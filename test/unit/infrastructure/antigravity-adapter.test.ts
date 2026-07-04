import { describe, it, expect, vi } from 'vitest';
import { AntigravityAdapter } from '../../../src/infrastructure/adapters/antigravity.js';
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
        cb(null, 'agy 2.0.0', '');
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
  proc.pid = 8888;
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
    prompt: 'antigravity prompt',
    workspace: '/tmp/agy-ws',
    config: {},
    ...overrides,
  };
}

describe('AntigravityAdapter', () => {
  it('spawns agy with headless prompt args', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new AntigravityAdapter(pm);

    adapter.execute(makeParams());

    expect(pm.spawn).toHaveBeenCalledWith(
      'agy',
      expect.arrayContaining([
        '-p',
        'antigravity prompt',
        '--dangerously-skip-permissions',
      ]),
      expect.objectContaining({ cwd: '/tmp/agy-ws' }),
    );
  });

  it('prepends system prompt and passes model', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new AntigravityAdapter(pm);

    adapter.execute(makeParams({
      systemPrompt: 'system instructions',
      prompt: 'user task',
      config: { model: 'gemini-3-pro' },
    }));

    const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(args).toContain('system instructions\n\nuser task');
    expect(args).toContain('--model');
    expect(args).toContain('gemini-3-pro');
  });

  it('streams plain stdout lines and emits done', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new AntigravityAdapter(pm);
    const handle = adapter.execute(makeParams());

    proc.stdout.write('line one\n');
    proc.stdout.write('line two\n');
    proc.stdout.end();
    setTimeout(() => proc.emit('close', 0), 20);

    const events: AgentEvent[] = [];
    for await (const ev of handle.events) events.push(ev);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'output', data: { text: 'line one' } });
    expect(events[1]).toMatchObject({ type: 'output', data: { text: 'line two' } });
    expect(events[2]).toMatchObject({ type: 'done', data: { result: 'line one\nline two' } });
  });

  it('throws on non-zero exit', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new AntigravityAdapter(pm);
    const handle = adapter.execute(makeParams());

    proc.stdout.end();
    setTimeout(() => proc.emit('close', 1), 20);

    await expect(async () => {
      for await (const ev of handle.events) { void ev; }
    }).rejects.toThrow('Antigravity process exited with code 1');
  });

  it('returns antigravity kind', () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    expect(new AntigravityAdapter(pm).kind).toBe('antigravity');
  });

  it('calls killWithGrace on stop', async () => {
    const proc = createMockProcess();
    const pm = createMockProcessManager(proc);
    const adapter = new AntigravityAdapter(pm);

    await adapter.stop(8888);
    expect(pm.killWithGrace).toHaveBeenCalledWith(8888);
  });
});
