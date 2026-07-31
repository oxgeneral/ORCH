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
import { appendStderrTail, createStderrTailCapture } from './utils.js';
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

    // Capture stderr tail so auth/extension-load errors surface in non-zero exits
    // rather than being silently drained. Drains backpressure at the same time.
    const stderrTail = createStderrTailCapture(proc.stderr);

    if (proc.stdin) {
      proc.stdin.write(JSON.stringify({
        id: `orch-${Date.now()}`,
        type: 'prompt',
        message: params.prompt,
      }) + '\n');
      // DO NOT call proc.stdin.end() here. Pi --mode rpc is a long-lived
      // persistent session: it sends a prompt preflight response, then drives
      // the LLM call asynchronously, streaming message_update / turn_end /
      // agent_end as the model responds. Closing stdin after the write breaks
      // that pipeline — verified on pi-coding-agent 0.73.1: pi stalls right
      // after the user-message_end event and never produces an assistant turn.
      // We terminate the long-lived process via processManager.killWithGrace
      // immediately after the terminal `done` event (see createPiRpcEvents).
    }

    const events = createPiRpcEvents(proc, pid, this.processManager, stderrTail, params.signal);
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
  stderrTail: () => string,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  async function* generate(): AsyncGenerator<AgentEvent> {
    let gotDoneEvent = false;
    let streamErrorYielded = false;
    let finalText = '';
    let lastTokens: TokenUsage | undefined;
    let pendingCompletion: PiCompletion | undefined;
    let exitCode: number | null = null;
    let exitError: Error | null = null;

    const exitPromise = new Promise<void>((resolve) => {
      proc.on('close', (code) => { exitCode = code; resolve(); });
      proc.on('error', (err) => { exitError = err; resolve(); });
    });

    let streamError: Error | null = null;
    try {
      if (proc.stdout) {
        try {
          for await (const line of readPiRpcLines(proc.stdout)) {
            if (signal?.aborted) break;
            const event = parsePiRpcEvent(line, { finalText, lastTokens });
            if (!event) continue;

            if (event.finalText !== undefined) finalText = event.finalText;
            if (event.tokens) lastTokens = event.tokens;

            if (event.completion) {
              pendingCompletion = event.completion;
            }

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

            const terminalCompletion = event.settled
              ? pendingCompletion
              : event.completion && !event.completion.waitForSettled
                ? event.completion
                : undefined;

            if (terminalCompletion) {
              const terminal = toTerminalPiEvent(terminalCompletion);
              if (terminal.event.type === 'done') gotDoneEvent = true;
              yield terminal.event;

              // Pi RPC is a long-lived process. Once the full run has settled,
              // stop the process instead of waiting for stdin to close.
              await processManager.killWithGrace(pid, 1_000).catch(() => {});

              if (terminal.error) throw terminal.error;
              return;
            }
          }
        } catch (err) {
          // Terminal provider failures are deliberately thrown after their
          // canonical error event is yielded. Let the orchestrator's failure
          // path handle retry/failed state instead of weakening them into a
          // stdout transport error or a successful generator completion.
          if (err instanceof PiTerminalError) throw err;

          // stdout emitted 'error' (ECONNRESET, EPIPE, etc) before a terminal event.
          // Without this catch the rejection propagates out of the async generator
          // as an unhandled error and the orchestrator only sees the run hang.
          streamError = err instanceof Error ? err : new Error(String(err));
          if (!signal?.aborted && !gotDoneEvent) {
            streamErrorYielded = true;
            yield {
              type: 'error',
              timestamp: new Date().toISOString(),
              data: { message: streamError.message },
              errorKind: classifyAdapterError(streamError.message),
            };
          }
        }
      }
    } finally {
      proc.stdout?.destroy();
      // Pi RPC is long-lived. If we leave via abort/break without a 'done' event,
      // the process is still alive — kill it so exitPromise resolves and the
      // generator doesn't pin the ChildProcess via dangling 'close' / 'error' listeners.
      if (!gotDoneEvent && (signal?.aborted || streamError)) {
        processManager.killWithGrace(pid, 1_000).catch(() => {});
      }
    }

    await exitPromise;

    // streamError was already surfaced as an error event — don't double-report.
    if (streamErrorYielded && streamError) {
      const classified = classifyAdapterError(streamError.message, exitCode ?? undefined);
      throw Object.assign(streamError, { errorKind: classified });
    }

    const spawnError = exitError as Error | null;
    if (spawnError && !signal?.aborted && !gotDoneEvent) {
      const message = appendStderrTail(spawnError.message, 'pi', stderrTail());
      const classified = classifyAdapterError(message, exitCode ?? undefined);
      throw Object.assign(new Error(message), { errorKind: classified });
    }
    if (exitCode !== 0 && exitCode !== null && !signal?.aborted && !gotDoneEvent) {
      const baseMsg = `Pi process exited with code ${exitCode}`;
      const message = appendStderrTail(baseMsg, 'pi', stderrTail());
      const classified = classifyAdapterError(message, exitCode);
      throw Object.assign(new Error(message), { errorKind: classified });
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
  completion?: PiCompletion;
  settled?: boolean;
}

interface PiCompletion {
  result: string;
  raw: Record<string, unknown>;
  tokens?: TokenUsage;
  waitForSettled: boolean;
  failure?: {
    message: string;
    errorKind: ReturnType<typeof classifyAdapterError>;
  };
}

class PiTerminalError extends Error {
  constructor(
    message: string,
    readonly errorKind: ReturnType<typeof classifyAdapterError>,
  ) {
    super(message);
    this.name = 'PiTerminalError';
  }
}

function parsePiRpcEvent(line: string, state: ParseState): ParsedPiEvent | null {
  if (!line.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { agentEvent: { type: 'output', timestamp: new Date().toISOString(), data: { text: line } } };
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
      return extractPassiveUpdate(parsed);

    case 'response': {
      if (parsed.success === false) {
        const message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed);
        return {
          completion: {
            result: '',
            raw: parsed,
            waitForSettled: false,
            failure: {
              message,
              errorKind: classifyAdapterError(message),
            },
          },
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
      // Intermediate progress: pi emits one of these per chunk of tool output
      // (e.g. streaming bash stdout). Other adapters don't surface this in
      // their event streams — drop it so the canonical contract holds.
      return null;

    case 'tool_execution_end':
      return parseToolExecutionEnd(parsed, timestamp);

    case 'agent_end': {
      const completion = parsePiCompletion(parsed, state);
      return {
        finalText: completion.result,
        tokens: completion.tokens,
        completion,
      };
    }

    case 'agent_settled':
      return { settled: true };

    case 'extension_error': {
      const message = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed);
      return {
        agentEvent: { type: 'error', timestamp, data: { message, raw: parsed }, errorKind: classifyAdapterError(message) },
      };
    }

    default:
      // Unknown pi event types are silently dropped: they would otherwise
      // pollute logs with raw RPC envelopes the renderer can't summarize.
      // Adding a known type above is the right way to surface a new event.
      return null;
  }
}

function parseMessageUpdate(parsed: Record<string, unknown>, timestamp: string, state: ParseState): ParsedPiEvent | null {
  const assistantMessageEvent = parsed.assistantMessageEvent as Record<string, unknown> | undefined;
  const updateType = typeof assistantMessageEvent?.type === 'string' ? assistantMessageEvent.type : '';

  if (updateType === 'text_delta') {
    // Aggregate deltas into state.finalText; emit nothing here. A long LLM
    // response is hundreds of deltas — flushing one event per delta floods
    // the activity feed with character-level fragments. text_end emits the
    // full message in one canonical `output` event below.
    const delta = typeof assistantMessageEvent?.delta === 'string' ? assistantMessageEvent.delta : '';
    return { finalText: state.finalText + delta };
  }

  if (updateType === 'text_end') {
    const content = typeof assistantMessageEvent?.content === 'string' ? assistantMessageEvent.content : state.finalText;
    // Reset the delta buffer so a follow-up assistant message in the same pi
    // session doesn't get concatenated onto this one (agent_end uses its own
    // messages[] extraction, not state.finalText, so this is safe to drop).
    if (!content) return { finalText: '' };
    return {
      finalText: '',
      agentEvent: { type: 'output', timestamp, data: { text: content } },
    };
  }

  if (updateType === 'error') {
    const errorMessage = extractPiMessageError(assistantMessageEvent?.error)
      ?? extractPiMessageError(parsed.message)
      ?? (typeof assistantMessageEvent?.reason === 'string' ? assistantMessageEvent.reason : undefined)
      ?? JSON.stringify(parsed);
    return {
      agentEvent: {
        type: 'error',
        timestamp,
        data: { message: errorMessage, raw: parsed },
        errorKind: classifyAdapterError(errorMessage),
      },
    };
  }

  return null;
}

function parseToolExecutionEnd(parsed: Record<string, unknown>, timestamp: string): ParsedPiEvent {
  const toolName = typeof parsed.toolName === 'string' ? parsed.toolName : '';
  const args = parsed.args as Record<string, unknown> | undefined;
  const resultText = extractToolResultText(parsed.result);

  if (parsed.isError === true) {
    const message = resultText || JSON.stringify(parsed.result ?? parsed);
    return {
      agentEvent: { type: 'error', timestamp, data: { message, raw: parsed }, errorKind: classifyAdapterError(message) },
    };
  }

  if (toolName === 'bash') {
    const command = typeof args?.command === 'string' ? args.command : JSON.stringify(args ?? {});
    return {
      agentEvent: {
        type: 'command',
        timestamp,
        data: { command, result: resultText, raw: parsed },
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

  // Generic tool result (read, grep, ls, …) — surface the result text so logs
  // show what came back, not the raw RPC envelope.
  const summary = resultText || `${toolName || 'tool'} completed`;
  return { agentEvent: { type: 'output', timestamp, data: { text: summary, raw: parsed } } };
}

/** Pi tool results wrap content arrays in `{ content: [...] }`; messages don't. */
function extractToolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  return extractTextFromContent((result as { content?: unknown }).content) ?? '';
}

function extractPassiveUpdate(parsed: Record<string, unknown>): ParsedPiEvent | null {
  const tokens = extractPiTokensFromMessage(parsed);
  return tokens ? { tokens } : null;
}

function parsePiCompletion(parsed: Record<string, unknown>, state: ParseState): PiCompletion {
  const assistantMessage = extractLastAssistantMessage(parsed);
  const result = extractTextFromContent(assistantMessage?.content) ?? state.finalText;
  const tokens = extractPiTokensFromMessage(assistantMessage ?? {}) ?? state.lastTokens;
  const stopReason = typeof assistantMessage?.stopReason === 'string'
    ? assistantMessage.stopReason
    : undefined;
  const errorMessage = typeof assistantMessage?.errorMessage === 'string'
    ? assistantMessage.errorMessage.trim()
    : '';

  const completion: PiCompletion = {
    result,
    raw: parsed,
    tokens,
    // Current Pi RPC emits agent_settled after agent_end and exposes
    // willRetry on agent_end. Older Pi versions have neither field, where
    // agent_end remains the terminal event.
    waitForSettled: Object.prototype.hasOwnProperty.call(parsed, 'willRetry'),
  };

  if (stopReason === 'error' || stopReason === 'aborted') {
    const message = errorMessage || result || `Pi agent stopped with reason: ${stopReason}`;
    completion.failure = {
      message,
      errorKind: classifyAdapterError(message),
    };
  }

  return completion;
}

function toTerminalPiEvent(completion: PiCompletion): {
  event: AgentEvent;
  error?: PiTerminalError;
} {
  const timestamp = new Date().toISOString();
  if (completion.failure) {
    const { message, errorKind } = completion.failure;
    return {
      event: {
        type: 'error',
        timestamp,
        data: { message, raw: completion.raw },
        errorKind,
      },
      error: new PiTerminalError(message, errorKind),
    };
  }

  return {
    event: {
      type: 'done',
      timestamp,
      data: { result: completion.result, raw: completion.raw },
      tokens: completion.tokens,
    },
  };
}

function extractLastAssistantMessage(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const messages = parsed.messages;
  if (!Array.isArray(messages)) return undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Record<string, unknown>;
    if (message.role === 'assistant') return message;
  }
  return undefined;
}

function extractPiMessageError(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.errorMessage === 'string' && record.errorMessage.trim()) {
    return record.errorMessage.trim();
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

// Pi exposes usage under multiple key shapes across versions and across the
// `message_*` vs `agent_end` paths — Pi-native names, snake_case shims, and
// Anthropic-style names when Pi forwards Claude usage records unchanged.
// First match per field wins, in this order.
const PI_TOKEN_ALIASES: Record<'input' | 'output' | 'reasoning' | 'cache_read' | 'cache_write', readonly string[]> = {
  input:       ['input', 'input_tokens'],
  output:      ['output', 'output_tokens'],
  reasoning:   ['reasoning', 'reasoning_tokens'],
  cache_read:  ['cacheRead', 'cache_read', 'cache_read_input_tokens'],
  cache_write: ['cacheWrite', 'cache_write', 'cache_creation_input_tokens'],
};

function extractPiTokensFromMessage(parsed: Record<string, unknown>): TokenUsage | undefined {
  const usage = parsed.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const pick = (keys: readonly string[]): number => {
    for (const k of keys) {
      const v = usage[k];
      if (typeof v === 'number') return v;
    }
    return 0;
  };

  const input = pick(PI_TOKEN_ALIASES.input);
  const output = pick(PI_TOKEN_ALIASES.output);
  const reasoning = pick(PI_TOKEN_ALIASES.reasoning);
  const cache_read = pick(PI_TOKEN_ALIASES.cache_read);
  const cache_write = pick(PI_TOKEN_ALIASES.cache_write);

  if (input === 0 && output === 0 && reasoning === 0 && cache_read === 0 && cache_write === 0) return undefined;
  return createTokenUsage(input, output, { reasoning, cache_read, cache_write });
}

/**
 * Pi RPC can emit very large JSONL records (notably agent_end with the full
 * message transcript). Do not use the generic process `readLines` helper: it
 * caps lines at 16 KB, which corrupts large JSON records before the adapter
 * can parse the terminal event. Same algorithm otherwise — see readLines() in
 * src/infrastructure/process/process-manager.ts for the cap-applied variant.
 *
 * Concats once per chunk arrival and scans with an offset to avoid the
 * O(n²) "concat([pending, buf]) per chunk" anti-pattern.
 */
async function* readPiRpcLines(stream: Readable): AsyncGenerator<string> {
  const chunks: Buffer[] = [];
  let totalLen = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, 'utf-8');
    if (buf.length === 0) continue;
    chunks.push(buf);
    totalLen += buf.length;

    const buffer = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    chunks.length = 0;
    totalLen = 0;

    let offset = 0;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf(0x0a, offset)) !== -1) {
      if (newlineIdx > offset) {
        const line = buffer.toString('utf-8', offset, newlineIdx);
        yield line.endsWith('\r') ? line.slice(0, -1) : line;
      }
      offset = newlineIdx + 1;
    }

    if (offset < buffer.length) {
      const remainder = buffer.subarray(offset);
      chunks.push(remainder);
      totalLen = remainder.length;
    }
  }

  if (totalLen > 0) {
    const final = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, totalLen);
    const line = final.toString('utf-8');
    if (line) yield line.endsWith('\r') ? line.slice(0, -1) : line;
  }
}
