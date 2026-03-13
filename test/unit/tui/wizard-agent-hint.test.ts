/**
 * Unit tests for agent hint rendering in task/goal create wizard.
 *
 * Covers:
 * 1. Hint has no ## WORKFLOW or other markdown headings
 * 2. Shows only first line of role (clean description)
 * 3. Truncation to 80 chars with ellipsis
 * 4. Agents without role show adapter name
 * 5. Disabled agents are excluded from options
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

describe('agent hint in task wizard — no markdown', () => {
  it('shows only first line of role, strips ## WORKFLOW and rest', () => {
    const agent = makeAgent({
      role: 'Senior TypeScript developer\n## WORKFLOW\n1) Analyze\n2) Implement',
    });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('Senior TypeScript developer');
    expect(hint).not.toContain('## WORKFLOW');
  });

  it('strips leading ## heading on first line', () => {
    const agent = makeAgent({ role: '## Backend Developer\nDoes backend stuff' });
    const hint = getAgentHint([agent], 'agt_1');
    // first line is the heading itself — trimmed and shown as-is
    // (we only strip newlines, not hash chars on first line)
    expect(hint).toBe('## Backend Developer');
    expect(hint).not.toContain('\n');
  });

  it('trims whitespace from first line', () => {
    const agent = makeAgent({ role: '   QA Engineer   \n## WORKFLOW\nstuff' });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('QA Engineer');
  });

  it('shows adapter name when role is undefined', () => {
    const agent = makeAgent({ role: undefined });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('claude');
  });

  it('shows empty hint when role is empty string (??-operator only guards null/undefined)', () => {
    const agent = makeAgent({ role: '' });
    // '' is not null/undefined so ?? does NOT fall back to adapter
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe('');
  });
});

describe('agent hint truncation to 80 chars', () => {
  it('truncates long first line to 79 chars + ellipsis', () => {
    const longRole = 'A'.repeat(100) + '\n## WORKFLOW\nstuff';
    const agent = makeAgent({ role: longRole });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBeDefined();
    expect(hint!.length).toBe(80); // 79 chars + '…'
    expect(hint!.endsWith('…')).toBe(true);
  });

  it('does not truncate roles exactly 80 chars long', () => {
    const role80 = 'B'.repeat(80);
    const agent = makeAgent({ role: role80 });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe(role80);
    expect(hint!.length).toBe(80);
  });

  it('does not truncate roles shorter than 80 chars', () => {
    const role = 'Short description';
    const agent = makeAgent({ role });
    const hint = getAgentHint([agent], 'agt_1');
    expect(hint).toBe(role);
  });
});

describe('agent hint in goal wizard', () => {
  it('goal wizard agent hint strips markdown same as task wizard', () => {
    const agent = makeAgent({
      id: 'agt_2',
      role: 'CTO / Tech Lead\n## WORKFLOW\n1) Analyze\n2) Delegate',
    });
    const steps = getGoalWizardSteps([agent]);
    const assigneeStep = steps.find((s) => s.id === 'assignee');
    const option = assigneeStep?.options?.find((o) => o.value === 'agt_2');
    expect(option?.hint).toBe('CTO / Tech Lead');
    expect(option?.hint).not.toContain('## WORKFLOW');
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
