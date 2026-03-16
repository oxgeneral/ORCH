import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventBus } from '../../../src/application/event-bus.js';
import { StructuredLogger } from '../../../src/cli/serve/structured-logger.js';
import type { ServeLoggerOptions } from '../../../src/cli/serve/types.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';

function createTestLogger(overrides: Partial<ServeLoggerOptions> = {}) {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (chunk: Buffer) => { chunks.push(chunk.toString()); });

  const logger = new StructuredLogger({
    format: 'json',
    verbose: false,
    streams: [stream],
    idleLogInterval: 6,
    ...overrides,
  });

  return { logger, stream, chunks };
}

function parseLines(chunks: string[]): Record<string, unknown>[] {
  return chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('StructuredLogger', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('JSON format', () => {
    it('logs agent:started events', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:started', agentId: 'agt_1', taskId: 'tsk_1', runId: 'run_1' });

      const lines = parseLines(chunks);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'info',
        event: 'agent:started',
        agentId: 'agt_1',
        taskId: 'tsk_1',
        runId: 'run_1',
      });
      expect(lines[0]!['ts']).toBeDefined();
      unsub();
    });

    it('logs agent:completed with success=true as info', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:completed', runId: 'run_1', agentId: 'agt_1', success: true });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'info', success: true });
      unsub();
    });

    it('logs agent:completed with success=false as warn', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:completed', runId: 'run_1', agentId: 'agt_1', success: false });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'warn', success: false });
      unsub();
    });

    it('logs agent:error as error level', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:error', runId: 'run_1', agentId: 'agt_1', error: 'timeout' });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'error', event: 'agent:error', error: 'timeout' });
      unsub();
    });

    it('logs task:status_changed', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'task:status_changed', taskId: 'tsk_1', from: 'todo', to: 'in_progress' });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ event: 'task:status_changed', from: 'todo', to: 'in_progress' });
      unsub();
    });

    it('logs task:created with title', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({
        type: 'task:created',
        task: { id: 'tsk_1', title: 'Fix bug', status: 'todo' } as any,
      });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ event: 'task:created', taskId: 'tsk_1', title: 'Fix bug' });
      unsub();
    });

    it('logs run:retry as warn', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'run:retry', runId: 'run_1', attempt: 2, delay_ms: 5000 });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'warn', attempt: 2, delay_ms: 5000 });
      unsub();
    });

    it('logs orchestrator:shutdown', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'orchestrator:shutdown', reason: 'Received SIGTERM' });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'info', event: 'orchestrator:shutdown', reason: 'Received SIGTERM' });
      unsub();
    });

    it('logs orchestrator:error with correct level based on fatal flag', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'orchestrator:error', error: 'tick failed', context: 'tick', fatal: false });
      eventBus.emit({ type: 'orchestrator:error', error: 'crash', context: 'tick', fatal: true });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'warn', fatal: false });
      expect(lines[1]).toMatchObject({ level: 'error', fatal: true });
      unsub();
    });

    it('includes heap_mb in orchestrator:tick', () => {
      const { logger, chunks } = createTestLogger({ verbose: true });
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'orchestrator:tick', running: 1, queued: 2 });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ event: 'orchestrator:tick', running: 1, queued: 2 });
      expect(typeof lines[0]!['heap_mb']).toBe('number');
      unsub();
    });

    it('logs workspace:merge_conflict as warn', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({
        type: 'workspace:merge_conflict',
        taskId: 'tsk_1',
        branch: 'orchestry/tsk_1/fix',
        conflictInfo: 'CONFLICT in src/foo.ts',
      });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({ level: 'warn', event: 'workspace:merge_conflict' });
      unsub();
    });
  });

  describe('agent:output filtering', () => {
    it('suppresses agent:output when verbose=false', () => {
      const { logger, chunks } = createTestLogger({ verbose: false });
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:output', runId: 'run_1', agentId: 'agt_1', data: 'hello' });

      expect(parseLines(chunks)).toHaveLength(0);
      unsub();
    });

    it('includes agent:output when verbose=true', () => {
      const { logger, chunks } = createTestLogger({ verbose: true });
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:output', runId: 'run_1', agentId: 'agt_1', data: 'hello' });

      const lines = parseLines(chunks);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 'debug', data: 'hello' });
      unsub();
    });

    it('truncates agent:output data to 200 chars', () => {
      const { logger, chunks } = createTestLogger({ verbose: true });
      const unsub = logger.subscribe(eventBus);

      const longData = 'x'.repeat(500);
      eventBus.emit({ type: 'agent:output', runId: 'run_1', agentId: 'agt_1', data: longData });

      const lines = parseLines(chunks);
      expect((lines[0]!['data'] as string).length).toBe(200);
      unsub();
    });
  });

  describe('idle tick throttling', () => {
    it('suppresses idle ticks except every Nth (idleLogInterval)', () => {
      const { logger, chunks } = createTestLogger({ idleLogInterval: 3 });
      const unsub = logger.subscribe(eventBus);

      for (let i = 0; i < 6; i++) {
        eventBus.emit({ type: 'orchestrator:tick', running: 0, queued: 0 });
      }

      const lines = parseLines(chunks);
      // Tick 3 and 6 should be logged (counter 3 and 6, modulo 3 === 0)
      expect(lines).toHaveLength(2);
      unsub();
    });

    it('always logs ticks with running > 0', () => {
      const { logger, chunks } = createTestLogger({ idleLogInterval: 6 });
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'orchestrator:tick', running: 1, queued: 0 });
      eventBus.emit({ type: 'orchestrator:tick', running: 0, queued: 1 });

      const lines = parseLines(chunks);
      expect(lines).toHaveLength(2);
      unsub();
    });
  });

  describe('text format', () => {
    it('produces human-readable lines', () => {
      const { logger, chunks } = createTestLogger({ format: 'text' });
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'agent:started', agentId: 'agt_1', taskId: 'tsk_1', runId: 'run_1' });

      const output = chunks.join('');
      expect(output).toContain('INFO');
      expect(output).toContain('agent:started');
      expect(output).toContain('agentId=agt_1');
      unsub();
    });
  });

  describe('multiple streams', () => {
    it('writes to all streams', () => {
      const stream1 = new PassThrough();
      const stream2 = new PassThrough();
      const chunks1: string[] = [];
      const chunks2: string[] = [];
      stream1.on('data', (c: Buffer) => { chunks1.push(c.toString()); });
      stream2.on('data', (c: Buffer) => { chunks2.push(c.toString()); });

      const logger = new StructuredLogger({
        format: 'json',
        verbose: false,
        streams: [stream1, stream2],
        idleLogInterval: 6,
      });

      const unsub = logger.subscribe(eventBus);
      eventBus.emit({ type: 'orchestrator:shutdown', reason: 'test' });

      expect(parseLines(chunks1)).toHaveLength(1);
      expect(parseLines(chunks2)).toHaveLength(1);
      unsub();
    });
  });

  describe('log() method', () => {
    it('writes standalone log entries', () => {
      const { logger, chunks } = createTestLogger();

      logger.log('info', 'serve:started', { mode: 'watch', pid: 12345 });

      const lines = parseLines(chunks);
      expect(lines[0]).toMatchObject({
        level: 'info',
        event: 'serve:started',
        mode: 'watch',
        pid: 12345,
      });
    });
  });

  describe('flush()', () => {
    it('closes non-stdout streams', async () => {
      const stream = new PassThrough();
      const endSpy = vi.spyOn(stream, 'end');

      const logger = new StructuredLogger({
        format: 'json',
        verbose: false,
        streams: [process.stdout, stream],
        idleLogInterval: 6,
      });

      await logger.flush();
      expect(endSpy).toHaveBeenCalled();
    });
  });

  describe('unsupported events', () => {
    it('does not log team/goal/message events', () => {
      const { logger, chunks } = createTestLogger();
      const unsub = logger.subscribe(eventBus);

      eventBus.emit({ type: 'team:created', teamId: 'team_1', name: 'Alpha', leadAgentId: 'agt_1' });
      eventBus.emit({ type: 'goal:created', goalId: 'goal_1', title: 'Ship v2' });
      eventBus.emit({ type: 'message:sent', messageId: 'msg_1', fromAgentId: 'agt_1', toAgentId: 'agt_2', channel: 'direct' });

      expect(parseLines(chunks)).toHaveLength(0);
      unsub();
    });
  });
});
