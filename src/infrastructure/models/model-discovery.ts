/**
 * Runtime model discovery for adapter CLIs.
 *
 * Some agent CLIs can list their currently available models. Use those lists
 * in interactive UI where possible, while keeping curated fallbacks for CLIs
 * that do not expose a non-interactive model catalog.
 */

import { spawn } from 'node:child_process';
import { isAdapterKind, type AdapterKind } from '../../domain/model-tiers.js';

const DISCOVERY_TIMEOUT_MS = 15_000;

export interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

export type ModelCatalog = Partial<Record<AdapterKind, ModelOption[]>>;

export const FALLBACK_MODEL_OPTIONS: Record<AdapterKind, ModelOption[]> = {
  claude: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', hint: 'most capable' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'fast, balanced' },
    { value: 'claude-haiku-4-6', label: 'Claude Haiku 4.6', hint: 'fastest, cheapest' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', hint: 'extended thinking' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'legacy' },
  ],
  codex: [
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'default, balanced' },
    { value: 'gpt-5.4', label: 'GPT-5.4', hint: 'latest' },
    { value: 'gpt-5', label: 'GPT-5', hint: 'capable' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', hint: 'fast' },
    { value: 'o3', label: 'o3', hint: 'reasoning' },
    { value: 'o4-mini', label: 'o4-mini', hint: 'fast reasoning' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini', hint: 'light' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano', hint: 'cheapest' },
    { value: 'codex-mini-latest', label: 'Codex Mini', hint: 'legacy' },
  ],
  cursor: [
    { value: 'auto', label: 'Auto', hint: 'let Cursor decide' },
    { value: 'composer-1.5', label: 'Composer 1.5', hint: 'latest agent' },
    { value: 'composer-1', label: 'Composer 1', hint: 'stable agent' },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'OpenAI' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Anthropic' },
  ],
  opencode: [
    { value: '', label: 'Default', hint: 'use model configured in opencode' },
    { value: 'openrouter/anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', hint: 'fast, balanced' },
    { value: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', hint: 'most capable' },
    { value: 'openrouter/google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Google' },
    { value: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Google, fast' },
    { value: 'openrouter/deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', hint: 'open-source' },
    { value: 'openrouter/deepseek/deepseek-r1:free', label: 'DeepSeek R1', hint: 'reasoning, free' },
    { value: 'opencode/big-pickle', label: 'Big Pickle', hint: 'opencode native' },
  ],
  pi: [
    { value: 'openai-codex/gpt-5.5', label: 'GPT-5.5', hint: 'Pi OpenAI Codex provider' },
    { value: 'openai-codex/gpt-5.4', label: 'GPT-5.4', hint: 'Pi OpenAI Codex provider' },
    { value: 'openai-codex/gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'Pi OpenAI Codex provider' },
    { value: '', label: 'Default', hint: 'use Pi configured default' },
  ],
  grok: [
    { value: 'grok-composer-2.5-fast', label: 'Grok Composer 2.5 Fast', hint: 'default' },
    { value: 'grok-build', label: 'Grok Build', hint: 'coding agent' },
    { value: '', label: 'Default', hint: 'use Grok configured default' },
  ],
  antigravity: [
    { value: '', label: 'Default', hint: 'use Antigravity configured default' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro', hint: 'capable' },
    { value: 'gemini-3-flash', label: 'Gemini 3 Flash', hint: 'fast' },
  ],
  shell: [
    { value: '', label: 'Default', hint: 'use shell adapter default' },
  ],
};

export function getFallbackModelOptions(adapter: string): ModelOption[] {
  return isAdapterKind(adapter)
    ? FALLBACK_MODEL_OPTIONS[adapter]
    : [{ value: '', label: 'Default', hint: 'use adapter default' }];
}

export async function discoverModelOptions(adapter: AdapterKind): Promise<ModelOption[]> {
  try {
    switch (adapter) {
      case 'grok':
        return withDefault(parseGrokModels(await run('grok', ['models'])), 'use Grok configured default');
      case 'antigravity':
        return withDefault(parseLineModels(await run('agy', ['models']), 'runtime'), 'use Antigravity configured default');
      case 'opencode':
        return withDefault(parseLineModels(await run('opencode', ['models']), 'runtime'), 'use model configured in opencode');
      case 'pi':
        return withDefault(parseLineModels(await run('pi', ['--list-models']), 'runtime'), 'use Pi configured default');
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export async function loadModelCatalog(adapters: readonly AdapterKind[]): Promise<ModelCatalog> {
  const entries = await Promise.all(adapters.map(async (adapter) => {
    const discovered = await discoverModelOptions(adapter);
    return [adapter, discovered.length > 0 ? discovered : getFallbackModelOptions(adapter)] as const;
  }));
  return Object.fromEntries(entries) as ModelCatalog;
}

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(stdout);
    };

    timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`${command} ${args.join(' ')} timed out`));
    }, DISCOVERY_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', finish);
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(`${command} ${args.join(' ')} failed: ${signal ?? code}${stderr ? ` ${stderr}` : ''}`));
      }
    });
  });
}

export function parseGrokModels(output: string): ModelOption[] {
  const result: ModelOption[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*([*-])\s+([^\s].*?)(?:\s+\(default\))?\s*$/);
    if (!match) continue;
    const isDefault = line.includes('(default)') || match[1] === '*';
    const value = match[2]!.replace(/\s+\(default\)\s*$/, '').trim();
    result.push({ value, label: labelFromModelId(value), hint: isDefault ? 'current default' : 'runtime' });
  }
  return dedupeOptions(result);
}

export function parseLineModels(output: string, hint: string): ModelOption[] {
  const options = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('No models available'))
    .filter((line) => !line.startsWith('Use ') && !line.startsWith('/'))
    .map((value) => ({ value, label: labelFromModelId(value), hint }));
  return dedupeOptions(options);
}

function withDefault(options: ModelOption[], hint: string): ModelOption[] {
  if (options.length === 0) return [];
  if (options.some((o) => o.value === '')) return options;
  return [{ value: '', label: 'Default', hint }, ...options];
}

function dedupeOptions(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  const result: ModelOption[] = [];
  for (const option of options) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    result.push(option);
  }
  return result;
}

function labelFromModelId(value: string): string {
  if (!value) return 'Default';
  if (/\s/.test(value)) return value;
  const last = value.split('/').pop() ?? value;
  return last
    .replace(/^~+/, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => (/^[a-z]+$/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part.toUpperCase()))
    .join(' ');
}
