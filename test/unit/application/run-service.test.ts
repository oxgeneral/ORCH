import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunService } from '../../../src/application/run-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import type { Run, RunEvent } from '../../../src/domain/run.js';
import type { IRunStore } from '../../../src/infrastructure/storage/interfaces.js';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_test1',
    task_id: 'tsk_test1',
    agent_id: 'agt_test1',
    attempt: 1,
    status: 'preparing',
    started_at: '2025-01-01T00:00:00Z',
    workspace_path: '/workspace',
    prompt: 'do something',
    ...overrides,
  };
}

function createMockRunStore(runs: Run[] = [], events: Map<string, RunEvent[]> = new Map()): IRunStore {
  const store = new Map(runs.map((r) => [r.id, structuredClone(r)]));
  return {
    save: vi.fn(async (run: Run) => { store.set(run.id, structuredClone(run)); }),
    get: vi.fn(async (id: string) => {
      const r = store.get(id);
      return r ? structuredClone(r) : null;
    }),
    listForTask: vi.fn(async (taskId: string) =>
      [...store.values()].filter((r) => r.task_id === taskId),
    ),
    listForAgent: vi.fn(async (agentId: string) =>
      [...store.values()].filter((r) => r.agent_id === agentId),
    ),
    appendEvent: vi.fn(async (runId: string, event: RunEvent) => {
      const list = events.get(runId) ?? [];
      list.push(event);
      events.set(runId, list);
    }),
    readEvents: vi.fn(async (runId: string) => events.get(runId) ?? []),
    readEventsTail: vi.fn(async (runId: string, count: number) => (events.get(runId) ?? []).slice(-count)),
    streamEvents: vi.fn(async function* () {}),
  };
}

describe('RunService.getLastFailedRunContext', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should return null when no failed runs exist', async () => {
    const runStore = createMockRunStore([
      makeRun({ id: 'run_1', task_id: 'tsk_1', status: 'succeeded' }),
    ]);
    const service = new RunService(runStore, eventBus);

    const result = await service.getLastFailedRunContext('tsk_1');
    expect(result).toBeNull();
  });

  it('should return null when no runs exist for the task', async () => {
    const runStore = createMockRunStore([]);
    const service = new RunService(runStore, eventBus);

    const result = await service.getLastFailedRunContext('tsk_1');
    expect(result).toBeNull();
  });

  it('should return error and output from the most recent failed run', async () => {
    const events = new Map<string, RunEvent[]>();
    events.set('run_2', [
      { timestamp: '2025-01-01T00:01:00Z', type: 'agent_output', data: 'line 1' },
      { timestamp: '2025-01-01T00:02:00Z', type: 'agent_output', data: 'line 2' },
      { timestamp: '2025-01-01T00:03:00Z', type: 'error', data: 'fatal error occurred' },
    ]);

    const runStore = createMockRunStore([
      makeRun({
        id: 'run_1',
        task_id: 'tsk_1',
        status: 'failed',
        error: 'Old error',
        finished_at: '2025-01-01T00:00:00Z',
      }),
      makeRun({
        id: 'run_2',
        task_id: 'tsk_1',
        status: 'failed',
        error: 'Process crashed',
        finished_at: '2025-01-01T01:00:00Z',
      }),
    ], events);

    const service = new RunService(runStore, eventBus);
    const result = await service.getLastFailedRunContext('tsk_1');

    expect(result).not.toBeNull();
    expect(result!.error).toBe('Process crashed');
    expect(result!.output).toContain('line 1');
    expect(result!.output).toContain('line 2');
    expect(result!.output).toContain('fatal error occurred');
  });

  it('should return "Unknown error" when run has no error field', async () => {
    const runStore = createMockRunStore([
      makeRun({
        id: 'run_1',
        task_id: 'tsk_1',
        status: 'failed',
        finished_at: '2025-01-01T00:00:00Z',
        // no error field
      }),
    ]);
    const service = new RunService(runStore, eventBus);

    const result = await service.getLastFailedRunContext('tsk_1');
    expect(result!.error).toBe('Unknown error');
  });

  it('should return all output lines without truncation', async () => {
    const lines: RunEvent[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push({
        timestamp: '2025-01-01T00:00:00Z',
        type: 'agent_output',
        data: `line ${i}`,
      });
    }
    const events = new Map<string, RunEvent[]>();
    events.set('run_1', lines);

    const runStore = createMockRunStore([
      makeRun({
        id: 'run_1',
        task_id: 'tsk_1',
        status: 'failed',
        error: 'Too much output',
        finished_at: '2025-01-01T00:00:00Z',
      }),
    ], events);

    const service = new RunService(runStore, eventBus);
    const result = await service.getLastFailedRunContext('tsk_1');

    const outputLines = result!.output.split('\n');
    expect(outputLines.length).toBe(100);
    expect(result!.output).toContain('line 0');
    expect(result!.output).toContain('line 99');
  });

  it('should handle missing events file gracefully', async () => {
    const runStore = createMockRunStore([
      makeRun({
        id: 'run_1',
        task_id: 'tsk_1',
        status: 'failed',
        error: 'Crashed',
        finished_at: '2025-01-01T00:00:00Z',
      }),
    ]);
    // Make readEvents throw (used by getLastFailedRunContext)
    (runStore.readEvents as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ENOENT'));

    const service = new RunService(runStore, eventBus);
    const result = await service.getLastFailedRunContext('tsk_1');

    expect(result).not.toBeNull();
    expect(result!.error).toBe('Crashed');
    expect(result!.output).toBe('');
  });

  it('should only include agent_output and error events in output', async () => {
    const events = new Map<string, RunEvent[]>();
    events.set('run_1', [
      { timestamp: '2025-01-01T00:00:00Z', type: 'agent_output', data: 'visible output' },
      { timestamp: '2025-01-01T00:00:01Z', type: 'file_changed', data: 'src/foo.ts' },
      { timestamp: '2025-01-01T00:00:02Z', type: 'tool_call', data: { tool: 'read' } },
      { timestamp: '2025-01-01T00:00:03Z', type: 'error', data: 'visible error' },
      { timestamp: '2025-01-01T00:00:04Z', type: 'command_run', data: 'npm test' },
    ]);

    const runStore = createMockRunStore([
      makeRun({
        id: 'run_1',
        task_id: 'tsk_1',
        status: 'failed',
        error: 'Failed',
        finished_at: '2025-01-01T00:00:00Z',
      }),
    ], events);

    const service = new RunService(runStore, eventBus);
    const result = await service.getLastFailedRunContext('tsk_1');

    expect(result!.output).toContain('visible output');
    expect(result!.output).toContain('visible error');
    expect(result!.output).not.toContain('src/foo.ts');
    expect(result!.output).not.toContain('npm test');
  });
});
