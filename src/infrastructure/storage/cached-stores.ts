/**
 * Tick-scoped caching wrappers for TaskStore and AgentStore.
 *
 * Caches list() results within a single tick cycle.
 * Cache is invalidated on save()/delete() or manually via invalidate().
 */

import type { Task, TaskStatus } from '../../domain/task.js';
import type { Agent } from '../../domain/agent.js';
import type { ITaskStore, IAgentStore } from './interfaces.js';

export class CachedTaskStore implements ITaskStore {
  private cache: Map<string, Task[]> = new Map();

  constructor(private readonly inner: ITaskStore) {}

  async list(filter?: { status?: TaskStatus }): Promise<Task[]> {
    const key = filter?.status ?? '__all__';

    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const result = await this.inner.list(filter);
    this.cache.set(key, result);
    return result;
  }

  async get(id: string): Promise<Task | null> {
    return this.inner.get(id);
  }

  async save(task: Task): Promise<void> {
    await this.inner.save(task);
    this.cache.clear();
  }

  async delete(id: string): Promise<void> {
    await this.inner.delete(id);
    this.cache.clear();
  }

  invalidate(): void {
    this.cache.clear();
  }
}

export class CachedAgentStore implements IAgentStore {
  private listCache: Agent[] | null = null;

  constructor(private readonly inner: IAgentStore) {}

  async list(): Promise<Agent[]> {
    if (this.listCache) {
      return this.listCache;
    }

    const result = await this.inner.list();
    this.listCache = result;
    return result;
  }

  async get(id: string): Promise<Agent | null> {
    return this.inner.get(id);
  }

  async getByName(name: string): Promise<Agent | null> {
    return this.inner.getByName(name);
  }

  async save(agent: Agent): Promise<void> {
    await this.inner.save(agent);
    this.listCache = null;
  }

  async delete(id: string): Promise<void> {
    await this.inner.delete(id);
    this.listCache = null;
  }

  invalidate(): void {
    this.listCache = null;
  }
}
