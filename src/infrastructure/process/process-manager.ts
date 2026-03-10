/**
 * Process management utilities.
 *
 * Handles spawning subprocesses, PID checks, graceful kill.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import readline from 'node:readline';
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
    try {
      process.kill(pid, signal);
    } catch {
      // Process already dead
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
      ...options,
    });

    if (!proc.pid) {
      throw new Error(`Failed to spawn process: ${command}`);
    }

    return { process: proc, pid: proc.pid };
  }
}

/**
 * Read lines from a readable stream as an async generator.
 * Handles line buffering and backpressure.
 */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    yield line;
  }
}
