import { describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/domain/agent.js';
import type { ModelCatalog } from '../../../src/infrastructure/models/model-discovery.js';
import {
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

    expect(modelStep.getOptions?.({ adapter: 'grok' })).toEqual(catalog.grok);
  });

  it('falls back when the runtime catalog has no adapter entry', () => {
    const steps = getAgentWizardSteps(undefined, undefined, {});
    const modelStep = steps.find((step) => step.id === 'model')!;
    const values = modelStep.getOptions?.({ adapter: 'grok' }).map((option) => option.value);

    expect(values).toContain('grok-composer-2.5-fast');
    expect(values).toContain('grok-build');
  });

  it('uses runtime catalog options in the edit agent wizard', () => {
    const catalog: ModelCatalog = {
      antigravity: [{ value: 'Gemini 3.5 Flash (High)', label: 'Gemini 3.5 Flash (High)', hint: 'runtime' }],
    };
    const steps = getEditAgentWizardSteps(makeAgent({ adapter: 'antigravity' }), undefined, undefined, catalog);
    const modelStep = steps.find((step) => step.id === 'model')!;

    expect(modelStep.options).toEqual(catalog.antigravity);
  });
});
