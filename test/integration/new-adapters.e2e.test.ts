/**
 * Grok and Antigravity adapters — end-to-end through the Orchestrator.
 *
 * These tests use the real adapter classes, AdapterRegistry, Orchestrator,
 * task/agent/run services, state machine, and JSONL run event path. The spawned
 * process is mocked, matching the existing Pi adapter e2e style, so CI does not
 * need live Grok or Antigravity credentials.
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { SpawnResult, IProcessManager } from '../../src/infrastructure/process/process-manager.js';
import { Orchestrator } from '../../src/application/orchestrator.js';
import { GrokAdapter } from '../../src/infrastructure/adapters/grok.js';
import { AntigravityAdapter } from '../../src/infrastructure/adapters/antigravity.js';
import { AdapterRegistry } from '../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter } from '../../src/infrastructure/adapters/interface.js';
import type { OrchestratorEvent } from '../../src/domain/events.js';
import {
  buildDeps,
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  cleanupOrch,
} from '../unit/application/helpers.js';

type MockProc = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
};

function createMockProcess(pid = 30101): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = pid;
  proc.kill = vi.fn();
  return proc;
}

async function waitFor<T>(
  predicate: () => Promise<T | null | undefined> | T | null | undefined,
  timeoutMs = 2000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

interface Harness {
  proc: MockProc;
  processManager: IProcessManager;
  taskStore: ReturnType<typeof createMockTaskStore>;
  agentStore: ReturnType<typeof createMockAgentStore>;
  runStore: ReturnType<typeof createMockRunStore>;
  events: OrchestratorEvent[];
  orch: Orchestrator;
}

async function buildHarness(adapterKind: 'grok' | 'antigravity', adapterFactory: (pm: IProcessManager) => IAgentAdapter): Promise<Harness> {
  const proc = createMockProcess(adapterKind === 'grok' ? 30101 : 30102);
  const processManager: IProcessManager = {
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn((): SpawnResult => ({ process: proc as unknown as ChildProcess, pid: proc.pid })),
  };

  const agent = makeAgent({
    id: `agt_${adapterKind}`,
    name: `${adapterKind}-engineer`,
    adapter: adapterKind,
    status: 'idle',
    config: { approval_policy: 'auto', max_turns: 5 },
  });
  const task = makeTask({
    id: `tsk_${adapterKind}`,
    title: `Exercise ${adapterKind}`,
    status: 'todo',
  });

  const taskStore = createMockTaskStore([task]);
  const agentStore = createMockAgentStore([agent]);
  const runStore = createMockRunStore();
  const stateStore = createMockStateStore();

  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(adapterFactory(processManager));

  const deps = buildDeps({
    taskStore,
    agentStore,
    runStore,
    stateStore,
    processManager,
    adapterRegistry,
  });

  const events: OrchestratorEvent[] = [];
  deps.eventBus.onAny((e) => events.push(e));

  const orch = new Orchestrator(deps);
  await (orch as { loadState: () => Promise<void> }).loadState();

  return { proc, processManager, taskStore, agentStore, runStore, events, orch };
}

describe('new adapters — e2e through Orchestrator', () => {
  it('drives a Grok task todo → in_progress → review → done', async () => {
    const h = await buildHarness('grok', (pm) => new GrokAdapter(pm));
    try {
      await (h.orch as { tick: () => Promise<void> }).tick();

      expect(h.processManager.spawn).toHaveBeenCalledOnce();
      const spawnCall = (h.processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(spawnCall[0]).toBe('grok');
      expect(spawnCall[1]).toEqual(expect.arrayContaining([
        '-p',
        'rendered prompt',
        '--output-format',
        'streaming-json',
        '--permission-mode',
        'bypassPermissions',
      ]));

      h.proc.stdout.write(JSON.stringify({ type: 'thought', data: 'skip' }) + '\n');
      h.proc.stdout.write(JSON.stringify({ type: 'text', data: 'Grok result' }) + '\n');
      h.proc.stdout.write(JSON.stringify({ type: 'tool_call', name: 'read', input: { path: 'src/index.ts' } }) + '\n');
      h.proc.stdout.write(JSON.stringify({ type: 'end', stopReason: 'EndTurn' }) + '\n');
      h.proc.stdout.end();
      setTimeout(() => h.proc.emit('close', 0), 20);

      const finalTask = await waitFor(async () => {
        const t = await h.taskStore.get('tsk_grok');
        return t?.status === 'done' ? t : null;
      });

      expect(finalTask.status).toBe('done');
      const agent = await h.agentStore.get('agt_grok');
      expect(agent!.status).toBe('idle');
      expect(agent!.stats.tasks_completed).toBe(1);

      const run = (await h.runStore.listAll())[0]!;
      const runEvents = await h.runStore.readEvents(run.id);
      expect(runEvents.map((e) => e.type).sort()).toEqual(['agent_output', 'done', 'tool_call']);
      expect(runEvents.at(-1)!.type).toBe('done');
      expect(runEvents.find((e) => e.type === 'agent_output')!.data).toBe(JSON.stringify({ text: 'Grok result' }));
    } finally {
      cleanupOrch(h.orch);
    }
  });

  it('drives an Antigravity task todo → in_progress → review → done', async () => {
    const h = await buildHarness('antigravity', (pm) => new AntigravityAdapter(pm));
    try {
      await (h.orch as { tick: () => Promise<void> }).tick();

      expect(h.processManager.spawn).toHaveBeenCalledOnce();
      const spawnCall = (h.processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(spawnCall[0]).toBe('agy');
      expect(spawnCall[1]).toContain('-p');
      expect(spawnCall[1][spawnCall[1].indexOf('-p') + 1]).toContain('rendered prompt');
      expect(spawnCall[1]).toContain('--dangerously-skip-permissions');

      h.proc.stdout.write('Antigravity line one\n');
      h.proc.stdout.write('Antigravity line two\n');
      h.proc.stdout.end();
      setTimeout(() => h.proc.emit('close', 0), 20);

      const finalTask = await waitFor(async () => {
        const t = await h.taskStore.get('tsk_antigravity');
        return t?.status === 'done' ? t : null;
      });

      expect(finalTask.status).toBe('done');
      const agent = await h.agentStore.get('agt_antigravity');
      expect(agent!.status).toBe('idle');
      expect(agent!.stats.tasks_completed).toBe(1);

      const run = (await h.runStore.listAll())[0]!;
      const runEvents = await h.runStore.readEvents(run.id);
      expect(runEvents.map((e) => e.type)).toEqual(['agent_output', 'agent_output', 'done']);
      expect(runEvents[0]!.data).toBe(JSON.stringify({ text: 'Antigravity line one' }));
      expect(runEvents[2]!.data).toBe(JSON.stringify({ result: 'Antigravity line one\nAntigravity line two' }));
    } finally {
      cleanupOrch(h.orch);
    }
  });
});
