/**
 * File-based task store.
 *
 * Tasks are stored as individual YAML files in .orchestry/tasks/.
 * An _index.json file caches the full list for fast list() calls.
 * All writes are atomic (temp → rename).
 */

import type { Task, TaskStatus } from '../../domain/task.js';
import type { ITaskStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readYaml, writeYaml, readJson, writeJson, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export class TaskStore implements ITaskStore {
  constructor(private readonly paths: Paths) {}

  async list(filter?: { status?: TaskStatus; goalId?: string }): Promise<Task[]> {
    const all = await this.readIndex();

    const tasks = all.filter(
      (task): task is Task =>
        task !== null &&
        (!filter?.status || task.status === filter.status) &&
        (!filter?.goalId || task.goalId === filter.goalId),
    );

    return tasks.sort((a, b) => {
      const statusOrder = statusPriority(a.status) - statusPriority(b.status);
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? '';
      const aTime = a.updated_at ?? '';
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }

  async get(id: string): Promise<Task | null> {
    return readYaml<Task>(this.paths.taskPath(id));
  }

  async save(task: Task): Promise<void> {
    await ensureDir(this.paths.tasksDir);
    await writeYaml(this.paths.taskPath(task.id), task);
    await this.updateIndex((idx) => {
      const filtered = idx.filter((t) => t.id !== task.id);
      filtered.push(task);
      return filtered;
    });
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.taskPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.updateIndex((idx) => idx.filter((t) => t.id !== id));
  }

  // --- Index management ---

  private get indexPath(): string {
    return path.join(this.paths.tasksDir, '_index.json');
  }

  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  private async readIndex(): Promise<Task[]> {
    try {
      const entries = await readJson<Task[]>(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
      // Corrupted JSON — fall through to rebuild
    }
    return this.rebuildIndex();
  }

  /**
   * Rebuild the index by reading all individual task YAML files.
   * Used as fallback when _index.json is missing or corrupted.
   */
  private async rebuildIndex(): Promise<Task[]> {
    await ensureDir(this.paths.tasksDir);
    const files = await listFiles(this.paths.tasksDir, '.yml');

    const results = await Promise.all(
      files.map((file) => {
        const id = file.replace('.yml', '');
        return readYaml<Task>(this.paths.taskPath(id));
      }),
    );

    const tasks = results.filter((t): t is Task => t !== null);
    await this.writeIndex(tasks);
    return tasks;
  }

  /** Write the index file atomically. */
  private async writeIndex(tasks: Task[]): Promise<void> {
    await ensureDir(this.paths.tasksDir);
    await writeJson(this.indexPath, tasks);
  }

  /** Apply a mutation to the index and write it back. */
  private async updateIndex(fn: (tasks: Task[]) => Task[]): Promise<void> {
    const current = await this.readIndex();
    const updated = fn(current);
    await this.writeIndex(updated);
  }
}

function statusPriority(status: TaskStatus): number {
  const order: Record<TaskStatus, number> = {
    in_progress: 0,
    retrying: 1,
    review: 2,
    todo: 3,
    done: 4,
    failed: 5,
    cancelled: 6,
  };
  return order[status];
}
