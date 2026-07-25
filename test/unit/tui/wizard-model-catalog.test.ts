import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/domain/agent.js';
import type { ModelCatalog } from '../../../src/infrastructure/models/model-discovery.js';
import {
  agentWizardToInput,
  editAgentWizardToFields,
  getAgentWizardSteps,
  getEditAgentWizardSteps,
} from '../../../src/tui/wizardConfigs.js';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    name: 'Alpha',
    adapter: 'grok',
    status: 'idle',
    config: { approval_policy: 'auto', max_turns: 50, timeout_ms: 3_600_000, stall_timeout_ms: 300_000 },
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

describe('agent wizard model catalog', () => {
  it('uses runtime catalog options for the selected adapter', () => {
    const catalog: ModelCatalog = {
      grok: [{ value: 'fresh-grok-model', label: 'Fresh Grok Model', hint: 'runtime' }],
    };
    const steps = getAgentWizardSteps(undefined, undefined, catalog);
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.getSuggestions?.({ adapter: 'grok' })).toEqual(catalog.grok);
  });

  it('falls back when the runtime catalog has no adapter entry', () => {
    const steps = getAgentWizardSteps(undefined, undefined, {});
    const modelStep = steps.find((step) => step.id === 'model')!;
    const values = modelStep.getSuggestions?.({ adapter: 'grok' }).map((option) => option.value);

    expect(values).toContain('');
  });

  it('uses a neutral fallback for unknown adapters', () => {
    const steps = getAgentWizardSteps();
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.getSuggestions?.({ adapter: 'custom' })).toEqual([
      { value: '', label: 'Default', hint: 'use adapter default' },
    ]);
  });

  it('uses runtime catalog options in the edit agent wizard', () => {
    const catalog: ModelCatalog = {
      antigravity: [{ value: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)', hint: 'runtime' }],
    };
    const steps = getEditAgentWizardSteps(makeAgent({ adapter: 'antigravity' }), undefined, undefined, catalog);
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.getSuggestions?.({ adapter: 'antigravity' })).toEqual(catalog.antigravity);
  });

  it('uses the newly selected adapter for edit wizard model options', () => {
    const catalog: ModelCatalog = {
      grok: [{ value: 'fresh-grok-model', label: 'Fresh Grok Model', hint: 'runtime' }],
      antigravity: [{ value: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)', hint: 'runtime' }],
    };
    const steps = getEditAgentWizardSteps(makeAgent({ adapter: 'grok' }), undefined, undefined, catalog);
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.getSuggestions?.({ adapter: 'antigravity' })).toEqual(catalog.antigravity);
  });

  it('clears the previous model when the adapter changes during editing', () => {
    const agent = makeAgent({
      adapter: 'claude',
      config: {
        approval_policy: 'auto',
        max_turns: 50,
        timeout_ms: 3_600_000,
        stall_timeout_ms: 300_000,
        model: 'claude-sonnet-4-6',
      },
    });
    const steps = getEditAgentWizardSteps(agent);
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.getDefaultValue?.({ adapter: 'claude' })).toBe('claude-sonnet-4-6');
    expect(modelStep.getDefaultValue?.({ adapter: 'codex' })).toBe('');
  });

  it('uses a searchable text field that also accepts custom model ids', () => {
    const steps = getAgentWizardSteps();
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.type).toBe('text');
    expect(modelStep.suggestionMode).toBe('value');
  });

  it('maps a manually entered custom model id directly', () => {
    expect(agentWizardToInput({
      name: 'Alpha',
      adapter: 'claude',
      model: 'claude-experimental',
    }).model).toBe('claude-experimental');

    expect(editAgentWizardToFields({
      model: 'provider/private-model',
    }).model).toBe('provider/private-model');
  });
});
