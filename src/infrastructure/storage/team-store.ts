/**
 * File-based team store.
 *
 * Teams stored as YAML files in .orchestry/teams/.
 */

import type { Team } from '../../domain/team.js';
import type { ITeamStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readYaml, writeYaml, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

export class TeamStore implements ITeamStore {
  constructor(private readonly paths: Paths) {}

  async save(team: Team): Promise<void> {
    await ensureDir(this.paths.teamsDir);
    await writeYaml(this.paths.teamPath(team.id), team);
  }

  async get(id: string): Promise<Team | null> {
    return readYaml<Team>(this.paths.teamPath(id));
  }

  async getByName(name: string): Promise<Team | null> {
    const teams = await this.list();
    return teams.find((t) => t.name === name) ?? null;
  }

  async list(): Promise<Team[]> {
    await ensureDir(this.paths.teamsDir);
    const files = await listFiles(this.paths.teamsDir, '.yml');
    const results = await Promise.all(
      files.map((f) => readYaml<Team>(this.paths.teamPath(f.replace('.yml', '')))),
    );
    return results.filter((t): t is Team => t !== null);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.teamPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
