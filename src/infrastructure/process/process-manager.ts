/**
 * Process management utilities.
 *
 * Handles spawning subprocesses, PID checks, graceful kill.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface SpawnResult {
  process: ChildProcess;
  pid: number;
}

export interface IProcessManager {
  isAlive(pid: number): boolean;
  kill(pid: number, signal?: NodeJS.Signals): void;
  killWithGrace(pid: number, graceMs?: number): Promise<void>;
  spawn(command: string, args: string[], options?: SpawnOptions): SpawnResult;
}

export class ProcessManager implements IProcessManager {
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  kill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
    // Kill entire process group (-pid) to clean up child processes (vitest, playwright, etc.)
    try {
      process.kill(-pid, signal);
    } catch {
      // Group kill failed — fall back to direct PID kill
      try {
        process.kill(pid, signal);
      } catch {
        // Process already dead
      }
    }
  }

  async killWithGrace(pid: number, graceMs: number = 10_000): Promise<void> {
    if (!this.isAlive(pid)) return;

    this.kill(pid, 'SIGTERM');

    const deadline = Date.now() + graceMs;

    while (Date.now() < deadline) {
      if (!this.isAlive(pid)) return;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Force kill if still alive
    this.kill(pid, 'SIGKILL');
  }

  spawn(command: string, args: string[], options?: SpawnOptions): SpawnResult {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // Create new process group so killWithGrace(-pid) kills all children
      ...options,
    });

    if (!proc.pid) {
      throw new Error(`Failed to spawn process: ${command}`);
    }

    return { process: proc, pid: proc.pid };
  }
}

/**
 * Max stdout line length before truncation (16 KB).
 * Claude tool_result events can be 100KB+ (full file contents).
 * Truncated lines produce invalid JSON → adapters' catch block handles gracefully.
 */
const MAX_LINE_LEN = 16384;

/**
 * Read lines from a readable stream as an async generator.
 *
 * Uses `for await` on the raw Readable (proper backpressure) instead of
 * readline.createInterface, which buffers all 'line' events in an unbounded
 * queue even when the consumer is paused — causing OOM under high throughput.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf-8');

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.length === 0) continue;
      // Cap line length to prevent multi-MB JSON.parse allocations
      yield line.length > MAX_LINE_LEN ? line.slice(0, MAX_LINE_LEN) : line;
    }
  }

  // Flush remaining data (last line without trailing newline)
  if (buffer.length > 0) {
    yield buffer.length > MAX_LINE_LEN ? buffer.slice(0, MAX_LINE_LEN) : buffer;
  }
}
