/**
 * Cursor Agent adapter.
 *
 * Spawns `cursor-agent` (Cursor's headless agent CLI) with `--output-format stream-json`.
 * Falls back to `agent` command if `cursor-agent` is not found.
 * Parses JSON-lines from stdout into AgentEvent stream.
 *
 * Note: This requires Cursor Agent CLI, not the regular `cursor` IDE command.
 * Install via: npm i -g @anthropic-ai/cursor-agent (when available)
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { extractTokens, createStreamingEvents } from './utils.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Try multiple command names and return the first that works */
async function findCommand(): Promise<{ command: string; version: string } | null> {
  for (const cmd of ['cursor-agent', 'agent']) {
    try {
      const { stdout } = await execFileAsync(cmd, ['--version']);
      return { command: cmd, version: stdout.trim() };
    } catch {
      // try next
    }
  }
  return null;
}

export class CursorAdapter implements IAgentAdapter {
  readonly kind = 'cursor';

  private resolvedCommand: string = 'cursor-agent';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    const found = await findCommand();
    if (found) {
      this.resolvedCommand = found.command;
      return { ok: true, version: found.version };
    }
    return {
      ok: false,
      error: 'Cursor Agent CLI not found. The headless agent CLI is required (cursor-agent or agent).',
      errorKind: AdapterErrorKind.ADAPTER_NOT_FOUND,
    };
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--workspace', params.workspace,
      '--yolo', // bypass interactive prompts for autonomous agents
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    const { process: proc, pid } = this.processManager.spawn(this.resolvedCommand, args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
      stdio: ['pipe', 'pipe', 'pipe'], // stdin must be 'pipe' to send prompt
    });

    // Pipe prompt via stdin
    if (proc.stdin) {
      proc.stdin.write(params.prompt);
      proc.stdin.end();
    }

    const events = createStreamingEvents(proc, parseCursorEvent, 'Cursor agent', params.signal);

    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseCursorEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

    // Cursor stream-json uses the same format as Claude stream-json
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
