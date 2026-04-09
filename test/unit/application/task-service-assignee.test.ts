/**
 * Tests for GitHub Issue #7: Tasks assigned by agent name instead of agent ID
 * are never picked up by serve/run.
 *
 * Fix: TaskService.resolveAssignee() normalizes names to IDs at creation time.
 * Defense-in-depth: findBestAgent() also matches by name as fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { TaskService } from '../../../src/application/task-service.js';
import { AgentService } from '../../../src/application/agent-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import {
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockStateStore,
} from './helpers.js';

describe('Issue #7: assignee name→ID resolution', () => {
  describe('TaskService.create — resolveAssignee', () => {
    it('resolves agent name to ID at creation time', async () => {
      const agent = makeAgent({ id: 'agt_sam01', name: 'Sam Altman' });
      const agentStore = createMockAgentStore([agent]);
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG, undefined, agentStore);

      const task = await service.create({
        title: 'Build AGI',
        assignee: 'Sam Altman',
      });

      expect(task.assignee).toBe('agt_sam01');
    });

    it('accepts valid agent ID as-is', async () => {
      const agent = makeAgent({ id: 'agt_elon1', name: 'Elon Musk' });
      const agentStore = createMockAgentStore([agent]);
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG, undefined, agentStore);

      const task = await service.create({
        title: 'Go to Mars',
        assignee: 'agt_elon1',
      });

      expect(task.assignee).toBe('agt_elon1');
    });

    it('throws error for unknown agent name', async () => {
      const agentStore = createMockAgentStore([]);
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG, undefined, agentStore);

      await expect(
        service.create({ title: 'Task', assignee: 'NonExistent Agent' }),
      ).rejects.toThrow(/Unknown agent/);
    });

    it('throws error for unknown agt_ ID', async () => {
      const agentStore = createMockAgentStore([]);
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG, undefined, agentStore);

      await expect(
        service.create({ title: 'Task for missing agent', assignee: 'agt_nonexistent' }),
      ).rejects.toThrow(/Unknown agent ID/);
    });

    it('works without agentStore (backward compatibility)', async () => {
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG);

      const task = await service.create({
        title: 'Legacy task',
        assignee: 'Sam Altman',
      });

      // Without agentStore, assignee is passed through as-is
      expect(task.assignee).toBe('Sam Altman');
    });

    it('handles undefined assignee', async () => {
      const agentStore = createMockAgentStore([makeAgent()]);
      const eventBus = new EventBus();
      const service = new TaskService(createMockTaskStore(), eventBus, DEFAULT_CONFIG, undefined, agentStore);

      const task = await service.create({ title: 'Unassigned task' });

      expect(task.assignee).toBeUndefined();
    });
  });

  describe('TaskService.assign — raw setter (no resolution)', () => {
    it('sets assignee as-is without resolving names', async () => {
      const task = makeTask({ id: 'tsk_re1', assignee: undefined });
      const taskStore = createMockTaskStore([task]);
      const eventBus = new EventBus();
      const service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      // assign() is a raw setter — caller is responsible for resolving names
      const result = await service.assign('tsk_re1', 'agt_new1');

      expect(result.assignee).toBe('agt_new1');
    });
  });

  describe('AgentService.findBestAgent — name fallback', () => {
    it('matches by agent name when assignee is a name', async () => {
      const agent = makeAgent({ id: 'agt_fb1', name: 'FallbackAgent', status: 'idle' });
      const agentStore = createMockAgentStore([agent]);
      const stateStore = createMockStateStore();
      const eventBus = new EventBus();
      const agentService = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      // Task with name-based assignee (legacy or external creation)
      const task = makeTask({ assignee: 'FallbackAgent' });

      const result = await agentService.findBestAgent(task);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('agt_fb1');
    });

    it('matches by agent ID when assignee is an ID', async () => {
      const agent = makeAgent({ id: 'agt_id1', name: 'IdAgent', status: 'idle' });
      const agentStore = createMockAgentStore([agent]);
      const stateStore = createMockStateStore();
      const eventBus = new EventBus();
      const agentService = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ assignee: 'agt_id1' });

      const result = await agentService.findBestAgent(task);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('agt_id1');
    });

    it('returns null when assigned agent is busy', async () => {
      const agent = makeAgent({ id: 'agt_busy', name: 'BusyAgent', status: 'running' });
      const agentStore = createMockAgentStore([agent]);
      const stateStore = createMockStateStore();
      const eventBus = new EventBus();
      const agentService = new AgentService(agentStore, stateStore, eventBus, DEFAULT_CONFIG);

      const task = makeTask({ assignee: 'BusyAgent' });

      const result = await agentService.findBestAgent(task);
      expect(result).toBeNull();
    });
  });
});
