import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TeamStore } from '../../../src/infrastructure/storage/team-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { Team } from '../../../src/domain/team.js';

let tmpDir: string;
let paths: Paths;
let store: TeamStore;

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team_test1',
    name: 'Alpha Squad',
    status: 'active',
    members: [
      { agent_id: 'agt_lead', role: 'lead', joined_at: '2025-01-01T00:00:00Z' },
      { agent_id: 'agt_member', role: 'member', joined_at: '2025-01-01T00:00:00Z' },
    ],
    task_pool: [],
    lead_agent_id: 'agt_lead',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    config: { auto_claim: true },
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-teamstore-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new TeamStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('TeamStore', () => {
  it('save and get a team', async () => {
    const team = makeTeam();
    await store.save(team);
    const retrieved = await store.get('team_test1');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('team_test1');
    expect(retrieved!.name).toBe('Alpha Squad');
    expect(retrieved!.status).toBe('active');
    expect(retrieved!.lead_agent_id).toBe('agt_lead');
    expect(retrieved!.members).toHaveLength(2);
  });

  it('getByName finds team by name', async () => {
    const team = makeTeam({ id: 'team_find', name: 'FindMe' });
    await store.save(team);

    const found = await store.getByName('FindMe');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('team_find');
  });

  it('getByName returns null for unknown name', async () => {
    const result = await store.getByName('NonExistent');
    expect(result).toBeNull();
  });

  it('list returns all teams', async () => {
    const team1 = makeTeam({ id: 'team_a', name: 'TeamA' });
    const team2 = makeTeam({ id: 'team_b', name: 'TeamB' });
    const team3 = makeTeam({ id: 'team_c', name: 'TeamC' });

    await store.save(team1);
    await store.save(team2);
    await store.save(team3);

    const list = await store.list();
    expect(list).toHaveLength(3);
    const ids = list.map((t) => t.id).sort();
    expect(ids).toEqual(['team_a', 'team_b', 'team_c']);
  });

  it('delete removes the file', async () => {
    const team = makeTeam({ id: 'team_del' });
    await store.save(team);

    await store.delete('team_del');

    const result = await store.get('team_del');
    expect(result).toBeNull();
  });

  it('get returns null for non-existent team', async () => {
    const result = await store.get('team_nonexistent');
    expect(result).toBeNull();
  });

  it('delete is idempotent for non-existent team', async () => {
    await expect(store.delete('team_nonexistent')).resolves.not.toThrow();
  });
});
