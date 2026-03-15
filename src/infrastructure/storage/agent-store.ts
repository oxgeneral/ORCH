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
import { listFiles, readYaml, writeYaml, readJson, writeJson, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export class AgentStore implements IAgentStore {
  constructor(private readonly paths: Paths) {}

  async list(): Promise<Agent[]> {
    return this.readIndex();
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
    await this.updateIndex((idx) => {
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
    await this.updateIndex((idx) => idx.filter((a) => a.id !== id));
  }

  // --- Index management ---

  private get indexPath(): string {
    return path.join(this.paths.agentsDir, '_index.json');
  }

  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  private async readIndex(): Promise<Agent[]> {
    try {
      const entries = await readJson<Agent[]>(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
      // Corrupted JSON — fall through to rebuild
    }
    return this.rebuildIndex();
  }

  /**
   * Rebuild the index by reading all individual agent YAML files.
   * Used as fallback when _index.json is missing or corrupted.
   */
  private async rebuildIndex(): Promise<Agent[]> {
    await ensureDir(this.paths.agentsDir);
    const files = await listFiles(this.paths.agentsDir, '.yml');

    const results = await Promise.all(
      files.map((file) => {
        const id = file.replace('.yml', '');
        return readYaml<Agent>(this.paths.agentPath(id));
      }),
    );

    const agents = results.filter((a): a is Agent => a !== null);
    await this.writeIndex(agents);
    return agents;
  }

  /** Write the index file atomically. */
  private async writeIndex(agents: Agent[]): Promise<void> {
    await ensureDir(this.paths.agentsDir);
    await writeJson(this.indexPath, agents);
  }

  /** Apply a mutation to the index and write it back. */
  private async updateIndex(fn: (agents: Agent[]) => Agent[]): Promise<void> {
    const current = await this.readIndex();
    const updated = fn(current);
    await this.writeIndex(updated);
  }
}
