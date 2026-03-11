/**
 * File-based task store.
 *
 * Tasks are stored as individual YAML files in .orchestry/tasks/.
 * All writes are atomic (temp → rename).
 */

import type { Task, TaskStatus } from '../../domain/task.js';
import type { ITaskStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readYaml, writeYaml, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

export class TaskStore implements ITaskStore {
  constructor(private readonly paths: Paths) {}

  async list(filter?: { status?: TaskStatus }): Promise<Task[]> {
    await ensureDir(this.paths.tasksDir);
    const files = await listFiles(this.paths.tasksDir, '.yml');

    const tasksResults = await Promise.all(
      files.map(file => {
        const id = file.replace('.yml', '');
        return readYaml<Task>(this.paths.taskPath(id));
      })
    );

    const tasks = tasksResults.filter(
      (task): task is Task => task !== null && (!filter?.status || task.status === filter.status)
    );

    return tasks.sort((a, b) => {
      const statusOrder = statusPriority(a.status) - statusPriority(b.status);
      if (statusOrder !== 0) return statusOrder;
      const priOrder = a.priority - b.priority;
      if (priOrder !== 0) return priOrder;
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
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.taskPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
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
