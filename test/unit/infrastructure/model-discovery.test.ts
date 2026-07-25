import { describe, expect, it, vi } from 'vitest';
import type { AdapterKind } from '../../../src/domain/model-tiers.js';
import {
  discoverModelOptions,
  getFallbackModelOptions,
  loadModelCatalog,
  parseClaudeModelAliases,
  parseCodexModelsCache,
  parseCursorModels,
  parseGrokModels,
  parseLineModels,
  parsePiModels,
  type CommandOutput,
} from '../../../src/infrastructure/models/model-discovery.js';

describe('model discovery parsers', () => {
  it('parses aliases advertised by the installed Claude CLI', () => {
    const output = `
  --model <model>  Model for the current session. Provide an alias for the latest
                   model (e.g. 'fable', 'opus', or 'sonnet') or a model's full
                   name (e.g. 'claude-fable-5').
  --name <name>    Session name
`;

    expect(parseClaudeModelAliases(output).map((option) => option.value)).toEqual([
      'fable',
      'opus',
      'sonnet',
      'claude-fable-5',
    ]);
  });

  it('parses visible models from the Codex cache', () => {
    const cache = JSON.stringify({
      models: [
        { slug: 'gpt-current', display_name: 'GPT Current', description: 'Latest', visibility: 'list' },
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
        { slug: 'gpt-compatible' },
        { display_name: 'Missing slug' },
      ],
    });

    expect(parseCodexModelsCache(cache)).toEqual([
      { value: 'gpt-current', label: 'GPT Current', hint: 'Latest' },
      { value: 'gpt-compatible', label: 'GPT Compatible', hint: 'Codex cache' },
    ]);
    expect(parseCodexModelsCache('{broken')).toEqual([]);
  });

  it('parses Cursor model ids, labels, and account status', () => {
    const output = `
Available models

auto - Auto (current, default)
gpt-5.6-sol-high - GPT-5.6 Sol 1M High

Tip: use --model <id>
`;

    expect(parseCursorModels(output)).toEqual([
      { value: 'auto', label: 'Auto', hint: 'current, default' },
      { value: 'gpt-5.6-sol-high', label: 'GPT-5.6 Sol 1M High', hint: 'runtime' },
    ]);
  });

  it('parses the Pi provider table into canonical provider/model ids', () => {
    const output = `
provider   model              context  max-out  thinking  images
anthropic  claude-sonnet-4-6  200K     64K      yes       yes
openai     gpt-5.4            1M       128K     yes       yes
`;

    expect(parsePiModels(output)).toEqual([
      {
        value: 'anthropic/claude-sonnet-4-6',
        label: 'claude-sonnet-4-6 (anthropic)',
        hint: '200K · 64K · yes · yes',
      },
      {
        value: 'openai/gpt-5.4',
        label: 'gpt-5.4 (openai)',
        hint: '1M · 128K · yes · yes',
      },
    ]);
  });

  it('parses grok models and marks the current default', () => {
    const output = `
Default model: grok-4.5

Available models:
  * grok-4.5 (default)
  - grok-build
`;

    expect(parseGrokModels(output)).toEqual([
      { value: 'grok-4.5', label: 'Grok 4.5', hint: 'current default' },
      { value: 'grok-build', label: 'Grok Build', hint: 'runtime' },
    ]);
  });

  it('parses one-model-per-line output and ignores helper text', () => {
    const output = `
Gemini 3.6 Flash (Medium)
No models available for a disabled provider
Use /help for usage
/tmp/cache/file
Claude Sonnet 5 (Thinking)
`;

    expect(parseLineModels(output, 'runtime')).toEqual([
      { value: 'Gemini 3.6 Flash (Medium)', label: 'Gemini 3.6 Flash (Medium)', hint: 'runtime' },
      { value: 'Claude Sonnet 5 (Thinking)', label: 'Claude Sonnet 5 (Thinking)', hint: 'runtime' },
    ]);
  });
});

describe('adapter model discovery', () => {
  const outputs: Record<string, CommandOutput> = {
    'claude --help': {
      stdout: "--model <model>  Use 'opus' or 'sonnet'.\n  --name <name>  Name",
      stderr: '',
    },
    'cursor-agent --list-models': {
      stdout: 'Available models\ncurrent - Current Model (default)',
      stderr: '',
    },
    'grok models': {
      stdout: 'Available models:\n  * grok-current (default)',
      stderr: '',
    },
    'agy models': {
      stdout: 'antigravity-current',
      stderr: '',
    },
    'opencode models': {
      stdout: 'provider/opencode-current',
      stderr: '',
    },
    'pi --list-models': {
      stdout: 'provider  model       context  max-out  thinking  images\nopenai   pi-current  1M       64K      yes       yes',
      stderr: '',
    },
  };

  const runCommand = vi.fn(async (command: string, args: string[]) => {
    const output = outputs[`${command} ${args.join(' ')}`];
    if (!output) throw new Error('unexpected command');
    return output;
  });
  const readTextFile = vi.fn(async () => JSON.stringify({
    models: [{ slug: 'codex-current', display_name: 'Codex Current', visibility: 'list' }],
  }));

  it.each([
    ['claude', 'opus'],
    ['codex', 'codex-current'],
    ['cursor', 'current'],
    ['opencode', 'provider/opencode-current'],
    ['pi', 'openai/pi-current'],
    ['grok', 'grok-current'],
    ['antigravity', 'antigravity-current'],
    ['shell', ''],
  ] satisfies Array<[AdapterKind, string]>)('discovers %s models', async (adapter, expectedModel) => {
    const options = await discoverModelOptions(adapter, {
      runCommand,
      readTextFile,
      codexHome: '/test/codex',
    });

    expect(options.map((option) => option.value)).toContain(expectedModel);
  });

  it('uses safe non-versioned fallbacks when discovery is unavailable', async () => {
    const options = await discoverModelOptions('cursor', {
      runCommand: async () => { throw new Error('not installed'); },
    });

    expect(options).toEqual([]);
    expect(getFallbackModelOptions('cursor').map((option) => option.value)).toEqual(['', 'auto']);
    expect(getFallbackModelOptions('codex').map((option) => option.value)).toEqual(['']);
  });

  it('streams each catalog entry as soon as it resolves', async () => {
    const updates: string[] = [];
    const catalog = await loadModelCatalog(['shell'], (update) => {
      updates.push(...Object.keys(update));
    });

    expect(updates).toEqual(['shell']);
    expect(catalog.shell).toEqual(getFallbackModelOptions('shell'));
  });
});
