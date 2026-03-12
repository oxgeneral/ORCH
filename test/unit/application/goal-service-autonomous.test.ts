/**
 * Tests for GoalService autonomous mode side effects.
 * Covers: enableAutonomous, maybeDisableAutonomous, graceful no-ops,
 * error swallowing, and multi-goal scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoalService } from '../../../src/application/goal-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import type { IGoalStore } from '../../../src/infrastructure/storage/interfaces.js';
import type { Goal } from '../../../src/domain/goal.js';

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

    it('does not call setAutonomous when transitioning to paused (non-terminal)', async () => {
      const goal = makeGoal({ id: 'goal_s3', status: 'active', assignee: 'agt_005' });
      const goalStore = createMockGoalStore([goal]);
      const agentService = createMockAgentService();
      const svc = new GoalService(goalStore, eventBus, agentService as any);

      await svc.updateStatus('goal_s3', 'paused');

      expect(agentService.setAutonomous).not.toHaveBeenCalled();
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
