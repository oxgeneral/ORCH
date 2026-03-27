/**
 * Claude Code adapter.
 *
 * Spawns `claude --print --output-format stream-json` in headless mode.
 * Parses JSON-lines from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { extractTokens, createStreamingEvents } from './utils.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code',
        errorKind: classifyAdapterError(msg),
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

    if (params.config.effort) {
      args.push('--reasoning-effort', params.config.effort);
    }

    // System prompt: orchestrator-generated (cacheable) takes priority, then per-agent config
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    if (effectiveSystemPrompt) {
      args.push('--system-prompt', effectiveSystemPrompt);
    }

    args.push(params.prompt);

    const { process: proc, pid } = this.processManager.spawn('claude', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    const events = createStreamingEvents(proc, parseClaudeEvent, 'Claude', params.signal);

    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseClaudeEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

    switch (parsed.type) {
      case 'assistant':
        return { type: 'output', timestamp, data: (parsed.message as unknown) ?? parsed };
      case 'tool_use':
        return { type: 'tool_call', timestamp, data: parsed };
      case 'tool_result':
        return { type: 'output', timestamp, data: parsed };
      case 'error': {
        const errData = (parsed.error as unknown) ?? parsed;
        const errMsg = typeof errData === 'string' ? errData : JSON.stringify(errData);
        return { type: 'error', timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }
      case 'result': {
        const tokens = extractTokens(parsed, { statsFallback: true });
        return { type: 'done', timestamp, data: parsed, tokens };
      }
      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
