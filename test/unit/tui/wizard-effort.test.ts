/**
 * Tests for the effort (reasoning effort) wizard step in agent creation/edit wizards.
 *
 * Covers:
 * 1. Effort step present after model step for claude/codex adapters
 * 2. Effort step skipped for shell/opencode/cursor adapters
 * 3. agentWizardToInput maps effort correctly
 * 4. editAgentWizardToFields maps effort correctly
 * 5. Edit wizard pre-fills current effort value
 */

import { describe, it, expect } from 'vitest';
import {
  getAgentWizardSteps,
  agentWizardToInput,
  getEditAgentWizardSteps,
  editAgentWizardToFields,
} from '../../../src/tui/wizardConfigs.js';
import type { Agent } from '../../../src/domain/agent.js';

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

describe('Agent wizard — effort step', () => {
  describe('getAgentWizardSteps', () => {
    it('has an effort step with id "effort"', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort');
      expect(effortStep).toBeDefined();
      expect(effortStep!.type).toBe('select');
    });

    it('effort step comes right after model step', () => {
      const steps = getAgentWizardSteps();
      const ids = steps.map((s) => s.id);
      const modelIdx = ids.indexOf('model');
      const effortIdx = ids.indexOf('effort');
      expect(effortIdx).toBe(modelIdx + 1);
    });

    it('effort step is shown for claude adapter', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({ adapter: 'claude' })).toBe(false);
    });

    it('effort step is shown for codex adapter', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({ adapter: 'codex' })).toBe(false);
    });

    it('effort step is skipped for shell adapter', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({ adapter: 'shell' })).toBe(true);
    });

    it('effort step is skipped for opencode adapter', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({ adapter: 'opencode' })).toBe(true);
    });

    it('effort step is skipped for cursor adapter', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({ adapter: 'cursor' })).toBe(true);
    });

    it('effort step has 4 options (default + 3 levels)', () => {
      const steps = getAgentWizardSteps();
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.options).toHaveLength(4);
      const values = effortStep.options!.map((o) => o.value);
      expect(values).toEqual(['', 'high', 'medium', 'low']);
    });
  });

  describe('agentWizardToInput', () => {
    it('maps effort value to output', () => {
      const result = agentWizardToInput({ name: 'bot', adapter: 'claude', effort: 'high' });
      expect(result.effort).toBe('high');
    });

    it('returns undefined effort for empty string', () => {
      const result = agentWizardToInput({ name: 'bot', adapter: 'claude', effort: '' });
      expect(result.effort).toBeUndefined();
    });

    it('returns undefined effort when not present', () => {
      const result = agentWizardToInput({ name: 'bot', adapter: 'claude' });
      expect(result.effort).toBeUndefined();
    });
  });

  describe('getEditAgentWizardSteps', () => {
    it('has effort step for claude agent', () => {
      const agent = makeAgent({ adapter: 'claude' });
      const steps = getEditAgentWizardSteps(agent);
      const effortStep = steps.find((s) => s.id === 'effort');
      expect(effortStep).toBeDefined();
    });

    it('effort step is skipped for shell agent', () => {
      const agent = makeAgent({ adapter: 'shell' });
      const steps = getEditAgentWizardSteps(agent);
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.skip!({})).toBe(true);
    });

    it('pre-fills current effort value', () => {
      const agent = makeAgent({
        adapter: 'claude',
        config: { ...makeAgent().config, effort: 'medium' },
      });
      const steps = getEditAgentWizardSteps(agent);
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.defaultValue).toBe('medium');
    });

    it('defaults to empty string when effort is not set', () => {
      const agent = makeAgent({ adapter: 'claude' });
      const steps = getEditAgentWizardSteps(agent);
      const effortStep = steps.find((s) => s.id === 'effort')!;
      expect(effortStep.defaultValue).toBe('');
    });
  });

  describe('editAgentWizardToFields', () => {
    it('maps effort value', () => {
      const result = editAgentWizardToFields({ name: 'bot', effort: 'low' });
      expect(result.effort).toBe('low');
    });

    it('returns undefined for empty effort', () => {
      const result = editAgentWizardToFields({ name: 'bot', effort: '' });
      expect(result.effort).toBeUndefined();
    });
  });
});
