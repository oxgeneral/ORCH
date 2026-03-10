/**
 * Agent adapter interface.
 *
 * Every AI tool (Claude, Codex, Shell, etc.) implements this contract.
 * execute() returns an AsyncGenerator for pull-based streaming of events.
 */

import type { AgentConfig } from '../../domain/agent.js';

export interface AdapterTestResult {
  ok: boolean;
  version?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ExecuteParams {
  prompt: string;
  workspace: string;
  env?: Record<string, string>;
  config: AgentConfig;
  signal?: AbortSignal;
}

export interface AgentEvent {
  type: 'output' | 'file_change' | 'command' | 'tool_call' | 'error' | 'done';
  timestamp: string;
  data: unknown;
  tokens?: { input: number; output: number; total: number };
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
