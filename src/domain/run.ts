/**
 * Run domain model.
 *
 * A Run represents a single execution attempt of a Task by an Agent.
 * Events are stored in separate .jsonl files (append-only), not in memory.
 */

export type RunStatus =
  | 'preparing'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface Run {
  id: string;
  task_id: string;
  agent_id: string;
  attempt: number;
  status: RunStatus;
  started_at: string;
  finished_at?: string;
  workspace_path: string;
  prompt: string;
  pid?: number;
  error?: string;
  tokens?: TokenUsage;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/** Create TokenUsage with total always computed as input + output. */
export function createTokenUsage(input: number, output: number): TokenUsage {
  return { input, output, total: input + output };
}

export interface RunEvent {
  timestamp: string;
  type: RunEventType;
  data: unknown;
}

export type RunEventType =
  | 'agent_output'
  | 'file_changed'
  | 'command_run'
  | 'tool_call'
  | 'error'
  | 'done';
