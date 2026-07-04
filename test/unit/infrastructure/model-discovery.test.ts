import { describe, expect, it } from 'vitest';
import {
  getFallbackModelOptions,
  parseGrokModels,
  parseLineModels,
} from '../../../src/infrastructure/models/model-discovery.js';

describe('model discovery parsers', () => {
  it('parses grok models and marks the current default', () => {
    const output = `
You are logged in with grok.com.

Default model: grok-composer-2.5-fast

Available models:
  * grok-composer-2.5-fast (default)
  - grok-build
`;

    expect(parseGrokModels(output)).toEqual([
      { value: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5 Fast', hint: 'current default' },
      { value: 'grok-build', label: 'Grok Build', hint: 'runtime' },
    ]);
  });

  it('parses one-model-per-line output and ignores helper text', () => {
    const output = `
Gemini 3.5 Flash (Medium)
No models available for a disabled provider
Use /help for usage
/tmp/cache/file
Claude Sonnet 4.6 (Thinking)
`;

    expect(parseLineModels(output, 'runtime')).toEqual([
      { value: 'Gemini 3.5 Flash (Medium)', label: 'Gemini 3.5 Flash (Medium)', hint: 'runtime' },
      { value: 'Claude Sonnet 4.6 (Thinking)', label: 'Claude Sonnet 4.6 (Thinking)', hint: 'runtime' },
    ]);
  });

  it('keeps fallback model options for CLIs without runtime discovery', () => {
    expect(getFallbackModelOptions('codex').map((option) => option.value)).toContain('gpt-5.3-codex');
    expect(getFallbackModelOptions('unknown')).toEqual([
      { value: '', label: 'Default', hint: 'use adapter default' },
    ]);
  });
});
