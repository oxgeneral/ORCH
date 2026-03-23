/**
 * Integration test: DiskObserver observes a simulated external orchestrator.
 *
 * Simulates the cross-process scenario:
 * 1. "External orchestrator" writes state.json and JSONL events
 * 2. DiskObserver polls and synthesizes OrchestratorEvents
 * 3. Verify full event lifecycle: started → output → file_changed → completed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DiskObserver } from '../../../src/cli/serve/disk-observer.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import { StateStore } from '../../../src/infrastructure/storage/state-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { writeJson } from '../../../src/infrastructure/storage/fs-utils.js';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const POLL_MS = 80;

function makeRunEvent(type: string, data: unknown): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, data });
}

describe('DiskObserver integration', () => {
  let tmpDir: string;
  let paths: Paths;
  let stateStore: StateStore;
  let observer: DiskObserver;
  let events: OrchestratorEvent[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'obs-integ-'));
    const orchDir = path.join(tmpDir, '.orchestry');
    await mkdir(orchDir);
    await mkdir(path.join(orchDir, 'runs'));
    await mkdir(path.join(orchDir, 'tasks'));
    await mkdir(path.join(orchDir, 'agents'));

    paths = new Paths(tmpDir);
    stateStore = new StateStore(paths);
    events = [];

    // Write initial empty state (as the real orchestrator would)
    await writeJson(paths.statePath, {
      version: 1,
      running: {},
      claimed: [],
      retry_queue: [],
      stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });
  });

  afterEach(async () => {
    observer?.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('full lifecycle: external orchestrator starts run → agent outputs → run completes', async () => {
    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    // ── Step 1: External orchestrator starts a run ──
    // Write state.json with a running entry (as orchestrator does on dispatchTask)
    await writeJson(paths.statePath, {
      version: 1,
      pid: 99999,
      started_at: new Date().toISOString(),
      running: {
        run_abc: {
          run_id: 'run_abc',
          agent_id: 'agt_worker',
          task_id: 'tsk_feat',
          pid: 88888,
          started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        },
      },
      claimed: ['tsk_feat'],
      retry_queue: [],
      stats: { total_runs: 1, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });

    // Wait for observer to pick up the new state
    await wait(POLL_MS * 2);

    // Verify agent:started was emitted
    const started = events.filter((e) => e.type === 'agent:started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'agent:started',
      agentId: 'agt_worker',
      taskId: 'tsk_feat',
      runId: 'run_abc',
    });

    // ── Step 2: External orchestrator writes agent output to JSONL ──
    const jsonlPath = paths.runEventsPath('run_abc');
    await writeFile(jsonlPath, [
      makeRunEvent('agent_output', 'Reading file src/main.ts...'),
      makeRunEvent('file_changed', 'src/main.ts'),
      makeRunEvent('agent_output', 'Applied fix to handleError()'),
      makeRunEvent('tool_call', { tool: 'edit', args: { file: 'src/main.ts' } }),
    ].join('\n') + '\n');

    events = [];
    await wait(POLL_MS * 2);

    // Verify all output events were captured
    const outputs = events.filter((e) => e.type === 'agent:output');
    expect(outputs.length).toBeGreaterThanOrEqual(3); // 2 agent_output + 1 tool_call
    expect(outputs[0]).toMatchObject({ data: 'Reading file src/main.ts...' });

    const fileChanges = events.filter((e) => e.type === 'agent:file_changed');
    expect(fileChanges.length).toBeGreaterThanOrEqual(1);
    expect(fileChanges[0]).toMatchObject({ path: 'src/main.ts' });

    // ── Step 3: More output appended (simulates streaming) ──
    await appendFile(jsonlPath, [
      makeRunEvent('agent_output', 'Running tests...'),
      makeRunEvent('agent_output', 'All 42 tests passed'),
      makeRunEvent('done', { tokens: { input: 1000, output: 500 } }),
    ].join('\n') + '\n');

    events = [];
    await wait(POLL_MS * 2);

    const newOutputs = events.filter((e) => e.type === 'agent:output');
    expect(newOutputs.length).toBeGreaterThanOrEqual(2);
    // 'done' events should NOT produce agent:completed (that comes from state diff)
    const completedFromDone = events.filter((e) => e.type === 'agent:completed');
    expect(completedFromDone).toHaveLength(0);

    // ── Step 4: External orchestrator finishes the run ──
    // Write run metadata (final status)
    await writeJson(paths.runPath('run_abc'), {
      id: 'run_abc',
      task_id: 'tsk_feat',
      agent_id: 'agt_worker',
      attempt: 1,
      status: 'succeeded',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      workspace_path: tmpDir,
      prompt: 'Fix the bug',
    });

    // Remove from state.running (as orchestrator does on completion)
    await writeJson(paths.statePath, {
      version: 1,
      pid: 99999,
      running: {},
      claimed: [],
      retry_queue: [],
      stats: { total_runs: 1, total_tasks_completed: 1, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 5000 },
    });

    events = [];
    await wait(POLL_MS * 2);

    // Verify completion events
    const completed = events.filter((e) => e.type === 'agent:completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(completed[0]).toMatchObject({
      type: 'agent:completed',
      runId: 'run_abc',
      agentId: 'agt_worker',
      success: true,
    });

    const statusChanged = events.filter((e) => e.type === 'task:status_changed');
    expect(statusChanged.length).toBeGreaterThanOrEqual(1);
    expect(statusChanged[0]).toMatchObject({
      taskId: 'tsk_feat',
      from: 'in_progress',
      to: 'review', // succeeded → review
    });
  });

  it('failed run lifecycle', async () => {
    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    // Start run
    await writeJson(paths.statePath, {
      version: 1, pid: 99999,
      running: {
        run_fail: { run_id: 'run_fail', agent_id: 'agt_1', task_id: 'tsk_1', pid: 77777, started_at: '', last_event_at: '' },
      },
      claimed: [], retry_queue: [],
      stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });

    await wait(POLL_MS * 2);

    // Write error event to JSONL while run is still active
    await writeFile(paths.runEventsPath('run_fail'),
      makeRunEvent('error', 'Process exited with code 1') + '\n',
    );

    // Let observer tail the error event while run is still active
    events = [];
    await wait(POLL_MS * 2);

    const errors = events.filter((e) => e.type === 'agent:error');
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Now run completes — write run metadata and update state
    await writeJson(paths.runPath('run_fail'), {
      id: 'run_fail', task_id: 'tsk_1', agent_id: 'agt_1',
      attempt: 1, status: 'failed', started_at: '', workspace_path: '', prompt: '',
      error: 'Process exited with code 1',
    });
    await writeJson(paths.statePath, {
      version: 1, pid: 99999, running: {}, claimed: [], retry_queue: [],
      stats: { total_runs: 1, total_tasks_completed: 0, total_tasks_failed: 1, total_tokens: {}, total_runtime_ms: 0 },
    });

    events = [];
    await wait(POLL_MS * 2);

    const completed = events.filter((e) => e.type === 'agent:completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(completed[0]).toMatchObject({ success: false });

    const status = events.filter((e) => e.type === 'task:status_changed');
    expect(status.length).toBeGreaterThanOrEqual(1);
    expect(status[0]).toMatchObject({ to: 'failed' });
  });

  it('multiple concurrent runs observed correctly', async () => {
    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    // Start two runs simultaneously
    await writeJson(paths.statePath, {
      version: 1, pid: 99999,
      running: {
        run_a: { run_id: 'run_a', agent_id: 'agt_a', task_id: 'tsk_a', pid: 111, started_at: '', last_event_at: '' },
        run_b: { run_id: 'run_b', agent_id: 'agt_b', task_id: 'tsk_b', pid: 222, started_at: '', last_event_at: '' },
      },
      claimed: [], retry_queue: [],
      stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });

    // Write distinct events for each run
    await writeFile(paths.runEventsPath('run_a'), makeRunEvent('agent_output', 'from agent A') + '\n');
    await writeFile(paths.runEventsPath('run_b'), makeRunEvent('agent_output', 'from agent B') + '\n');

    await wait(POLL_MS * 2);

    const startedA = events.filter((e) => e.type === 'agent:started' && 'runId' in e && e.runId === 'run_a');
    const startedB = events.filter((e) => e.type === 'agent:started' && 'runId' in e && e.runId === 'run_b');
    expect(startedA).toHaveLength(1);
    expect(startedB).toHaveLength(1);

    const outputs = events.filter((e) => e.type === 'agent:output');
    const dataValues = outputs.map((e) => 'data' in e ? e.data : '');
    expect(dataValues).toContain('from agent A');
    expect(dataValues).toContain('from agent B');

    // Tick should show 2 running
    const ticks = events.filter((e) => e.type === 'orchestrator:tick');
    expect(ticks.some((t) => 'running' in t && t.running === 2)).toBe(true);
  });

  it('orchestrator restart resets tracked runs', async () => {
    observer = new DiskObserver({ paths, stateStore, pollIntervalMs: POLL_MS });
    observer.subscribe((e) => events.push(e));

    // First orchestrator with PID 111
    await writeJson(paths.statePath, {
      version: 1, pid: 111,
      running: {
        run_old: { run_id: 'run_old', agent_id: 'agt_1', task_id: 'tsk_1', pid: 333, started_at: '', last_event_at: '' },
      },
      claimed: [], retry_queue: [],
      stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });
    await writeFile(paths.runEventsPath('run_old'), makeRunEvent('agent_output', 'old output') + '\n');

    await wait(POLL_MS * 2);

    // Orchestrator restarts with new PID and new run
    await writeJson(paths.statePath, {
      version: 1, pid: 222,
      running: {
        run_new: { run_id: 'run_new', agent_id: 'agt_2', task_id: 'tsk_2', pid: 444, started_at: '', last_event_at: '' },
      },
      claimed: [], retry_queue: [],
      stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
    });
    await writeFile(paths.runEventsPath('run_new'), makeRunEvent('agent_output', 'new output') + '\n');

    events = [];
    await wait(POLL_MS * 2);

    // Should see agent:started for run_new (tracked was reset)
    const started = events.filter((e) => e.type === 'agent:started');
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started.some((e) => 'runId' in e && e.runId === 'run_new')).toBe(true);

    const outputs = events.filter((e) => e.type === 'agent:output');
    const dataValues = outputs.map((e) => 'data' in e ? e.data : '');
    expect(dataValues).toContain('new output');
  });
});
