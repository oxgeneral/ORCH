/**
 * Tests for retry dispatch race condition fix.
 *
 * Verifies that:
 * 1. dispatchTask() skips tasks that are no longer dispatchable (e.g. already done)
 * 2. Retry queue processing skips tasks that succeeded while waiting
 * 3. _handleRunFailure skips if running entry was already cleaned up
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { DEFAULT_STATE, type RunningEntry } from '../../../src/domain/state.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import {
  makeTask,
  makeAgent,
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

describe('Retry dispatch race condition guards', () => {
  let orchestrator: Orchestrator;

  afterEach(() => {
    if (orchestrator) cleanupOrch(orchestrator);
  });

  it('dispatchTask silently skips a task that is already done', async () => {
    const task = makeTask({ id: 'tsk_1', status: 'done', attempts: 1 });
    const agent = makeAgent({ id: 'agt_1', status: 'idle' });

    const adapter = createMockAdapter([
      { type: 'done', timestamp: new Date().toISOString(), data: 'ok' },
    ]);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });
    orchestrator = new Orchestrator(deps);

    // Directly invoke dispatchTask on a done task — should not throw, should not spawn
    await orchestrator.runTask('tsk_1');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('retry queue skips tasks that succeeded while waiting in queue', async () => {
    // Task was retrying but then succeeded via another path
    const task = makeTask({ id: 'tsk_r1', status: 'done', attempts: 2 });
    const agent = makeAgent({ id: 'agt_1', status: 'idle' });

    const adapter = createMockAdapter([]);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const retryDueAt = new Date(Date.now() - 1000).toISOString(); // already due
    const stateStore = createMockStateStore({
      retry_queue: [{ task_id: 'tsk_r1', attempt: 2, due_at: retryDueAt, error: 'temp fail' }],
    });

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      stateStore,
      adapterRegistry: registry,
    });
    orchestrator = new Orchestrator(deps);

    // Start watch to trigger tick which processes retry queue
    await orchestrator.startWatch({ skipAutonomousSeeding: true });
    // Wait for first tick
    await new Promise((r) => setTimeout(r, 200));
    await orchestrator.stop();

    // Adapter should NOT have been called — task is already done
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('_handleRunFailure skips if running entry was already cleaned up by success handler', async () => {
    const task = makeTask({ id: 'tsk_race', status: 'done', attempts: 1 });
    const agent = makeAgent({ id: 'agt_1', status: 'idle' });

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
    });
    orchestrator = new Orchestrator(deps);

    // Simulate: running entry already cleaned up (e.g. by handleRunSuccess)
    const state = { ...DEFAULT_STATE, running: {} }; // no running entry for tsk_race
    (orchestrator as any).state = state;
    (orchestrator as any).lockAcquired = true;

    const entry: RunningEntry = {
      run_id: 'run_test',
      agent_id: 'agt_1',
      pid: 99999,
      started_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    };

    // Call _handleRunFailure directly — should early return without updating agent stats
    await (orchestrator as any)._handleRunFailure('tsk_race', entry, 'stall');

    // Agent stats should NOT be updated (tasks_failed should remain 0)
    const agentAfter = await deps.agentStore.get('agt_1');
    expect(agentAfter!.stats.tasks_failed).toBe(0);
  });

  it('dispatchTask skips a task in cancelled status', async () => {
    const task = makeTask({ id: 'tsk_c1', status: 'cancelled' });
    const agent = makeAgent({ id: 'agt_1', status: 'idle' });

    const adapter = createMockAdapter([]);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });
    orchestrator = new Orchestrator(deps);

    await orchestrator.runTask('tsk_c1');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('dispatchTask skips a task in failed status', async () => {
    const task = makeTask({ id: 'tsk_f1', status: 'failed', attempts: 3, max_attempts: 3 });
    const agent = makeAgent({ id: 'agt_1', status: 'idle' });

    const adapter = createMockAdapter([]);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });
    orchestrator = new Orchestrator(deps);

    await orchestrator.runTask('tsk_f1');
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});
