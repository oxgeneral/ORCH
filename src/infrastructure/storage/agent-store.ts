/**
 * File-based agent store.
 *
 * Agents are stored as individual YAML files in .orchestry/agents/.
 * An _index.json file caches the full list for fast list() calls.
 * All writes are atomic (temp → rename).
 */

import type { Agent } from '../../domain/agent.js';
import type { IAgentStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { ensureDir, writeYaml, readYaml } from './fs-utils.js';
import { IndexManager } from './index-manager.js';
import fs from 'node:fs/promises';

export class AgentStore implements IAgentStore {
  private readonly index: IndexManager<Agent>;

  constructor(private readonly paths: Paths) {
    this.index = new IndexManager<Agent>({
      dir: paths.agentsDir,
      ext: '.yml',
      itemPath: (id) => paths.agentPath(id),
    });
  }

  async list(): Promise<Agent[]> {
    return this.index.readIndex();
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
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((a) => a.id !== agent.id);
      filtered.push(agent);
      return filtered;
    });
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.agentPath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((a) => a.id !== id));
  }
}
