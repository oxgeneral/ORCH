/**
 * Runtime model discovery for adapter CLIs.
 *
 * Prefer the catalog exposed by the installed CLI. When a CLI has no model
 * listing command (Codex and Claude), use its own local cache or stable aliases.
 * Fallbacks deliberately avoid pinned model versions so they cannot go stale.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isAdapterKind, type AdapterKind } from '../../domain/model-tiers.js';

const DISCOVERY_TIMEOUT_MS = 15_000;

export interface ModelOption {
  value: string;
  label: string;
  hint?: string;
}

export type ModelCatalog = Partial<Record<AdapterKind, ModelOption[]>>;

export interface CommandOutput {
  stdout: string;
  stderr: string;
}

export interface ModelDiscoveryRuntime {
  runCommand?: (command: string, args: string[]) => Promise<CommandOutput>;
  readTextFile?: (path: string) => Promise<string>;
  codexHome?: string;
}

export const FALLBACK_MODEL_OPTIONS: Record<AdapterKind, ModelOption[]> = {
  claude: [
    { value: '', label: 'Default', hint: 'use Claude configured default' },
    { value: 'opus', label: 'Opus', hint: 'latest Opus alias' },
    { value: 'sonnet', label: 'Sonnet', hint: 'latest Sonnet alias' },
  ],
  codex: [
    { value: '', label: 'Default', hint: 'use Codex configured default' },
  ],
  cursor: [
    { value: '', label: 'Default', hint: 'use Cursor configured default' },
    { value: 'auto', label: 'Auto', hint: 'let Cursor choose' },
  ],
  opencode: [
    { value: '', label: 'Default', hint: 'use model configured in OpenCode' },
  ],
  pi: [
    { value: '', label: 'Default', hint: 'use Pi configured default; run /login in Pi if unavailable' },
  ],
  grok: [
    { value: '', label: 'Default', hint: 'use Grok configured default' },
  ],
  antigravity: [
    { value: '', label: 'Default', hint: 'use Antigravity configured default' },
  ],
  shell: [
    { value: '', label: 'Default', hint: 'model is not used by the shell adapter' },
  ],
};

export function getFallbackModelOptions(adapter: string): ModelOption[] {
  return isAdapterKind(adapter)
    ? FALLBACK_MODEL_OPTIONS[adapter]
    : [{ value: '', label: 'Default', hint: 'use adapter default' }];
}

export async function discoverModelOptions(
  adapter: AdapterKind,
  runtime: ModelDiscoveryRuntime = {},
): Promise<ModelOption[]> {
  const runCommand = runtime.runCommand ?? run;

  try {
    switch (adapter) {
      case 'claude':
        return await discoverCommand(runCommand, 'claude', ['--help'], parseClaudeModelAliases, 'use Claude configured default');
      case 'cursor':
        return await discoverCommand(runCommand, 'cursor-agent', ['--list-models'], parseCursorModels, 'use Cursor configured default');
      case 'grok':
        return await discoverCommand(runCommand, 'grok', ['models'], parseGrokModels, 'use Grok configured default');
      case 'antigravity':
        return await discoverCommand(runCommand, 'agy', ['models'], parseRuntimeLineModels, 'use Antigravity configured default');
      case 'opencode':
        return await discoverCommand(runCommand, 'opencode', ['models'], parseRuntimeLineModels, 'use model configured in OpenCode');
      case 'pi':
        return await discoverCommand(runCommand, 'pi', ['--list-models'], parsePiModels, 'use Pi configured default', true);
      case 'codex': {
        const codexHome = runtime.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
        const readTextFile = runtime.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
        return withDefault(
          parseCodexModelsCache(await readTextFile(join(codexHome, 'models_cache.json'))),
          'use Codex configured default',
        );
      }
      case 'shell':
        return getFallbackModelOptions('shell');
    }
  } catch {
    return [];
  }
}

async function discoverCommand(
  runCommand: (command: string, args: string[]) => Promise<CommandOutput>,
  command: string,
  args: string[],
  parse: (output: string) => ModelOption[],
  defaultHint: string,
  includeStderr = false,
): Promise<ModelOption[]> {
  const { stdout, stderr } = await runCommand(command, args);
  const output = includeStderr ? `${stdout}\n${stderr}` : stdout || stderr;
  return withDefault(parse(output), defaultHint);
}

export async function loadModelCatalog(
  adapters: readonly AdapterKind[],
  onUpdate?: (update: ModelCatalog) => void,
): Promise<ModelCatalog> {
  const entries = await Promise.all(adapters.map(async (adapter) => {
    const discovered = await discoverModelOptions(adapter);
    const options = discovered.length > 0 ? discovered : getFallbackModelOptions(adapter);
    onUpdate?.({ [adapter]: options });
    return [adapter, options] as const;
  }));
  return Object.fromEntries(entries) as ModelCatalog;
}

async function run(command: string, args: string[]): Promise<CommandOutput> {
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
      else resolve({ stdout, stderr });
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

export function parseClaudeModelAliases(output: string): ModelOption[] {
  const plain = stripAnsi(output);
  const modelFlag = plain.match(/--model <model>\s+([\s\S]*?)(?=\n\s{2,}--|\nCommands:|$)/)?.[1] ?? '';
  const aliases = [...modelFlag.matchAll(/(?:^|[\s,(])['"]([a-z0-9][a-z0-9._/-]*)['"]/gi)]
    .map((match) => match[1]!.trim())
    .filter(Boolean);
  return dedupeOptions(aliases.map((value) => ({
    value,
    label: labelFromModelId(value),
    hint: value.includes('-') ? 'installed CLI example' : 'latest alias',
  })));
}

export function parseCodexModelsCache(input: string): ModelOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];

  const options: ModelOption[] = [];
  for (const item of parsed.models) {
    if (!isRecord(item) || typeof item.slug !== 'string') continue;
    if (item.visibility !== undefined && item.visibility !== 'list') continue;
    options.push({
      value: item.slug,
      label: typeof item.display_name === 'string' ? item.display_name : labelFromModelId(item.slug),
      hint: typeof item.description === 'string' ? item.description : 'Codex cache',
    });
  }
  return dedupeOptions(options);
}

export function parseCursorModels(output: string): ModelOption[] {
  const options: ModelOption[] = [];
  for (const rawLine of stripAnsi(output).split('\n')) {
    const match = rawLine.trim().match(/^(\S+)\s+-\s+(.+)$/);
    if (!match) continue;
    const value = match[1]!;
    const labelAndHint = match[2]!;
    const status = labelAndHint.match(/\s+\(([^)]+)\)\s*$/);
    const label = status ? labelAndHint.slice(0, status.index).trim() : labelAndHint.trim();
    options.push({ value, label, hint: status?.[1] ?? 'runtime' });
  }
  return dedupeOptions(options);
}

export function parsePiModels(output: string): ModelOption[] {
  const lines = stripAnsi(output).split('\n').map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => /^provider\s{2,}model\s{2,}/i.test(line));
  if (headerIndex < 0) return [];

  const options: ModelOption[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const columns = line.split(/\s{2,}/);
    const provider = columns[0];
    const model = columns[1];
    if (!provider || !model) continue;
    options.push({
      value: `${provider}/${model}`,
      label: `${model} (${provider})`,
      hint: columns.slice(2).filter(Boolean).join(' · ') || 'runtime',
    });
  }
  return dedupeOptions(options);
}

export function parseGrokModels(output: string): ModelOption[] {
  const result: ModelOption[] = [];
  for (const line of stripAnsi(output).split('\n')) {
    const match = line.match(/^\s*([*-])\s+([^\s].*?)(?:\s+\(default\))?\s*$/);
    if (!match) continue;
    const isDefault = line.includes('(default)') || match[1] === '*';
    const value = match[2]!.replace(/\s+\(default\)\s*$/, '').trim();
    result.push({ value, label: labelFromModelId(value), hint: isDefault ? 'current default' : 'runtime' });
  }
  return dedupeOptions(result);
}

export function parseLineModels(output: string, hint: string): ModelOption[] {
  const options = stripAnsi(output)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('No models available'))
    .filter((line) => !line.startsWith('Use ') && !line.startsWith('/'))
    .map((value) => ({ value, label: labelFromModelId(value), hint }));
  return dedupeOptions(options);
}

function parseRuntimeLineModels(output: string): ModelOption[] {
  return parseLineModels(output, 'runtime');
}

function withDefault(options: ModelOption[], hint: string): ModelOption[] {
  if (options.length === 0) return [];
  if (options.some((option) => option.value === '')) return options;
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

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function labelFromModelId(value: string): string {
  if (!value) return 'Default';
  if (/\s/.test(value)) return value;
  const last = value.split('/').pop() ?? value;
  return last
    .replace(/^~+/, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      if (/^(gpt|api|ai)$/i.test(part)) return part.toUpperCase();
      return /^[a-z]+$/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part.toUpperCase();
    })
    .join(' ');
}
