import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AgentStore } from '../../../src/infrastructure/storage/agent-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { Agent } from '../../../src/domain/agent.js';

let tmpDir: string;
let paths: Paths;
let store: AgentStore;

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: `Agent ${id}`,
    adapter: 'claude',
    status: 'idle',
    config: { env: {} },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0, tokens_used: 0 },
    ...overrides,
  } as Agent;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-agentstore-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new AgentStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('AgentStore', () => {
  it('returns empty list when no agents', async () => {
    const agents = await store.list();
    expect(agents).toHaveLength(0);
  });

  it('saves and retrieves an agent', async () => {
    const agent = makeAgent('agt_1');
    await store.save(agent);

    const result = await store.get('agt_1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('agt_1');
    expect(result!.name).toBe('Agent agt_1');
  });

  it('lists all saved agents', async () => {
    await store.save(makeAgent('agt_a'));
    await store.save(makeAgent('agt_b'));

    const agents = await store.list();
    expect(agents).toHaveLength(2);
  });

  it('getByName finds agent by name', async () => {
    await store.save(makeAgent('agt_1', { name: 'Builder' }));
    await store.save(makeAgent('agt_2', { name: 'Tester' }));

    const agent = await store.getByName('Builder');
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe('agt_1');
  });

  it('getByName returns null for unknown name', async () => {
    await store.save(makeAgent('agt_1'));
    const agent = await store.getByName('Unknown');
    expect(agent).toBeNull();
  });

  it('deletes an agent', async () => {
    await store.save(makeAgent('agt_1'));
    await store.delete('agt_1');

    const result = await store.get('agt_1');
    expect(result).toBeNull();

    const agents = await store.list();
    expect(agents).toHaveLength(0);
  });

  it('delete is idempotent for non-existent agent', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  describe('_index.json cache', () => {
    it('creates _index.json on first save()', async () => {
      await store.save(makeAgent('agt_1'));
      const indexPath = path.join(paths.agentsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Agent[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('agt_1');
    });

    it('list() reads from _index.json instead of individual files', async () => {
      await store.save(makeAgent('agt_a'));
      await store.save(makeAgent('agt_b'));

      const agents = await store.list();
      expect(agents).toHaveLength(2);
      const ids = agents.map(a => a.id).sort();
      expect(ids).toEqual(['agt_a', 'agt_b']);
    });

    it('delete() removes entry from _index.json', async () => {
      await store.save(makeAgent('agt_a'));
      await store.save(makeAgent('agt_b'));
      await store.delete('agt_a');

      const indexPath = path.join(paths.agentsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Agent[];
      expect(index).toHaveLength(1);
      expect(index[0].id).toBe('agt_b');
    });

    it('rebuilds index when _index.json is missing', async () => {
      await store.save(makeAgent('agt_x'));
      await store.save(makeAgent('agt_y'));

      // Delete the index file
      const indexPath = path.join(paths.agentsDir, '_index.json');
      await fs.unlink(indexPath);

      // list() should rebuild from individual YAML files
      const agents = await store.list();
      expect(agents).toHaveLength(2);
      const ids = agents.map(a => a.id).sort();
      expect(ids).toEqual(['agt_x', 'agt_y']);

      // Index should be recreated
      await expect(fs.access(indexPath)).resolves.not.toThrow();
    });

    it('rebuilds index when _index.json is corrupted', async () => {
      await store.save(makeAgent('agt_ok'));

      // Corrupt the index
      const indexPath = path.join(paths.agentsDir, '_index.json');
      await fs.writeFile(indexPath, '{{not valid json');

      // list() should rebuild
      const agents = await store.list();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agt_ok');
    });

    it('save() updates existing entry in index', async () => {
      await store.save(makeAgent('agt_1', { name: 'Original' }));
      await store.save(makeAgent('agt_1', { name: 'Updated' }));

      const indexPath = path.join(paths.agentsDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Agent[];
      expect(index).toHaveLength(1);
      expect(index[0].name).toBe('Updated');
    });
  });
});
