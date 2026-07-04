import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService } from '../../../src/application/agent-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import { AgentNotFoundError, InvalidArgumentsError } from '../../../src/domain/errors.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Task } from '../../../src/domain/task.js';
import type { IAgentStore, IStateStore } from '../../../src/infrastructure/storage/interfaces.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_test1',
    name: 'test-agent',
    adapter: 'claude',
    config: {
      approval_policy: 'suggest',
      max_turns: 50,
      timeout_ms: 3600000,
      stall_timeout_ms: 300000,
    },
    status: 'idle',
    stats: {
      tasks_completed: 0,
      tasks_failed: 0,
      total_runs: 0,
      total_runtime_ms: 0,
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    title: 'Test',
    description: '',
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

function createMockAgentStore(agents: Agent[] = []): IAgentStore {
  const store = new Map(agents.map((a) => [a.id, structuredClone(a)]));
  return {
    list: vi.fn(async () => [...store.values()]),
    get: vi.fn(async (id: string) => {
      const a = store.get(id);
      return a ? structuredClone(a) : null;
    }),
    getByName: vi.fn(async (name: string) => {
      const a = [...store.values()].find((a) => a.name === name);
      return a ? structuredClone(a) : null;
    }),
    save: vi.fn(async (agent: Agent) => {
      store.set(agent.id, structuredClone(agent));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

function createMockStateStore(): IStateStore {
  return {
    read: vi.fn(async () => structuredClone(DEFAULT_STATE)),
    write: vi.fn(async () => {}),
  };
}

describe('AgentService', () => {
  let agentStore: IAgentStore;
  let stateStore: IStateStore;
  let eventBus: EventBus;
  let service: AgentService;

  beforeEach(() => {
    agentStore = createMockAgentStore();
    stateStore = createMockStateStore();
    eventBus = new EventBus();
    service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);
  });

  describe('create', () => {
    it('creates an agent with defaults from config', async () => {
      const agent = await service.create({ name: 'claude-1', adapter: 'claude' });
      expect(agent.id).toMatch(/^agt_/);
      expect(agent.name).toBe('claude-1');
      expect(agent.adapter).toBe('claude');
      expect(agent.status).toBe('idle');
      expect(agent.config.approval_policy).toBe(DEFAULT_CONFIG.defaults.agent.approval_policy);
      expect(agentStore.save).toHaveBeenCalled();
    });

    it('throws on empty name', async () => {
      await expect(service.create({ name: '', adapter: 'claude' })).rejects.toThrow(
        InvalidArgumentsError,
      );
    });

    it('throws on duplicate name', async () => {
      agentStore = createMockAgentStore([makeAgent({ name: 'existing' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      await expect(service.create({ name: 'existing', adapter: 'claude' })).rejects.toThrow(
        InvalidArgumentsError,
      );
    });

    it('stores effort in config when provided', async () => {
      const agent = await service.create({ name: 'effort-agent', adapter: 'claude', effort: 'high' });
      expect(agent.config.effort).toBe('high');
    });

    it('leaves effort undefined when not provided', async () => {
      const agent = await service.create({ name: 'no-effort', adapter: 'claude' });
      expect(agent.config.effort).toBeUndefined();
    });
  });

  describe('get', () => {
    it('returns agent when found', async () => {
      agentStore = createMockAgentStore([makeAgent()]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.get('agt_test1');
      expect(agent.id).toBe('agt_test1');
    });

    it('throws AgentNotFoundError', async () => {
      await expect(service.get('agt_missing')).rejects.toThrow(AgentNotFoundError);
    });
  });

  describe('remove', () => {
    it('removes idle agent', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      await service.remove('agt_test1');
      expect(agentStore.delete).toHaveBeenCalledWith('agt_test1');
    });

    it('throws on running agent with active run', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'running' })]);
      // Simulate an actual running entry in state
      const stateWithRunning = structuredClone(DEFAULT_STATE);
      (stateWithRunning.running as Record<string, unknown>)['tsk_1'] = {
        agent_id: 'agt_test1',
        run_id: 'run_1',
        pid: 1234,
        started_at: new Date().toISOString(),
      };
      stateStore = {
        read: vi.fn(async () => stateWithRunning),
        write: vi.fn(async () => {}),
      };
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      await expect(service.remove('agt_test1')).rejects.toThrow(InvalidArgumentsError);
    });

    it('resets stale running status and deletes', async () => {
      // Agent stuck in "running" but no actual run in state
      agentStore = createMockAgentStore([makeAgent({ status: 'running' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      await service.remove('agt_test1');
      expect(agentStore.save).toHaveBeenCalled();
      expect(agentStore.delete).toHaveBeenCalledWith('agt_test1');
    });
  });

  describe('disable / enable', () => {
    it('disables an agent', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.disable('agt_test1');
      expect(agent.status).toBe('disabled');
    });

    it('enables a disabled agent', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'disabled' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.enable('agt_test1');
      expect(agent.status).toBe('idle');
    });
  });

  describe('update effort', () => {
    it('sets adapter via update', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle', adapter: 'claude' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.update('agt_test1', { adapter: 'grok' });
      expect(agent.adapter).toBe('grok');
    });

    it('throws when updating adapter to empty string', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      await expect(service.update('agt_test1', { adapter: '   ' })).rejects.toThrow(InvalidArgumentsError);
    });

    it('clears model when set to empty string', async () => {
      agentStore = createMockAgentStore([makeAgent({
        status: 'idle',
        config: { ...makeAgent().config, model: 'claude-sonnet-4-6' },
      })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.update('agt_test1', { model: '' });
      expect(agent.config.model).toBeUndefined();
    });

    it('sets effort via update', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle' })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.update('agt_test1', { effort: 'low' });
      expect(agent.config.effort).toBe('low');
    });

    it('clears effort when set to empty string', async () => {
      agentStore = createMockAgentStore([makeAgent({ status: 'idle', config: { ...makeAgent().config, effort: 'high' } })]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const agent = await service.update('agt_test1', { effort: '' as any });
      expect(agent.config.effort).toBeUndefined();
    });
  });

  describe('findBestAgent', () => {
    it('returns null when no agents available', async () => {
      const task = makeTask();
      const result = await service.findBestAgent(task);
      expect(result).toBeNull();
    });

    it('returns assigned agent if idle', async () => {
      const agent = makeAgent({ id: 'agt_1', status: 'idle' });
      agentStore = createMockAgentStore([agent]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ assignee: 'agt_1' });
      const result = await service.findBestAgent(task);
      expect(result?.id).toBe('agt_1');
    });

    it('returns null if assigned agent is not idle', async () => {
      const agent = makeAgent({ id: 'agt_1', status: 'running' });
      agentStore = createMockAgentStore([agent]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ assignee: 'agt_1' });
      const result = await service.findBestAgent(task);
      expect(result).toBeNull();
    });

    it('matches by label via role', async () => {
      const a1 = makeAgent({ id: 'agt_1', name: 'agent-1', role: 'frontend', status: 'idle' });
      const a2 = makeAgent({ id: 'agt_2', name: 'agent-2', role: 'backend developer', status: 'idle' });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['backend'] });
      const result = await service.findBestAgent(task);
      expect(result?.id).toBe('agt_2');
    });

    it('prefers skill match over role match', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        name: 'agent-1',
        role: 'backend developer',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['frontend', 'css'] },
      });
      const a2 = makeAgent({
        id: 'agt_2',
        name: 'agent-2',
        role: 'generalist',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['backend', 'api'] },
      });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['backend'] });
      const result = await service.findBestAgent(task);
      // agt_2: skill match (50) + idle (20) = 70
      // agt_1: role match (30) + idle (20) = 50
      expect(result?.id).toBe('agt_2');
    });

    it('scores multiple skill matches cumulatively', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        name: 'agent-1',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['typescript', 'testing'] },
      });
      const a2 = makeAgent({
        id: 'agt_2',
        name: 'agent-2',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['typescript'] },
      });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['typescript', 'testing'] });
      const result = await service.findBestAgent(task);
      // agt_1: 50+50 + 20 = 120, agt_2: 50 + 20 = 70
      expect(result?.id).toBe('agt_1');
    });

    it('applies success rate bonus', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        status: 'idle',
        stats: { tasks_completed: 9, tasks_failed: 1, total_runs: 10, total_runtime_ms: 0 },
      });
      const a2 = makeAgent({
        id: 'agt_2',
        status: 'idle',
        stats: { tasks_completed: 1, tasks_failed: 9, total_runs: 10, total_runtime_ms: 0 },
      });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask();
      const result = await service.findBestAgent(task);
      // agt_1: idle(20) + success(9) = 29, agt_2: idle(20) + success(1) = 21
      expect(result?.id).toBe('agt_1');
    });

    it('falls back to first idle agent', async () => {
      const a1 = makeAgent({ id: 'agt_1', status: 'running' });
      const a2 = makeAgent({ id: 'agt_2', status: 'idle' });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask();
      const result = await service.findBestAgent(task);
      expect(result?.id).toBe('agt_2');
    });

    it('excludes disabled agents from matching', async () => {
      const a1 = makeAgent({ id: 'agt_1', status: 'disabled', config: { ...makeAgent().config, skills: ['backend'] } });
      const a2 = makeAgent({ id: 'agt_2', status: 'idle' });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['backend'] });
      const result = await service.findBestAgent(task);
      expect(result?.id).toBe('agt_2');
    });

    it('matches skills case-insensitively', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        name: 'agent-1',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['TypeScript', 'REACT'] },
      });
      agentStore = createMockAgentStore([a1]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['typescript', 'react'] });
      const result = await service.findBestAgent(task);
      expect(result?.id).toBe('agt_1');
    });

    it('role substring matching can cause false positives (known issue)', async () => {
      const a1 = makeAgent({ id: 'agt_1', name: 'agent-1', role: 'frontend developer', status: 'idle' });
      const a2 = makeAgent({ id: 'agt_2', name: 'agent-2', role: 'backend developer', status: 'idle' });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      // Label "end" matches both "frontend" and "backend" via includes()
      const task = makeTask({ labels: ['end'] });
      const result = await service.findBestAgent(task);
      // Both agents get role match (30) + idle (20) = 50 — first wins
      expect(result?.role).toContain('end');
    });

    it('combines skill + role + success rate scoring', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        name: 'agent-1',
        role: 'backend developer',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['api'] },
        stats: { tasks_completed: 10, tasks_failed: 0, total_runs: 10, total_runtime_ms: 0 },
      });
      const a2 = makeAgent({
        id: 'agt_2',
        name: 'agent-2',
        role: 'generalist',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['api', 'backend'] },
        stats: { tasks_completed: 5, tasks_failed: 5, total_runs: 10, total_runtime_ms: 0 },
      });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['api', 'backend'] });
      const result = await service.findBestAgent(task);
      // agt_1: skill(50 for api) + role(30 for backend) + idle(20) + success(10) = 110
      // agt_2: skill(50+50 for api+backend) + idle(20) + success(5) = 125
      expect(result?.id).toBe('agt_2');
    });

    it('returns null when all agents are disabled or running', async () => {
      const a1 = makeAgent({ id: 'agt_1', status: 'disabled' });
      const a2 = makeAgent({ id: 'agt_2', status: 'running' });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask();
      const result = await service.findBestAgent(task);
      expect(result).toBeNull();
    });

    it('ignores assignee if agent does not exist', async () => {
      const a1 = makeAgent({ id: 'agt_1', status: 'idle' });
      agentStore = createMockAgentStore([a1]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ assignee: 'agt_nonexistent' });
      const result = await service.findBestAgent(task);
      expect(result).toBeNull();
    });

    it('handles agents with zero task history (no success bonus)', async () => {
      const a1 = makeAgent({
        id: 'agt_1',
        status: 'idle',
        stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
      });
      agentStore = createMockAgentStore([a1]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask();
      const result = await service.findBestAgent(task);
      // Only idle bonus (20), no division by zero
      expect(result?.id).toBe('agt_1');
    });

    it('does not match labels against agents without skills or role', async () => {
      const a1 = makeAgent({ id: 'agt_1', status: 'idle' }); // no role, no skills
      const a2 = makeAgent({
        id: 'agt_2',
        name: 'agent-2',
        status: 'idle',
        config: { ...makeAgent().config, skills: ['backend'] },
      });
      agentStore = createMockAgentStore([a1, a2]);
      service = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ labels: ['backend'] });
      const result = await service.findBestAgent(task);
      // agt_1: idle(20) only; agt_2: skill(50) + idle(20) = 70
      expect(result?.id).toBe('agt_2');
    });
  });
});
