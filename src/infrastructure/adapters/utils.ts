/**
 * Shared utilities for agent adapters.
 *
 * Deduplicates extractTokens and streaming event generation logic
 * common to claude, codex, and cursor adapters.
 */

import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { AgentEvent } from './interface.js';
import { readLines } from '../process/process-manager.js';
import { type TokenUsage, createTokenUsage } from '../../domain/run.js';
import { classifyAdapterError } from '../../domain/errors.js';

const STDERR_TAIL_BYTES = 4096;

/** Combine system and user prompts. Adapters without native system prompt support use this. */
export function buildFullPrompt(systemPrompt: string | undefined, userPrompt: string): string {
  return systemPrompt ? systemPrompt + '\n\n' + userPrompt : userPrompt;
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

  const readUsageNumber = (keys: readonly string[]): number | undefined => {
    if (!usage) return undefined;
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number') return value;
    }
    return undefined;
  };

  const input = readUsageNumber(['input_tokens', 'inputTokens']);
  if (input !== undefined) {
    const output = readUsageNumber(['output_tokens', 'outputTokens']) ?? 0;
    const reasoning = readUsageNumber(['reasoning_tokens', 'reasoningTokens']) ?? 0;
    const cache_read = readUsageNumber(['cache_read_input_tokens', 'cacheReadTokens']) ?? 0;
    const cache_write = readUsageNumber(['cache_creation_input_tokens', 'cacheWriteTokens']) ?? 0;
    return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
  }
  return undefined;
}

/**
 * Drain stderr while retaining a bounded tail for diagnostics.
 *
 * Attaching the data listener immediately prevents a chatty child process from
 * blocking on a full stderr pipe. The returned closure exposes only the tail so
 * adapter failures stay useful without retaining unbounded output in memory.
 */
export function createStderrTailCapture(
  stderr: Readable | null | undefined,
): () => string {
  if (!stderr) return () => '';

  let buf: Buffer = Buffer.alloc(0);
  stderr.on('data', (chunk: Buffer | string) => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8');
    buf = buf.length === 0 ? next : Buffer.concat([buf, next], buf.length + next.length);
    if (buf.length > STDERR_TAIL_BYTES) {
      // Materialize an exactly-sized copy rather than retaining a view into a
      // potentially much larger chunk's backing ArrayBuffer.
      buf = Buffer.from(buf.subarray(buf.length - STDERR_TAIL_BYTES));
    }
  });
  stderr.on('error', () => {});

  return () => buf.toString('utf-8').trimEnd();
}

/** Append a captured stderr tail to an adapter process error. */
export function appendStderrTail(message: string, adapterName: string, tail: string): string {
  return tail ? `${message}\n--- ${adapterName} stderr (tail) ---\n${tail}` : message;
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
  // Set up lifecycle and stderr listeners eagerly. Async generator bodies do
  // not run until their first next(), and fast process failures can otherwise
  // happen before ORCH starts consuming the event stream.
  let exitCode: number | null = null;
  let exitError: Error | null = null;
  const stderrTail = createStderrTailCapture(proc.stderr);
  const exitPromise = new Promise<void>((resolve) => {
    proc.once('close', (code) => { exitCode = code; resolve(); });
    proc.once('error', (err) => { exitError = err; resolve(); });
  });

  async function* generate(): AsyncGenerator<AgentEvent> {
    let gotDoneEvent = false;

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
      const message = appendStderrTail(spawnErr.message, adapterName, stderrTail());
      const classified = classifyAdapterError(message, exitCode ?? undefined);
      const err = Object.assign(new Error(message), { errorKind: classified });
      throw err;
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = appendStderrTail(
        `${adapterName} process exited with code ${exitCode}`,
        adapterName,
        stderrTail(),
      );
      const classified = classifyAdapterError(msg, exitCode);
      const err = Object.assign(new Error(msg), { errorKind: classified });
      throw err;
    }
  }

  return generate();
}
