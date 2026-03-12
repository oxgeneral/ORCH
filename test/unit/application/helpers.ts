/**
 * Shared test helpers for application-level tests.
 * Provides mock factories for stores, services, and orchestrator dependencies.
 */
import { vi } from 'vitest';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { DEFAULT_STATE, type OrchestratorState } from '../../../src/domain/state.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Run, RunEvent } from '../../../src/domain/run.js';
import type {
  ITaskStore,
  IAgentStore,
  IRunStore,
  IStateStore,
  IContextStore,
  IMessageStore,
  ITeamStore,
} from '../../../src/infrastructure/storage/interfaces.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { IWorkspaceManager } from '../../../src/infrastructure/workspace/interface.js';
import type { ITemplateEngine } from '../../../src/infrastructure/template/template-engine.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { TaskService } from '../../../src/application/task-service.js';
import { AgentService } from '../../../src/application/agent-service.js';
import { RunService } from '../../../src/application/run-service.js';
import type { OrchestratorDeps } from '../../../src/application/orchestrator.js';

// --- Entity factories ---

export function makeTask(overrides: Partial<Task> = {}): Task {
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

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
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

export function makeRun(overrides: Partial<Run> = {}): Run {
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

// --- Mock store factories ---

export function createMockTaskStore(tasks: Task[] = []): ITaskStore {
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

export function createMockAgentStore(agents: Agent[] = []): IAgentStore {
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

export function createMockRunStore(): IRunStore {
  const runs = new Map<string, Run>();
  const events = new Map<string, RunEvent[]>();
  return {
    save: vi.fn(async (run: Run) => { runs.set(run.id, structuredClone(run)); }),
    get: vi.fn(async (id: string) => {
      const r = runs.get(id);
      return r ? structuredClone(r) : null;
    }),
    listForTask: vi.fn(async () => []),
    listForAgent: vi.fn(async () => []),
    appendEvent: vi.fn(async (runId: string, event: RunEvent) => {
      if (!events.has(runId)) events.set(runId, []);
      events.get(runId)!.push(structuredClone(event));
    }),
    readEvents: vi.fn(async (runId: string) => events.get(runId) ?? []),
    readEventsTail: vi.fn(async (_runId: string, _count: number) => []),
    streamEvents: vi.fn(async function* () {}),
  };
}

export function createMockStateStore(initial?: Partial<OrchestratorState>): IStateStore {
  let state = structuredClone({ ...DEFAULT_STATE, ...initial });
  return {
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (s) => { state = structuredClone(s); }),
  };
}

export function createMockProcessManager(): IProcessManager {
  return {
    isAlive: vi.fn(() => true),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(() => ({ process: {} as any, pid: 12345 })),
  };
}

export function createMockWorkspaceManager(): IWorkspaceManager {
  return {
    prepare: vi.fn(async () => ({ path: '/tmp/ws' })),
    mergeBack: vi.fn(async () => ({ success: true as const })),
    cleanup: vi.fn(async () => {}),
    validate: vi.fn(),
  };
}

export function createMockTemplateEngine(): ITemplateEngine {
  return {
    render: vi.fn(async (_template: string, _context: any) => 'rendered prompt'),
  };
}

export function createMockContextStore(): IContextStore {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getAll: vi.fn(async () => ({})),
  };
}

export function createMockMessageStore(): IMessageStore {
  return {
    save: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    listPending: vi.fn(async () => []),
    listForTeam: vi.fn(async () => []),
    markDelivered: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    purgeExpired: vi.fn(async () => 0),
  };
}

export function createMockTeamStore(): ITeamStore {
  return {
    save: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    getByName: vi.fn(async () => null),
    list: vi.fn(async () => []),
    delete: vi.fn(async () => {}),
  };
}

// --- Adapter helpers ---

export async function* makeEventGenerator(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const e of events) {
    yield e;
  }
}

export function createMockAdapter(events: AgentEvent[] = []): IAgentAdapter {
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

// --- Full orchestrator deps builder ---

export function buildDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
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
