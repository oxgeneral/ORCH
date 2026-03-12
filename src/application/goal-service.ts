/**
 * Goal service — business logic for goal lifecycle.
 *
 * Goals are persistent objectives that drive autonomous agent work.
 * State machine: active → achieved | abandoned
 *                active ↔ paused
 *
 * Side effect: assigning an agent to a goal auto-enables autonomous mode;
 * removing the last active goal from an agent auto-disables it.
 */

import { nanoid } from 'nanoid';
import type { Goal, GoalStatus, CreateGoalInput } from '../domain/goal.js';
import { isGoalTerminal } from '../domain/goal.js';
import { AUTONOMOUS_LABEL } from '../domain/task.js';
import { GoalNotFoundError, InvalidArgumentsError } from '../domain/errors.js';
import type { IGoalStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';
import type { AgentService } from './agent-service.js';
import type { TaskService } from './task-service.js';

const VALID_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  active: ['paused', 'achieved', 'abandoned'],
  paused: ['active', 'abandoned'],
  achieved: [],
  abandoned: [],
};

export class GoalService {
  constructor(
    private readonly goalStore: IGoalStore,
    private readonly eventBus: EventBus,
    private readonly agentService?: AgentService,
    private readonly taskService?: TaskService,
  ) {}

  async create(input: CreateGoalInput): Promise<Goal> {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError('Goal title is required');
    }

    const now = new Date().toISOString();
    const goal: Goal = {
      id: `goal_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      status: 'active',
      assignee: input.assignee,
      created_at: now,
      updated_at: now,
    };

    await this.goalStore.save(goal);
    this.eventBus.emit({ type: 'goal:created', goalId: goal.id, title: goal.title });

    if (goal.assignee) {
      await this.enableAutonomous(goal.assignee);
    }

    return goal;
  }

  async list(filter?: { status?: GoalStatus }): Promise<Goal[]> {
    return this.goalStore.list(filter);
  }

  async get(id: string): Promise<Goal> {
    const goal = await this.goalStore.get(id);
    if (!goal) throw new GoalNotFoundError(id);
    return goal;
  }

  async updateStatus(id: string, newStatus: GoalStatus): Promise<Goal> {
    const goal = await this.get(id);
    const oldStatus = goal.status;

    if (!VALID_TRANSITIONS[oldStatus].includes(newStatus)) {
      throw new InvalidArgumentsError(
        `Cannot transition goal from '${oldStatus}' to '${newStatus}'`,
      );
    }

    goal.status = newStatus;
    goal.updated_at = new Date().toISOString();
    await this.goalStore.save(goal);

    this.eventBus.emit({ type: 'goal:status_changed', goalId: id, from: oldStatus, to: newStatus });

    if (goal.assignee) {
      if (newStatus === 'paused') {
        // Pause: disable autonomous + cancel pending autonomous tasks
        await this.maybeDisableAutonomous(goal.assignee);
        await this.cancelPendingAutonomousTasks(goal.assignee);
      } else if (newStatus === 'active' && oldStatus === 'paused') {
        // Resume: re-enable autonomous mode
        await this.enableAutonomous(goal.assignee);
      } else if (isGoalTerminal(newStatus)) {
        // Terminal: check if agent still has other active goals
        await this.maybeDisableAutonomous(goal.assignee);
      }
    }

    return goal;
  }

  async update(id: string, fields: { title?: string; description?: string; assignee?: string }): Promise<Goal> {
    const goal = await this.get(id);
    const oldAssignee = goal.assignee;

    if (fields.title !== undefined) {
      if (!fields.title.trim()) throw new InvalidArgumentsError('Goal title cannot be empty');
      goal.title = fields.title.trim();
    }
    if (fields.description !== undefined) goal.description = fields.description.trim();
    if (fields.assignee !== undefined) goal.assignee = fields.assignee || undefined;

    goal.updated_at = new Date().toISOString();
    await this.goalStore.save(goal);
    this.eventBus.emit({ type: 'goal:updated', goalId: id });

    // Handle assignee change — independent agents, run in parallel
    const newAssignee = goal.assignee;
    if (newAssignee !== oldAssignee) {
      const ops: Promise<void>[] = [];
      if (newAssignee) ops.push(this.enableAutonomous(newAssignee));
      if (oldAssignee) ops.push(this.maybeDisableAutonomous(oldAssignee));
      await Promise.all(ops);
    }

    return goal;
  }

  async delete(id: string): Promise<void> {
    const goal = await this.get(id);
    const { assignee } = goal;
    await this.goalStore.delete(id);
    this.eventBus.emit({ type: 'goal:deleted', goalId: id });

    if (assignee) {
      await this.maybeDisableAutonomous(assignee);
    }
  }

  /** Enable autonomous mode on an agent. */
  private async enableAutonomous(agentId: string): Promise<void> {
    if (!this.agentService) return;
    try {
      await this.agentService.setAutonomous(agentId, true);
    } catch {
      // Agent may not exist — ignore silently
    }
  }

  /** Check if an agent has at least one active goal. */
  private async hasActiveGoalsForAgent(agentId: string): Promise<boolean> {
    const activeGoals = await this.goalStore.list({ status: 'active' });
    return activeGoals.some((g) => g.assignee === agentId);
  }

  /** Cancel dispatchable (todo/retrying) autonomous tasks assigned to the agent. */
  private async cancelPendingAutonomousTasks(agentId: string): Promise<void> {
    if (!this.taskService) return;
    try {
      const [todos, retrying] = await Promise.all([
        this.taskService.list({ status: 'todo' }),
        this.taskService.list({ status: 'retrying' }),
      ]);
      const pending = [...todos, ...retrying].filter(
        (t) => t.assignee === agentId && t.labels?.includes(AUTONOMOUS_LABEL),
      );
      await Promise.all(pending.map((t) => this.taskService!.cancel(t.id).catch(() => {})));
    } catch {
      // Best-effort cleanup
    }
  }

  /** Disable autonomous if agent has no other active goals. */
  private async maybeDisableAutonomous(agentId: string): Promise<void> {
    if (!this.agentService) return;
    try {
      if (!(await this.hasActiveGoalsForAgent(agentId))) {
        await this.agentService.setAutonomous(agentId, false);
      }
    } catch {
      // Agent may not exist — ignore silently
    }
  }
}
