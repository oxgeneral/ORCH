/**
 * Codex CLI adapter.
 *
 * Spawns `codex exec --json -` in headless mode.
 * Prompt is piped via stdin (avoids CLI arg length limits).
 * Parses JSONL events from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { extractTokens, createStreamingEvents } from './utils.js';
import { classifyAdapterError, AdapterErrorKind } from '../../domain/errors.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class CodexAdapter implements IAgentAdapter {
  readonly kind = 'codex';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execFileAsync('codex', ['--version']);
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Codex CLI not found. Install: npm i -g @openai/codex',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      'exec',
      '--json',
      '--sandbox', 'danger-full-access', // autonomous agents can't respond to approval prompts
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    // Read prompt from stdin (avoids ARG_MAX limits on long prompts)
    args.push('-');

    const { process: proc, pid } = this.processManager.spawn('codex', args, {
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

    const events = createStreamingEvents(proc, parseCodexEvent, 'Codex', params.signal);

    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function parseCodexEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

    const type = (parsed.type as string) ?? '';

    // Codex JSONL event types
    switch (type) {
      // Thread/session started
      case 'thread.started':
        return { type: 'output', timestamp, data: parsed };

      // Turn lifecycle
      case 'turn.started':
        return { type: 'output', timestamp, data: parsed };

      case 'turn.completed': {
        const tokens = extractTokens(parsed);
        return { type: 'done', timestamp, data: parsed, tokens };
      }

      case 'turn.failed': {
        const tokens = extractTokens(parsed);
        const failMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed);
        return { type: 'error', timestamp, data: parsed, tokens, errorKind: classifyAdapterError(failMsg) };
      }

      // Item events
      case 'item.started':
      case 'item.completed': {
        const item = (parsed.item as Record<string, unknown>) ?? {};
        const itemType = (item.type as string) ?? '';

        if (itemType === 'agent_message') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'reasoning') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'command_execution') {
          return { type: 'command', timestamp, data: item };
        }
        if (itemType === 'file_change') {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const paths = (changes as Record<string, unknown>[])
            .map((c) => typeof c.path === 'string' ? c.path : '')
            .filter(Boolean);
          return { type: 'file_change', timestamp, data: { paths, raw: item } };
        }
        if (itemType === 'tool_use') {
          return { type: 'tool_call', timestamp, data: item };
        }
        if (itemType === 'tool_result') {
          return { type: 'output', timestamp, data: item };
        }
        if (itemType === 'error') {
          const itemErrMsg = typeof item.message === 'string' ? item.message : JSON.stringify(item);
          return { type: 'error', timestamp, data: item, errorKind: classifyAdapterError(itemErrMsg) };
        }
        return { type: 'output', timestamp, data: item };
      }

      case 'error': {
        const errData = (parsed.error as unknown) ?? parsed;
        const errMsg = typeof errData === 'string' ? errData : JSON.stringify(errData);
        return { type: 'error', timestamp, data: errData, errorKind: classifyAdapterError(errMsg) };
      }

      default:
        return { type: 'output', timestamp, data: parsed };
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}
