import { describe, it, expect, vi } from 'vitest';
import { CursorAdapter } from '../../../src/infrastructure/adapters/cursor.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// Top-level mock so vi.mock hoisting applies to the whole module.
// execFile is intercepted; by default both cursor-agent and agent binaries fail
// so that existing test() behaviour is predictable.  Individual tests override
// this via mockImplementationOnce.
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
        const err = new Error('spawn cursor-agent ENOENT');
        (err as NodeJS.ErrnoException).code = 'ENOENT';
        cb(err, '', '');
      },
    ),
  };
});

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    pid: number;
    kill: () => void;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
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
    prompt: 'cursor prompt',
    workspace: '/tmp/cursor-ws',
    config: { adapter: 'cursor' },
    ...overrides,
  };
}

describe('CursorAdapter', () => {
  describe('execute', () => {
    it('spawns cursor-agent with correct args', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      adapter.execute(makeParams());

      expect(pm.spawn).toHaveBeenCalledWith(
        'cursor-agent',
        [
          '-p',
          '--output-format', 'stream-json',
          '--workspace', '/tmp/cursor-ws',
          '--yolo',
          '--trust',
          'cursor prompt',
        ],
        expect.objectContaining({
          cwd: '/tmp/cursor-ws',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    });

    it('does not write prompt to stdin', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      const writeSpy = vi.spyOn(proc.stdin, 'write');
      adapter.execute(makeParams());

      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('prepends systemPrompt to the positional prompt when provided', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      adapter.execute(makeParams({ systemPrompt: 'system instructions', prompt: 'user task' }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args.at(-1)).toBe('system instructions\n\nuser task');
    });

    it('passes only userPrompt positionally when systemPrompt is absent', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      adapter.execute(makeParams({ prompt: 'just the task', systemPrompt: undefined }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args.at(-1)).toBe('just the task');
    });

    it('includes --model when config.model is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'cursor', model: 'gpt-4o' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4o');
      expect(args.at(-1)).toBe('cursor prompt');
    });

    it('returns pid', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      expect(adapter.execute(makeParams()).pid).toBe(8888);
    });

    it('parses assistant event as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'assistant', message: 'hi' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('hi');
    });

    it('parses tool_use as tool_call', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'tool_use', name: 'edit' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('tool_call');
    });

    it('parses error event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'cursor error' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
      expect(events[0]!.data).toBe('cursor error');
    });

    it('parses result as done with tokens', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'result',
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
      expect(events[0]!.tokens).toEqual({
        input: 50,
        output: 25,
        reasoning: 0,
        total: 75,
        cache_read: 10,
        cache_write: 5,
      });
    });

    it('handles non-JSON gracefully', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write('bad line\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('bad line');
    });

    it('throws on non-zero exit without done event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      await expect(async () => {
        for await (const ev of handle.events) { /* drain */ }
      }).rejects.toThrow('exited with code 1');
    });

    it('captures stderr and an immediate exit before event iteration starts', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stderr.end('Error: No prompt provided for print mode\n');
      proc.stdout.end();
      proc.emit('close', 1);

      await expect(async () => {
        for await (const ev of handle.events) { /* drain */ }
      }).rejects.toThrow(/No prompt provided for print mode/);
    });

    it('does not throw on non-zero exit when done event received', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'result' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
    });

    it('parses tool_result as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'tool_result', content: 'ok' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
    });
  });

  describe('test', () => {
    it('returns ok: false with errorKind ADAPTER_NOT_FOUND when no cursor binary is found', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      // The module-level mock already makes execFile fail with ENOENT for all commands,
      // so findCommand() returns null and test() returns ADAPTER_NOT_FOUND directly.
      const result = await adapter.test();

      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(AdapterErrorKind.ADAPTER_NOT_FOUND);
    });
  });

  describe('stop', () => {
    it('calls killWithGrace', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CursorAdapter(pm);

      await adapter.stop(8888);
      expect(pm.killWithGrace).toHaveBeenCalledWith(8888);
    });
  });

  describe('kind', () => {
    it('returns cursor', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      expect(new CursorAdapter(pm).kind).toBe('cursor');
    });
  });
});
