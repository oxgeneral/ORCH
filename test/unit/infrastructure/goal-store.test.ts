import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GoalStore } from '../../../src/infrastructure/storage/goal-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { Goal } from '../../../src/domain/goal.js';

let tmpDir: string;
let paths: Paths;
let store: GoalStore;

function makeGoal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    title: `Goal ${id}`,
    description: '',
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-goalstore-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new GoalStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GoalStore', () => {
  it('returns empty list when no goals', async () => {
    const goals = await store.list();
    expect(goals).toHaveLength(0);
  });

  it('saves and retrieves a goal', async () => {
    const goal = makeGoal('goal_1');
    await store.save(goal);

    const result = await store.get('goal_1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('goal_1');
    expect(result!.title).toBe('Goal goal_1');
  });

  it('lists all saved goals', async () => {
    await store.save(makeGoal('goal_a'));
    await store.save(makeGoal('goal_b'));

    const goals = await store.list();
    expect(goals).toHaveLength(2);
  });

  it('filters by status', async () => {
    await store.save(makeGoal('goal_1', { status: 'active' }));
    await store.save(makeGoal('goal_2', { status: 'achieved' }));

    const active = await store.list({ status: 'active' });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('goal_1');
  });

  it('deletes a goal', async () => {
    await store.save(makeGoal('goal_1'));
    await store.delete('goal_1');

    const result = await store.get('goal_1');
    expect(result).toBeNull();

    const goals = await store.list();
    expect(goals).toHaveLength(0);
  });

  it('delete is idempotent for non-existent goal', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('sorts by status priority then updated_at', async () => {
    await store.save(makeGoal('goal_achieved', { status: 'achieved', updated_at: '2026-01-02T00:00:00Z' }));
    await store.save(makeGoal('goal_active', { status: 'active', updated_at: '2026-01-01T00:00:00Z' }));
    await store.save(makeGoal('goal_paused', { status: 'paused', updated_at: '2026-01-03T00:00:00Z' }));

    const goals = await store.list();
    expect(goals.map((g) => g.id)).toEqual(['goal_active', 'goal_paused', 'goal_achieved']);
  });

  describe('_index.json cache', () => {
    it('creates _index.json on first save()', async () => {
      await store.save(makeGoal('goal_1'));
      const indexPath = path.join(paths.goalsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Goal[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('goal_1');
    });

    it('list() reads from _index.json instead of individual files', async () => {
      await store.save(makeGoal('goal_a'));
      await store.save(makeGoal('goal_b'));

      const goals = await store.list();
      expect(goals).toHaveLength(2);
      const ids = goals.map((g) => g.id).sort();
      expect(ids).toEqual(['goal_a', 'goal_b']);
    });

    it('delete() removes entry from _index.json', async () => {
      await store.save(makeGoal('goal_a'));
      await store.save(makeGoal('goal_b'));
      await store.delete('goal_a');

      const indexPath = path.join(paths.goalsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Goal[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('goal_b');
    });

    it('rebuilds index when _index.json is missing', async () => {
      await store.save(makeGoal('goal_x'));
      await store.save(makeGoal('goal_y'));

      // Delete the index file
      const indexPath = path.join(paths.goalsDir, '_index.json');
      await fs.unlink(indexPath);

      // list() should rebuild from individual YAML files
      const goals = await store.list();
      expect(goals).toHaveLength(2);
      const ids = goals.map((g) => g.id).sort();
      expect(ids).toEqual(['goal_x', 'goal_y']);

      // Index should be recreated
      await expect(fs.access(indexPath)).resolves.not.toThrow();
    });

    it('rebuilds index when _index.json is corrupted', async () => {
      await store.save(makeGoal('goal_ok'));

      // Corrupt the index
      const indexPath = path.join(paths.goalsDir, '_index.json');
      await fs.writeFile(indexPath, '{{not valid json');

      // list() should rebuild
      const goals = await store.list();
      expect(goals).toHaveLength(1);
      expect(goals[0].id).toBe('goal_ok');
    });

    it('save() updates existing entry in index', async () => {
      await store.save(makeGoal('goal_1', { title: 'Original' }));
      await store.save(makeGoal('goal_1', { title: 'Updated' }));

      const indexPath = path.join(paths.goalsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Goal[];
      expect(index).toHaveLength(1);
      expect(index[0].title).toBe('Updated');
    });
  });
});
