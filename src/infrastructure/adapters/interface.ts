/**
 * Agent adapter interface.
 *
 * Every AI tool (Claude, Codex, Shell, etc.) implements this contract.
 * execute() returns an AsyncGenerator for pull-based streaming of events.
 */

import type { AgentConfig } from '../../domain/agent.js';
import type { AdapterErrorKind } from '../../domain/errors.js';

export interface AdapterTestResult {
  ok: boolean;
  version?: string;
  error?: string;
  errorKind?: AdapterErrorKind;
  details?: Record<string, unknown>;
}

export interface ExecuteParams {
  prompt: string;
  systemPrompt?: string;
  workspace: string;
  env?: Record<string, string>;
  config: AgentConfig;
  signal?: AbortSignal;
}

/**
 * Canonical `data` shape per AgentEvent type. Each adapter should emit `data`
 * that matches its event's row below so that downstream consumers (TUI logs,
 * `orch logs` CLI, serve daemon) can render events without knowing adapter
 * internals.
 *
 *   | type        | data shape                                        |
 *   |-------------|---------------------------------------------------|
 *   | output      | { text: string, raw?: unknown }                   |
 *   | tool_call   | { name: string, input?: unknown, raw?: unknown }  |
 *   | command     | { command: string, result?: unknown, raw?: unknown } |
 *   | file_change | { paths: string[], raw?: unknown }                |
 *   | error       | { message: string, raw?: unknown }                |
 *   | done        | { result?: string, raw?: unknown }                |
 *
 * - `raw` is an optional escape hatch for the full provider payload; logs
 *   renderers must not include it in the default summary.
 * - Adapters should emit ONE `output` per logical assistant message (per
 *   text-block or per turn), not per-character delta. Use adapter-local state
 *   to aggregate streaming deltas before emitting.
 * - Intermediate progress events (tool-in-flight, "thinking" pings) should be
 *   dropped at the adapter boundary — they belong in adapter-specific UIs,
 *   not in the orchestrator event stream.
 *
 * Existing adapters predate this contract and emit a variety of shapes
 * (claude/cursor: full `parsed.message`; codex: `item`). The TUI renderer
 * (`formatAgentOutput` in src/tui/App.tsx) is defensive and accepts both
 * canonical and legacy shapes during the migration window.
 */
export interface AgentEvent {
  type: 'output' | 'file_change' | 'command' | 'tool_call' | 'error' | 'done';
  timestamp: string;
  data: unknown;
  tokens?: { input: number; output: number; reasoning?: number; total: number; cache_read?: number; cache_write?: number };
  errorKind?: AdapterErrorKind;
}

export interface ExecuteHandle {
  pid: number;
  events: AsyncGenerator<AgentEvent>;
}

export interface IAgentAdapter {
  readonly kind: string;
  test(): Promise<AdapterTestResult>;
  execute(params: ExecuteParams): ExecuteHandle;
  stop(pid: number): Promise<void>;
}
