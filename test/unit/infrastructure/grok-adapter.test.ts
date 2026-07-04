import { describe, it, expect, vi } from 'vitest';
import { GrokAdapter } from '../../../src/infrastructure/adapters/grok.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn(
      (
        _cmd: string,
        _args: string[],
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, 'grok 0.2.64', '');
      },
    ),
  };
});

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough | null;
    pid: number;
    kill: () => void;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = null;
  proc.pid = 7777;
  proc.kill = vi.fn();
  return proc;
}

function createMockProcessManager(proc: ReturnType<typeof createMockProcess>): IProcessManager {
  return {
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ process: proc as any, pid: proc.pid })),
  };
}

function makeParams(overrides?: Partial<ExecuteParams>): ExecuteParams {
  return {
    prompt: 'grok prompt',
    workspace: '/tmp/grok-ws',
    config: {},
    ...overrides,
  };
}

describe('GrokAdapter', () => {
  it('spawns grok with headless streaming-json args', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);

    adapter.execute(makeParams());

    expect(pm.spawn).toHaveBeenCalledWith(
      'grok',
      expect.arrayContaining([
        '-p', 'grok prompt',
        '--output-format', 'streaming-json',
        '--permission-mode', 'bypassPermissions',
        '--always-approve',
        '--cwd', '/tmp/grok-ws',
      ]),
      expect.objectContaining({ cwd: '/tmp/grok-ws' }),
    );
  });

  it('passes model, effort, max turns, and system prompt override', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);

    adapter.execute(makeParams({
      systemPrompt: 'system instructions',
      config: { model: 'grok-build', effort: 'high', max_turns: 7 },
    }));

    const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('grok-build');
    expect(args).toContain('--effort');
    expect(args).toContain('high');
    expect(args).toContain('--max-turns');
    expect(args).toContain('7');
    expect(args).toContain('--system-prompt-override');
    expect(args).toContain('system instructions');
  });

  it('aggregates text deltas and emits done on end', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);
    const handle = adapter.execute(makeParams());

    proc.stdout.write(JSON.stringify({ type: 'thought', data: 'skip me' }) + '\n');
    proc.stdout.write(JSON.stringify({ type: 'text', data: 'ORCH' }) + '\n');
    proc.stdout.write(JSON.stringify({ type: 'text', data: '_OK' }) + '\n');
    proc.stdout.write(JSON.stringify({ type: 'end', stopReason: 'EndTurn' }) + '\n');
    proc.stdout.end();
    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) events.push(ev);

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('output');
    expect(events[0]!.data).toEqual({ text: 'ORCH_OK' });
    expect(events[1]!.type).toBe('done');
    expect(events[1]!.data).toEqual({ result: 'ORCH_OK', raw: { type: 'end', stopReason: 'EndTurn' } });
  });

  it('parses tool and error events', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);
    const handle = adapter.execute(makeParams());

    proc.stdout.write(JSON.stringify({ type: 'tool_call', name: 'edit' }) + '\n');
    proc.stdout.write(JSON.stringify({ type: 'error', data: 'bad' }) + '\n');
    proc.stdout.end();
    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) events.push(ev);

    expect(events[0]!.type).toBe('tool_call');
    expect(events[1]!.type).toBe('error');
  });

  it('throws on non-zero exit without done event', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);
    const handle = adapter.execute(makeParams());

    proc.stdout.end();
    setTimeout(() => proc.emit('close', 1), 20);

    await expect(async () => {
      for await (const ev of handle.events) { void ev; }
    }).rejects.toThrow('Grok process exited with code 1');
  });

  it('returns grok kind', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    expect(new GrokAdapter(pm).kind).toBe('grok');
  });

  it('calls killWithGrace on stop', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new GrokAdapter(pm);

    await adapter.stop(7777);
    expect(pm.killWithGrace).toHaveBeenCalledWith(7777);
  });
});
