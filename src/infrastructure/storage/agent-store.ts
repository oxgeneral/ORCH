/**
 * File-based agent store.
 *
 * Agents are stored as individual YAML files in .orchestry/agents/.
 * All writes are atomic (temp → rename).
 */

import type { Agent } from '../../domain/agent.js';
import type { IAgentStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readYaml, writeYaml, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

export class AgentStore implements IAgentStore {
  constructor(private readonly paths: Paths) {}

  async list(): Promise<Agent[]> {
    await ensureDir(this.paths.agentsDir);
    const files = await listFiles(this.paths.agentsDir, '.yml');

    const results = await Promise.all(
      files.map(file => {
        const id = file.replace('.yml', '');
        return readYaml<Agent>(this.paths.agentPath(id));
      })
    );

    return results.filter((agent): agent is Agent => agent !== null);
  }

  async get(id: string): Promise<Agent | null> {
    return readYaml<Agent>(this.paths.agentPath(id));
  }

  async getByName(name: string): Promise<Agent | null> {
    const agents = await this.list();
    return agents.find((a) => a.name === name) ?? null;
  }

  async save(agent: Agent): Promise<void> {
    await ensureDir(this.paths.agentsDir);
    await writeYaml(this.paths.agentPath(agent.id), agent);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.agentPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
