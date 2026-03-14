/**
 * Unit tests for agent hint rendering in task/goal create wizard.
 *
 * Covers:
 * 1. Hint format: [adapter] first-line-of-role
 * 2. First line truncation to 60 chars with ellipsis
 * 3. Agents without role show adapter name only
 * 4. Disabled agents are excluded from options
 */

import { describe, it, expect } from 'vitest';
import { getTaskWizardSteps, getGoalWizardSteps } from '../../../src/tui/wizardConfigs.js';
import type { Agent } from '../../../src/domain/agent.js';

// ── Helper ──

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

function getAgentHint(agents: Agent[], agentId: string): string | undefined {
  const steps = getTaskWizardSteps(agents);
  const assigneeStep = steps.find((s) => s.id === 'assignee');
  const option = assigneeStep?.options?.find((o) => o.value === agentId);
  return option?.hint;
}

// ── Tests ──

describe('agent hint format: [adapter] role', () => {
  it('shows [adapter] prefix + first line of role', () => {
    const agent = makeAgent({
      role: 'Senior TypeScript developer\n## WORKFLOW\n1) Analyze\n2) Implement',
    });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('[claude] Senior TypeScript developer');
    expect(hint).not.toContain('## WORKFLOW');
  });

  it('shows adapter prefix for non-claude adapters', () => {
    const agent = makeAgent({ adapter: 'opencode', role: 'Backend engineer' });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('[opencode] Backend engineer');
  });

  it('shows adapter name only when role is undefined', () => {
    const agent = makeAgent({ role: undefined });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('claude');
  });

  it('shows adapter name only when role is empty string', () => {
    const agent = makeAgent({ role: '' });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('claude');
  });

  it('trims whitespace from first line', () => {
    const agent = makeAgent({ role: '   QA Engineer   \n## WORKFLOW\nstuff' });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('[claude] QA Engineer');
  });
});

describe('agent hint role truncation to 60 chars', () => {
  it('truncates long first line with ellipsis', () => {
    const longRole = 'A'.repeat(100) + '\n## WORKFLOW\nstuff';
    const agent = makeAgent({ role: longRole });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBeDefined();
    // [claude] + space + 59 chars + ellipsis
    expect(hint).toMatch(/^\[claude\] A{59}\u2026$/);
  });

  it('does not truncate roles at exactly 60 chars', () => {
    const role60 = 'B'.repeat(60);
    const agent = makeAgent({ role: role60 });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe(`[claude] ${role60}`);
  });

  it('does not truncate short roles', () => {
    const role = 'Short description';
    const agent = makeAgent({ role });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('[claude] Short description');
  });
});

describe('agent hint in goal wizard', () => {
  it('goal wizard uses same [adapter] role format', () => {
    const agent = makeAgent({
      id: 'agt_2',
      role: 'CTO / Tech Lead\n## WORKFLOW\n1) Analyze\n2) Delegate',
    });
    const steps = getGoalWizardSteps([agent]);
    const assigneeStep = steps.find((s) => s.id === 'assignee');
    const option = assigneeStep?.options?.find((o) => o.value === 'agt_2');
    expect(option?.hint).toBe('[claude] CTO / Tech Lead');
  });
});

describe('disabled agents excluded from wizard', () => {
  it('disabled agent not shown in task wizard options', () => {
    const active = makeAgent({ id: 'agt_active', name: 'Active', status: 'idle' });
    const disabled = makeAgent({ id: 'agt_dis', name: 'Disabled', status: 'disabled' });
    const steps = getTaskWizardSteps([active, disabled]);
    const assigneeStep = steps.find((s) => s.id === 'assignee');
    const ids = assigneeStep?.options?.map((o) => o.value) ?? [];
    expect(ids).toContain('agt_active');
    expect(ids).not.toContain('agt_dis');
  });
});
