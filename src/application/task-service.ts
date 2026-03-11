/**
 * Task service — business logic for task lifecycle.
 *
 * Validates state transitions, emits events, manages CRUD.
 * CLI commands call this service, not storage directly.
 */

import { nanoid } from 'nanoid';
import type { Task, CreateTaskInput, TaskStatus } from '../domain/task.js';
import { canTransition, isTerminal } from '../domain/transitions.js';
import {
  TaskNotFoundError,
  InvalidTransitionError,
  TaskAlreadyRunningError,
  InvalidArgumentsError,
} from '../domain/errors.js';
import type { ITaskStore } from '../infrastructure/storage/interfaces.js';
import type { IStateStore } from '../infrastructure/storage/interfaces.js';
import type { OrchestratorConfig } from '../domain/config.js';
import type { EventBus } from './event-bus.js';

export class TaskService {
  constructor(
    private readonly taskStore: ITaskStore,
    private readonly stateStore: IStateStore,
    private readonly eventBus: EventBus,
    private readonly config: OrchestratorConfig,
  ) {}

  async create(input: CreateTaskInput): Promise<Task> {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError('Task title is required');
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: `tsk_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      status: 'todo',
      priority: input.priority ?? this.config.defaults.task.priority,
      assignee: input.assignee,
      labels: input.labels ?? [],
      depends_on: input.depends_on ?? [],
      created_at: now,
      updated_at: now,
      attempts: 0,
      max_attempts: input.max_attempts ?? this.config.defaults.task.max_attempts,
      workspace_mode: input.workspace_mode,
      review_criteria: input.review_criteria,
      scope: input.scope,
    };

    await this.taskStore.save(task);
    this.eventBus.emit({ type: 'task:created', task });

    return task;
  }

  async list(filter?: { status?: TaskStatus }): Promise<Task[]> {
    return this.taskStore.list(filter);
  }

  async get(id: string): Promise<Task> {
    const task = await this.taskStore.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

  async updateStatus(id: string, newStatus: TaskStatus): Promise<Task> {
    const task = await this.get(id);
    const oldStatus = task.status;

    if (!canTransition(oldStatus, newStatus)) {
      throw new InvalidTransitionError(id, oldStatus, newStatus);
    }

    task.status = newStatus;
    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);

    this.eventBus.emit({
      type: 'task:status_changed',
      taskId: id,
      from: oldStatus,
      to: newStatus,
    });

    return task;
  }

  async assign(taskId: string, agentId: string): Promise<Task> {
    const task = await this.get(taskId);
    task.assignee = agentId;
    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);

    this.eventBus.emit({
      type: 'task:assigned',
      taskId,
      agentId,
    });

    return task;
  }

  async cancel(id: string): Promise<Task> {
    const task = await this.get(id);

    if (isTerminal(task.status)) {
      throw new InvalidTransitionError(id, task.status, 'cancelled');
    }

    // If task is running, check state
    if (task.status === 'in_progress') {
      const state = await this.stateStore.read();
      const running = state.running[id];
      if (running) {
        throw new TaskAlreadyRunningError(id, running.run_id, running.agent_id);
      }
    }

    return this.updateStatus(id, 'cancelled');
  }

  async retry(id: string): Promise<Task> {
    const task = await this.get(id);

    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new InvalidTransitionError(id, task.status, 'todo');
    }

    const oldStatus = task.status;
    task.status = 'todo';
    task.attempts = 0;
    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);

    this.eventBus.emit({
      type: 'task:status_changed',
      taskId: id,
      from: oldStatus,
      to: 'todo',
    });

    return task;
  }

  async update(id: string, fields: { title?: string; description?: string; priority?: number; labels?: string[] }): Promise<Task> {
    const task = await this.get(id);

    if (fields.title !== undefined) {
      if (!fields.title.trim()) throw new InvalidArgumentsError('Task title cannot be empty');
      task.title = fields.title.trim();
    }
    if (fields.description !== undefined) task.description = fields.description.trim();
    if (fields.priority !== undefined) task.priority = fields.priority;
    if (fields.labels !== undefined) task.labels = fields.labels;

    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);
    return task;
  }

  async delete(id: string): Promise<void> {
    const task = await this.get(id);
    if (task.status === 'in_progress') {
      throw new InvalidArgumentsError('Cannot delete a running task. Cancel it first.');
    }
    await this.taskStore.delete(id);
  }

  async incrementAttempts(id: string): Promise<Task> {
    const task = await this.get(id);
    task.attempts += 1;
    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);
    return task;
  }
}
