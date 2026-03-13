import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CachedTaskStore, CachedAgentStore } from '../../../src/infrastructure/storage/cached-stores.js';
import type { ITaskStore, IAgentStore } from '../../../src/infrastructure/storage/interfaces.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';

function makeTask(id: string, status: Task['status'] = 'todo'): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status,
    priority: 1,
    attempts: 0,
    max_attempts: 3,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dependencies: [],
    tags: [],
  } as Task;
}

function makeAgent(id: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    adapter: 'claude-code',
    status: 'idle',
    config: { env: {} },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, tokens_used: 0 },
  } as Agent;
}

describe('CachedTaskStore', () => {
  let inner: ITaskStore;
  let cached: CachedTaskStore;
  const tasks = [makeTask('t1'), makeTask('t2', 'in_progress')];

  beforeEach(() => {
    inner = {
      list: vi.fn().mockResolvedValue(tasks),
      get: vi.fn().mockResolvedValue(tasks[0]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    cached = new CachedTaskStore(inner);
  });

  it('caches list() results on second call', async () => {
    await cached.list();
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(1);
  });

  it('returns same data from cache', async () => {
    const first = await cached.list();
    const second = await cached.list();
    expect(first).toBe(second);
  });

  it('caches filtered and unfiltered separately', async () => {
    await cached.list();
    await cached.list({ status: 'todo' });
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on save()', async () => {
    await cached.list();
    await cached.save(makeTask('t3'));
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on delete()', async () => {
    await cached.list();
    await cached.delete('t1');
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on invalidate()', async () => {
    await cached.list();
    cached.invalidate();
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('delegates get() without caching', async () => {
    await cached.get('t1');
    await cached.get('t1');
    expect(inner.get).toHaveBeenCalledTimes(2);
  });
});

describe('CachedAgentStore', () => {
  let inner: IAgentStore;
  let cached: CachedAgentStore;
  const agents = [makeAgent('a1'), makeAgent('a2')];

  beforeEach(() => {
    inner = {
      list: vi.fn().mockResolvedValue(agents),
      get: vi.fn().mockResolvedValue(agents[0]),
      getByName: vi.fn().mockResolvedValue(agents[0]),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    cached = new CachedAgentStore(inner);
  });

  it('caches list() results on second call', async () => {
    await cached.list();
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(1);
  });

  it('returns same data from cache', async () => {
    const first = await cached.list();
    const second = await cached.list();
    expect(first).toBe(second);
  });

  it('invalidates cache on save()', async () => {
    await cached.list();
    await cached.save(makeAgent('a3'));
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on delete()', async () => {
    await cached.list();
    await cached.delete('a1');
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('invalidates cache on invalidate()', async () => {
    await cached.list();
    cached.invalidate();
    await cached.list();
    expect(inner.list).toHaveBeenCalledTimes(2);
  });

  it('delegates get() without caching', async () => {
    await cached.get('a1');
    await cached.get('a1');
    expect(inner.get).toHaveBeenCalledTimes(2);
  });

  it('caches getByName() results within tick', async () => {
    await cached.getByName('Agent a1');
    await cached.getByName('Agent a1');
    expect(inner.getByName).toHaveBeenCalledTimes(1);
  });

  it('invalidates nameCache on save', async () => {
    await cached.getByName('Agent a1');
    await cached.save({ id: 'a1', name: 'Agent a1' } as Agent);
    await cached.getByName('Agent a1');
    expect(inner.getByName).toHaveBeenCalledTimes(2);
  });

  it('invalidates nameCache on delete', async () => {
    await cached.getByName('Agent a1');
    await cached.delete('a1');
    await cached.getByName('Agent a1');
    expect(inner.getByName).toHaveBeenCalledTimes(2);
  });

  it('invalidates nameCache on invalidate()', async () => {
    await cached.getByName('Agent a1');
    cached.invalidate();
    await cached.getByName('Agent a1');
    expect(inner.getByName).toHaveBeenCalledTimes(2);
  });
});
