import { describe, it, expect, vi } from 'vitest';
import { CodexAdapter } from '../../../src/infrastructure/adapters/codex.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// Top-level mock so vi.mock hoisting applies to the whole module.
// execFile is intercepted; by default it succeeds with a version string.
// Individual tests override this via mockImplementationOnce.
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
        cb(null, 'codex/1.0.0', '');
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
    prompt: 'codex prompt',
    workspace: '/tmp/codex-ws',
    config: { adapter: 'codex' },
    ...overrides,
  };
}

describe('CodexAdapter', () => {
  describe('execute', () => {
    it('spawns codex with correct args including stdin pipe', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      adapter.execute(makeParams());

      expect(pm.spawn).toHaveBeenCalledWith(
        'codex',
        expect.arrayContaining(['exec', '--json', '--sandbox', 'danger-full-access', '-']),
        expect.objectContaining({
          cwd: '/tmp/codex-ws',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
    });

    it('writes prompt to stdin', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      const writeSpy = vi.spyOn(proc.stdin, 'write');
      const endSpy = vi.spyOn(proc.stdin, 'end');

      adapter.execute(makeParams());

      expect(writeSpy).toHaveBeenCalledWith('codex prompt');
      expect(endSpy).toHaveBeenCalled();
    });

    it('prepends systemPrompt to stdin when provided (no native --system-prompt support)', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      const writeSpy = vi.spyOn(proc.stdin, 'write');

      adapter.execute(makeParams({ systemPrompt: 'system instructions', prompt: 'user task' }));

      expect(writeSpy).toHaveBeenCalledWith('system instructions\n\nuser task');
    });

    it('writes only userPrompt to stdin when systemPrompt is absent', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      const writeSpy = vi.spyOn(proc.stdin, 'write');

      adapter.execute(makeParams({ prompt: 'just the task', systemPrompt: undefined }));

      expect(writeSpy).toHaveBeenCalledWith('just the task');
    });

    it('includes --model when config.model is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'codex', model: 'gpt-4' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('gpt-4');
    });

    it('returns pid', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());
      expect(handle.pid).toBe(7777);
    });

    it('parses turn.completed as done with tokens', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 200, output_tokens: 80 },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
      expect(events[0]!.tokens).toEqual({ input: 200, output: 80, reasoning: 0, total: 280, cache_read: 0, cache_write: 0 });
    });

    it('parses turn.failed as error', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'turn.failed', error: 'bad' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
    });

    it('drops thread and turn lifecycle noise', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'thread.started' }) + '\n');
      proc.stdout.write(JSON.stringify({ type: 'turn.started' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toEqual([]);
    });

    it('normalizes item.completed agent_message to canonical output data', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: { id: 'item_0', type: 'agent_message', text: 'hello' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toMatchObject({
        text: 'hello',
        raw: { id: 'item_0', type: 'agent_message', text: 'hello' },
      });
    });

    it('normalizes completed command_execution and drops its started event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.started',
        item: { type: 'command_execution', command: 'ls', status: 'in_progress' },
      }) + '\n');
      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'ls', aggregated_output: 'file.txt\n', exit_code: 0 },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('command');
      expect(events[0]!.data).toMatchObject({ command: 'ls', result: 'file.txt\n' });
    });

    it('parses item.completed with file_change and extracts paths', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'file_change',
          changes: [{ path: 'a.ts' }, { path: 'b.ts' }],
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('file_change');
      expect((events[0]!.data as any).paths).toEqual(['a.ts', 'b.ts']);
    });

    it('normalizes completed tool_use as canonical tool_call', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: { type: 'tool_use', name: 'search', input: { query: 'orch' } },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('tool_call');
      expect(events[0]!.data).toMatchObject({ name: 'search', input: { query: 'orch' } });
    });

    it('normalizes completed web_search as a tool_call instead of text output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'call_1',
          type: 'web_search',
          query: 'privacy preserving AI',
          action: { type: 'search', queries: ['privacy preserving AI'] },
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('tool_call');
      expect(events[0]!.data).toMatchObject({
        name: 'web_search',
        input: { query: 'privacy preserving AI' },
      });
    });

    it('parses item.completed with error type as error', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: { type: 'error', message: 'oops' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
      expect(events[0]!.data).toMatchObject({ message: 'oops' });
    });

    it('handles non-JSON lines gracefully', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write('garbage\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('garbage');
    });

    it('throws on non-zero exit without done event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      await expect(async () => {
        for await (const ev of handle.events) { /* drain */ }
      }).rejects.toThrow('exited with code 1');
    });

    it('parses error event at top level', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'fatal' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
      expect(events[0]!.data).toMatchObject({ message: 'fatal' });
    });

    it('unwraps nested provider JSON and suppresses the duplicate turn.failed error', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());
      const providerError = JSON.stringify({
        type: 'error',
        status: 400,
        error: {
          type: 'invalid_request_error',
          message: "The 'gpt-5.6' model is not supported when using Codex with a ChatGPT account.",
        },
      });

      proc.stdout.write(JSON.stringify({
        type: 'error',
        message: providerError,
      }) + '\n');
      proc.stdout.write(JSON.stringify({
        type: 'turn.failed',
        error: { message: providerError },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      expect(events[0]!.data).toMatchObject({
        message: "The 'gpt-5.6' model is not supported when using Codex with a ChatGPT account.",
      });
    });

    it('keeps model metadata warnings out of the error stream', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'error',
          message: 'Model metadata for `gpt-5.6` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toMatchObject({
        text: expect.stringContaining('Model metadata for `gpt-5.6` not found'),
      });
    });

    it('turn.failed error event has errorKind set via classifyAdapterError', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'turn.failed', error: 'something broke' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.errorKind).toBeDefined();
    });

    it('item.completed error item has errorKind UNKNOWN for generic message', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'item.completed',
        item: { type: 'error', message: 'generic failure' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.errorKind).toBe(AdapterErrorKind.UNKNOWN);
    });

    it('top-level error event has errorKind AUTH_FAILED when message contains "401"', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'HTTP 401 unauthorized' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.errorKind).toBe(AdapterErrorKind.AUTH_FAILED);
    });
  });

  describe('test', () => {
    it('returns errorKind SPAWN_FAILED when execFile throws an ENOENT error', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementationOnce(
        (
          _cmd: unknown,
          _args: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          const err = new Error('spawn codex ENOENT');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          cb(err, '', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      const result = await adapter.test();

      expect(result.errorKind).toBe(AdapterErrorKind.SPAWN_FAILED);
    });
  });

  describe('stop', () => {
    it('calls killWithGrace', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new CodexAdapter(pm);

      await adapter.stop(7777);
      expect(pm.killWithGrace).toHaveBeenCalledWith(7777);
    });
  });

  describe('kind', () => {
    it('returns codex', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      expect(new CodexAdapter(pm).kind).toBe('codex');
    });
  });
});
