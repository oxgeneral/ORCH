/**
 * File-based goal store.
 *
 * Goals are stored as individual YAML files in .orchestry/goals/.
 * All writes are atomic (temp → rename).
 */

import type { Goal, GoalStatus } from '../../domain/goal.js';
import type { IGoalStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readYaml, writeYaml, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

export class GoalStore implements IGoalStore {
  constructor(private readonly paths: Paths) {}

  async list(filter?: { status?: GoalStatus }): Promise<Goal[]> {
    await ensureDir(this.paths.goalsDir);
    const files = await listFiles(this.paths.goalsDir, '.yml');

    const results = await Promise.all(
      files.map(file => {
        const id = file.replace('.yml', '');
        return readYaml<Goal>(this.paths.goalPath(id));
      })
    );

    const goals = results.filter(
      (goal): goal is Goal => goal !== null && (!filter?.status || goal.status === filter.status)
    );

    return goals.sort((a, b) => {
      const statusOrder = statusPriority(a.status) - statusPriority(b.status);
      if (statusOrder !== 0) return statusOrder;
      const bTime = b.updated_at ?? '';
      const aTime = a.updated_at ?? '';
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    });
  }

  async get(id: string): Promise<Goal | null> {
    return readYaml<Goal>(this.paths.goalPath(id));
  }

  async save(goal: Goal): Promise<void> {
    await ensureDir(this.paths.goalsDir);
    await writeYaml(this.paths.goalPath(goal.id), goal);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.goalPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

function statusPriority(status: GoalStatus): number {
  const order: Record<GoalStatus, number> = {
    active: 0,
    paused: 1,
    achieved: 2,
    abandoned: 3,
  };
  return order[status];
}
