/**
 * Shared utilities for agent adapters.
 *
 * Deduplicates extractTokens and streaming event generation logic
 * common to claude, codex, and cursor adapters.
 */

import type { ChildProcess } from 'node:child_process';
import type { AgentEvent } from './interface.js';
import { readLines } from '../process/process-manager.js';
import { createTokenUsage } from '../../domain/run.js';

export type TokenInfo = { input: number; output: number; total: number };

/**
 * Extract token usage from a parsed JSON event.
 *
 * @param parsed - The parsed JSON object from an adapter event line.
 * @param opts.statsFallback - If true, also checks `parsed.stats?.usage` (Claude-specific).
 */
export function extractTokens(
  parsed: Record<string, unknown>,
  opts?: { statsFallback?: boolean },
): TokenInfo | undefined {
  let usage = parsed.usage as Record<string, unknown> | undefined;

  if (!usage && opts?.statsFallback) {
    const stats = parsed.stats as Record<string, unknown> | undefined;
    usage = stats?.usage as Record<string, unknown> | undefined;
  }

  if (usage && typeof usage.input_tokens === 'number') {
    const input = usage.input_tokens;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    return createTokenUsage(input, output);
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
      for await (const line of readLines(proc.stdout)) {
        if (signal?.aborted) break;
        const event = parseEvent(line);
        if (event) {
          if (event.type === 'done') gotDoneEvent = true;
          yield event;
        }
      }
    }

    await exitPromise;

    if (exitError && !signal?.aborted && !gotDoneEvent) {
      throw exitError;
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      throw new Error(`${adapterName} process exited with code ${exitCode}`);
    }
  }

  return generate();
}
