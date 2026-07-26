import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/domain/agent.js';
import type { Team } from '../../../src/domain/team.js';
import {
  agentWizardToInput,
  editAgentWizardToFields,
  getAgentWizardSteps,
  getEditAgentWizardSteps,
} from '../../../src/tui/wizardConfigs.js';

function makeShellAgent(command = 'npm test'): Agent {
  return {
    id: 'agt_shell',
    name: 'Test Runner',
    adapter: 'shell',
    status: 'idle',
    config: { command, approval_policy: 'auto' },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
  };
}

const team: Team = {
  id: 'team_1',
  name: 'QA',
  status: 'active',
  members: [],
  task_pool: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  config: { auto_claim: true },
};

function visibleStepIds(
  steps: ReturnType<typeof getAgentWizardSteps>,
  values: Record<string, string>,
): string[] {
  return steps.filter((step) => !step.skip?.(values)).map((step) => step.id);
}

describe('shell agent wizard', () => {
  it('reduces creation to name, provider, and command even when teams exist', () => {
    const steps = getAgentWizardSteps([], [team]);
    expect(visibleStepIds(steps, { adapter: 'shell' })).toEqual([
      'name',
      'adapter',
      'command',
    ]);
  });

  it('shows command guidance and requires a non-empty value', () => {
    const commandStep = getAgentWizardSteps().find((step) => step.id === 'command')!;
    expect(commandStep.required).toBe(true);
    expect(commandStep.description).toBe('Runs from task workspace · exit 0 = done · non-zero = failed');
    expect(commandStep.validate!('   ')).toBe('Command is required for Shell');
    expect(commandStep.validate!('npm test')).toBeNull();
  });

  it('keeps the command step hidden for AI adapters', () => {
    const steps = getAgentWizardSteps();
    const visible = visibleStepIds(steps, { adapter: 'claude' });
    expect(visible).not.toContain('command');
    expect(visible).toContain('model');
    expect(visible).toContain('role');
  });

  it('prefills the configured default adapter', () => {
    const adapterStep = getAgentWizardSteps(undefined, undefined, undefined, 'shell')
      .find((step) => step.id === 'adapter')!;
    expect(adapterStep.defaultValue).toBe('shell');
  });

  it('maps shell input without stale AI-only values', () => {
    const input = agentWizardToInput({
      name: 'Test Runner',
      adapter: 'shell',
      command: '  npm test  ',
      model: 'stale-model',
      effort: 'high',
      role: 'stale role',
      skills: 'stale-skill',
      team: 'team_1',
      approval_policy: 'manual',
    });

    expect(input).toMatchObject({
      name: 'Test Runner',
      adapter: 'shell',
      command: 'npm test',
      approval_policy: 'auto',
    });
    expect(input.model).toBeUndefined();
    expect(input.effort).toBeUndefined();
    expect(input.role).toBeUndefined();
    expect(input.skills).toBeUndefined();
    expect(input.team_id).toBeUndefined();
  });

  it('prefills and exposes command when editing a shell agent', () => {
    const steps = getEditAgentWizardSteps(makeShellAgent(), undefined, [team]);
    const commandStep = steps.find((step) => step.id === 'command')!;
    const visible = steps
      .filter((step) => !step.skip?.({ adapter: 'shell' }))
      .map((step) => step.id);

    expect(commandStep.defaultValue).toBe('npm test');
    expect(visible).toEqual(['name', 'adapter', 'command']);
  });

  it('maps shell edits and clears stale commands after switching back to AI', () => {
    expect(editAgentWizardToFields({
      name: 'Runner',
      adapter: 'shell',
      command: '  npm run lint  ',
    }).command).toBe('npm run lint');

    expect(editAgentWizardToFields({
      name: 'Runner',
      adapter: 'claude',
      model: '',
    }).command).toBe('');
  });
});
