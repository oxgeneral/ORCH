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
import { ensureDir, writeYaml, readYaml } from './fs-utils.js';
import { IndexManager } from './index-manager.js';
import fs from 'node:fs/promises';

export class TaskStore implements ITaskStore {
  private readonly index: IndexManager<Task>;

  constructor(private readonly paths: Paths) {
    this.index = new IndexManager<Task>({
      dir: paths.tasksDir,
      ext: '.yml',
      itemPath: (id) => paths.taskPath(id),
    });
  }

  async list(filter?: { status?: TaskStatus; goalId?: string }): Promise<Task[]> {
    const all = await this.index.readIndex();

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
    await this.index.updateIndex((idx) => {
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
    await this.index.updateIndex((idx) => idx.filter((t) => t.id !== id));
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
