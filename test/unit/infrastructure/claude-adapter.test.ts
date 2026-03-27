import { describe, it, expect, vi } from 'vitest';
import { ClaudeAdapter } from '../../../src/infrastructure/adapters/claude.js';
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
        cb(null, 'claude/1.0.0', '');
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
  proc.pid = 5555;
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
    config: { adapter: 'claude', max_turns: 10 },
    ...overrides,
  };
}

describe('ClaudeAdapter', () => {
  describe('execute', () => {
    it('spawns claude with correct args', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams());

      expect(pm.spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining([
          '--print',
          '--output-format', 'stream-json',
          '--max-turns', '10',
          '--verbose',
          '--dangerously-skip-permissions',
          'test prompt',
        ]),
        expect.objectContaining({ cwd: '/tmp/workspace' }),
      );
    });

    it('includes --model when config.model is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'claude', model: 'sonnet' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
    });

    it('includes --effort when config.effort is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'claude', effort: 'high' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).toContain('--effort');
      expect(args[args.indexOf('--effort') + 1]).toBe('high');
    });

    it('does not include --effort when config.effort is absent', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'claude' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).not.toContain('--effort');
    });

    it('includes --system-prompt when config.system_prompt is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'claude', system_prompt: 'Be helpful' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(args).toContain('--system-prompt');
      expect(args).toContain('Be helpful');
    });

    it('uses params.systemPrompt for --system-prompt over config.system_prompt', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({
        systemPrompt: 'Orchestrator system prompt',
        config: { adapter: 'claude', system_prompt: 'Agent config system prompt' },
      }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).toContain('--system-prompt');
      // params.systemPrompt takes priority
      const sysIdx = args.indexOf('--system-prompt');
      expect(args[sysIdx + 1]).toBe('Orchestrator system prompt');
    });

    it('uses config.system_prompt when params.systemPrompt is absent', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({
        config: { adapter: 'claude', system_prompt: 'Agent config prompt' },
      }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      const sysIdx = args.indexOf('--system-prompt');
      expect(args[sysIdx + 1]).toBe('Agent config prompt');
    });

    it('does not include --system-prompt when neither systemPrompt nor config is set', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({ config: { adapter: 'claude' } }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args).not.toContain('--system-prompt');
    });

    it('passes prompt as last arg and systemPrompt via --system-prompt flag', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      adapter.execute(makeParams({
        prompt: 'user task prompt',
        systemPrompt: 'system instructions',
      }));

      const args = (pm.spawn as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
      expect(args[args.length - 1]).toBe('user task prompt');
      // systemPrompt should be passed via --system-prompt flag, not as a bare arg
      const spIdx = args.indexOf('--system-prompt');
      expect(spIdx).toBeGreaterThan(-1);
      expect(args[spIdx + 1]).toBe('system instructions');
    });

    it('returns pid in handle', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      const handle = adapter.execute(makeParams());
      expect(handle.pid).toBe(5555);
    });

    it('parses assistant event as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'assistant', message: 'hello' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events.some((e) => e.type === 'output')).toBe(true);
    });

    it('parses tool_use event as tool_call', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'tool_use', name: 'read' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('tool_call');
    });

    it('parses error event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'something broke' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('error');
      expect(events[0]!.data).toBe('something broke');
    });

    it('parses result event as done with tokens', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({
        type: 'result',
        usage: { input_tokens: 100, output_tokens: 50 },
      }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
      expect(events[0]!.tokens).toEqual({ input: 100, output: 50, reasoning: 0, total: 150, cache_read: 0, cache_write: 0 });
    });

    it('handles non-JSON lines gracefully', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
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
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write('\n\n');
      proc.stdout.write(JSON.stringify({ type: 'assistant', message: 'hi' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events).toHaveLength(1);
    });

    it('throws on non-zero exit code when no done event', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      await expect(async () => {
        for await (const ev of handle.events) events.push(ev);
      }).rejects.toThrow('exited with code 1');
    });

    it('thrown exit error carries errorKind property (utils.ts classifyAdapterError)', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      let caughtError: unknown;
      try {
        for await (const _ev of handle.events) { /* drain */ }
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Record<string, unknown>)['errorKind']).toBeDefined();
    });

    it('does not throw on non-zero exit when done event was received', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'result', data: 'ok' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 1), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('done');
    });

    it('parses unknown event type as output', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'unknown_type', info: 'data' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.type).toBe('output');
    });

    it('error event has errorKind UNKNOWN for a generic error message', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'something broke' }) + '\n');
      proc.stdout.end();
      setTimeout(() => proc.emit('close', 0), 20);

      const events: AgentEvent[] = [];
      for await (const ev of handle.events) events.push(ev);

      expect(events[0]!.errorKind).toBe(AdapterErrorKind.UNKNOWN);
    });

    it('error event has errorKind AUTH_FAILED when message contains "unauthorized"', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      const handle = adapter.execute(makeParams());

      proc.stdout.write(JSON.stringify({ type: 'error', error: 'Request unauthorized' }) + '\n');
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
          const err = new Error('spawn claude ENOENT');
          (err as NodeJS.ErrnoException).code = 'ENOENT';
          cb(err, '', '');
          return {} as ReturnType<typeof execFile>;
        },
      );

      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      const result = await adapter.test();

      expect(result.errorKind).toBe(AdapterErrorKind.SPAWN_FAILED);
    });
  });

  describe('stop', () => {
    it('calls killWithGrace on processManager', async () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);

      await adapter.stop(5555);
      expect(pm.killWithGrace).toHaveBeenCalledWith(5555);
    });
  });

  describe('kind', () => {
    it('returns claude', () => {
      const proc = createMockProcess();
      const pm = createMockProcessManager(proc);
      const adapter = new ClaudeAdapter(pm);
      expect(adapter.kind).toBe('claude');
    });
  });
});
