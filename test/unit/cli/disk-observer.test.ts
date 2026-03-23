import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiskObserver } from '../../../src/cli/serve/disk-observer.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import type { IStateStore } from '../../../src/infrastructure/storage/interfaces.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';

/** Wait for observer polls to process (real timers) */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeState(running: OrchestratorState['running'] = {}): OrchestratorState {
  return {
    version: 1,
    pid: 12345,
    started_at: new Date().toISOString(),
    running,
    claimed: new Set(),
    retry_queue: [],
    stats: {
      total_runs: 0,
      total_tasks_completed: 0,
      total_tasks_failed: 0,
      total_tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache_read: 0, cache_write: 0 },
      total_runtime_ms: 0,
    },
  };
}

function jsonl(...events: Array<{ type: string; data: unknown }>): string {
  return events.map((e) => JSON.stringify({
    timestamp: new Date().toISOString(),
    type: e.type,
    data: e.data,
  })).join('\n') + '\n';
}

/** Very fast poll interval for tests */
const POLL_MS = 50;

describe('DiskObserver', () => {
  let tmpDir: string;
  let paths: Paths;
  let stateStore: IStateStore;
  let currentState: OrchestratorState;
  let observer: DiskObserver;
  let events: OrchestratorEvent[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'disk-observer-'));
    const orchDir = path.join(tmpDir, '.orchestry');
    await mkdir(orchDir);
    await mkdir(path.join(orchDir, 'runs'));
    await writeFile(path.join(orchDir, 'state.json'), '{}');

    paths = new Paths(tmpDir);
    currentState = makeState();
    stateStore = {
      read: vi.fn(async () => currentState),
      write: vi.fn(async () => {}),
    };
    events = [];
  });

  afterEach(async () => {
    observer?.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('emits agent:started when a new run appears in state', async () => {
    currentState = makeState({
      run_1: { run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_1', pid: 999, started_at: '', last_event_at: '' },
    });

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent:started', agentId: 'agt_1', taskId: 'tsk_1', runId: 'run_1' }),
    );
  });

  it('emits agent:completed when a run disappears from state', async () => {
    currentState = makeState({
      run_1: { run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_1', pid: 999, started_at: '', last_event_at: '' },
    });

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    // First poll: detect new run
    await wait(POLL_MS + 30);

    // Run disappears from state
    currentState = makeState({});
    await writeFile(paths.runPath('run_1'), JSON.stringify({
      id: 'run_1', task_id: 'tsk_1', agent_id: 'agt_1', status: 'succeeded',
      attempt: 1, started_at: '', workspace_path: '', prompt: '',
    }));

    events = [];
    await wait(POLL_MS + 30);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent:completed', runId: 'run_1', agentId: 'agt_1', success: true }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'task:status_changed', taskId: 'tsk_1' }),
    );
  });

  it('tails JSONL events from active runs', async () => {
    currentState = makeState({
      run_2: { run_id: 'run_2', agent_id: 'agt_2', task_id: 'tsk_2', pid: 999, started_at: '', last_event_at: '' },
    });

    // Write events before observer starts
    const eventsFile = paths.runEventsPath('run_2');
    await writeFile(eventsFile, jsonl(
      { type: 'agent_output', data: 'hello world' },
      { type: 'file_changed', data: 'src/foo.ts' },
    ));

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const outputEvents = events.filter((e) => e.type === 'agent:output');
    const fileEvents = events.filter((e) => e.type === 'agent:file_changed');

    expect(outputEvents).toHaveLength(1);
    expect(outputEvents[0]).toMatchObject({ type: 'agent:output', data: 'hello world' });
    expect(fileEvents).toHaveLength(1);
    expect(fileEvents[0]).toMatchObject({ type: 'agent:file_changed', path: 'src/foo.ts' });
  });

  it('reads only new bytes on subsequent polls', async () => {
    currentState = makeState({
      run_3: { run_id: 'run_3', agent_id: 'agt_3', task_id: 'tsk_3', pid: 999, started_at: '', last_event_at: '' },
    });

    const eventsFile = paths.runEventsPath('run_3');
    await writeFile(eventsFile, jsonl({ type: 'agent_output', data: 'line1' }));

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const firstCount = events.filter((e) => e.type === 'agent:output').length;
    expect(firstCount).toBe(1);

    // Append more data
    await appendFile(eventsFile, jsonl({ type: 'agent_output', data: 'line2' }));

    events = [];
    await wait(POLL_MS + 30);

    const newOutputs = events.filter((e) => e.type === 'agent:output');
    expect(newOutputs).toHaveLength(1);
    expect(newOutputs[0]).toMatchObject({ data: 'line2' });
  });

  it('handles partial lines across poll boundaries', async () => {
    currentState = makeState({
      run_4: { run_id: 'run_4', agent_id: 'agt_4', task_id: 'tsk_4', pid: 999, started_at: '', last_event_at: '' },
    });

    const eventsFile = paths.runEventsPath('run_4');
    const fullLine = JSON.stringify({ timestamp: new Date().toISOString(), type: 'agent_output', data: 'complete' });
    const partialLine = '{"timestamp":"2026-01-01T00:00:00.000Z","type":"agent_output","data":"par';
    await writeFile(eventsFile, fullLine + '\n' + partialLine);

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    // Only the complete line should be emitted
    const outputs = events.filter((e) => e.type === 'agent:output');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ data: 'complete' });

    // Complete the partial line
    await appendFile(eventsFile, 'tial"}\n');

    events = [];
    await wait(POLL_MS + 30);

    const newOutputs = events.filter((e) => e.type === 'agent:output');
    expect(newOutputs).toHaveLength(1);
    expect(newOutputs[0]).toMatchObject({ data: 'partial' });
  });

  it('translates error events', async () => {
    currentState = makeState({
      run_5: { run_id: 'run_5', agent_id: 'agt_5', task_id: 'tsk_5', pid: 999, started_at: '', last_event_at: '' },
    });

    const eventsFile = paths.runEventsPath('run_5');
    await writeFile(eventsFile, jsonl({ type: 'error', data: 'something broke' }));

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const errorEvents = events.filter((e) => e.type === 'agent:error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({ error: 'something broke' });
  });

  it('skips done events (lifecycle handled by state diff)', async () => {
    currentState = makeState({
      run_6: { run_id: 'run_6', agent_id: 'agt_6', task_id: 'tsk_6', pid: 999, started_at: '', last_event_at: '' },
    });

    const eventsFile = paths.runEventsPath('run_6');
    await writeFile(eventsFile, jsonl({ type: 'done', data: { tokens: {} } }));

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const completed = events.filter((e) => e.type === 'agent:completed');
    expect(completed).toHaveLength(0);
  });

  it('unsubscribe stops polling', async () => {
    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    const unsub = observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);
    const callCount = (stateStore.read as ReturnType<typeof vi.fn>).mock.calls.length;

    unsub();

    await wait(POLL_MS * 3);
    // No additional calls after unsubscribe
    expect((stateStore.read as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });

  it('handles missing JSONL file gracefully', async () => {
    currentState = makeState({
      run_m: { run_id: 'run_m', agent_id: 'agt_m', task_id: 'tsk_m', pid: 999, started_at: '', last_event_at: '' },
    });

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent:started', runId: 'run_m' }),
    );
  });

  it('emits orchestrator:tick for active runs', async () => {
    currentState = makeState({
      run_t1: { run_id: 'run_t1', agent_id: 'agt_t1', task_id: 'tsk_t1', pid: 999, started_at: '', last_event_at: '' },
      run_t2: { run_id: 'run_t2', agent_id: 'agt_t2', task_id: 'tsk_t2', pid: 999, started_at: '', last_event_at: '' },
    });

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const ticks = events.filter((e) => e.type === 'orchestrator:tick');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks[0]).toMatchObject({ running: 2, queued: 0 });
  });

  it('translates tool_call and command_run as agent:output', async () => {
    currentState = makeState({
      run_tc: { run_id: 'run_tc', agent_id: 'agt_tc', task_id: 'tsk_tc', pid: 999, started_at: '', last_event_at: '' },
    });

    const eventsFile = paths.runEventsPath('run_tc');
    await writeFile(eventsFile, jsonl(
      { type: 'tool_call', data: { tool: 'read', args: { path: '/a.ts' } } },
      { type: 'command_run', data: 'npm test' },
    ));

    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    await wait(POLL_MS + 30);

    const outputs = events.filter((e) => e.type === 'agent:output');
    expect(outputs).toHaveLength(2);
    // tool_call serialized as JSON
    expect(outputs[0]).toMatchObject({ type: 'agent:output' });
    // command_run as string
    expect(outputs[1]).toMatchObject({ type: 'agent:output', data: 'npm test' });
  });
});
