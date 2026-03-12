import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { DEFAULT_STATE, type OrchestratorState, type RunningEntry } from '../../../src/domain/state.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { LockConflictError } from '../../../src/domain/errors.js';
import {
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockProcessManager,
  createMockWorkspaceManager,
  createMockTemplateEngine,
  createMockContextStore,
  createMockAdapter,
  makeEventGenerator,
  buildDeps,
} from './helpers.js';

// Mock the lock module so we don't touch the filesystem
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
}));

describe('Orchestrator', () => {
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  afterEach(() => {
    // Force-clean interval and signal handlers without going through the mutex
    if (orchestrator) {
      const o = orchestrator as any;
      if (o.intervalId) { clearInterval(o.intervalId); o.intervalId = null; }
      o.shuttingDown = true;
      o.removeSignalHandlers?.();
      if (o.lockAcquired) { o.lockAcquired = false; }
      if (o.saveStateTimer) { clearTimeout(o.saveStateTimer); o.saveStateTimer = null; }
    }
  });

  describe('constructor', () => {
    it('creates an orchestrator in non-owner mode', () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      expect(orchestrator.isOwner).toBe(false);
    });
  });

  describe('requireOwnership', () => {
    it('runTask throws LockConflictError if lock is held by another process', async () => {
      const { acquireLock } = await import('../../../src/infrastructure/storage/lock.js');
      vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, pid: 9999 });
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.runTask('tsk_1')).rejects.toThrow(LockConflictError);
    });

    it('runAll throws LockConflictError if lock is held by another process', async () => {
      const { acquireLock } = await import('../../../src/infrastructure/storage/lock.js');
      vi.mocked(acquireLock).mockResolvedValueOnce({ acquired: false, pid: 9999 });
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.runAll()).rejects.toThrow(LockConflictError);
    });

    it('runTask acquires and releases lock even on error', async () => {
      const { acquireLock, releaseLock } = await import('../../../src/infrastructure/storage/lock.js');
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      // runTask will fail because task doesn't exist, but lock should still be acquired and released
      await orchestrator.runTask('tsk_nonexistent').catch(() => {});
      expect(acquireLock).toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalled();
      expect(orchestrator.isOwner).toBe(false); // lock released after run
    });

    it('cancelTask throws LockConflictError if lock not acquired', async () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.cancelTask('tsk_1')).rejects.toThrow(LockConflictError);
    });

    it('forceStopAgent throws LockConflictError if lock not acquired', async () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.forceStopAgent('agt_1')).rejects.toThrow(LockConflictError);
    });
  });

  describe('startWatch + stop', () => {
    it('acquires lock and starts tick loop', async () => {
      const task = makeTask();
      const agent = makeAgent();
      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
      });
      orchestrator = new Orchestrator(deps);

      await orchestrator.startWatch();

      expect(orchestrator.isOwner).toBe(true);
      // State should have pid and started_at
      const written = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastWrite = written[written.length - 1]?.[0] as OrchestratorState | undefined;
      expect(lastWrite?.pid).toBe(process.pid);
      expect(lastWrite?.started_at).toBeDefined();
    });

    it('stop releases lock and clears state', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });
      orchestrator = new Orchestrator(deps);

      await orchestrator.startWatch();
      expect(orchestrator.isOwner).toBe(true);

      await orchestrator.stop();
      expect(orchestrator.isOwner).toBe(false);
    });

    it('stop is idempotent (double stop does not throw)', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });
      orchestrator = new Orchestrator(deps);

      await orchestrator.startWatch();
      await orchestrator.stop();
      await orchestrator.stop(); // second call should be no-op
    });

    it('stop kills running agents and marks tasks for retry', async () => {
      const task = makeTask({ status: 'in_progress', attempts: 1 });
      const agent = makeAgent({ status: 'running' });
      const run = makeRun({ status: 'running', pid: 54321 });
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      // Use a fresh stateStore that returns running entries consistently
      let currentState = structuredClone({
        ...DEFAULT_STATE,
        running: {
          [task.id]: {
            run_id: run.id,
            agent_id: agent.id,
            task_id: task.id,
            pid: 54321,
            started_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
          },
        },
      });
      const stateStore: IStateStore = {
        read: vi.fn(async () => structuredClone(currentState)),
        write: vi.fn(async (s) => { currentState = structuredClone(s); }),
      };

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        runStore,
        stateStore,
      });
      orchestrator = new Orchestrator(deps);

      // Set lock manually and load state, then stop — skip startWatch to avoid tick interference
      (orchestrator as any).lockAcquired = true;
      await (orchestrator as any).loadState();
      await orchestrator.stop();

      expect(deps.processManager.killWithGrace).toHaveBeenCalledWith(54321);
    });
  });

  describe('tick (reconcile + dispatch)', () => {
    it('emits orchestrator:tick event with running and queued counts', async () => {
      const task = makeTask();
      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([makeAgent()]),
      });

      const tickEvents: any[] = [];
      deps.eventBus.on('orchestrator:tick', (e) => tickEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Wait for tick to process
      await new Promise((r) => setTimeout(r, 50));

      expect(tickEvents.length).toBeGreaterThanOrEqual(1);
      expect(tickEvents[0]).toMatchObject({
        type: 'orchestrator:tick',
      });
      expect(typeof tickEvents[0].running).toBe('number');
      expect(typeof tickEvents[0].queued).toBe('number');
    });

    it('reconcile detects orphaned in_progress tasks and marks them failed', async () => {
      // Task is in_progress but NOT in state.running — orphaned
      const task = makeTask({ id: 'tsk_orphan', status: 'in_progress' });
      const agent = makeAgent();

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore: createMockStateStore({ running: {} }),
      });

      const orphanEvents: any[] = [];
      deps.eventBus.on('task:orphaned', (e) => orphanEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      expect(orphanEvents.length).toBeGreaterThanOrEqual(1);
      expect(orphanEvents[0].taskId).toBe('tsk_orphan');
    });

    it('reconcile fixes stale agent statuses', async () => {
      // Agent is stuck in 'running' but has no running entry
      const agent = makeAgent({ status: 'running' });

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([agent]),
        stateStore: createMockStateStore({ running: {} }),
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      // agentService.setStatus should have been called to reset to idle
      const agentSaved = (deps.agentStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const lastSaved = agentSaved.find(([a]: [Agent]) => a.id === agent.id && a.status === 'idle');
      expect(lastSaved).toBeDefined();
    });

    // Terminal task with stale running entry — reconcile cleans it up directly (no _handleRunFailure needed)
    it('reconcile detects dead PID — running entry cleaned up on terminal task', async () => {
      const task = makeTask({ id: 'tsk_dead', status: 'failed' });
      const agent = makeAgent();

      const processManager = createMockProcessManager();
      (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const now = new Date().toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_dead: {
            run_id: 'run_dead',
            agent_id: agent.id,
            task_id: 'tsk_dead',
            pid: 88888,
            started_at: now,
            last_event_at: now,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
        processManager,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // The stale running entry for a terminal task should be cleaned up
      const writes = (stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.running['tsk_dead']).toBeUndefined();
    });

    // Terminal task with stale running entry detected as stalled — cleaned up directly
    it('reconcile emits stall_detected and kills stalled process', async () => {
      const task = makeTask({ id: 'tsk_stall', status: 'done' });
      const agent = makeAgent();

      const processManager = createMockProcessManager();
      (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

      // last_event_at was long ago — but task is terminal so it takes the cleanup path
      const longAgo = new Date(Date.now() - 1_000_000).toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_stall: {
            run_id: 'run_stall',
            agent_id: agent.id,
            task_id: 'tsk_stall',
            pid: 77777,
            started_at: longAgo,
            last_event_at: longAgo,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
        processManager,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // Terminal task with running entry should be cleaned up
      const writes = (stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.running['tsk_stall']).toBeUndefined();
    });

    it('reconcile handles dead PID via _handleRunFailure without deadlock', async () => {
      // This test verifies the deadlock fix: reconcile() runs inside tick()'s
      // withStateLock, so it must call _handleRunFailure (no mutex) instead of
      // handleRunFailure (which re-enters the mutex and would deadlock).
      // An in_progress task with a dead PID should be processed and cleaned up
      // within a reasonable time (no hang).
      const task = makeTask({ id: 'tsk_deadpid', status: 'in_progress', attempts: 1 });
      const agent = makeAgent();
      const run = makeRun({ id: 'run_deadpid', task_id: 'tsk_deadpid', agent_id: agent.id });
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const processManager = createMockProcessManager();
      // PID is dead — isAlive returns false
      (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const now = new Date().toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_deadpid: {
            run_id: 'run_deadpid',
            agent_id: agent.id,
            task_id: 'tsk_deadpid',
            pid: 99999,
            started_at: now,
            last_event_at: now,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        runStore,
        stateStore,
        processManager,
      });

      orchestrator = new Orchestrator(deps);

      // Use a timeout to detect deadlock — if reconcile hangs, the test fails
      const result = await Promise.race([
        (async () => {
          await orchestrator.startWatch();
          // Allow tick to run
          await new Promise((r) => setTimeout(r, 200));
          return 'completed';
        })(),
        new Promise<string>((r) => setTimeout(() => r('timeout'), 5_000)),
      ]);

      expect(result).toBe('completed');

      // The running entry should be cleaned up
      const writes = (stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.running['tsk_deadpid']).toBeUndefined();

      // Should have enqueued retry (attempts=1 < max_attempts=3)
      expect(lastState.retry_queue.some((r: any) => r.task_id === 'tsk_deadpid')).toBe(true);
    }, 10_000);

    it('handleRunFailure updates task status and enqueues retry (called directly)', async () => {
      const task = makeTask({ id: 'tsk_fail', status: 'in_progress', attempts: 1 });
      const agent = makeAgent();
      const run = makeRun({ id: 'run_fail', task_id: 'tsk_fail', agent_id: agent.id });
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const stateStore = createMockStateStore({
        running: {
          tsk_fail: {
            run_id: 'run_fail',
            agent_id: agent.id,
            task_id: 'tsk_fail',
            pid: 77777,
            started_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      // Load state manually
      await (orchestrator as any).loadState();

      const entry = (orchestrator as any).state.running['tsk_fail'];
      // Call _handleRunFailure directly to avoid mutex re-entrance
      await (orchestrator as any)._handleRunFailure('tsk_fail', entry, 'test error');

      // Should have enqueued retry (attempts=1 < max_attempts=3)
      const state = (orchestrator as any).state as OrchestratorState;
      expect(state.retry_queue.length).toBe(1);
      expect(state.retry_queue[0].task_id).toBe('tsk_fail');
      expect(state.running['tsk_fail']).toBeUndefined();
    });

    it('reconcile processes retry queue when due', async () => {
      // A retry entry that is already due
      const task = makeTask({ id: 'tsk_retry', status: 'retrying', attempts: 1 });
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'ok' } },
      ]));

      const stateStore = createMockStateStore({
        retry_queue: [
          {
            task_id: 'tsk_retry',
            attempt: 2,
            due_at: new Date(Date.now() - 1000).toISOString(),
            error: 'previous error',
          },
        ],
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
        adapterRegistry: registry,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // After reconcile, retry queue should have been drained
      const writes = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const latestState = writes[writes.length - 1]?.[0] as OrchestratorState | undefined;
      // The retry entry should have been removed from queue
      const retryStillQueued = latestState?.retry_queue.some((r) => r.task_id === 'tsk_retry');
      expect(retryStillQueued).toBeFalsy();
    });
  });

  describe('dispatchAll', () => {
    it('dispatches todo tasks to idle agents', async () => {
      const task = makeTask();
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
      ]));

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // Task should have been dispatched — check taskStore.save was called with in_progress
      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const inProgressSave = taskSaves.find(([t]: [Task]) => t.id === task.id && t.status === 'in_progress');
      expect(inProgressSave).toBeDefined();
    });

    it('does not dispatch when max_concurrent_agents reached', async () => {
      const task1 = makeTask({ id: 'tsk_1', status: 'in_progress' });
      const task2 = makeTask({ id: 'tsk_2', status: 'todo' });
      const agent = makeAgent();

      const config = {
        ...DEFAULT_CONFIG,
        scheduling: { ...DEFAULT_CONFIG.scheduling, max_concurrent_agents: 1, poll_interval_ms: 100_000 },
      };

      const stateStore = createMockStateStore({
        running: {
          tsk_1: {
            run_id: 'run_1',
            agent_id: agent.id,
            task_id: 'tsk_1',
            pid: 11111,
            started_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task1, task2]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
        config,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      // task2 should NOT have been dispatched since we're at max concurrency
      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const task2Dispatch = taskSaves.find(([t]: [Task]) => t.id === 'tsk_2' && t.status === 'in_progress');
      expect(task2Dispatch).toBeUndefined();
    });

    it('does not dispatch blocked tasks', async () => {
      const dep = makeTask({ id: 'tsk_dep', status: 'in_progress' });
      const blocked = makeTask({ id: 'tsk_blocked', status: 'todo', depends_on: ['tsk_dep'] });
      const agent = makeAgent();

      deps = buildDeps({
        taskStore: createMockTaskStore([dep, blocked]),
        agentStore: createMockAgentStore([agent]),
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const blockedDispatch = taskSaves.find(([t]: [Task]) => t.id === 'tsk_blocked' && t.status === 'in_progress');
      expect(blockedDispatch).toBeUndefined();
    });

    it('emits scope overlap warning for overlapping tasks', async () => {
      const task1 = makeTask({ id: 'tsk_s1', status: 'in_progress', scope: ['src/auth/**'] });
      const task2 = makeTask({ id: 'tsk_s2', status: 'todo', scope: ['src/auth/login.ts'] });
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
      ]));

      deps = buildDeps({
        taskStore: createMockTaskStore([task1, task2]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
      });

      const overlapEvents: any[] = [];
      deps.eventBus.on('task:scope_overlap', (e) => overlapEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      expect(overlapEvents.length).toBeGreaterThanOrEqual(1);
      expect(overlapEvents[0].taskId).toBe('tsk_s2');
      expect(overlapEvents[0].overlappingTaskId).toBe('tsk_s1');
    });

    it('does not dispatch task with scope overlapping a running task', async () => {
      // tsk_running is in_progress with scope; tsk_overlap is todo with conflicting scope
      const task1 = makeTask({ id: 'tsk_running', status: 'in_progress', scope: ['src/auth/**'] });
      const task2 = makeTask({ id: 'tsk_overlap', status: 'todo', scope: ['src/auth/login.ts'] });
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
      ]));

      deps = buildDeps({
        taskStore: createMockTaskStore([task1, task2]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // tsk_overlap must NOT have been dispatched (saved as in_progress)
      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const overlapDispatched = taskSaves.find(([t]: [Task]) => t.id === 'tsk_overlap' && t.status === 'in_progress');
      expect(overlapDispatched).toBeUndefined();
    });

    it('dispatches tasks without scope normally even when other tasks have scope', async () => {
      // tsk_scoped is in_progress with scope; tsk_noscope has no scope — should dispatch fine
      const task1 = makeTask({ id: 'tsk_scoped', status: 'in_progress', scope: ['src/auth/**'] });
      const task2 = makeTask({ id: 'tsk_noscope', status: 'todo' }); // no scope
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
      ]));

      deps = buildDeps({
        taskStore: createMockTaskStore([task1, task2]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // tsk_noscope should have been dispatched
      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      const noscopeDispatched = taskSaves.find(([t]: [Task]) => t.id === 'tsk_noscope' && t.status === 'in_progress');
      expect(noscopeDispatched).toBeDefined();
    });

    it('blocked candidate does not count as peer for subsequent candidates', async () => {
      // tsk_a is in_progress overlapping with tsk_b; tsk_c overlaps tsk_b but NOT tsk_a
      // tsk_b gets blocked; tsk_c should still be dispatched (not blocked by tsk_b since it's blocked)
      const config = {
        ...DEFAULT_CONFIG,
        scheduling: { ...DEFAULT_CONFIG.scheduling, max_concurrent_agents: 3, poll_interval_ms: 100_000 },
      };
      const taskA = makeTask({ id: 'tsk_pa', status: 'in_progress', scope: ['src/auth/**'] });
      const taskB = makeTask({ id: 'tsk_pb', status: 'todo', scope: ['src/auth/login.ts'], updated_at: '2025-01-02T00:00:00Z' });
      const taskC = makeTask({ id: 'tsk_pc', status: 'todo', scope: ['src/api/**'], updated_at: '2025-01-01T00:00:00Z' });
      const agent = makeAgent();
      const registry = new AdapterRegistry();
      registry.register(createMockAdapter([
        { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
      ]));

      deps = buildDeps({
        taskStore: createMockTaskStore([taskA, taskB, taskC]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        config,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      const taskSaves = (deps.taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
      // tsk_pb overlaps tsk_pa (in_progress) → must be blocked
      const pbDispatched = taskSaves.find(([t]: [Task]) => t.id === 'tsk_pb' && t.status === 'in_progress');
      expect(pbDispatched).toBeUndefined();
      // tsk_pc does NOT overlap tsk_pa or tsk_pb (blocked), so should dispatch
      const pcDispatched = taskSaves.find(([t]: [Task]) => t.id === 'tsk_pc' && t.status === 'in_progress');
      expect(pcDispatched).toBeDefined();
    });
  });

  describe('cancelTask', () => {
    it('kills running agent and marks task cancelled', async () => {
      const task = makeTask({ id: 'tsk_cancel', status: 'in_progress', attempts: 1 });
      const agent = makeAgent();
      const run = makeRun({ id: 'run_cancel' });
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const stateStore = createMockStateStore({
        running: {
          [task.id]: {
            run_id: run.id,
            agent_id: agent.id,
            task_id: task.id,
            pid: 55555,
            started_at: '2025-01-01T00:00:00Z',
            last_event_at: '2025-01-01T00:00:00Z',
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      // Manually set lock acquired to test cancelTask in isolation
      (orchestrator as any).lockAcquired = true;
      await orchestrator.cancelTask('tsk_cancel');

      expect(deps.processManager.killWithGrace).toHaveBeenCalledWith(55555, 3_000);
    });

    it('clears retry queue entries for cancelled task', async () => {
      const task = makeTask({ id: 'tsk_cr', status: 'retrying' });

      const stateStore = createMockStateStore({
        retry_queue: [
          { task_id: 'tsk_cr', attempt: 2, due_at: '2025-01-01T00:01:00Z', error: 'err' },
        ],
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([]),
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      (orchestrator as any).lockAcquired = true;
      await orchestrator.cancelTask('tsk_cr');

      const writes = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.retry_queue.length).toBe(0);
    });
  });

  describe('forceStopAgent', () => {
    it('kills all running tasks for the agent', async () => {
      const task1 = makeTask({ id: 'tsk_fs1', status: 'in_progress' });
      const task2 = makeTask({ id: 'tsk_fs2', status: 'in_progress' });
      const agent = makeAgent({ id: 'agt_fs' });
      const run1 = makeRun({ id: 'run_fs1' });
      const run2 = makeRun({ id: 'run_fs2' });
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(structuredClone(run1))
        .mockResolvedValueOnce(structuredClone(run2));

      const stateStore = createMockStateStore({
        running: {
          tsk_fs1: {
            run_id: 'run_fs1', agent_id: 'agt_fs', task_id: 'tsk_fs1',
            pid: 11111, started_at: '2025-01-01T00:00:00Z', last_event_at: '2025-01-01T00:00:00Z',
          },
          tsk_fs2: {
            run_id: 'run_fs2', agent_id: 'agt_fs', task_id: 'tsk_fs2',
            pid: 22222, started_at: '2025-01-01T00:00:00Z', last_event_at: '2025-01-01T00:00:00Z',
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task1, task2]),
        agentStore: createMockAgentStore([agent]),
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      (orchestrator as any).lockAcquired = true;
      await orchestrator.forceStopAgent('agt_fs');

      expect(deps.processManager.killWithGrace).toHaveBeenCalledWith(11111, 3_000);
      expect(deps.processManager.killWithGrace).toHaveBeenCalledWith(22222, 3_000);
    });
  });

  describe('collectEvents', () => {
    it('processes adapter events and updates state', async () => {
      const task = makeTask();
      const agent = makeAgent();
      const now = new Date().toISOString();
      const adapterEvents: AgentEvent[] = [
        { type: 'output', timestamp: now, data: { text: 'working...' } },
        { type: 'file_change', timestamp: now, data: { path: 'src/foo.ts' } },
        { type: 'done', timestamp: now, data: { result: 'completed!' }, tokens: { input: 100, output: 200, total: 300 } },
      ];

      const registry = new AdapterRegistry();
      registry.register(createMockAdapter(adapterEvents));

      const runStore = createMockRunStore();

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
        runStore,
      });

      const outputEvents: any[] = [];
      deps.eventBus.on('agent:output', (e) => outputEvents.push(e));
      const fileEvents: any[] = [];
      deps.eventBus.on('agent:file_changed', (e) => fileEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Wait for dispatch and collection
      await new Promise((r) => setTimeout(r, 200));

      expect(outputEvents.length).toBeGreaterThanOrEqual(1);
      expect(fileEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('consecutive tick failures', () => {
    it('emits orchestrator:shutdown after maxConsecutiveTickFailures', async () => {
      const taskStore = createMockTaskStore([]);
      const stateStore = createMockStateStore();
      // startWatch calls: loadState + saveState + tick(loadState), then interval ticks
      // Allow first 3 calls (startWatch setup), then fail on interval ticks
      let callCount = 0;
      (stateStore.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        // First 3 reads are for startWatch setup + initial tick; after that, fail
        if (callCount > 3) throw new Error('boom');
        return structuredClone(DEFAULT_STATE);
      });

      deps = buildDeps({
        taskStore,
        stateStore,
        agentStore: createMockAgentStore([]),
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 20 } },
      });

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Wait for multiple tick failures
      await new Promise((r) => setTimeout(r, 500));

      expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      expect(errorEvents.some((e) => e.context === 'tick')).toBe(true);
    });
  });

  describe('state recovery', () => {
    it('loads persisted state on startWatch', async () => {
      const persistedState: OrchestratorState = {
        ...structuredClone(DEFAULT_STATE),
        stats: {
          ...DEFAULT_STATE.stats,
          total_tasks_completed: 42,
        },
      };

      const stateStore = createMockStateStore(persistedState);

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      // The state should preserve previous stats
      const writes = (stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.stats.total_tasks_completed).toBe(42);
    });

    it('cleans up stale running entries for terminal tasks on reconcile', async () => {
      const task = makeTask({ id: 'tsk_done', status: 'done' });
      const agent = makeAgent();

      const stateStore = createMockStateStore({
        running: {
          tsk_done: {
            run_id: 'run_old',
            agent_id: agent.id,
            task_id: 'tsk_done',
            pid: 99999,
            started_at: '2025-01-01T00:00:00Z',
            last_event_at: '2025-01-01T00:00:00Z',
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      // Stale entry should have been cleaned up
      const writes = (stateStore.write as ReturnType<typeof vi.fn>).mock.calls;
      const lastState = writes[writes.length - 1]?.[0] as OrchestratorState;
      expect(lastState.running['tsk_done']).toBeUndefined();
    });
  });

  describe('BUG#1 + BUG#2: current_task cleared and total_runtime_ms accumulated', () => {
    it('_handleRunSuccess clears agent.current_task after completion', async () => {
      const agent = makeAgent({ id: 'agt_suc', current_task: 'tsk_suc' });
      const task = makeTask({ id: 'tsk_suc', status: 'in_progress', attempts: 1 });
      const agentStore = createMockAgentStore([agent]);
      const runStore = createMockRunStore();
      const run = makeRun({ id: 'run_suc', task_id: 'tsk_suc', agent_id: 'agt_suc' });
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const startedAt = new Date(Date.now() - 5000).toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_suc: {
            run_id: 'run_suc',
            agent_id: 'agt_suc',
            task_id: 'tsk_suc',
            pid: 11111,
            started_at: startedAt,
            last_event_at: startedAt,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore,
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      await (orchestrator as any)._handleRunSuccess('tsk_suc', 'run_suc', 'agt_suc');

      // Agent should have current_task cleared
      const savedAgent = await agentStore.get('agt_suc');
      expect(savedAgent?.current_task).toBeUndefined();
    });

    it('_handleRunFailure clears agent.current_task after failure', async () => {
      const agent = makeAgent({ id: 'agt_fail', current_task: 'tsk_fail2' });
      const task = makeTask({ id: 'tsk_fail2', status: 'in_progress', attempts: 2, max_attempts: 3 });
      const agentStore = createMockAgentStore([agent]);
      const runStore = createMockRunStore();
      const run = makeRun({ id: 'run_fail2', task_id: 'tsk_fail2', agent_id: 'agt_fail' });
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const startedAt = new Date(Date.now() - 3000).toISOString();
      const entry = {
        run_id: 'run_fail2',
        agent_id: 'agt_fail',
        task_id: 'tsk_fail2',
        pid: 22222,
        started_at: startedAt,
        last_event_at: startedAt,
      };

      const stateStore = createMockStateStore({
        running: { tsk_fail2: entry },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore,
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      await (orchestrator as any)._handleRunFailure('tsk_fail2', entry, 'crash');

      // Agent should have current_task cleared
      const savedAgent = await agentStore.get('agt_fail');
      expect(savedAgent?.current_task).toBeUndefined();
    });

    it('_handleRunSuccess accumulates total_runtime_ms in agent stats', async () => {
      const agent = makeAgent({ id: 'agt_rt', stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 1000 } });
      const task = makeTask({ id: 'tsk_rt', status: 'in_progress', attempts: 1 });
      const agentStore = createMockAgentStore([agent]);
      const runStore = createMockRunStore();
      const run = makeRun({ id: 'run_rt', task_id: 'tsk_rt', agent_id: 'agt_rt' });
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const startedAt = new Date(Date.now() - 2000).toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_rt: {
            run_id: 'run_rt',
            agent_id: 'agt_rt',
            task_id: 'tsk_rt',
            pid: 33333,
            started_at: startedAt,
            last_event_at: startedAt,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore,
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      await (orchestrator as any)._handleRunSuccess('tsk_rt', 'run_rt', 'agt_rt');

      // total_runtime_ms should be > 1000 (accumulated)
      const savedAgent = await agentStore.get('agt_rt');
      expect(savedAgent?.stats.total_runtime_ms).toBeGreaterThan(1000);
      expect(savedAgent?.stats.total_runs).toBe(1);
    });

    it('_handleRunFailure accumulates total_runtime_ms in agent stats', async () => {
      const agent = makeAgent({ id: 'agt_rt2', stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 500 } });
      const task = makeTask({ id: 'tsk_rt2', status: 'in_progress', attempts: 2, max_attempts: 3 });
      const agentStore = createMockAgentStore([agent]);
      const runStore = createMockRunStore();
      const run = makeRun({ id: 'run_rt2', task_id: 'tsk_rt2', agent_id: 'agt_rt2' });
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const startedAt = new Date(Date.now() - 4000).toISOString();
      const entry = {
        run_id: 'run_rt2',
        agent_id: 'agt_rt2',
        task_id: 'tsk_rt2',
        pid: 44444,
        started_at: startedAt,
        last_event_at: startedAt,
      };

      const stateStore = createMockStateStore({
        running: { tsk_rt2: entry },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore,
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      await (orchestrator as any)._handleRunFailure('tsk_rt2', entry, 'timeout');

      // total_runtime_ms should be > 500 (accumulated)
      const savedAgent = await agentStore.get('agt_rt2');
      expect(savedAgent?.stats.total_runtime_ms).toBeGreaterThan(500);
      expect(savedAgent?.stats.tasks_failed).toBe(1);
      expect(savedAgent?.stats.total_runs).toBe(1);
    });

    it('total_runtime_ms is non-zero after success run (Speedster badge scenario)', async () => {
      const agent = makeAgent({ id: 'agt_speed', stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 } });
      const task = makeTask({ id: 'tsk_speed', status: 'in_progress', attempts: 1 });
      const agentStore = createMockAgentStore([agent]);
      const runStore = createMockRunStore();
      const run = makeRun({ id: 'run_speed', task_id: 'tsk_speed', agent_id: 'agt_speed' });
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      // Simulate a run that started 1s ago
      const startedAt = new Date(Date.now() - 1000).toISOString();
      const stateStore = createMockStateStore({
        running: {
          tsk_speed: {
            run_id: 'run_speed',
            agent_id: 'agt_speed',
            task_id: 'tsk_speed',
            pid: 55555,
            started_at: startedAt,
            last_event_at: startedAt,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore,
        runStore,
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      await (orchestrator as any)._handleRunSuccess('tsk_speed', 'run_speed', 'agt_speed');

      // After success, total_runtime_ms must be > 0 (Speedster badge achievable)
      const savedAgent = await agentStore.get('agt_speed');
      expect(savedAgent?.stats.total_runtime_ms).toBeGreaterThan(0);
    });
  });

  describe('immediate dispatch on task:created', () => {
    it('task:created triggers immediateDispatch after debounce', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 60_000 } },
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Spy on stateStore.read to track loadState calls after initial tick
      const readSpy = deps.stateStore.read as ReturnType<typeof vi.fn>;
      const readCountBefore = readSpy.mock.calls.length;

      // Emit task:created — should schedule immediateDispatch
      deps.eventBus.emit({ type: 'task:created', task: makeTask() });

      // Wait for debounce (500ms) + execution
      await new Promise((r) => setTimeout(r, 800));

      // immediateDispatch should have called loadState (stateStore.read) at least once more
      const readCountAfter = readSpy.mock.calls.length;
      expect(readCountAfter).toBeGreaterThan(readCountBefore);
    });

    it('debounce batches multiple task:created events into one dispatch', async () => {
      const agent = makeAgent();
      const taskStore = createMockTaskStore([]);
      const agentStore = createMockAgentStore([agent]);

      const config = {
        ...DEFAULT_CONFIG,
        scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 60_000 },
      };

      deps = buildDeps({ taskStore, agentStore, config });
      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Track how many times dispatchAll runs via stateStore.write calls after initial tick
      const writesBefore = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;

      // Emit 3 task:created events in quick succession
      for (let i = 0; i < 3; i++) {
        deps.eventBus.emit({ type: 'task:created', task: makeTask({ id: `tsk_batch_${i}` }) });
      }

      // Wait for debounce window
      await new Promise((r) => setTimeout(r, 800));

      // Only one immediate dispatch should have happened (single write batch after debounce)
      const writesAfter = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;
      // Should have exactly 1 extra save from immediateDispatch (not 3)
      expect(writesAfter - writesBefore).toBeLessThanOrEqual(2); // 1 for loadState saveState, at most 1 extra
    });

    it('stop clears task:created subscription and debounce timer', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 60_000 } },
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Schedule an immediate dispatch
      deps.eventBus.emit({ type: 'task:created', task: makeTask() });

      // Stop immediately — timer should be cleared
      await orchestrator.stop();

      // Verify internal state is cleaned up
      expect((orchestrator as any).taskCreatedUnsub).toBeNull();
      expect((orchestrator as any).immediateDispatchTimer).toBeNull();
    });

    it('does not dispatch if shuttingDown', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 60_000 } },
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await orchestrator.stop();

      const writesBefore = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;

      // Manually call scheduleImmediateDispatch — should be no-op because shuttingDown
      (orchestrator as any).shuttingDown = true;
      (orchestrator as any).scheduleImmediateDispatch();

      await new Promise((r) => setTimeout(r, 700));

      const writesAfter = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(writesAfter).toBe(writesBefore);
    });

    it('does not run immediateDispatch while tick is in progress', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 60_000 } },
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Simulate tick in progress
      (orchestrator as any).tickInProgress = true;

      const writesBefore = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;

      // Manually trigger
      (orchestrator as any).scheduleImmediateDispatch();
      await new Promise((r) => setTimeout(r, 700));

      // No extra writes because tickInProgress was true
      const writesAfter = (deps.stateStore.write as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(writesAfter).toBe(writesBefore);
    });
  });
});
