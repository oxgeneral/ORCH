/**
 * Shell adapter.
 *
 * Spawns an arbitrary command via `bash -lc`.
 * Task prompt is passed via ORCHESTRY_TASK_PROMPT env variable.
 * Consumes stdout and stderr concurrently to avoid deadlocks.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { buildFullPrompt, buildChildEnv } from './utils.js';
import { readLines } from '../process/process-manager.js';
import { EventBuffer } from './event-buffer.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ShellAdapter implements IAgentAdapter {
  readonly kind = 'shell';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('bash', ['--version']);
      const version = stdout.split('\n')[0]?.trim() ?? 'unknown';
      return { ok: true, version };
    } catch {
      return { ok: false, error: 'bash not found', errorKind: classifyAdapterError('bash not found') };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    if (!params.security?.allowShellAdapter) {
      async function* errorGen(): AsyncGenerator<AgentEvent> {
        yield {
          type: 'error',
          timestamp: new Date().toISOString(),
          data: 'Shell adapter is disabled. Set execution.security.allow_shell_adapter=true to opt in.',
          errorKind: AdapterErrorKind.SPAWN_FAILED,
        };
      }
      return { pid: 0, events: errorGen() };
    }

    const command = params.config.command;
    if (!command) {
      // Return a handle that immediately yields an error
      async function* errorGen(): AsyncGenerator<AgentEvent> {
        yield {
          type: 'error',
          timestamp: new Date().toISOString(),
          data: 'Shell adapter requires a command in agent config',
          errorKind: AdapterErrorKind.SPAWN_FAILED,
        };
      }
      return { pid: 0, events: errorGen() };
    }

    const { process: proc, pid } = this.processManager.spawn('bash', ['-lc', command], {
      cwd: params.workspace,
      env: buildChildEnv(params.env, {
        ORCHESTRY_TASK_PROMPT: buildFullPrompt(params.systemPrompt, params.prompt),
      }),
      signal: params.signal,
    });

    const signal = params.signal;
    const processManager = this.processManager;

    async function* generateEvents(): AsyncGenerator<AgentEvent> {
      // Ring buffer with backpressure replaces Array.shift() polling
      const buffer = new EventBuffer();

      // Ensure process is reaped on abort — SIGTERM + grace period + SIGKILL
      const onAbort = () => {
        processManager.killWithGrace(pid, 5_000).catch(() => {});
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const stdoutPromise = (async () => {
        if (!proc.stdout) return;
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: 'output',
            timestamp: new Date().toISOString(),
            data: line,
          });
        }
      })();

      const stderrPromise = (async () => {
        if (!proc.stderr) return;
        for await (const line of readLines(proc.stderr)) {
          if (signal?.aborted) break;
          await buffer.push({
            type: 'error',
            timestamp: new Date().toISOString(),
            data: line,
            errorKind: classifyAdapterError(line),
          });
        }
      })();

      // Close the buffer once both streams are drained (or on error)
      void Promise.all([stdoutPromise, stderrPromise]).then(
        () => buffer.close(),
        () => buffer.close(),
      );

      // Yield events as they arrive — no polling, no busy-wait
      yield* buffer;

      // Clean up abort listener
      if (signal && !signal.aborted) {
        signal.removeEventListener('abort', onAbort);
      }

      // Wait for process to exit
      await new Promise<void>((resolve, reject) => {
        // If process already exited, resolve immediately
        if (proc.exitCode !== null || proc.killed) {
          resolve();
          return;
        }
        proc.on('close', (code) => {
          if (code === 0 || signal?.aborted) {
            resolve();
          } else {
            reject(new Error(`Shell command exited with code ${code}`));
          }
        });
        proc.on('error', reject);
      });
    }

    return { pid, events: generateEvents() };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}
