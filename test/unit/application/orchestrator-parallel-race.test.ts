/**
 * Tests for GitHub Issue #8: Parallel runs via orch serve — successful runs
 * marked as failed due to race condition between reconcile() and collectEvents().
 *
 * Root cause: When a process exits cleanly, there's a window between PID death
 * and handleRunSuccess acquiring the mutex. If reconcile fires during this window,
 * it falsely detects the dead PID as a "crash" and marks the task as failed.
 *
 * Fix: activeCollectors Set — reconcile skips PID/stall checks for tasks with
 * an active collectEvents background promise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Orchestrator } from '../../../src/application/orchestrator.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import type { AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import {
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockProcessManager,
  createMockAdapter,
  cleanupOrch,
  buildDeps,
} from './helpers.js';

vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
  touchLock: vi.fn(async () => {}),
}));

describe('Issue #8: parallel run race condition — activeCollectors guard', () => {
  const orchInstances: Orchestrator[] = [];

  afterEach(() => {
    for (const orch of orchInstances) cleanupOrch(orch);
    orchInstances.length = 0;
  });

  it('reconcile skips PID check for tasks with active collector', async () => {
    // Setup: two tasks running in parallel
    const task1 = makeTask({ id: 'tsk_r1', status: 'in_progress' });
    const task2 = makeTask({ id: 'tsk_r2', status: 'in_progress' });
    const agent1 = makeAgent({ id: 'agt_r1', status: 'running' });
    const agent2 = makeAgent({ id: 'agt_r2', status: 'running' });

    const taskStore = createMockTaskStore([task1, task2]);
    const agentStore = createMockAgentStore([agent1, agent2]);
    const runStore = createMockRunStore();
    const processManager = createMockProcessManager();

    // PID is dead for both tasks (process exited cleanly)
    (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const stateStore = createMockStateStore({
      running: {
        tsk_r1: {
          run_id: 'run_r1', agent_id: 'agt_r1', task_id: 'tsk_r1',
          pid: 100, started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        },
        tsk_r2: {
          run_id: 'run_r2', agent_id: 'agt_r2', task_id: 'tsk_r2',
          pid: 200, started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        },
      },
    });

    const deps = buildDeps({
      taskStore, agentStore, runStore, stateStore, processManager,
    });
    const orch = new Orchestrator(deps);
    orchInstances.push(orch);

    // Simulate activeCollectors — both tasks have active collectors
    const orchAny = orch as any;
    orchAny.activeCollectors.add('tsk_r1');
    orchAny.activeCollectors.add('tsk_r2');

    // Run a tick — reconcile should skip PID checks for both
    orchAny.lockAcquired = true;
    await orchAny.withStateLock(async () => {
      orchAny.cachedTaskStore.invalidate();
      orchAny.cachedAgentStore.invalidate();
      await orchAny.loadState();
      await orchAny.reconcile();
    });

    // Tasks should NOT be marked as failed
    const t1 = await taskStore.get('tsk_r1');
    const t2 = await taskStore.get('tsk_r2');
    expect(t1!.status).toBe('in_progress');
    expect(t2!.status).toBe('in_progress');

    // _handleRunFailure should NOT have been called
    expect(runStore.save).not.toHaveBeenCalled();
  });

  it('reconcile correctly detects crash when collector is NOT active', async () => {
    const task = makeTask({ id: 'tsk_c1', status: 'in_progress' });
    const agent = makeAgent({ id: 'agt_c1', status: 'running' });

    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();
    const processManager = createMockProcessManager();

    // PID is dead and no active collector
    (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const stateStore = createMockStateStore({
      running: {
        tsk_c1: {
          run_id: 'run_c1', agent_id: 'agt_c1', task_id: 'tsk_c1',
          pid: 100, started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        },
      },
    });

    const deps = buildDeps({
      taskStore, agentStore, runStore, stateStore, processManager,
    });
    const orch = new Orchestrator(deps);
    orchInstances.push(orch);

    // No activeCollectors set — reconcile should detect the crash
    const orchAny = orch as any;
    orchAny.lockAcquired = true;
    await orchAny.withStateLock(async () => {
      orchAny.cachedTaskStore.invalidate();
      orchAny.cachedAgentStore.invalidate();
      await orchAny.loadState();
      await orchAny.reconcile();
    });

    // Task should be transitioned to failed/retrying
    const t1 = await taskStore.get('tsk_c1');
    expect(t1!.status).not.toBe('in_progress');
  });

  it('activeCollectors is cleaned up after collectEvents completes', async () => {
    // Setup: one task dispatched with a quick-completing adapter
    const task = makeTask({ id: 'tsk_ac', status: 'todo' });
    const agent = makeAgent({ id: 'agt_ac', adapter: 'shell', config: { approval_policy: 'auto' } });

    const events: AgentEvent[] = [
      { type: 'output', timestamp: new Date().toISOString(), data: { text: 'hello' } },
      { type: 'done', timestamp: new Date().toISOString(), data: { type: 'result', subtype: 'success', result: 'done' } },
    ];

    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();
    const adapter = createMockAdapter(events);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore, agentStore, runStore, adapterRegistry: registry,
    });
    const orch = new Orchestrator(deps);
    orchInstances.push(orch);

    const orchAny = orch as any;
    orchAny.lockAcquired = true;

    // Dispatch the task
    await orchAny.freshDispatch(() => orchAny.dispatchTask('tsk_ac'));

    // activeCollectors should contain the task briefly
    // Wait for collectEvents to complete
    await new Promise((r) => setTimeout(r, 200));

    // After completion, activeCollectors should be empty
    expect(orchAny.activeCollectors.size).toBe(0);
  });

  it('collectEvents finalizes run when entry was already cleaned by reconcile', async () => {
    const task = makeTask({ id: 'tsk_fin', status: 'in_progress' });
    const agent = makeAgent({ id: 'agt_fin', status: 'running' });
    const run = makeRun({ id: 'run_fin', task_id: 'tsk_fin', agent_id: 'agt_fin', status: 'running' });

    const runStore = createMockRunStore();
    await runStore.save(run);

    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);

    const deps = buildDeps({
      taskStore, agentStore, runStore,
    });
    const orch = new Orchestrator(deps);
    orchInstances.push(orch);

    const orchAny = orch as any;
    orchAny.lockAcquired = true;
    // Set state without running entry (simulating reconcile already cleaned it)
    orchAny.state = {
      running: {},
      claimed: new Set(),
      retry_queue: [],
      stats: {
        total_tasks_completed: 0, total_runs: 0, total_runtime_ms: 0,
        total_tokens: { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0 },
      },
    };

    // Create a failing generator
    async function* failingGenerator(): AsyncGenerator<AgentEvent> {
      throw new Error('Process exited with code 1');
    }

    // Call collectEvents directly
    await orchAny.collectEvents(failingGenerator(), 'run_fin', 'tsk_fin', 'agt_fin');

    // Run should be finalized as failed (not left stuck in 'running')
    const savedRun = await runStore.get('run_fin');
    expect(savedRun!.status).toBe('failed');
  });
});
