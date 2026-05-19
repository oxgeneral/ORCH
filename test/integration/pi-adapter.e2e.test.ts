/**
 * Pi adapter — end-to-end through the Orchestrator.
 *
 * Drives one task through the full lifecycle using a real PiAdapter, a real
 * Orchestrator, real state machine + JSONL run storage, and a mocked
 * ProcessManager.spawn() that returns a controllable child process.
 *
 * What this test asserts "from-and-to":
 *   1. Dispatch: orchestrator pulls a todo task, finds the pi agent, calls
 *      PiAdapter.execute() — which spawns, writes the prompt JSONL to stdin,
 *      and closes stdin (B1).
 *   2. Stream: feeding RPC events to stdout (text_delta, tool_execution_start,
 *      bash + write tool ends, agent_end with usage) produces the matching
 *      AgentEvents on the orchestrator's event bus.
 *   3. Collect + state machine: each event is appended to the run's JSONL,
 *      and the task transitions todo → in_progress → review → done
 *      (auto-approve, because makeAgent() sets approval_policy=auto).
 *   4. Cleanup: after the terminal `done` event, PiAdapter kills the long-lived
 *      Pi RPC process via processManager.killWithGrace(pid, 1000).
 *   5. Tokens: usage from agent_end propagates onto the done event.
 *
 * This is the template for "e2e through Orchestrator" adapter tests. For a new
 * adapter: copy this file, swap PiAdapter for the new adapter, and rewrite the
 * stdout JSONL payloads + parse-specific assertions.
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { SpawnResult, IProcessManager } from '../../src/infrastructure/process/process-manager.js';
import { Orchestrator } from '../../src/application/orchestrator.js';
import { PiAdapter } from '../../src/infrastructure/adapters/pi.js';
import { AdapterRegistry } from '../../src/infrastructure/adapters/registry.js';
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

function createMockProcess(pid = 24601): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = pid;
  proc.kill = vi.fn();
  return proc;
}

/** Wait until `predicate()` returns truthy, polling at 5 ms intervals. */
async function waitFor<T>(predicate: () => Promise<T | null | undefined> | T | null | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitFor: predicate did not become truthy within ${timeoutMs}ms`);
}

describe('Pi adapter — end-to-end through Orchestrator', () => {
  it('drives a task todo → in_progress → review → done via real PiAdapter + mocked spawn', async () => {
    // ── 1. Mock child process and ProcessManager ───────────────────────────
    const proc = createMockProcess();
    const stdinEndSpy = vi.spyOn(proc.stdin, 'end');

    const killWithGrace = vi.fn(async (_pid: number, _timeoutMs?: number) => {
      // Mirror real ProcessManager behavior: a graceful kill closes the process.
      setImmediate(() => proc.emit('close', 0));
    });

    const processManager: IProcessManager = {
      isAlive: vi.fn(() => true),
      kill: vi.fn(),
      killWithGrace,
      spawn: vi.fn((): SpawnResult => ({ process: proc as unknown as ChildProcess, pid: proc.pid })),
    };

    // ── 2. Seed stores with one pi agent and one todo task ─────────────────
    const agent = makeAgent({
      id: 'agt_pi',
      name: 'pi-engineer',
      adapter: 'pi',
      status: 'idle',
      // approval_policy=auto comes from makeAgent default — review auto-approves.
    });
    const task = makeTask({
      id: 'tsk_pi',
      title: 'Implement feature X',
      status: 'todo',
    });

    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();
    const stateStore = createMockStateStore();

    // ── 3. Real PiAdapter wired into a real AdapterRegistry ────────────────
    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(new PiAdapter(processManager));

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      stateStore,
      processManager,
      adapterRegistry,
    });

    // Record every orchestrator event so we can assert on the trace afterwards.
    const events: OrchestratorEvent[] = [];
    deps.eventBus.onAny((e: OrchestratorEvent) => {
      events.push(e);
    });

    const orch = new Orchestrator(deps);
    await (orch as { loadState: () => Promise<void> }).loadState();

    // ── 4. Tick 1 — dispatch (synchronous up to adapter.execute) ──────────
    await (orch as { tick: () => Promise<void> }).tick();

    expect(processManager.spawn).toHaveBeenCalledOnce();
    const spawnCall = (processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(spawnCall[0]).toBe('pi');
    expect(spawnCall[1]).toEqual(expect.arrayContaining(['--mode', 'rpc']));

    // Pi --mode rpc is a long-lived persistent session — stdin must stay open
    // so the LLM call can run. Closing stdin stalls pi after user-message_end
    // (verified on pi-coding-agent 0.73.1). The adapter terminates pi via
    // killWithGrace once the terminal `done` event arrives.
    expect(stdinEndSpy).not.toHaveBeenCalled();

    // After dispatch, the task is in_progress and the agent is busy.
    const dispatchedTask = await taskStore.get('tsk_pi');
    expect(dispatchedTask!.status).toBe('in_progress');
    const busyAgent = await agentStore.get('agt_pi');
    expect(busyAgent!.status).toBe('running');
    expect(busyAgent!.current_task).toBe('tsk_pi');

    // ── 5. Feed the Pi RPC event stream ────────────────────────────────────
    // Each chunk mirrors what `pi --mode rpc` emits as JSONL on stdout.
    proc.stdout.write(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Reading sources…' },
    }) + '\n');

    proc.stdout.write(JSON.stringify({
      type: 'tool_execution_start',
      toolName: 'read',
      args: { path: 'src/foo.ts' },
    }) + '\n');

    proc.stdout.write(JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'bash',
      args: { command: 'npm test' },
      result: { content: [{ type: 'text', text: 'passed' }], details: { exitCode: 0 } },
      isError: false,
    }) + '\n');

    proc.stdout.write(JSON.stringify({
      type: 'tool_execution_end',
      toolName: 'write',
      args: { path: 'src/foo.ts' },
      result: { content: [{ type: 'text', text: 'written' }] },
      isError: false,
    }) + '\n');

    proc.stdout.write(JSON.stringify({
      type: 'agent_end',
      messages: [{
        role: 'assistant',
        content: [{ type: 'text', text: 'Implementation complete.' }],
        usage: { input: 42, output: 17, reasoning: 3, cache_read: 5, cache_write: 0 },
      }],
    }) + '\n');

    // ── 6. Wait for the state machine to settle on `done` ──────────────────
    const finalTask = await waitFor(async () => {
      const t = await taskStore.get('tsk_pi');
      return t?.status === 'done' ? t : null;
    });

    // ── 7. Assertions on the full trace ────────────────────────────────────

    // State machine: every transition this task should have gone through.
    const taskTransitions = events
      .filter((e): e is Extract<OrchestratorEvent, { type: 'task:status_changed' }> =>
        e.type === 'task:status_changed' && (e as { taskId?: string }).taskId === 'tsk_pi',
      )
      .map((e) => `${e.from}→${e.to}`);
    expect(taskTransitions).toEqual(['todo→in_progress', 'in_progress→review', 'review→done']);

    // Final state: task done, agent idle again.
    expect(finalTask.status).toBe('done');
    const freedAgent = await agentStore.get('agt_pi');
    expect(freedAgent!.status).toBe('idle');
    expect(freedAgent!.current_task).toBeUndefined();
    expect(freedAgent!.stats.tasks_completed).toBe(1);

    // Adapter lifecycle: killWithGrace called by PiAdapter after the terminal event
    // (the orchestrator may also call it during cleanup; only the first call matters).
    expect(killWithGrace).toHaveBeenCalled();
    expect(killWithGrace.mock.calls[0]![0]).toBe(proc.pid);

    // Run events: the JSONL stream produced one event per emitted line, in order.
    const runs = await runStore.listAll();
    expect(runs).toHaveLength(1);
    const runId = runs[0]!.id;
    const runEvents = await runStore.readEvents(runId);
    const runEventTypes = runEvents.map((e) => e.type);
    // RunEvent types are the orchestrator-side names that AgentEvent types map to.
    expect(runEventTypes).toEqual([
      'agent_output', // text_delta
      'tool_call',    // tool_execution_start (read)
      'command_run',  // tool_execution_end (bash)
      'file_changed', // tool_execution_end (write)
      'done',         // agent_end
    ]);

    // Tokens: agent_end usage propagated onto the run after finish().
    // Cache tokens are informational and intentionally NOT added to `total`.
    const finalRun = await runStore.get(runId);
    expect(finalRun!.status).toBe('succeeded');
    expect(finalRun!.tokens).toEqual({
      input: 42,
      output: 17,
      reasoning: 3,
      cache_read: 5,
      cache_write: 0,
      total: 62, // input + output + reasoning (cache_read/write are informational)
    });

    cleanupOrch(orch);
  });
});
