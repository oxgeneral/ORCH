/**
 * Unit tests for getEditAgentWizardSteps team selection and editAgentWizardToFields.
 *
 * Covers:
 * 1. Team step shows active teams + None sentinel
 * 2. Current team is pre-selected via defaultValue
 * 3. Step is skipped when no active teams exist
 * 4. editAgentWizardToFields returns correct team_id
 * 5. Leave old + join new logic via team_id diff
 * 6. None selection returns empty team_id
 * 7. Agent without team can join a team
 * 8. Inactive teams are excluded from options
 */

import { describe, it, expect } from 'vitest';
import {
  getEditAgentWizardSteps,
  editAgentWizardToFields,
} from '../../../src/tui/wizardConfigs.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Team, TeamMember } from '../../../src/domain/team.js';

// ── Helpers ──

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    name: 'TestAgent',
    adapter: 'claude',
    status: 'idle',
    config: { approval_policy: 'auto', max_turns: 50, timeout_ms: 3_600_000, stall_timeout_ms: 300_000 },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team_1',
    name: 'Alpha Team',
    status: 'active',
    members: [{ agent_id: 'agt_1', role: 'member', joined_at: '2025-01-01T00:00:00Z' } as TeamMember],
    task_pool: [],
    lead_agent_id: 'agt_1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    config: { auto_claim: true },
    ...overrides,
  };
}

// ── getEditAgentWizardSteps ──

describe('getEditAgentWizardSteps — team step', () => {
  it('includes None + active teams in team options', () => {
    const agent = makeAgent();
    const teams = [makeTeam({ id: 'team_1', name: 'Alpha' })];
    const steps = getEditAgentWizardSteps(agent, undefined, teams);
    const teamStep = steps.find((s) => s.id === 'team');
    expect(teamStep).toBeDefined();
    const opts = teamStep!.options!;
    expect(opts[0]).toMatchObject({ value: '', label: 'None' });
    expect(opts[1]).toMatchObject({ value: 'team_1', label: 'Alpha' });
    expect(opts).toHaveLength(2);
  });

  it('pre-selects current team via defaultValue (derived from agent membership)', () => {
    const agent = makeAgent({ id: 'agt_1' });
    const teams = [
      makeTeam({ id: 'team_1', members: [{ agent_id: 'agt_1', role: 'member', joined_at: '2025-01-01T00:00:00Z' } as TeamMember] }),
      makeTeam({ id: 'team_2', name: 'Beta', members: [{ agent_id: 'agt_2', role: 'member', joined_at: '2025-01-01T00:00:00Z' } as TeamMember] }),
    ];
    const steps = getEditAgentWizardSteps(agent, undefined, teams);
    const teamStep = steps.find((s) => s.id === 'team');
    expect(teamStep!.defaultValue).toBe('team_1');
  });

  it('defaults to empty string when agent has no team', () => {
    const agent = makeAgent({ id: 'agt_no_team' });
    const teams = [makeTeam()];
    const steps = getEditAgentWizardSteps(agent, undefined, teams);
    const teamStep = steps.find((s) => s.id === 'team');
    expect(teamStep!.defaultValue).toBe('');
  });

  it('skips team step when no active teams exist', () => {
    const agent = makeAgent();
    const steps = getEditAgentWizardSteps(agent, undefined, []);
    const teamStep = steps.find((s) => s.id === 'team');
    // skip() should return true when teamOptions.length <= 1 (only None)
    expect(teamStep!.skip!({} as Record<string, string>)).toBe(true);
  });

  it('shows team step when at least one active team exists', () => {
    const agent = makeAgent();
    const teams = [makeTeam()];
    const steps = getEditAgentWizardSteps(agent, undefined, teams);
    const teamStep = steps.find((s) => s.id === 'team');
    expect(teamStep!.skip!({} as Record<string, string>)).toBe(false);
  });

  it('excludes inactive (disbanded, paused) teams from options', () => {
    const agent = makeAgent();
    const teams = [
      makeTeam({ id: 'team_active', name: 'Active', status: 'active' }),
      makeTeam({ id: 'team_dis', name: 'Disbanded', status: 'disbanded' }),
      makeTeam({ id: 'team_paused', name: 'Paused', status: 'paused' }),
    ];
    const steps = getEditAgentWizardSteps(agent, undefined, teams);
    const teamStep = steps.find((s) => s.id === 'team');
    const opts = teamStep!.options!;
    const ids = opts.map((o) => o.value);
    expect(ids).toContain('team_active');
    expect(ids).not.toContain('team_dis');
    expect(ids).not.toContain('team_paused');
  });

  it('shows member count in team option hint', () => {
    const agent = makeAgent();
    const team = makeTeam({
      members: [
        { agent_id: 'agt_1', role: 'member', joined_at: '2025-01-01T00:00:00Z' },
        { agent_id: 'agt_2', role: 'member', joined_at: '2025-01-01T00:00:00Z' },
      ] as TeamMember[],
    });
    const steps = getEditAgentWizardSteps(agent, undefined, [team]);
    const teamStep = steps.find((s) => s.id === 'team');
    const teamOption = teamStep!.options!.find((o) => o.value === 'team_1');
    expect(teamOption!.hint).toBe('2 members');
  });

  it('works when teams param is undefined (no crash)', () => {
    const agent = makeAgent();
    const steps = getEditAgentWizardSteps(agent, undefined, undefined);
    const teamStep = steps.find((s) => s.id === 'team');
    expect(teamStep!.skip!({} as Record<string, string>)).toBe(true);
  });
});

// ── editAgentWizardToFields — team_id ──

describe('editAgentWizardToFields — team_id field', () => {
  it('returns team_id when team is selected', () => {
    const fields = editAgentWizardToFields({ name: 'Agent', role: '', model: '', team: 'team_1' });
    expect(fields.team_id).toBe('team_1');
  });

  it('returns undefined when team is empty string (None selected)', () => {
    // Uses `|| undefined` — empty string is falsy so maps to undefined.
    // App.tsx handles this via `fields.team_id ?? ''` which normalises undefined → ''.
    const fields = editAgentWizardToFields({ name: 'Agent', role: '', model: '', team: '' });
    expect(fields.team_id).toBeUndefined();
  });

  it('returns undefined when team key is absent', () => {
    const fields = editAgentWizardToFields({ name: 'Agent', role: '', model: '' });
    expect(fields.team_id).toBeUndefined();
  });
});

// ── Team change logic (pure simulation of App.tsx handleWizardComplete) ──

describe('team change logic simulation', () => {
  /** Simulate the leave/join decision from App.tsx handleWizardComplete edit_agent block */
  function computeTeamOps(oldTeamId: string, newTeamId: string) {
    const ops: Array<'leave' | 'join'> = [];
    if (oldTeamId && oldTeamId !== newTeamId) ops.push('leave');
    if (newTeamId && newTeamId !== oldTeamId) ops.push('join');
    return ops;
  }

  it('leaves old team and joins new team when switching teams', () => {
    const ops = computeTeamOps('team_1', 'team_2');
    expect(ops).toEqual(['leave', 'join']);
  });

  it('only leaves team when selecting None from a team', () => {
    const ops = computeTeamOps('team_1', '');
    expect(ops).toEqual(['leave']);
  });

  it('only joins team when agent had no team', () => {
    const ops = computeTeamOps('', 'team_1');
    expect(ops).toEqual(['join']);
  });

  it('no ops when team is unchanged (same ID)', () => {
    const ops = computeTeamOps('team_1', 'team_1');
    expect(ops).toEqual([]);
  });

  it('no ops when agent had no team and None is selected', () => {
    const ops = computeTeamOps('', '');
    expect(ops).toEqual([]);
  });
});
