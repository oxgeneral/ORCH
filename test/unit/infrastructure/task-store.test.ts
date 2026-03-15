import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../../src/infrastructure/storage/task-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { Task } from '../../../src/domain/task.js';

let tmpDir: string;
let paths: Paths;
let store: TaskStore;

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'todo',
    priority: 1,
    labels: [],
    depends_on: [],
    attempts: 0,
    max_attempts: 3,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-taskstore-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new TaskStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('TaskStore', () => {
  it('returns empty list when no tasks', async () => {
    const tasks = await store.list();
    expect(tasks).toHaveLength(0);
  });

  it('saves and retrieves a task', async () => {
    const task = makeTask('tsk_1');
    await store.save(task);

    const result = await store.get('tsk_1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tsk_1');
    expect(result!.title).toBe('Task tsk_1');
  });

  it('lists all saved tasks', async () => {
    await store.save(makeTask('tsk_a'));
    await store.save(makeTask('tsk_b'));

    const tasks = await store.list();
    expect(tasks).toHaveLength(2);
  });

  it('filters by status', async () => {
    await store.save(makeTask('tsk_1', { status: 'todo' }));
    await store.save(makeTask('tsk_2', { status: 'done' }));

    const todos = await store.list({ status: 'todo' });
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe('tsk_1');
  });

  it('filters by goalId', async () => {
    await store.save(makeTask('tsk_1', { goalId: 'goal_1' }));
    await store.save(makeTask('tsk_2', { goalId: 'goal_2' }));

    const filtered = await store.list({ goalId: 'goal_1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('tsk_1');
  });

  it('deletes a task', async () => {
    await store.save(makeTask('tsk_1'));
    await store.delete('tsk_1');

    const result = await store.get('tsk_1');
    expect(result).toBeNull();

    const tasks = await store.list();
    expect(tasks).toHaveLength(0);
  });

  it('delete is idempotent for non-existent task', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('sorts by status priority then updated_at', async () => {
    await store.save(makeTask('tsk_done', { status: 'done', updated_at: '2026-01-02T00:00:00Z' }));
    await store.save(makeTask('tsk_ip', { status: 'in_progress', updated_at: '2026-01-01T00:00:00Z' }));
    await store.save(makeTask('tsk_todo', { status: 'todo', updated_at: '2026-01-03T00:00:00Z' }));

    const tasks = await store.list();
    expect(tasks.map(t => t.id)).toEqual(['tsk_ip', 'tsk_todo', 'tsk_done']);
  });

  describe('_index.json cache', () => {
    it('creates _index.json on first save()', async () => {
      await store.save(makeTask('tsk_1'));
      const indexPath = path.join(paths.tasksDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Task[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('tsk_1');
    });

    it('list() reads from _index.json instead of individual files', async () => {
      await store.save(makeTask('tsk_a'));
      await store.save(makeTask('tsk_b'));

      const tasks = await store.list();
      expect(tasks).toHaveLength(2);
      const ids = tasks.map(t => t.id).sort();
      expect(ids).toEqual(['tsk_a', 'tsk_b']);
    });

    it('delete() removes entry from _index.json', async () => {
      await store.save(makeTask('tsk_a'));
      await store.save(makeTask('tsk_b'));
      await store.delete('tsk_a');

      const indexPath = path.join(paths.tasksDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Task[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('tsk_b');
    });

    it('rebuilds index when _index.json is missing', async () => {
      await store.save(makeTask('tsk_x'));
      await store.save(makeTask('tsk_y'));

      // Delete the index file
      const indexPath = path.join(paths.tasksDir, '_index.json');
      await fs.unlink(indexPath);

      // list() should rebuild from individual YAML files
      const tasks = await store.list();
      expect(tasks).toHaveLength(2);
      const ids = tasks.map(t => t.id).sort();
      expect(ids).toEqual(['tsk_x', 'tsk_y']);

      // Index should be recreated
      await expect(fs.access(indexPath)).resolves.not.toThrow();
    });

    it('rebuilds index when _index.json is corrupted', async () => {
      await store.save(makeTask('tsk_ok'));

      // Corrupt the index
      const indexPath = path.join(paths.tasksDir, '_index.json');
      await fs.writeFile(indexPath, '{{not valid json');

      // list() should rebuild
      const tasks = await store.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('tsk_ok');
    });

    it('save() updates existing entry in index', async () => {
      await store.save(makeTask('tsk_1', { title: 'Original' }));
      await store.save(makeTask('tsk_1', { title: 'Updated' }));

      const indexPath = path.join(paths.tasksDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Task[];
      expect(index).toHaveLength(1);
      expect(index[0].title).toBe('Updated');
    });
  });
});
