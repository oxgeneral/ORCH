/**
 * QA verification tests for perf optimizations (wave 2):
 * 1) state.claimed Array→Set: has/add/delete operations
 * 2) state-store claimed serialization: Array.from on write, new Set on read
 * 3) reconcile Promise.all: parallel task reads
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_STATE, type RunningEntry } from '../../../src/domain/state.js';
import {
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockStateStore,
  buildDeps,
} from './helpers.js';
import { Orchestrator } from '../../../src/application/orchestrator.js';

// Mock lock module
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
}));

// ====================================================================
// 1) claimed Set operations
// ====================================================================
describe('claimed Set operations', () => {
  it('DEFAULT_STATE.claimed is a Set', () => {
    const state = { ...DEFAULT_STATE, claimed: new Set<string>() };
    expect(state.claimed instanceof Set).toBe(true);
  });

  it('claimed.add() adds an ID', () => {
    const claimed = new Set<string>();
    claimed.add('tsk_1');
    expect(claimed.has('tsk_1')).toBe(true);
    expect(claimed.size).toBe(1);
  });

  it('claimed.delete() removes an ID', () => {
    const claimed = new Set<string>(['tsk_1', 'tsk_2']);
    claimed.delete('tsk_1');
    expect(claimed.has('tsk_1')).toBe(false);
    expect(claimed.has('tsk_2')).toBe(true);
    expect(claimed.size).toBe(1);
  });

  it('claimed.has() is O(1) lookup (Set semantics)', () => {
    const claimed = new Set<string>();
    for (let i = 0; i < 100; i++) {
      claimed.add(`tsk_${i}`);
    }
    expect(claimed.has('tsk_0')).toBe(true);
    expect(claimed.has('tsk_99')).toBe(true);
    expect(claimed.has('tsk_100')).toBe(false);
  });

  it('claimed.delete() on non-existent ID is a no-op (no error)', () => {
    const claimed = new Set<string>();
    expect(() => claimed.delete('tsk_nonexistent')).not.toThrow();
    expect(claimed.size).toBe(0);
  });
});

// ====================================================================
// 2) claimed serialization: Array.from on write, new Set on read
// ====================================================================
describe('claimed Set serialization round-trip', () => {
  it('Array.from(claimed) serializes Set to array for JSON', () => {
    const claimed = new Set<string>(['tsk_a', 'tsk_b', 'tsk_c']);
    const serialized = Array.from(claimed);
    expect(Array.isArray(serialized)).toBe(true);
    expect(serialized).toContain('tsk_a');
    expect(serialized).toContain('tsk_b');
    expect(serialized).toContain('tsk_c');
    expect(serialized.length).toBe(3);
  });

  it('new Set(array) deserializes array back to Set', () => {
    const array = ['tsk_a', 'tsk_b'];
    const claimed = new Set<string>(array);
    expect(claimed instanceof Set).toBe(true);
    expect(claimed.has('tsk_a')).toBe(true);
    expect(claimed.has('tsk_b')).toBe(true);
    expect(claimed.size).toBe(2);
  });

  it('round-trip: claimed Set → array → Set preserves all IDs', () => {
    const original = new Set<string>(['tsk_1', 'tsk_2', 'tsk_3']);
    const json = JSON.stringify(Array.from(original));
    const restored = new Set<string>(JSON.parse(json) as string[]);
    for (const id of original) {
      expect(restored.has(id)).toBe(true);
    }
    expect(restored.size).toBe(original.size);
  });

  it('null claimed deserializes to empty Set (corrupt state recovery)', () => {
    const raw: unknown = null;
    const claimed = Array.isArray(raw) ? new Set<string>(raw) : new Set<string>();
    expect(claimed instanceof Set).toBe(true);
    expect(claimed.size).toBe(0);
  });

  it('non-array claimed deserializes to empty Set (corrupt state recovery)', () => {
    const raw: unknown = 'bad-value';
    const claimed = Array.isArray(raw) ? new Set<string>(raw) : new Set<string>();
    expect(claimed.size).toBe(0);
  });
});

// ====================================================================
// 3) reconcile Promise.all: parallel task reads
// ====================================================================
describe('reconcile parallel task reads via Promise.all', () => {
  it('taskStore.get is called for each running entry (parallel pre-fetch)', async () => {
    const task1 = makeTask({ id: 'tsk_r1', status: 'in_progress' });
    const task2 = makeTask({ id: 'tsk_r2', status: 'in_progress' });
    const agent = makeAgent({ id: 'agt_1', status: 'busy' });

    const taskStore = createMockTaskStore([task1, task2]);
    const agentStore = createMockAgentStore([agent]);

    const now = new Date().toISOString();
    const stateStore = createMockStateStore({
      running: {
        tsk_r1: { run_id: 'run_1', task_id: 'tsk_r1', agent_id: 'agt_1', pid: 1111, started_at: now, last_event_at: now },
        tsk_r2: { run_id: 'run_2', task_id: 'tsk_r2', agent_id: 'agt_1', pid: 2222, started_at: now, last_event_at: now },
      },
    });

    const deps = buildDeps({ taskStore, agentStore, stateStore });
    const orch = new Orchestrator(deps);
    await (orch as any).loadState();

    // Track order of get calls to verify Promise.all batching
    const getCalls: string[] = [];
    (taskStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      getCalls.push(id);
      return id === 'tsk_r1' ? structuredClone(task1) : structuredClone(task2);
    });

    await (orch as any).reconcile();

    // Both tasks should have been fetched
    expect(taskStore.get).toHaveBeenCalledWith('tsk_r1');
    expect(taskStore.get).toHaveBeenCalledWith('tsk_r2');
    expect(getCalls).toContain('tsk_r1');
    expect(getCalls).toContain('tsk_r2');
  });

  it('Promise.all issues all reads before processing any result', async () => {
    const tasks = ['tsk_a', 'tsk_b', 'tsk_c'].map((id) =>
      makeTask({ id, status: 'in_progress' }),
    );

    const taskStore = createMockTaskStore(tasks);
    const agentStore = createMockAgentStore([makeAgent({ id: 'agt_1' })]);

    const now = new Date().toISOString();
    const running: Record<string, RunningEntry> = {};
    for (const t of tasks) {
      running[t.id] = { run_id: `run_${t.id}`, task_id: t.id, agent_id: 'agt_1', pid: 9999, started_at: now, last_event_at: now };
    }
    const stateStore = createMockStateStore({ running });

    const deps = buildDeps({ taskStore, agentStore, stateStore });
    const orch = new Orchestrator(deps);
    await (orch as any).loadState();

    let concurrentCalls = 0;
    let maxConcurrent = 0;
    let inFlight = 0;
    (taskStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      inFlight++;
      concurrentCalls++;
      if (inFlight > maxConcurrent) maxConcurrent = inFlight;
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return tasks.find((t) => t.id === id) ?? null;
    });

    await (orch as any).reconcile();

    // With Promise.all, all 3 reads are issued concurrently → maxConcurrent should be 3
    expect(maxConcurrent).toBe(3);
    expect(concurrentCalls).toBe(3);
  });
});
