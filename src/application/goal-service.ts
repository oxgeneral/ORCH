/**
 * Goal service — business logic for goal lifecycle.
 *
 * Goals are persistent objectives that drive autonomous agent work.
 * State machine: active → achieved | abandoned | paused
 *                paused → active | achieved | abandoned
 *
 * Side effect: assigning an agent to a goal auto-enables autonomous mode;
 * removing the last active goal from an agent auto-disables it.
 */

import { nanoid } from 'nanoid';
import type { Goal, GoalStatus, CreateGoalInput } from '../domain/goal.js';
import { isGoalTerminal } from '../domain/goal.js';
import { AUTONOMOUS_LABEL, type Task } from '../domain/task.js';
import { isTerminal as isTaskTerminal } from '../domain/transitions.js';
import { GoalNotFoundError, GoalHasPendingTasksError, InvalidArgumentsError } from '../domain/errors.js';
import type { IGoalStore, IContextStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';
import type { AgentService } from './agent-service.js';
import type { TaskService } from './task-service.js';
import { sanitizeText } from '../infrastructure/security/redaction.js';

const VALID_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  active: ['paused', 'achieved', 'abandoned'],
  paused: ['active', 'achieved', 'abandoned'],
  achieved: [],
  abandoned: [],
};

export class GoalService {
  constructor(
    private readonly goalStore: IGoalStore,
    private readonly eventBus: EventBus,
    private readonly agentService?: AgentService,
    private readonly taskService?: TaskService,
    private readonly contextStore?: IContextStore,
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
      orchestration: {
        enabled: true,
        phase: 'needs_analysis',
        cycle: 1,
        lead_agent_id: input.assignee,
        last_transition_at: now,
      },
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

  async updateStatus(id: string, newStatus: GoalStatus, opts?: { force?: boolean }): Promise<Goal> {
    const goal = await this.get(id);
    const oldStatus = goal.status;

    if (!VALID_TRANSITIONS[oldStatus].includes(newStatus)) {
      const err = new InvalidArgumentsError(`Cannot transition goal from '${oldStatus}' to '${newStatus}'`);
      await this.recordGoalFailure(goal, err.message, 'status transition');
      throw err;
    }

    // Guard: block achieved if child tasks are still pending.
    // Autonomous [auto] tasks are excluded — they are the mechanism for achieving
    // the goal and will be cleaned up by side effects after status change.
    if (newStatus === 'achieved' && this.taskService) {
      const childTasks = await this.taskService.list({ goalId: id });
      const pending = childTasks.filter(
        (t) => !isTaskTerminal(t.status) && !t.labels?.includes(AUTONOMOUS_LABEL),
      );
      if (pending.length > 0) {
        if (opts?.force) {
          // Force mode: cancel tasks that are safe to cancel at storage level.
          // in_progress tasks have live OS processes — GoalService cannot kill them.
          const cancellable = pending.filter((t) => t.status !== 'in_progress');
          const running = pending.filter((t) => t.status === 'in_progress');
          await Promise.all(
            cancellable.map((t) => this.taskService!.cancel(t.id).catch(() => {})),
          );
          if (running.length > 0) {
            const summary = running.map((t) => `${t.id} (in_progress)`).join(', ');
            const err = new GoalHasPendingTasksError(id, running.length, summary);
            await this.recordGoalFailure(goal, err.message, 'force achieved blocked by running tasks');
            throw err;
          }
        } else {
          const summary = pending.map((t) => `${t.id} (${t.status})`).join(', ');
          const err = new GoalHasPendingTasksError(id, pending.length, summary);
          await this.recordGoalFailure(goal, err.message, 'achieved blocked by pending tasks');
          throw err;
        }
      }
    }

    goal.status = newStatus;
    const oldPhase = goal.orchestration?.phase;
    if (goal.orchestration) {
      if (newStatus === 'paused') {
        goal.orchestration.phase = 'paused';
      } else if (newStatus === 'active' && oldStatus === 'paused') {
        goal.orchestration.phase = 'needs_analysis';
      } else if (isGoalTerminal(newStatus)) {
        goal.orchestration.phase = 'closed';
      }
      goal.orchestration.last_transition_at = new Date().toISOString();
    }
    goal.updated_at = new Date().toISOString();
    await this.goalStore.save(goal);

    this.eventBus.emit({ type: 'goal:status_changed', goalId: id, from: oldStatus, to: newStatus });
    if (oldPhase && goal.orchestration && oldPhase !== goal.orchestration.phase) {
      this.eventBus.emit({
        type: 'goal:phase_changed',
        goalId: id,
        from: oldPhase,
        to: goal.orchestration.phase,
        cycle: goal.orchestration.cycle,
      });
    }

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
    if (fields.assignee !== undefined && goal.orchestration?.enabled) {
      goal.orchestration.lead_agent_id = goal.assignee;
      goal.orchestration.last_transition_at = new Date().toISOString();
    }

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

  async listTasksForGoal(goalId: string): Promise<Task[]> {
    return this.taskService?.list({ goalId }) ?? [];
  }

  async getProgressReport(goalId: string): Promise<string | undefined> {
    if (!this.contextStore) return undefined;
    const entry = await this.contextStore.get(`${goalId}-progress`);
    return entry?.value;
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

  private async recordGoalFailure(goal: Goal, message: string, context: string): Promise<void> {
    const failure = {
      message: sanitizeText(message).slice(0, 1000),
      phase: 'goal' as const,
      at: new Date().toISOString(),
      context,
      goalId: goal.id,
      retryable: true,
    };
    goal.last_error = failure;
    goal.updated_at = failure.at;
    await this.goalStore.save(goal).catch(() => {});
    this.eventBus.emit({
      type: 'goal:error',
      goalId: goal.id,
      error: failure.message,
      phase: failure.phase,
      retryable: failure.retryable,
    });
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
