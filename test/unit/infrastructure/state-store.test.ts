import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { StateStore } from '../../../src/infrastructure/storage/state-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';

let tmpDir: string;
let paths: Paths;
let store: StateStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-state-'));
  // Create .orchestry structure
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new StateStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('StateStore', () => {
  it('returns default state when file does not exist', async () => {
    const state = await store.read();
    expect(state).toEqual(DEFAULT_STATE);
  });

  it('returns a deep clone of default state (not shared reference)', async () => {
    const s1 = await store.read();
    const s2 = await store.read();
    s1.stats.total_runs = 999;
    expect(s2.stats.total_runs).toBe(0);
  });

  it('round-trips state through write/read', async () => {
    const state: OrchestratorState = {
      ...structuredClone(DEFAULT_STATE),
      pid: 12345,
      started_at: '2025-01-01T00:00:00Z',
      stats: {
        total_runs: 5,
        total_tasks_completed: 3,
        total_tasks_failed: 1,
        total_tokens: { input: 100, output: 200, total: 300 },
        total_runtime_ms: 60000,
      },
    };

    await store.write(state);
    const loaded = await store.read();

    expect(loaded).toEqual(state);
  });

  it('validates corrupted state with null running field', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({ version: 1, running: null, claimed: null, retry_queue: 'bad', stats: null }),
    );

    const state = await store.read();
    expect(state.running).toEqual({});
    expect(state.claimed).toEqual(new Set());
    expect(state.retry_queue).toEqual([]);
    expect(state.stats).toEqual(DEFAULT_STATE.stats);
  });

  it('preserves valid fields while fixing corrupted ones', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.orchestry', 'state.json'),
      JSON.stringify({
        version: 1,
        pid: 42,
        running: { r1: { run_id: 'r1', agent_id: 'a1', task_id: 't1', pid: 1, started_at: '', last_event_at: '' } },
        claimed: ['t1'],
        retry_queue: null,
        stats: { total_runs: 10 },
      }),
    );

    const state = await store.read();
    expect(state.pid).toBe(42);
    expect(state.running).toHaveProperty('r1');
    expect(state.claimed).toEqual(new Set(['t1']));
    expect(state.retry_queue).toEqual([]);
    expect(state.stats.total_runs).toBe(10);
    expect(state.stats.total_tasks_completed).toBe(0);
  });
});
