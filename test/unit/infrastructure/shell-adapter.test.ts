import { describe, it, expect, vi } from 'vitest';
import { ShellAdapter } from '../../../src/infrastructure/adapters/shell.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

/** Create a minimal mock process with controllable stdout/stderr streams. */
function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: null;
    pid: number;
    kill: () => void;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = null;
  proc.pid = 9999;
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
    prompt: 'test prompt',
    workspace: '/tmp',
    config: { command: 'echo hello', adapter: 'shell' },
    security: { allowShellAdapter: true },
    ...overrides,
  };
}

describe('ShellAdapter', () => {
  it('is disabled by default', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams({ security: undefined }));
    const events: AgentEvent[] = [];
    for await (const ev of handle.events) events.push(ev);

    expect(pm.spawn).not.toHaveBeenCalled();
    expect(events[0]!.data).toContain('Shell adapter is disabled');
  });

  it('yields output events from stdout', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams());

    // Simulate stdout output then close streams
    proc.stdout.write('hello world\n');
    proc.stdout.end();
    proc.stderr.end();

    // Process exits cleanly
    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'output' && e.data === 'hello world')).toBe(true);
  });

  it('yields error events from stderr', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams());

    proc.stdout.end();
    proc.stderr.write('something went wrong\n');
    proc.stderr.end();

    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    expect(events.some((e) => e.type === 'error' && e.data === 'something went wrong')).toBe(true);
  });

  it('does not hang when stream emits an error (buffer.close is called)', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams());

    // Simulate stream error — this is the critical test:
    // Before the fix, the buffer would never close and the generator would hang forever.
    proc.stdout.destroy(new Error('stream read error'));
    proc.stderr.end();

    setTimeout(() => proc.emit('close', 1), 20);

    const events: AgentEvent[] = [];

    // Use a timeout to detect hanging — if buffer.close() is never called, this will timeout
    const result = await Promise.race([
      (async () => {
        for await (const ev of handle.events) {
          events.push(ev);
        }
        return 'completed';
      })().catch(() => 'error'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 3000)),
    ]);

    expect(result).not.toBe('timeout');
  });

  it('does not expose the user prompt in the child environment', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    adapter.execute(makeParams({ prompt: 'user task' }));

    const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(spawnCall[2].env['ORCHESTRY_TASK_PROMPT']).toBeUndefined();
    expect(Object.values(spawnCall[2].env)).not.toContain('user task');
  });

  it('does not expose the system prompt in the child environment', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    adapter.execute(makeParams({ systemPrompt: 'be concise', prompt: 'user task' }));

    const spawnCall = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(spawnCall[2].env['ORCHESTRY_TASK_PROMPT']).toBeUndefined();
    expect(Object.values(spawnCall[2].env)).not.toContain('be concise');
    expect(Object.values(spawnCall[2].env)).not.toContain('user task');
  });

  it('returns immediate error for missing command', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams({ config: { adapter: 'shell' } }));

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].data).toContain('requires a command');
  });

  it('stderr error event has errorKind set by classifyAdapterError', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams());

    proc.stdout.end();
    proc.stderr.write('something went wrong\n');
    proc.stderr.end();

    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
    expect(errEvent!.errorKind).toBeDefined();
  });

  it('stderr error event has errorKind UNKNOWN for a generic stderr line', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams());

    proc.stdout.end();
    proc.stderr.write('generic failure message\n');
    proc.stderr.end();

    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent!.errorKind).toBe(AdapterErrorKind.UNKNOWN);
  });

  it('missing command error event has errorKind SPAWN_FAILED', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new ShellAdapter(pm);

    const handle = adapter.execute(makeParams({ config: { adapter: 'shell' } }));

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) {
      events.push(ev);
    }

    expect(events[0]!.errorKind).toBe(AdapterErrorKind.SPAWN_FAILED);
  });
});
