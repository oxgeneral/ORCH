/**
 * Task service — business logic for task lifecycle.
 *
 * Validates state transitions, emits events, manages CRUD.
 * CLI commands call this service, not storage directly.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { Task, CreateTaskInput, TaskStatus } from '../domain/task.js';
import { canTransition, isTerminal } from '../domain/transitions.js';
import {
  TaskNotFoundError,
  InvalidTransitionError,
  InvalidArgumentsError,
} from '../domain/errors.js';
import type { ITaskStore, IAgentStore } from '../infrastructure/storage/interfaces.js';
import type { Paths } from '../infrastructure/storage/paths.js';
import type { OrchestratorConfig } from '../domain/config.js';
import type { EventBus } from './event-bus.js';
import { ensureDir } from '../infrastructure/storage/fs-utils.js';

export class TaskService {
  constructor(
    private readonly taskStore: ITaskStore,
    private readonly eventBus: EventBus,
    private readonly config: OrchestratorConfig,
    private readonly paths?: Paths,
    private readonly agentStore?: IAgentStore,
  ) {}

  async create(input: CreateTaskInput): Promise<Task> {
    if (!input.title.trim()) {
      throw new InvalidArgumentsError('Task title is required');
    }

    const priority = input.priority ?? this.config.defaults.task.priority;
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
      throw new InvalidArgumentsError('Priority must be an integer between 1 and 4');
    }

    if (input.depends_on?.length) {
      const results = await Promise.all(
        input.depends_on.map(async (depId) => ({ depId, exists: !!(await this.taskStore.get(depId)) })),
      );
      const missing = results.filter((r) => !r.exists).map((r) => r.depId);
      if (missing.length > 0) {
        throw new InvalidArgumentsError(
          `Unknown depends_on task ID(s): ${missing.join(', ')}`,
        );
      }
    }

    const assignee = await this.resolveAssignee(input.assignee);

    const now = new Date().toISOString();
    const task: Task = {
      id: `tsk_${nanoid(7)}`,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      status: 'todo',
      priority,
      assignee,
      labels: input.labels ?? [],
      depends_on: input.depends_on ?? [],
      created_at: now,
      updated_at: now,
      attempts: 0,
      max_attempts: input.max_attempts ?? this.config.defaults.task.max_attempts,
      workspace_mode: input.workspace_mode,
      review_criteria: input.review_criteria,
      scope: input.scope,
      goalId: input.goalId,
    };

    if (input.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(task.id, input.attachments);
      task.attachments = attachmentNames;
    }

    await this.taskStore.save(task);
    this.eventBus.emit({ type: 'task:created', task });

    return task;
  }

  async list(filter?: { status?: TaskStatus; goalId?: string }): Promise<Task[]> {
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
    task.assignee = await this.resolveAssignee(agentId);
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

    return this.updateStatus(id, 'cancelled');
  }

  async clone(id: string): Promise<Task> {
    const src = await this.get(id);
    return this.create({
      title: src.title,
      description: src.description,
      priority: src.priority,
      assignee: src.assignee,
      labels: [...src.labels],
      depends_on: src.depends_on.length ? [...src.depends_on] : undefined,
      max_attempts: src.max_attempts,
      workspace_mode: src.workspace_mode,
      review_criteria: src.review_criteria ? [...src.review_criteria] : undefined,
      scope: src.scope ? [...src.scope] : undefined,
      goalId: src.goalId,
    });
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

  async reject(id: string, feedback?: string): Promise<Task> {
    const task = await this.get(id);

    if (task.status !== 'review') {
      throw new InvalidTransitionError(id, task.status, 'todo');
    }

    const oldStatus = task.status;
    task.status = 'todo';
    task.attempts = 0;
    task.feedback = feedback;
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

  async update(id: string, fields: { title?: string; description?: string; priority?: number; labels?: string[]; attachments?: string[] }): Promise<Task> {
    const task = await this.get(id);

    if (fields.title !== undefined) {
      if (!fields.title.trim()) throw new InvalidArgumentsError('Task title cannot be empty');
      task.title = fields.title.trim();
    }
    if (fields.description !== undefined) task.description = fields.description.trim();
    if (fields.priority !== undefined) {
      if (!Number.isInteger(fields.priority) || fields.priority < 1 || fields.priority > 4) {
        throw new InvalidArgumentsError('Priority must be an integer between 1 and 4');
      }
      task.priority = fields.priority;
    }
    if (fields.labels !== undefined) task.labels = fields.labels;
    if (fields.attachments?.length && this.paths) {
      const attachmentNames = await this.copyAttachments(id, fields.attachments);
      task.attachments = [...(task.attachments ?? []), ...attachmentNames];
    }

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

    if (this.paths) {
      const dir = this.paths.taskAttachmentsDir(id);
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  getAttachmentPath(taskId: string, filename: string): string {
    if (!this.paths) {
      throw new InvalidArgumentsError('Paths not configured');
    }
    return path.join(this.paths.taskAttachmentsDir(taskId), filename);
  }

  private async copyAttachments(taskId: string, sourcePaths: string[]): Promise<string[]> {
    if (!this.paths) return [];

    const dir = this.paths.taskAttachmentsDir(taskId);
    await ensureDir(dir);

    // Validate all files exist first
    await Promise.all(
      sourcePaths.map(async (srcPath) => {
        try {
          await fs.access(srcPath);
        } catch {
          throw new InvalidArgumentsError(`Attachment file not found: ${srcPath}`);
        }
      }),
    );

    // Copy all files in parallel
    const names = await Promise.all(
      sourcePaths.map(async (srcPath) => {
        const basename = path.basename(srcPath);
        await fs.copyFile(srcPath, path.join(dir, basename));
        return basename;
      }),
    );

    return names;
  }

  async incrementAttempts(id: string): Promise<Task> {
    const task = await this.get(id);
    task.attempts += 1;
    task.updated_at = new Date().toISOString();
    await this.taskStore.save(task);
    return task;
  }

  /**
   * Resolve an assignee value to an agent ID.
   * Accepts: agent ID (agt_xxx), agent name, or undefined.
   * Returns the agent ID if found, or undefined if input is undefined.
   * Throws InvalidArgumentsError if non-empty value matches no agent.
   */
  private async resolveAssignee(assignee: string | undefined): Promise<string | undefined> {
    if (!assignee) return undefined;
    if (!this.agentStore) return assignee;

    // If it looks like an agent ID, verify it exists
    if (assignee.startsWith('agt_')) {
      const agent = await this.agentStore.get(assignee);
      if (agent) return agent.id;
      throw new InvalidArgumentsError(
        `Unknown agent ID: "${assignee}". No agent with this ID exists.`,
      );
    }

    // Try name lookup
    const byName = await this.agentStore.getByName(assignee);
    if (byName) return byName.id;

    throw new InvalidArgumentsError(
      `Unknown agent: "${assignee}". Use an agent ID (agt_xxx) or an exact agent name.`,
    );
  }
}
