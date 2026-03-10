/**
 * Claude Code adapter.
 *
 * Spawns `claude --print --output-format stream-json` in headless mode.
 * Parses JSON-lines from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { readLines } from '../process/process-manager.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ClaudeAdapter implements IAgentAdapter {
  readonly kind = 'claude';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('claude', ['--version']);
      return { ok: true, version: stdout.trim() };
    } catch {
      return {
        ok: false,
        error: 'Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code',
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--max-turns', String(params.config.max_turns ?? 50),
      '--verbose',
      '--dangerously-skip-permissions', // Agents run autonomously; stdin is 'ignore' so prompts would hang
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    if (params.config.system_prompt) {
      args.push('--system-prompt', params.config.system_prompt);
    }

    args.push(params.prompt);

    const { process: proc, pid } = this.processManager.spawn('claude', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    const signal = params.signal;

    async function* generateEvents(): AsyncGenerator<AgentEvent> {
      let gotDoneEvent = false;

      // Capture exit code early (process may close before readline finishes)
      let exitCode: number | null = null;
      let exitError: Error | null = null;
      const exitPromise = new Promise<void>((resolve) => {
        proc.on('close', (code) => { exitCode = code; resolve(); });
        proc.on('error', (err) => { exitError = err; resolve(); });
      });

      if (proc.stdout) {
        for await (const line of readLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parseClaudeEvent(line);
          if (event) {
            if (event.type === 'done') gotDoneEvent = true;
            yield event;
          }
        }
      }

      // Wait for process to fully exit
      await exitPromise;

      // Check exit status AFTER all stdout is processed (so gotDoneEvent is accurate)
      if (exitError && !signal?.aborted && !gotDoneEvent) {
        throw exitError;
      }
      if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
        throw new Error(`Claude process exited with code ${exitCode}`);
      }
    }

    return { pid, events: generateEvents() };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function extractTokens(parsed: any): { input: number; output: number; total: number } | undefined {
  // Claude stream-json result may include usage info
  const usage = parsed.usage ?? parsed.stats?.usage;
  if (usage && typeof usage.input_tokens === 'number') {
    const input = usage.input_tokens;
    const output = usage.output_tokens ?? 0;
    return { input, output, total: input + output };
  }
  return undefined;
}

function parseClaudeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed = JSON.parse(line);
    const timestamp = new Date().toISOString();

    switch (parsed.type) {
      case 'assistant':
        return { type: 'output', timestamp, data: parsed.message ?? parsed };
      case 'tool_use':
        return { type: 'tool_call', timestamp, data: parsed };
      case 'tool_result':
        return { type: 'output', timestamp, data: parsed };
      case 'error':
        return { type: 'error', timestamp, data: parsed.error ?? parsed };
      case 'result': {
        const tokens = extractTokens(parsed);
        return { type: 'done', timestamp, data: parsed, tokens };
      }
      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
