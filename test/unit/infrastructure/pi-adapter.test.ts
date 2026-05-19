import { describe, it, expect, vi } from 'vitest';
import { PiAdapter } from '../../../src/infrastructure/adapters/pi.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { AgentEvent, ExecuteParams } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => {
      const cb = args.at(-1) as (err: Error | null, stdout: string, stderr: string) => void;
      cb(null, 'pi 1.0.0', '');
      return {};
    }),
  };
});

type MockProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  pid: number;
  kill: () => void;
};

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.pid = 8888;
  proc.kill = vi.fn();
  return proc;
}

function createMockProcessManager(proc: MockProcess): IProcessManager {
  return {
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ process: proc as unknown as ChildProcess, pid: proc.pid })),
  };
}

function makeParams(overrides?: Partial<ExecuteParams>): ExecuteParams {
  return {
    prompt: 'pi prompt',
    workspace: '/tmp/pi-ws',
    config: { adapter: 'pi' },
    ...overrides,
  };
}

async function collectEvents(handle: { events: AsyncGenerator<AgentEvent> }, proc: ReturnType<typeof createMockProcess>): Promise<AgentEvent[]> {
  proc.stdout.end();
  setTimeout(() => proc.emit('close', 0), 20);
  const events: AgentEvent[] = [];
  for await (const ev of handle.events) events.push(ev);
  return events;
}

describe('PiAdapter', () => {
  describe('execute', () => {
    it('spawns pi in rpc mode with stdin pipe and session persistence enabled by default', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      adapter.execute(makeParams());

      expect(pm.spawn).toHaveBeenCalledWith(
        'pi',
        expect.arrayContaining(['--mode', 'rpc']),
        expect.objectContaining({
          cwd: '/tmp/pi-ws',
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).not.toContain('--no-session');
    });

    it('passes model and effort as --model and --thinking', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'pi', model: 'openai-codex/gpt-5.5', effort: 'high' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('openai-codex/gpt-5.5');
      expect(args).toContain('--thinking');
      expect(args).toContain('high');
    });

    it('appends orchestrator systemPrompt without replacing Pi harness prompt', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      adapter.execute(makeParams({ systemPrompt: 'system instructions' }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--append-system-prompt');
      expect(args).toContain('system instructions');
      expect(args).not.toContain('--system-prompt');
    });

    it('writes a prompt command to stdin as JSONL', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const writeSpy = vi.spyOn(proc.stdin, 'write');

      adapter.execute(makeParams({ prompt: 'do work' }));

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const line = String(writeSpy.mock.calls[0][0]);
      expect(line.endsWith('\n')).toBe(true);
      expect(JSON.parse(line)).toMatchObject({ type: 'prompt', message: 'do work' });
    });

    it('keeps stdin open so Pi RPC long-lived session can drive the LLM call', () => {
      // Pi --mode rpc is persistent: the prompt write is a request, the LLM
      // call runs asynchronously inside pi, and closing stdin stalls it after
      // user-message_end (verified on pi-coding-agent 0.73.1). We terminate
      // pi via killWithGrace after the terminal `done` event instead.
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const endSpy = vi.spyOn(proc.stdin, 'end');

      adapter.execute(makeParams({ prompt: 'do work' }));

      expect(endSpy).not.toHaveBeenCalled();
    });

    it('ignores extension_ui_request events', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'extension_ui_request', method: 'setTitle', title: 'noise' }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events).toEqual([]);
    });

    it('maps text_delta message updates to output events', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events[0]!.type).toBe('output');
      expect((events[0]!.data as any).text).toBe('hello');
    });

    it('maps tool execution events to tool_call and output events', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'tool_execution_start', toolName: 'read', args: { path: 'a.ts' } }) + '\n');
      proc.stdout.write(JSON.stringify({ type: 'tool_execution_end', toolName: 'read', result: { content: [{ type: 'text', text: 'ok' }] }, isError: false }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events[0]!.type).toBe('tool_call');
      expect((events[0]!.data as any).name).toBe('read');
      expect(events[1]!.type).toBe('output');
    });

    it('maps bash tool execution to command events', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'bash',
        args: { command: 'npm test' },
        result: { content: [{ type: 'text', text: 'passed' }], details: { exitCode: 0 } },
        isError: false,
      }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events[0]!.type).toBe('command');
      expect((events[0]!.data as any).command).toBe('npm test');
    });

    it('maps write/edit tool execution to file_change events', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'tool_execution_end',
        toolName: 'write',
        args: { path: 'src/new.ts' },
        result: { content: [{ type: 'text', text: 'written' }] },
        isError: false,
      }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events[0]!.type).toBe('file_change');
      expect((events[0]!.data as any).paths).toEqual(['src/new.ts']);
    });

    it('maps large agent_end lines to done without truncating JSON', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());
      const largeText = 'x'.repeat(20_000);

      proc.stdout.write(JSON.stringify({
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: largeText }], usage: { input: 10, output: 4, totalTokens: 14 } }],
      }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events.at(-1)!.type).toBe('done');
      expect((events.at(-1)!.data as any).result).toBe(largeText);
    });

    it('maps agent_end to done with final text and tokens', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'done text' },
      }) + '\n');
      proc.stdout.write(JSON.stringify({
        type: 'agent_end',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'done text' }], usage: { input: 10, output: 4, totalTokens: 14 } }],
      }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events.at(-1)!.type).toBe('done');
      expect((events.at(-1)!.data as any).result).toBe('done text');
      expect(events.at(-1)!.tokens).toEqual({ input: 10, output: 4, reasoning: 0, total: 14, cache_read: 0, cache_write: 0 });
    });

    it('maps response failure to error', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'response', command: 'prompt', success: false, error: 'bad request' }) + '\n');

      const events = await collectEvents(handle, proc);

      expect(events[0]!.type).toBe('error');
      expect(events[0]!.errorKind).toBe(AdapterErrorKind.UNKNOWN);
    });

    it('yields an error event when stdout emits an error before any line', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      // Trigger 'error' on stdout before any data — the for await must catch it
      // and surface an error event instead of throwing an unhandled rejection.
      setTimeout(() => proc.stdout.emit('error', new Error('ECONNRESET')), 5);
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      expect((events[0]!.data as { message: string }).message).toContain('ECONNRESET');
      // Pi adapter must clean up the process when the stream dies before 'done'.
      expect(pm.killWithGrace).toHaveBeenCalledWith(proc.pid, 1_000);
    });

    it('kills the process when the abort signal fires before a done event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const controller = new AbortController();
      const handle = adapter.execute(makeParams({ signal: controller.signal }));

      // Emit a non-terminal event, then abort. The generator must break and
      // schedule killWithGrace via the finally block.
      proc.stdout.write(JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'partial' } }) + '\n');
      setTimeout(() => {
        controller.abort();
        proc.stdout.end();
        proc.emit('close', null);
      }, 10);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(pm.killWithGrace).toHaveBeenCalledWith(proc.pid, 1_000);
    });

    it('appends stderr tail to error message on non-zero exit', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stderr.write('error: failed to load extension foo\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 2), 20);

      await expect(async () => {
        for await (const _ev of handle.events) { void _ev; }
      }).rejects.toThrow(/failed to load extension foo/);
    });
  });

  describe('test', () => {
    it('returns ok when pi --version succeeds', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      const result = await adapter.test();

      expect(result.ok).toBe(true);
      expect(result.version).toBe('pi 1.0.0');
    });

    it('returns SPAWN_FAILED when pi is missing', async () => {
      const { execFile } = await import('node:child_process');
      vi.mocked(execFile).mockImplementationOnce(
        (
          _cmd: unknown,
          _args: unknown,
          cb: (err: Error | null, stdout: string, stderr: string) => void,
        ) => {
          const err = new Error('spawn pi ENOENT');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          cb(err, '', '');
          return {} as ReturnType<typeof execFile>;
        },
      );
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      const result = await adapter.test();

      expect(result.ok).toBe(false);
      expect(result.errorKind).toBe(AdapterErrorKind.SPAWN_FAILED);
    });
  });

  describe('stop', () => {
    it('calls killWithGrace', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new PiAdapter(pm);

      await adapter.stop(8888);

      expect(pm.killWithGrace).toHaveBeenCalledWith(8888);
    });
  });

  describe('kind', () => {
    it('returns pi', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      expect(new PiAdapter(pm).kind).toBe('pi');
    });
  });
});
