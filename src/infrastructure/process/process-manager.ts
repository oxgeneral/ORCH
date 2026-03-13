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
    } catch (err) {
      // EPERM means process exists but we lack permission to signal it
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
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
 * First layer of a three-layer cap: readLines (16 KB) → serializeEventData (8 KB) → bus emit (4 KB).
 * Truncated lines produce invalid JSON → adapters' catch block handles gracefully.
 */
const MAX_LINE_LEN = 16384;

/** Cap a string to MAX_LINE_LEN. */
function capLine(s: string): string {
  return s.length > MAX_LINE_LEN ? s.slice(0, MAX_LINE_LEN) : s;
}

/**
 * Read lines from a readable stream as an async generator.
 *
 * Uses `for await` on the raw Readable (proper backpressure) instead of
 * readline.createInterface, which buffers all 'line' events in an unbounded
 * queue even when the consumer is paused — causing OOM under high throughput.
 *
 * Uses Buffer.concat + offset tracking to avoid O(n²) string copies.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  const chunks: Buffer[] = [];
  let totalLen = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf-8');
    if (buf.length === 0) continue;
    chunks.push(buf);
    totalLen += buf.length;

    // Concat once per chunk arrival, then scan for newlines with offset tracking
    const buffer = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    chunks.length = 0;
    totalLen = 0;

    let offset = 0;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf(0x0a, offset)) !== -1) {
      if (newlineIdx > offset) {
        yield capLine(buffer.toString('utf-8', offset, newlineIdx));
      }
      offset = newlineIdx + 1;
    }

    // Keep unconsumed remainder for next chunk
    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      chunks.push(remainder);
      totalLen = remainder.length;
    }
  }

  // Flush remaining data (last line without trailing newline)
  if (totalLen > 0) {
    const final = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    yield capLine(final.toString('utf-8'));
  }
}
