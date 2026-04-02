/**
 * Tests for GoalService autonomous mode side effects.
 * Covers: enableAutonomous, maybeDisableAutonomous, graceful no-ops,
 * error swallowing, and multi-goal scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoalService } from '../../../src/application/goal-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { GoalHasPendingTasksError } from '../../../src/domain/errors.js';
import type { IGoalStore } from '../../../src/infrastructure/storage/interfaces.js';
import type { Goal } from '../../../src/domain/goal.js';
import type { Task } from '../../../src/domain/task.js';

// --- Helpers ---

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal_test1',
    title: 'Test goal',
    description: '',
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockGoalStore(goals: Goal[] = []): IGoalStore {
  const store = new Map(goals.map((g) => [g.id, structuredClone(g)]));
  return {
    list: vi.fn(async (filter?: { status?: string }) => {
      const all = [...store.values()];
      if (filter?.status) return all.filter((g) => g.status === filter.status);
      return all;
    }),
    get: vi.fn(async (id: string) => {
      const g = store.get(id);
      return g ? structuredClone(g) : null;
    }),
    save: vi.fn(async (goal: Goal) => {
      store.set(goal.id, structuredClone(goal));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

function createMockAgentService() {
  return {
    setAutonomous: vi.fn(async (_id: string, _enabled: boolean) => {}),
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test1',
    title: 'Test task',
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

function createMockTaskService(tasks: Task[] = []) {
  const store = new Map(tasks.map((t) => [t.id, structuredClone(t)]));
  return {
    list: vi.fn(async (filter?: { status?: string; goalId?: string }) => {
      let result = [...store.values()];
      if (filter?.goalId) result = result.filter((t) => t.goalId === filter.goalId);
      if (filter?.status) result = result.filter((t) => t.status === filter.status);
      return result;
    }),
    cancel: vi.fn(async (id: string) => {
      const t = store.get(id);
      if (t) {
        t.status = 'cancelled';
        store.set(id, t);
      }
      return t;
    }),
  };
}

// --- Tests ---

describe('GoalService autonomous mode side effects', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('create', () => {
    it('calls enableAutonomous when goal is created with assignee', async () => {
      const goalStore = createMockGoalStore();
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.create({ title: 'Goal A', assignee: 'agt_001' });

      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_001', true);
    });

    it('does not call enableAutonomous when goal is created without assignee', async () => {
      const goalStore = createMockGoalStore();
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.create({ title: 'Goal A' });

      expect(agentService.setAutonomous).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('calls maybeDisableAutonomous when deleting goal with assignee', async () => {
      const goal = makeGoal({ id: 'goal_del1', assignee: 'agt_002' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.delete('goal_del1');

      // After deletion store is empty → no active goals → disable
      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_002', false);
    });

    it('does not call setAutonomous when deleted goal has no assignee', async () => {
      const goal = makeGoal({ id: 'goal_del2' }); // no assignee
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.delete('goal_del2');

      expect(agentService.setAutonomous).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('calls maybeDisableAutonomous when status transitions to achieved', async () => {
      const goal = makeGoal({ id: 'goal_s1', status: 'active', assignee: 'agt_003' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.updateStatus('goal_s1', 'achieved');

      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_003', false);
    });

    it('calls maybeDisableAutonomous when status transitions to abandoned', async () => {
      const goal = makeGoal({ id: 'goal_s2', status: 'active', assignee: 'agt_004' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.updateStatus('goal_s2', 'abandoned');

      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_004', false);
    });

    it('calls maybeDisableAutonomous when transitioning to paused', async () => {
      const goal = makeGoal({ id: 'goal_s3', status: 'active', assignee: 'agt_005' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.updateStatus('goal_s3', 'paused');

      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_005', false);
    });

    it('does not call setAutonomous on terminal status if goal has no assignee', async () => {
      const goal = makeGoal({ id: 'goal_s4', status: 'active' }); // no assignee
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.updateStatus('goal_s4', 'achieved');

      expect(agentService.setAutonomous).not.toHaveBeenCalled();
    });
  });

  describe('update assignee change', () => {
    it('enables new assignee and maybe-disables old when assignee changes', async () => {
      const goal = makeGoal({ id: 'goal_u1', assignee: 'agt_old' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.update('goal_u1', { assignee: 'agt_new' });

      // enable new
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_new', true);
      // disable old (no other active goals for agt_old)
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_old', false);
      expect(agentService.setAutonomous).toHaveBeenCalledTimes(2);
    });

    it('enables new assignee only when old was undefined', async () => {
      const goal = makeGoal({ id: 'goal_u2' }); // no assignee
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.update('goal_u2', { assignee: 'agt_new2' });

      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_new2', true);
    });

    it('maybe-disables old assignee only when new assignee is empty string (cleared)', async () => {
      const goal = makeGoal({ id: 'goal_u3', assignee: 'agt_will_lose' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.update('goal_u3', { assignee: '' });

      // empty string → assignee becomes undefined → old should maybe-disable
      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_will_lose', false);
    });

    it('does not call setAutonomous when assignee is unchanged', async () => {
      const goal = makeGoal({ id: 'goal_u4', assignee: 'agt_same' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.update('goal_u4', { title: 'New title' }); // no assignee field

      expect(agentService.setAutonomous).not.toHaveBeenCalled();
    });
  });

  describe('no agentService (undefined)', () => {
    it('create with assignee is graceful no-op', async () => {
      const goalStore = createMockGoalStore();
      const svc = new GoalService(goalStore, eventBus); // no agentService

      await expect(svc.create({ title: 'Goal X', assignee: 'agt_x' })).resolves.not.toThrow();
    });

    it('delete is graceful no-op', async () => {
      const goal = makeGoal({ id: 'goal_noop1', assignee: 'agt_y' });
      const goalStore = createMockGoalStore([goal]);
      const svc = new GoalService(goalStore, eventBus);

      await expect(svc.delete('goal_noop1')).resolves.not.toThrow();
    });

    it('updateStatus to achieved is graceful no-op', async () => {
      const goal = makeGoal({ id: 'goal_noop2', status: 'active', assignee: 'agt_z' });
      const goalStore = createMockGoalStore([goal]);
      const svc = new GoalService(goalStore, eventBus);

      await expect(svc.updateStatus('goal_noop2', 'achieved')).resolves.not.toThrow();
    });
  });

  describe('agentService.setAutonomous throws', () => {
    it('create: error is caught silently', async () => {
      const goalStore = createMockGoalStore();
      const agentService = { setAutonomous: vi.fn(async () => { throw new Error('agent not found'); }) };
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await expect(svc.create({ title: 'Goal err', assignee: 'agt_missing' })).resolves.not.toThrow();
    });

    it('delete: error is caught silently', async () => {
      const goal = makeGoal({ id: 'goal_err1', assignee: 'agt_missing' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = { setAutonomous: vi.fn(async () => { throw new Error('fail'); }) };
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await expect(svc.delete('goal_err1')).resolves.not.toThrow();
    });

    it('updateStatus: error is caught silently', async () => {
      const goal = makeGoal({ id: 'goal_err2', status: 'active', assignee: 'agt_missing' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = { setAutonomous: vi.fn(async () => { throw new Error('fail'); }) };
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await expect(svc.updateStatus('goal_err2', 'achieved')).resolves.not.toThrow();
    });
  });

  describe('achieved blocks when child tasks are pending', () => {
    it('throws GoalHasPendingTasksError when todo tasks exist for the goal', async () => {
      const goal = makeGoal({ id: 'goal_pend1', status: 'active' });
      const task = makeTask({ id: 'tsk_child1', status: 'todo', goalId: 'goal_pend1' });
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService([task]);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      await expect(svc.updateStatus('goal_pend1', 'achieved'))
        .rejects.toThrow(GoalHasPendingTasksError);
    });

    it('throws when in_progress tasks exist for the goal', async () => {
      const goal = makeGoal({ id: 'goal_pend2', status: 'active' });
      const task = makeTask({ id: 'tsk_child2', status: 'in_progress', goalId: 'goal_pend2' });
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService([task]);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      await expect(svc.updateStatus('goal_pend2', 'achieved'))
        .rejects.toThrow(GoalHasPendingTasksError);
    });

    it('throws when review tasks exist for the goal', async () => {
      const goal = makeGoal({ id: 'goal_pend3', status: 'active' });
      const task = makeTask({ id: 'tsk_child3', status: 'review', goalId: 'goal_pend3' });
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService([task]);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      await expect(svc.updateStatus('goal_pend3', 'achieved'))
        .rejects.toThrow(GoalHasPendingTasksError);
    });

    it('allows achieved when all child tasks are in terminal states', async () => {
      const goal = makeGoal({ id: 'goal_ok1', status: 'active' });
      const tasks = [
        makeTask({ id: 'tsk_done', status: 'done', goalId: 'goal_ok1' }),
        makeTask({ id: 'tsk_fail', status: 'failed', goalId: 'goal_ok1' }),
        makeTask({ id: 'tsk_canc', status: 'cancelled', goalId: 'goal_ok1' }),
      ];
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService(tasks);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      const result = await svc.updateStatus('goal_ok1', 'achieved');
      expect(result.status).toBe('achieved');
    });

    it('allows achieved when no child tasks exist', async () => {
      const goal = makeGoal({ id: 'goal_empty', status: 'active' });
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService([]);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      const result = await svc.updateStatus('goal_empty', 'achieved');
      expect(result.status).toBe('achieved');
    });

    it('force: cancels pending tasks and allows achieved', async () => {
      const goal = makeGoal({ id: 'goal_force1', status: 'active' });
      const tasks = [
        makeTask({ id: 'tsk_f1', status: 'todo', goalId: 'goal_force1' }),
        makeTask({ id: 'tsk_f2', status: 'in_progress', goalId: 'goal_force1' }),
        makeTask({ id: 'tsk_f3', status: 'done', goalId: 'goal_force1' }),
      ];
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService(tasks);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      const result = await svc.updateStatus('goal_force1', 'achieved', { force: true });
      expect(result.status).toBe('achieved');
      // Should cancel the 2 non-terminal tasks, not the done one
      expect(taskService.cancel).toHaveBeenCalledTimes(2);
      expect(taskService.cancel).toHaveBeenCalledWith('tsk_f1');
      expect(taskService.cancel).toHaveBeenCalledWith('tsk_f2');
    });

    it('does not check tasks for non-achieved transitions', async () => {
      const goal = makeGoal({ id: 'goal_pause', status: 'active', assignee: 'agt_x' });
      const task = makeTask({ id: 'tsk_p1', status: 'todo', goalId: 'goal_pause' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const taskService = createMockTaskService([task]);
      const svc = new GoalService(goalStore, eventBus, agentService as any, taskService as any);

      // paused should NOT check child tasks by goalId (cancelPendingAutonomousTasks may call list with status filter)
      const result = await svc.updateStatus('goal_pause', 'paused');
      expect(result.status).toBe('paused');
      expect(taskService.list).not.toHaveBeenCalledWith({ goalId: 'goal_pause' });
    });

    it('does not check tasks for abandoned transition', async () => {
      const goal = makeGoal({ id: 'goal_aband', status: 'active' });
      const task = makeTask({ id: 'tsk_ab1', status: 'todo', goalId: 'goal_aband' });
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService([task]);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      // abandoned should NOT check child tasks — it's a deliberate "give up"
      const result = await svc.updateStatus('goal_aband', 'abandoned');
      expect(result.status).toBe('abandoned');
    });

    it('error message includes task IDs and statuses', async () => {
      const goal = makeGoal({ id: 'goal_msg', status: 'active' });
      const tasks = [
        makeTask({ id: 'tsk_m1', status: 'todo', goalId: 'goal_msg' }),
        makeTask({ id: 'tsk_m2', status: 'retrying', goalId: 'goal_msg' }),
      ];
      const goalStore = createMockGoalStore([goal]);
      const taskService = createMockTaskService(tasks);
      const svc = new GoalService(goalStore, eventBus, undefined, taskService as any);

      try {
        await svc.updateStatus('goal_msg', 'achieved');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GoalHasPendingTasksError);
        const msg = (err as Error).message;
        expect(msg).toContain('tsk_m1');
        expect(msg).toContain('tsk_m2');
        expect(msg).toContain('2 task(s) still pending');
      }
    });

    it('skips validation when taskService is not provided', async () => {
      const goal = makeGoal({ id: 'goal_notsk', status: 'active' });
      const goalStore = createMockGoalStore([goal]);
      // No taskService — should not throw even if child tasks would exist
      const svc = new GoalService(goalStore, eventBus);

      const result = await svc.updateStatus('goal_notsk', 'achieved');
      expect(result.status).toBe('achieved');
    });
  });

  describe('multiple active goals — disable only when last removed', () => {
    it('does NOT disable autonomous when agent still has another active goal after deletion', async () => {
      const goal1 = makeGoal({ id: 'goal_m1', assignee: 'agt_shared' });
      const goal2 = makeGoal({ id: 'goal_m2', assignee: 'agt_shared' });
      const goalStore = createMockGoalStore([goal1, goal2]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      // Delete goal_m1 — goal_m2 is still active for agt_shared
      await svc.delete('goal_m1');

      // Should NOT call setAutonomous(false) because goal_m2 is still active
      expect(agentService.setAutonomous).not.toHaveBeenCalledWith('agt_shared', false);
    });

    it('disables autonomous when last active goal is deleted', async () => {
      const goal = makeGoal({ id: 'goal_last', assignee: 'agt_solo' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.delete('goal_last');

      expect(agentService.setAutonomous).toHaveBeenCalledOnce();
      expect(agentService.setAutonomous).toHaveBeenCalledWith('agt_solo', false);
    });

    it('does NOT disable when agent still has active goal after terminal status change', async () => {
      const goal1 = makeGoal({ id: 'goal_t1', status: 'active', assignee: 'agt_multi' });
      const goal2 = makeGoal({ id: 'goal_t2', status: 'active', assignee: 'agt_multi' });
      const goalStore = createMockGoalStore([goal1, goal2]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      // Transition goal1 to achieved — goal2 is still active
      await svc.updateStatus('goal_t1', 'achieved');

      // goal_t2 is still active for agt_multi → should NOT disable
      expect(agentService.setAutonomous).not.toHaveBeenCalledWith('agt_multi', false);
    });
  });
});
