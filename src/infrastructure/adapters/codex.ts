/**
 * Codex CLI adapter.
 *
 * Spawns `codex exec --json -` in headless mode.
 * Prompt is piped via stdin (avoids CLI arg length limits).
 * Parses JSONL events from stdout into AgentEvent stream.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import { extractTokens, createStreamingEvents, buildFullPrompt } from './utils.js';
import {
  classifyAdapterError,
  extractErrorMessage,
  isModelMetadataWarning,
} from '../../domain/errors.js';
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

    // Pipe prompt via stdin — prepend system prompt if present (Codex has no native --system-prompt)
    if (proc.stdin) {
      proc.stdin.write(buildFullPrompt(params.systemPrompt, params.prompt));
      proc.stdin.end();
    }

    const events = createStreamingEvents(proc, createCodexEventParser(), 'Codex', params.signal);

    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function createCodexEventParser(): (line: string) => AgentEvent | null {
  let lastErrorMessage: string | null = null;

  return (line) => {
    const event = parseCodexEvent(line);
    if (!event) return null;

    if (event.type !== 'error') {
      lastErrorMessage = null;
      return event;
    }

    const message = extractErrorMessage(event.data);
    if (message && message === lastErrorMessage) return null;
    lastErrorMessage = message;
    return event;
  };
}

function parseCodexEvent(line: string): AgentEvent | null {
  if (!line.trim()) return null;

  try {
    const parsed: Record<string, unknown> = JSON.parse(line);
    const timestamp = new Date().toISOString();

    const type = (parsed.type as string) ?? '';

    // Codex JSONL event types
    switch (type) {
      // Provider lifecycle noise carries no user-facing information.
      case 'thread.started':
      case 'turn.started':
      case 'item.started':
        return null;

      case 'turn.completed': {
        const tokens = extractTokens(parsed);
        const result = typeof parsed.result === 'string' ? parsed.result : undefined;
        return {
          type: 'done',
          timestamp,
          data: { ...(result ? { result } : {}), raw: parsed },
          tokens,
        };
      }

      case 'turn.failed': {
        const tokens = extractTokens(parsed);
        return codexErrorEvent(timestamp, parsed, parsed.error ?? parsed, tokens);
      }

      case 'item.completed': {
        const item = (parsed.item as Record<string, unknown>) ?? {};
        const itemType = (item.type as string) ?? '';

        if (itemType === 'agent_message') {
          const text = typeof item.text === 'string' ? item.text : '';
          return text ? { type: 'output', timestamp, data: { text, raw: item } } : null;
        }
        if (itemType === 'reasoning') {
          return null;
        }
        if (itemType === 'command_execution') {
          const command = typeof item.command === 'string' ? item.command : '';
          const result = typeof item.aggregated_output === 'string' ? item.aggregated_output : undefined;
          return command
            ? { type: 'command', timestamp, data: { command, ...(result !== undefined ? { result } : {}), raw: item } }
            : null;
        }
        if (itemType === 'file_change') {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const paths = (changes as Record<string, unknown>[])
            .map((c) => typeof c.path === 'string' ? c.path : '')
            .filter(Boolean);
          return { type: 'file_change', timestamp, data: { paths, raw: item } };
        }
        if (itemType === 'tool_use' || itemType === 'mcp_tool_call') {
          const name = typeof item.name === 'string'
            ? item.name
            : typeof item.tool === 'string' ? item.tool : itemType;
          return {
            type: 'tool_call',
            timestamp,
            data: { name, ...('input' in item ? { input: item.input } : {}), raw: item },
          };
        }
        if (itemType === 'web_search') {
          const input = {
            ...(typeof item.query === 'string' ? { query: item.query } : {}),
            ...(item.action !== undefined ? { action: item.action } : {}),
          };
          return { type: 'tool_call', timestamp, data: { name: 'web_search', input, raw: item } };
        }
        if (itemType === 'tool_result') {
          const text = extractItemText(item);
          return text ? { type: 'output', timestamp, data: { text, raw: item } } : null;
        }
        if (itemType === 'error') {
          return codexErrorEvent(timestamp, item);
        }
        const text = extractItemText(item);
        return text ? { type: 'output', timestamp, data: { text, raw: item } } : null;
      }

      case 'error': {
        return codexErrorEvent(timestamp, parsed, parsed.error ?? parsed);
      }

      default: {
        const text = extractItemText(parsed);
        return text ? { type: 'output', timestamp, data: { text, raw: parsed } } : null;
      }
    }
  } catch {
    return { type: 'output', timestamp: new Date().toISOString(), data: line };
  }
}

function codexErrorEvent(
  timestamp: string,
  raw: Record<string, unknown>,
  value: unknown = raw,
  tokens?: AgentEvent['tokens'],
): AgentEvent {
  const message = extractErrorMessage(value);
  if (isModelMetadataWarning(message)) {
    return { type: 'output', timestamp, data: { text: `⚠ ${message}`, raw } };
  }
  return {
    type: 'error',
    timestamp,
    data: { message, raw },
    ...(tokens ? { tokens } : {}),
    errorKind: classifyAdapterError(message),
  };
}

function extractItemText(item: Record<string, unknown>): string {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  if (typeof item.message === 'string') return item.message;
  return '';
}
