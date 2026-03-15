/**
 * File-based goal store.
 *
 * Goals are stored as individual YAML files in .orchestry/goals/.
 * An _index.json file caches the full list for fast list() calls.
 * All writes are atomic (temp → rename).
 */

import { GOAL_STATUS_ORDER, type Goal, type GoalStatus } from '../../domain/goal.js';
import type { IGoalStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { ensureDir, writeYaml, readYaml } from './fs-utils.js';
import { IndexManager } from './index-manager.js';
import fs from 'node:fs/promises';

export class GoalStore implements IGoalStore {
  private readonly index: IndexManager<Goal>;

  constructor(private readonly paths: Paths) {
    this.index = new IndexManager<Goal>({
      dir: paths.goalsDir,
      ext: '.yml',
      itemPath: (id) => paths.goalPath(id),
    });
  }

  async list(filter?: { status?: GoalStatus }): Promise<Goal[]> {
    const all = await this.index.readIndex();

    const goals = all.filter(
      (goal): goal is Goal => goal !== null && (!filter?.status || goal.status === filter.status),
    );

    return goals.sort((a, b) => {
      const statusOrder = GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status];
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
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((g) => g.id !== goal.id);
      filtered.push(goal);
      return filtered;
    });
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.goalPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((g) => g.id !== id));
  }
}
