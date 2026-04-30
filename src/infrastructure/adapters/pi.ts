/**
 * Pi coding agent adapter.
 *
 * Spawns `pi --mode rpc` in headless RPC mode.
 * Sends the ORCH prompt as a JSONL `prompt` command over stdin and maps Pi
 * RPC events from stdout into ORCH AgentEvents. Pi extensions/skills/context
 * remain enabled by default; UI-only extension events are ignored.
 */

import type { IAgentAdapter, AdapterTestResult, ExecuteParams, AgentEvent, ExecuteHandle } from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';
import type { Readable } from 'node:stream';
import { createTokenUsage, type TokenUsage } from '../../domain/run.js';
import { classifyAdapterError } from '../../domain/errors.js';
import { execFile } from 'node:child_process';

export class PiAdapter implements IAgentAdapter {
  readonly kind = 'pi';

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile('pi', ['--version'], (err, out) => {
          if (err) reject(err);
          else resolve(out);
        });
      });
      return { ok: true, version: stdout.trim() };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: 'Pi CLI not found. Install: npm i -g @mariozechner/pi-coding-agent',
        errorKind: classifyAdapterError(msg),
      };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    const args = [
      '--mode', 'rpc',
    ];

    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    if (params.config.effort) {
      args.push('--thinking', params.config.effort);
    }

    // Preserve Pi's own coding-agent harness prompt. ORCH's system prompt is
    // appended as additional project/task governance rather than replacing it.
    const effectiveSystemPrompt = params.systemPrompt ?? params.config.system_prompt;
    if (effectiveSystemPrompt) {
      args.push('--append-system-prompt', effectiveSystemPrompt);
    }

    const { process: proc, pid } = this.processManager.spawn('pi', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Avoid stderr backpressure if extensions emit warnings during startup.
    proc.stderr?.resume();

    if (proc.stdin) {
      proc.stdin.write(JSON.stringify({
        id: `orch-${Date.now()}`,
        type: 'prompt',
        message: params.prompt,
      }) + '\n');
    }

    const events = createPiRpcEvents(proc, pid, this.processManager, params.signal);
    return { pid, events };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.killWithGrace(pid);
  }
}

function createPiRpcEvents(
  proc: import('node:child_process').ChildProcess,
  pid: number,
  processManager: IProcessManager,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  async function* generate(): AsyncGenerator<AgentEvent> {
    let gotDoneEvent = false;
    let finalText = '';
    let lastTokens: TokenUsage | undefined;
    let exitCode: number | null = null;
    let exitError: Error | null = null;

    const exitPromise = new Promise<void>((resolve) => {
      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', (err) => { exitError = err; resolve(); });
    });

    try {
      if (proc.stdout) {
        for await (const line of readPiRpcLines(proc.stdout)) {
          if (signal?.aborted) break;
          const event = parsePiRpcEvent(line, { finalText, lastTokens });
          if (!event) continue;

          if (event.finalText !== undefined) finalText = event.finalText;
          if (event.tokens) lastTokens = event.tokens;

          if (event.agentEvent) {
            if (event.agentEvent.type === 'done') gotDoneEvent = true;
            yield event.agentEvent;
            if (event.agentEvent.type === 'done') {
              // Pi RPC is a long-lived process. ORCH tasks are one-shot runs, so
              // stop Pi after the terminal event instead of waiting forever.
              await processManager.killWithGrace(pid, 1_000).catch(() => {});
              return;
            }
          }
        }
      }
    } finally {
      proc.stdout?.destroy();
    }

    await exitPromise;

    const spawnError = exitError as Error | null;
    if (spawnError && !signal?.aborted && !gotDoneEvent) {
      const classified = classifyAdapterError(spawnError.message, exitCode ?? undefined);
      throw Object.assign(new Error(spawnError.message), { errorKind: classified });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const msg = `Pi process exited with code ${exitCode}`;
      const classified = classifyAdapterError(msg, exitCode);
      throw Object.assign(new Error(msg), { errorKind: classified });
    }
  }

  return generate();
}

interface ParseState {
  finalText: string;
  lastTokens?: TokenUsage;
}

interface ParsedPiEvent {
  agentEvent?: AgentEvent;
  finalText?: string;
  tokens?: TokenUsage;
}

function parsePiRpcEvent(line: string, state: ParseState): ParsedPiEvent | null {
  if (!line.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { agentEvent: { type: 'output', timestamp: new Date().toISOString(), data: line } };
  }

  const timestamp = new Date().toISOString();
  const type = typeof parsed.type === 'string' ? parsed.type : '';

  switch (type) {
    case 'extension_ui_request':
    case 'agent_start':
    case 'turn_start':
    case 'message_start':
    case 'message_end':
    case 'turn_end':
    case 'queue_update':
    case 'compaction_start':
    case 'compaction_end':
    case 'auto_retry_start':
    case 'auto_retry_end':
      return extractPassiveUpdate(parsed, state);

    case 'response': {
      if (parsed.success === false) {
        const errMsg = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed);
        return {
          agentEvent: { type: 'error', timestamp, data: parsed, errorKind: classifyAdapterError(errMsg) },
        };
      }
      return null;
    }

    case 'message_update':
      return parseMessageUpdate(parsed, timestamp, state);

    case 'tool_execution_start':
      return {
        agentEvent: {
          type: 'tool_call',
          timestamp,
          data: { name: parsed.toolName, input: parsed.args, raw: parsed },
        },
      };

    case 'tool_execution_update':
      return {
        agentEvent: {
          type: 'output',
          timestamp,
          data: parsed,
        },
      };

    case 'tool_execution_end':
      return parseToolExecutionEnd(parsed, timestamp);

    case 'agent_end': {
      const final = extractFinalText(parsed) ?? state.finalText;
      const tokens = extractPiTokensFromAgentEnd(parsed) ?? state.lastTokens;
      return {
        finalText: final,
        tokens,
        agentEvent: {
          type: 'done',
          timestamp,
          data: { result: final, raw: parsed },
          tokens,
        },
      };
    }

    case 'extension_error': {
      const errMsg = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed);
      return {
        agentEvent: { type: 'error', timestamp, data: parsed, errorKind: classifyAdapterError(errMsg) },
      };
    }

    default:
      return { agentEvent: { type: 'output', timestamp, data: parsed } };
  }
}

function parseMessageUpdate(parsed: Record<string, unknown>, timestamp: string, state: ParseState): ParsedPiEvent | null {
  const assistantMessageEvent = parsed.assistantMessageEvent as Record<string, unknown> | undefined;
  const updateType = typeof assistantMessageEvent?.type === 'string' ? assistantMessageEvent.type : '';

  if (updateType === 'text_delta') {
    const delta = typeof assistantMessageEvent?.delta === 'string' ? assistantMessageEvent.delta : '';
    return {
      finalText: state.finalText + delta,
      agentEvent: { type: 'output', timestamp, data: { text: delta, raw: parsed } },
    };
  }

  if (updateType === 'text_end') {
    const content = typeof assistantMessageEvent?.content === 'string' ? assistantMessageEvent.content : state.finalText;
    return { finalText: content };
  }

  if (updateType === 'error') {
    const reason = typeof assistantMessageEvent?.reason === 'string' ? assistantMessageEvent.reason : JSON.stringify(parsed);
    return {
      agentEvent: { type: 'error', timestamp, data: parsed, errorKind: classifyAdapterError(reason) },
    };
  }

  return null;
}

function parseToolExecutionEnd(parsed: Record<string, unknown>, timestamp: string): ParsedPiEvent {
  const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : '';
  const args = parsed.args as Record<string, unknown> | undefined;

  if (parsed.isError === true) {
    const errMsg = JSON.stringify(parsed.result ?? parsed);
    return {
      agentEvent: { type: 'error', timestamp, data: parsed, errorKind: classifyAdapterError(errMsg) },
    };
  }

  if (toolName === 'bash') {
    return {
      agentEvent: {
        type: 'command',
        timestamp,
        data: { command: args?.command, result: parsed.result, raw: parsed },
      },
    };
  }

  if (/^(write|edit)$/i.test(toolName)) {
    const path = extractPath(args);
    if (path) {
      return {
        agentEvent: {
          type: 'file_change',
          timestamp,
          data: { paths: [path], raw: parsed },
        },
      };
    }
  }

  return { agentEvent: { type: 'output', timestamp, data: parsed } };
}

function extractPassiveUpdate(parsed: Record<string, unknown>, state: ParseState): ParsedPiEvent | null {
  const tokens = extractPiTokensFromMessage(parsed);
  if (tokens) return { tokens };
  return state.finalText ? null : null;
}

function extractFinalText(parsed: Record<string, unknown>): string | undefined {
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown>;
    if (message.role !== 'assistant') continue;
    const text = extractTextFromContent(message.content);
    if (text) return text;
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => {
      const p = part as Record<string, unknown>;
      return typeof p.text === 'string' ? p.text : '';
    })
    .filter(Boolean);
  return parts.length ? parts.join('') : undefined;
}

function extractPath(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  if (typeof args.path === 'string') return args.path;
  if (typeof args.file_path === 'string') return args.file_path;
  return undefined;
}

function extractPiTokensFromAgentEnd(parsed: Record<string, unknown>): TokenUsage | undefined {
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown>;
    if (message.role !== 'assistant') continue;
    const tokens = extractPiTokensFromMessage(message);
    if (tokens) return tokens;
  }
  return undefined;
}

function extractPiTokensFromMessage(parsed: Record<string, unknown>): TokenUsage | undefined {
  const usage = parsed.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const input = numberField(usage.input) ?? numberField(usage.input_tokens) ?? 0;
  const output = numberField(usage.output) ?? numberField(usage.output_tokens) ?? 0;
  const reasoning = numberField(usage.reasoning) ?? numberField(usage.reasoning_tokens) ?? 0;
  const cache_read = numberField(usage.cacheRead) ?? numberField(usage.cache_read) ?? numberField(usage.cache_read_input_tokens) ?? 0;
  const cache_write = numberField(usage.cacheWrite) ?? numberField(usage.cache_write) ?? numberField(usage.cache_creation_input_tokens) ?? 0;

  if (input === 0 && output === 0 && reasoning === 0 && cache_read === 0 && cache_write === 0) return undefined;
  return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/**
 * Pi RPC can emit very large JSONL records (notably agent_end with the full
 * message transcript). Do not use the generic process readLines helper here:
 * it caps lines at 16 KB, which corrupts large JSON records before the adapter
 * can parse the terminal event.
 */
async function* readPiRpcLines(stream: Readable): AsyncGenerator<string> {
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf-8');
    pending = pending.length ? Buffer.concat([pending, buf]) : buf;

    let newlineIdx: number;
    while ((newlineIdx = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, newlineIdx).toString('utf-8');
      pending = pending.subarray(newlineIdx + 1);
      if (line) yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
  }

  if (pending.length) {
    const line = pending.toString('utf-8');
    if (line) yield line.endsWith('\r') ? line.slice(0, -1) : line;
  }
}
