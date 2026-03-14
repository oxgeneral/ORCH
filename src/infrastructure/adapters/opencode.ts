/**
 * OpenCode adapter.
 *
 * Spawns `opencode run --format json` in headless mode.
 * Parses JSONL events from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { createStreamingEvents, buildFullPrompt } from './utils.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
import { createTokenUsage } from '../../domain/run.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class OpenCodeAdapter implements IAgentAdapter {
  readonly kind = 'opencode';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('opencode', ['--version']);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'OpenCode CLI not found. Install: npm i -g opencode',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      'run',
      '--format', 'json',
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    // OpenCode has no native --system-prompt; prepend to user prompt
    const fullPrompt = buildFullPrompt(params.systemPrompt, params.prompt);
    args.push(fullPrompt);

    const { process: proc, pid } = this.processManager.spawn('opencode', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    const events = createStreamingEvents(proc, parseOpenCodeEvent, 'OpenCode', params.signal);

    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseOpenCodeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();
    const type = (parsed.type as string) ?? '';
    const part = (parsed.part as Record<string, unknown>) ?? {};

    switch (type) {
      case 'step_start':
        return { type: 'output', timestamp, data: parsed.part ?? parsed };

      case 'text':
        return { type: 'output', timestamp, data: part.text ?? part };

      case 'tool_use': {
        const state = (part.state as Record<string, unknown>) ?? {};
        if (state.status === 'error') {
          const errMsg = typeof state.error === 'string' ? state.error : JSON.stringify(state);
          return { type: 'error', timestamp, data: state, errorKind: classifyAdapterError(errMsg) };
        }
        return { type: 'tool_call', timestamp, data: { tool: part.tool, ...state } };
      }

      case 'step_finish': {
        const reason = part.reason as string | undefined;
        const tokens = extractOpenCodeTokens(part);

        if (reason === 'error') {
          const errMsg = typeof part.error === 'string' ? part.error : JSON.stringify(part);
          return { type: 'error', timestamp, data: part, tokens, errorKind: classifyAdapterError(errMsg) };
        }
        if (reason === 'tool-calls') {
          return { type: 'output', timestamp, data: part, tokens };
        }
        // reason === 'stop', 'max_tokens', or any other terminal reason → done
        return { type: 'done', timestamp, data: part, tokens };
      }

      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}

/** Extract token usage from opencode step_finish part. */
function extractOpenCodeTokens(part: Record<string, unknown>): { input: number; output: number; total: number } | undefined {
  const tokens = part.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens.input !== 'number') return undefined;

  const input = tokens.input;
  const output = typeof tokens.output === 'number' ? tokens.output : 0;
  return createTokenUsage(input, output);
}
