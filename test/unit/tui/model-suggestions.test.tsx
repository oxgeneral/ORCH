import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import { App } from '../../../src/tui/App.js';
import { FormWizard, type WizardStep } from '../../../src/tui/components/FormWizard.js';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import type { ModelCatalog } from '../../../src/infrastructure/models/model-discovery.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  _resetAnimTick();
});

describe('model suggestions', () => {
  it('filters a large dynamic catalog and submits the selected model id', async () => {
    const onComplete = vi.fn();
    const steps: WizardStep[] = [{
      id: 'model',
      label: 'Model',
      type: 'text',
      getSuggestions: () => [
        { value: '', label: 'Default' },
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      ],
      suggestionMode: 'value',
      suggestionsLabel: 'available models',
    }];
    const { stdin, lastFrame } = render(React.createElement(FormWizard, {
      title: 'MODEL',
      steps,
      onComplete,
      onCancel: vi.fn(),
      width: 80,
      height: 16,
    }));

    stdin.write('terra');
    await delay(50);
    expect(lastFrame()).toContain('GPT-5.6 Terra');
    expect(lastFrame()).not.toContain('GPT-5.6 Sol');

    stdin.write('\x1B[B');
    await delay(25);
    stdin.write('\r');
    await delay(50);
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-5.6-terra' });
  });

  it('refreshes model suggestions in an already open agent wizard', async () => {
    let pushCatalog: ((catalog: ModelCatalog) => void) | undefined;
    const onLoadModelCatalog = (onUpdate?: (catalog: ModelCatalog) => void) => {
      pushCatalog = onUpdate;
      return new Promise<ModelCatalog>(() => {});
    };
    const state = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame, unmount } = render(React.createElement(App, {
      projectName: 'test',
      tasks: [],
      agents: [],
      state,
      onAddAgent: vi.fn(),
      onLoadModelCatalog,
    }));

    await delay(50);
    stdin.write('/');
    await delay(50);
    for (const character of 'agent add') stdin.write(character);
    await delay(50);
    stdin.write('\r');
    await delay(50);
    for (const character of 'alpha') stdin.write(character);
    await delay(50);
    stdin.write('\r');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()).toContain('Model');

    pushCatalog?.({
      claude: [{ value: 'claude-live-model', label: 'Claude Live Model', hint: 'runtime' }],
    });
    await delay(100);

    expect(lastFrame()).toContain('Claude Live Model');
    unmount();
  });
});
