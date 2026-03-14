import { describe, it, expect, vi } from 'vitest';
import { OpenCodeAdapter } from '../../../src/infrastructure/adapters/opencode.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';
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
        cb(null, '1.2.26', '');
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
    prompt: 'test prompt',
    workspace: '/tmp/workspace',
    config: { adapter: 'opencode' },
    ...overrides,
  };
}

describe('OpenCodeAdapter', () => {
  describe('kind', () => {
    it('returns opencode', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      expect(adapter.kind).toBe('opencode');
    });
  });

  describe('execute', () => {
    it('spawns opencode with correct args', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      adapter.execute(makeParams());

      expect(pm.spawn).toHaveBeenCalledWith(
        'opencode',
        expect.arrayContaining([
          'run',
          '--format', 'json',
          'test prompt',
        ]),
        expect.objectContaining({ cwd: '/tmp/workspace' }),
      );
      // No --dir flag — workspace is set via cwd
      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).not.toContain('--dir');
    });

    it('includes --model when config.model is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'opencode', model: 'anthropic/claude-sonnet-4' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).toContain('--model');
      expect(args).toContain('anthropic/claude-sonnet-4');
    });

    it('prepends systemPrompt to prompt (no native --system-prompt)', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      adapter.execute(makeParams({
        prompt: 'user task',
        systemPrompt: 'system instructions',
      }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      const lastArg = args[args.length - 1];
      expect(lastArg).toBe('system instructions\n\nuser task');
    });

    it('passes prompt as-is when no systemPrompt', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      adapter.execute(makeParams({ prompt: 'just the prompt' }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toBe('just the prompt');
    });

    it('returns pid in handle', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      const handle = adapter.execute(makeParams());
      expect(handle.pid).toBe(7777);
    });

    it('parses text event as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'text',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: { type: 'text', text: 'hello world' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('hello world');
    });

    it('skips step_start lifecycle event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_start',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: { type: 'step-start', snapshot: 'abc123' },
      }) + '\n');
      proc.stdout.write(JSON.stringify({
        type: 'text',
        part: { text: 'hello' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      // step_start is skipped, only text event remains
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('hello');
    });

    it('parses tool_use event as tool_call', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'tool_use',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: {
          type: 'tool',
          tool: 'write',
          state: { status: 'completed', input: { filePath: '/tmp/test.txt', content: 'test' } },
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('tool_call');
      const data = events[0]!.data as Record<string, unknown>;
      expect(data.name).toBe('write');
      expect(data.input).toEqual({ filePath: '/tmp/test.txt', content: 'test' });
    });

    it('parses tool_use with error status as error event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'tool_use',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: {
          type: 'tool',
          tool: 'write',
          state: { status: 'error', error: 'The user rejected permission' },
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
    });

    it('parses step_finish reason=stop as done with tokens', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_finish',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: {
          type: 'step-finish',
          reason: 'stop',
          tokens: { total: 14502, input: 12416, output: 2, reasoning: 0 },
          cost: 0,
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
      expect(events[0]!.tokens).toEqual({ input: 12416, output: 2, total: 12418 });
    });

    it('skips step_finish reason=tool-calls (intermediate lifecycle)', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_finish',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: {
          type: 'step-finish',
          reason: 'tool-calls',
          tokens: { total: 500, input: 400, output: 100 },
        },
      }) + '\n');
      proc.stdout.write(JSON.stringify({
        type: 'text',
        part: { text: 'next step' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      // step_finish tool-calls is skipped, only text event remains
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('output');
    });

    it('parses step_finish reason=error as error event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_finish',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: { type: 'step-finish', reason: 'error', error: 'model overloaded' },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
    });

    it('handles non-JSON lines gracefully', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write('not json at all\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
      expect(events[0]!.data).toBe('not json at all');
    });

    it('skips empty lines', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write('\n\n');
      proc.stdout.write(JSON.stringify({ type: 'text', part: { text: 'hi' } }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
    });

    it('throws on non-zero exit code when no done event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      await expect(async () => {
        for await (const ev of handle.events) events.push(ev);
      }).rejects.toThrow('exited with code 1');
    });

    it('does not throw on non-zero exit when done event was received', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { total: 100, input: 80, output: 20 } },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
    });

    it('parses step_finish with unknown reason (e.g. max_tokens) as done', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'step_finish',
        timestamp: 1234,
        sessionID: 'ses_1',
        part: {
          type: 'step-finish',
          reason: 'max_tokens',
          tokens: { total: 8000, input: 7000, output: 1000 },
        },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
      expect(events[0]!.tokens).toEqual({ input: 7000, output: 1000, total: 8000 });
    });

    it('parses unknown event type as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'unknown_type', data: 'info' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
    });
  });

  describe('test', () => {
    it('returns errorKind SPAWN_FAILED when execFile throws ENOENT', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementationOnce(
        (
          _cmd: unknown,
          _args: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          const err = new Error('spawn opencode ENOENT');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          cb(err, '', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      const result = await adapter.test();

      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(AdapterErrorKind.SPAWN_FAILED);
    });
  });

  describe('stop', () => {
    it('calls killWithGrace on processManager', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new OpenCodeAdapter(pm);

      await adapter.stop(7777);
      expect(pm.killWithGrace).toHaveBeenCalledWith(7777);
    });
  });
});
