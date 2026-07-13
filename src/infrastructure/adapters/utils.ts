/**
 * Shared utilities for agent adapters.
 *
 * Deduplicates extractTokens and streaming event generation logic
 * common to claude, codex, and cursor adapters.
 */

import type { ChildProcess } from 'node:child_process';
import type { AgentEvent } from './interface.js';
import { readLines } from '../process/process-manager.js';
import { type TokenUsage, createTokenUsage } from '../../domain/run.js';
import { classifyAdapterError } from '../../domain/errors.js';

const PARENT_ENV_ALLOWLIST = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
]);

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPLICIT_ENV_DENYLIST = new Set([
  'PATH',
  'NODE_PATH',
  'NODE_OPTIONS',
  'BASH_ENV',
  'ENV',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'NPM_CONFIG_USERCONFIG',
  'NPM_CONFIG_GLOBALCONFIG',
  'PYTHONPATH',
  'PYTHONSTARTUP',
  'RUBYOPT',
  'PERL5OPT',
  'PERL5LIB',
]);

function isSafeExplicitEnvName(key: string): boolean {
  const upper = key.toUpperCase();
  return ENV_NAME_RE.test(key) &&
    !EXPLICIT_ENV_DENYLIST.has(upper) &&
    !upper.startsWith('LD_') &&
    !upper.startsWith('DYLD_') &&
    !upper.startsWith('NPM_CONFIG_') &&
    !upper.startsWith('GIT_CONFIG_KEY_') &&
    !upper.startsWith('GIT_CONFIG_VALUE_');
}

/** Combine system and user prompts. Adapters without native system prompt support use this. */
export function buildFullPrompt(systemPrompt: string | undefined, userPrompt: string): string {
  return systemPrompt ? systemPrompt + '\n\n' + userPrompt : userPrompt;
}

/** Build a least-privilege child environment for agent processes. */
export function buildChildEnv(
  explicitEnv?: Record<string, string>,
  extraEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if ((PARENT_ENV_ALLOWLIST.has(key) || key.startsWith('LC_')) && value !== undefined) {
      env[key] = value;
    }
  }

  for (const source of [explicitEnv, extraEnv]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (isSafeExplicitEnvName(key)) env[key] = value;
    }
  }

  return env;
}

/**
 * Extract token usage from a parsed JSON event.
 *
 * @param parsed - The parsed JSON object from an adapter event line.
 * @param opts.statsFallback - If true, also checks `parsed.stats?.usage` (Claude-specific).
 */
export function extractTokens(
  parsed: Record<string, unknown>,
  opts?: { statsFallback?: boolean },
): TokenUsage | undefined {
  let usage = parsed.usage as Record<string, unknown> | undefined;

  if (!usage && opts?.statsFallback) {
    const stats = parsed.stats as Record<string, unknown> | undefined;
    usage = stats?.usage as Record<string, unknown> | undefined;
  }

  if (usage && typeof usage.input_tokens === 'number') {
    const input = usage.input_tokens;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    const reasoning = typeof usage.reasoning_tokens === 'number' ? usage.reasoning_tokens : 0;
    const cache_read = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const cache_write = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
  }
  return undefined;
}

/**
 * Create an async generator that streams AgentEvents from a child process.
 *
 * Handles: exit promise setup, line-by-line reading, abort signal, exit code checking.
 *
 * @param proc - The spawned child process.
 * @param parseEvent - Adapter-specific function to parse a line into an AgentEvent.
 * @param adapterName - Name used in error messages (e.g. "Claude", "Codex").
 * @param signal - Optional abort signal.
 */
export function createStreamingEvents(
  proc: ChildProcess,
  parseEvent: (line: string) => AgentEvent | null,
  adapterName: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  async function* generate(): AsyncGenerator<AgentEvent> {
    let gotDoneEvent = false;

    let exitCode: number | null = null;
    let exitError: Error | null = null;
    const exitPromise = new Promise<void>((resolve) => {
      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', (err) => { exitError = err; resolve(); });
    });

    if (proc.stdout) {
      try {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseEvent(line);
          if (event) {
            if (event.type === 'done') gotDoneEvent = true;
            yield event;
          }
        }
      } finally {
        // Destroy the stream to release the FD immediately rather than waiting
        // for the process to die — critical for rapid abort/restart cycles.
        // destroy() is idempotent: safe on an already-ended stream.
        proc.stdout.destroy();
      }
    }

    await exitPromise;

    if (exitError && !signal?.aborted && !gotDoneEvent) {
      const spawnErr = exitError as Error;
      const classified = classifyAdapterError(spawnErr.message, exitCode ?? undefined);
      const err = Object.assign(new Error(spawnErr.message), { errorKind: classified });
      throw err;
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = `${adapterName} process exited with code ${exitCode}`;
      const classified = classifyAdapterError(msg, exitCode);
      const err = Object.assign(new Error(msg), { errorKind: classified });
      throw err;
    }
  }

  return generate();
}
