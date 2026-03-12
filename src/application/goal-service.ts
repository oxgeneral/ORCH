/**
 * Goal service — business logic for goal lifecycle.
 *
 * Goals are persistent objectives that drive autonomous agent work.
 * State machine: active → achieved | abandoned
 *                active ↔ paused
 */

import { nanoid } from 'nanoid';
import type { Goal, GoalStatus, CreateGoalInput } from '../domain/goal.js';
import { GoalNotFoundError, InvalidArgumentsError } from '../domain/errors.js';
import type { IGoalStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';

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
    return goal;
  }

  async update(id: string, fields: { title?: string; description?: string; assignee?: string }): Promise<Goal> {
    const goal = await this.get(id);

    if (fields.title !== undefined) {
      if (!fields.title.trim()) throw new InvalidArgumentsError('Goal title cannot be empty');
      goal.title = fields.title.trim();
    }
    if (fields.description !== undefined) goal.description = fields.description.trim();
    if (fields.assignee !== undefined) goal.assignee = fields.assignee || undefined;

    goal.updated_at = new Date().toISOString();
    await this.goalStore.save(goal);
    return goal;
  }

  async delete(id: string): Promise<void> {
    await this.get(id); // ensure exists
    await this.goalStore.delete(id);
    this.eventBus.emit({ type: 'goal:deleted', goalId: id });
  }
}
