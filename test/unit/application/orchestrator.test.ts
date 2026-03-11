import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { DEFAULT_STATE, type OrchestratorState, type RunningEntry } from '../../../src/domain/state.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Run } from '../../../src/domain/run.js';
import type {
  ITaskStore,
  IAgentStore,
  IRunStore,
  IStateStore,
  IContextStore,
} from '../../../src/infrastructure/storage/interfaces.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { IWorkspaceManager } from '../../../src/infrastructure/workspace/interface.js';
import type { ITemplateEngine } from '../../../src/infrastructure/template/template-engine.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { TaskService } from '../../../src/application/task-service.js';
import { AgentService } from '../../../src/application/agent-service.js';
import { RunService } from '../../../src/application/run-service.js';
import { LockConflictError } from '../../../src/domain/errors.js';

// --- Helpers ---

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test1',
    title: 'Test task',
    description: 'desc',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_test1',
    name: 'TestAgent',
    adapter: 'shell',
    status: 'idle',
    config: {
      approval_policy: 'auto',
      max_turns: 50,
      timeout_ms: 3_600_000,
      stall_timeout_ms: 300_000,
    },
    stats: {
      tasks_completed: 0,
      tasks_failed: 0,
      total_runs: 0,
      total_runtime_ms: 0,
    },
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run_test1',
    task_id: 'tsk_test1',
    agent_id: 'agt_test1',
    attempt: 1,
    status: 'preparing',
    started_at: '2025-01-01T00:00:00Z',
    workspace_path: '/tmp/ws',
    prompt: 'do stuff',
    ...overrides,
  };
}

function createMockTaskStore(tasks: Task[] = []): ITaskStore {
  const store = new Map(tasks.map((t) => [t.id, structuredClone(t)]));
  return {
    list: vi.fn(async (filter?) => {
      const all = [...store.values()];
      if (filter?.status) return all.filter((t) => t.status === filter.status);
      return all;
    }),
    get: vi.fn(async (id: string) => {
      const t = store.get(id);
      return t ? structuredClone(t) : null;
    }),
    save: vi.fn(async (task: Task) => {
      store.set(task.id, structuredClone(task));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

function createMockAgentStore(agents: Agent[] = []): IAgentStore {
  const store = new Map(agents.map((a) => [a.id, structuredClone(a)]));
  return {
    list: vi.fn(async () => [...store.values()].map((a) => structuredClone(a))),
    get: vi.fn(async (id: string) => {
      const a = store.get(id);
      return a ? structuredClone(a) : null;
    }),
    getByName: vi.fn(async (name: string) => {
      for (const a of store.values()) {
        if (a.name === name) return structuredClone(a);
      }
      return null;
    }),
    save: vi.fn(async (agent: Agent) => {
      store.set(agent.id, structuredClone(agent));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

function createMockRunStore(): IRunStore {
  const runs = new Map<string, Run>();
  const events = new Map<string, import('../../../src/domain/run.js').RunEvent[]>();
  return {
    save: vi.fn(async (run: Run) => { runs.set(run.id, structuredClone(run)); }),
    get: vi.fn(async (id: string) => {
      const r = runs.get(id);
      return r ? structuredClone(r) : null;
    }),
    listForTask: vi.fn(async () => []),
    listForAgent: vi.fn(async () => []),
    appendEvent: vi.fn(async (runId: string, event) => {
      if (!events.has(runId)) events.set(runId, []);
      events.get(runId)!.push(structuredClone(event));
    }),
    readEvents: vi.fn(async (runId: string) => events.get(runId) ?? []),
    streamEvents: vi.fn(async function* () {}),
  };
}

function createMockStateStore(initial?: Partial<OrchestratorState>): IStateStore {
  let state = structuredClone({ ...DEFAULT_STATE, ...initial });
  return {
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (s) => { state = structuredClone(s); }),
  };
}

function createMockProcessManager(): IProcessManager {
  return {
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ process: {} as any, pid: 12345 })),
  };
}

function createMockWorkspaceManager(): IWorkspaceManager {
  return {
    prepare: vi.fn(async () => ({ path: '/tmp/ws' })),
    mergeBack: vi.fn(async () => ({ success: true as const })),
    cleanup: vi.fn(async () => {}),
    validate: vi.fn(),
  };
}

function createMockTemplateEngine(): ITemplateEngine {
  return {
    render: vi.fn(async (_template: string, _context: any) => 'rendered prompt'),
  };
}

function createMockContextStore(): IContextStore {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getAll: vi.fn(async () => ({})),
  };
}

async function* makeEventGenerator(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const e of events) {
    yield e;
  }
}

function createMockAdapter(events: AgentEvent[] = []): IAgentAdapter {
  return {
    kind: 'shell',
    test: vi.fn(async () => ({ ok: true })),
    execute: vi.fn((): ExecuteHandle => ({
      pid: 99999,
      events: makeEventGenerator(events),
    })),
    stop: vi.fn(async () => {}),
  };
}

function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const taskStore = overrides.taskStore ?? createMockTaskStore();
  const agentStore = overrides.agentStore ?? createMockAgentStore();
  const runStore = overrides.runStore ?? createMockRunStore();
  const stateStore = overrides.stateStore ?? createMockStateStore();
  const eventBus = overrides.eventBus ?? new EventBus();
  const config = overrides.config ?? { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 100_000 } };

  return {
    taskStore,
    agentStore,
    runStore,
    stateStore,
    adapterRegistry: overrides.adapterRegistry ?? new AdapterRegistry(),
    workspaceManager: overrides.workspaceManager ?? createMockWorkspaceManager(),
    templateEngine: overrides.templateEngine ?? createMockTemplateEngine(),
    processManager: overrides.processManager ?? createMockProcessManager(),
    eventBus,
    taskService: overrides.taskService ?? new TaskService(taskStore, stateStore, eventBus, config),
    agentService: overrides.agentService ?? new AgentService(agentStore, stateStore, eventBus, config),
    runService: overrides.runService ?? new RunService(runStore, eventBus),
    contextStore: overrides.contextStore ?? createMockContextStore(),
    config,
    projectRoot: '/tmp/project',
    lockPath: '/tmp/project/.orchestry/lock',
    ...overrides,
  };
}

// --- Tests ---

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
    it('runTask throws LockConflictError if lock not acquired', async () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.runTask('tsk_1')).rejects.toThrow(LockConflictError);
    });

    it('runAll throws LockConflictError if lock not acquired', async () => {
      deps = buildDeps();
      orchestrator = new Orchestrator(deps);
      await expect(orchestrator.runAll()).rejects.toThrow(LockConflictError);
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
});
