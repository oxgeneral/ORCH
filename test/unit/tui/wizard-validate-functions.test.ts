/**
 * Unit tests for validate functions in wizardConfigs.ts (commit 26a8270).
 *
 * Covers:
 * 1. Task title validate: empty → 'Title is required'
 * 2. Task priority validate: values outside 1-4 → 'Priority must be 1-4'
 * 3. Agent name validate (create): empty → error, duplicate → 'already exists'
 * 4. Edit agent name: self-exclusion (a.id !== agent.id)
 * 5. Team name validate: empty → error, duplicate → 'already exists'
 * 6. Goal title validate: empty → 'Title is required'
 */

import { describe, it, expect } from 'vitest';
import {
  getTaskWizardSteps,
  getEditTaskWizardSteps,
  getAgentWizardSteps,
  getEditAgentWizardSteps,
  getTeamWizardSteps,
  getGoalWizardSteps,
  getEditGoalWizardSteps,
} from '../../../src/tui/wizardConfigs.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Task } from '../../../src/domain/task.js';
import type { Team, TeamMember } from '../../../src/domain/team.js';
import type { Goal } from '../../../src/domain/goal.js';

// ── Helpers ──

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    name: 'Alpha',
    adapter: 'claude',
    status: 'idle',
    config: { approval_policy: 'auto', max_turns: 50, timeout_ms: 3_600_000, stall_timeout_ms: 300_000 },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_1',
    title: 'Existing task',
    status: 'todo',
    priority: 3,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team_1',
    name: 'Alpha Team',
    status: 'active',
    members: [] as TeamMember[],
    task_pool: [],
    lead_agent_id: 'agt_1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    config: { auto_claim: true },
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal_1',
    title: 'Existing goal',
    status: 'active',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Task title validate ──

describe('getTaskWizardSteps — title validate', () => {
  it('returns null for non-empty title', () => {
    const steps = getTaskWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('My task')).toBeNull();
  });

  it('returns error for empty string', () => {
    const steps = getTaskWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('')).toBe('Title is required');
  });

  it('returns error for whitespace-only string', () => {
    const steps = getTaskWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('   ')).toBe('Title is required');
  });
});

// ── Task priority validate ──

describe('getTaskWizardSteps — priority validate', () => {
  it('returns null for valid priority 1', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('1')).toBeNull();
  });

  it('returns null for valid priority 4', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('4')).toBeNull();
  });

  it('returns error for priority 0 (below range)', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('0')).toBe('Priority must be 1-4');
  });

  it('returns error for priority 5 (above range)', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('5')).toBe('Priority must be 1-4');
  });

  it('returns error for non-integer (float)', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('1.5')).toBe('Priority must be 1-4');
  });

  it('returns error for non-numeric string', () => {
    const steps = getTaskWizardSteps([]);
    const priorityStep = steps.find((s) => s.id === 'priority');
    expect(priorityStep?.validate?.('high')).toBe('Priority must be 1-4');
  });
});

// ── Edit task title validate ──

describe('getEditTaskWizardSteps — title validate', () => {
  it('returns null for non-empty title', () => {
    const task = makeTask({ title: 'Old title' });
    const steps = getEditTaskWizardSteps(task, []);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('Updated title')).toBeNull();
  });

  it('returns error for empty string', () => {
    const task = makeTask();
    const steps = getEditTaskWizardSteps(task, []);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('')).toBe('Title is required');
  });

  it('returns error for whitespace-only string', () => {
    const task = makeTask();
    const steps = getEditTaskWizardSteps(task, []);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('  ')).toBe('Title is required');
  });
});

// ── Agent name validate (create) ──

describe('getAgentWizardSteps — name validate', () => {
  it('returns null for unique non-empty name', () => {
    const agents = [makeAgent({ name: 'Beta' })];
    const steps = getAgentWizardSteps(agents);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('Gamma')).toBeNull();
  });

  it('returns error for empty name', () => {
    const steps = getAgentWizardSteps([]);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('')).toBe('Name is required');
  });

  it('returns error for whitespace-only name', () => {
    const steps = getAgentWizardSteps([]);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('   ')).toBe('Name is required');
  });

  it('returns error for duplicate name', () => {
    const agents = [makeAgent({ name: 'Alpha' })];
    const steps = getAgentWizardSteps(agents);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('Alpha')).toBe('Agent with this name already exists');
  });

  it('matches duplicate name with trim', () => {
    const agents = [makeAgent({ name: 'Alpha' })];
    const steps = getAgentWizardSteps(agents);
    const nameStep = steps.find((s) => s.id === 'name');
    // 'Alpha' (trimmed) matches existing 'Alpha'
    expect(nameStep?.validate?.(' Alpha ')).toBe('Agent with this name already exists');
  });

  it('returns null when no agents provided', () => {
    const steps = getAgentWizardSteps(undefined);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('NewAgent')).toBeNull();
  });
});

// ── Edit agent name validate (self-exclusion) ──

describe('getEditAgentWizardSteps — name validate with self-exclusion', () => {
  it('allows keeping own name (self-exclusion)', () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Alpha' });
    const agents = [agent, makeAgent({ id: 'agt_2', name: 'Beta' })];
    const steps = getEditAgentWizardSteps(agent, agents);
    const nameStep = steps.find((s) => s.id === 'name');
    // Renaming to own current name should not trigger duplicate error
    expect(nameStep?.validate?.('Alpha')).toBeNull();
  });

  it('returns error for duplicate name of another agent', () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Alpha' });
    const agents = [agent, makeAgent({ id: 'agt_2', name: 'Beta' })];
    const steps = getEditAgentWizardSteps(agent, agents);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('Beta')).toBe('Agent with this name already exists');
  });

  it('returns error for empty name on edit', () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Alpha' });
    const steps = getEditAgentWizardSteps(agent, [agent]);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('')).toBe('Name is required');
  });

  it('does not flag own id when checking duplicates', () => {
    // Ensure a.id !== agent.id is the exclusion condition
    const agent = makeAgent({ id: 'agt_target', name: 'MyAgent' });
    const agents = [
      agent,
      makeAgent({ id: 'agt_other', name: 'OtherAgent' }),
    ];
    const steps = getEditAgentWizardSteps(agent, agents);
    const nameStep = steps.find((s) => s.id === 'name');
    // Renaming to same name as self — should pass
    expect(nameStep?.validate?.('MyAgent')).toBeNull();
  });

  it('works when agents param is undefined (no crash)', () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Alpha' });
    const steps = getEditAgentWizardSteps(agent, undefined);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('NewName')).toBeNull();
  });
});

// ── Team name validate ──

describe('getTeamWizardSteps — name validate', () => {
  it('returns null for unique non-empty name', () => {
    const teams = [makeTeam({ name: 'Backend' })];
    const steps = getTeamWizardSteps([], teams);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('Frontend')).toBeNull();
  });

  it('returns error for empty name', () => {
    const steps = getTeamWizardSteps([]);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('')).toBe('Name is required');
  });

  it('returns error for whitespace-only name', () => {
    const steps = getTeamWizardSteps([]);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('   ')).toBe('Name is required');
  });

  it('returns error for duplicate team name', () => {
    const teams = [makeTeam({ name: 'Backend' })];
    const steps = getTeamWizardSteps([], teams);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('Backend')).toBe('Team with this name already exists');
  });

  it('matches duplicate team name with trim', () => {
    const teams = [makeTeam({ name: 'Backend' })];
    const steps = getTeamWizardSteps([], teams);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.(' Backend ')).toBe('Team with this name already exists');
  });

  it('returns null when no teams provided (undefined)', () => {
    const steps = getTeamWizardSteps([], undefined);
    const nameStep = steps.find((s) => s.id === 'name');
    expect(nameStep?.validate?.('NewTeam')).toBeNull();
  });
});

// ── Goal title validate ──

describe('getGoalWizardSteps — title validate', () => {
  it('returns null for non-empty title', () => {
    const steps = getGoalWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('Achieve launch')).toBeNull();
  });

  it('returns error for empty string', () => {
    const steps = getGoalWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('')).toBe('Title is required');
  });

  it('returns error for whitespace-only string', () => {
    const steps = getGoalWizardSteps([]);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('  ')).toBe('Title is required');
  });
});

// ── Edit goal title validate ──

describe('getEditGoalWizardSteps — title validate', () => {
  it('returns null for non-empty title', () => {
    const goal = makeGoal({ title: 'Old goal' });
    const steps = getEditGoalWizardSteps(goal, []);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('Updated goal')).toBeNull();
  });

  it('returns error for empty string', () => {
    const goal = makeGoal();
    const steps = getEditGoalWizardSteps(goal, []);
    const titleStep = steps.find((s) => s.id === 'title');
    expect(titleStep?.validate?.('')).toBe('Title is required');
  });
});
