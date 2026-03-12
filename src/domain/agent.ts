/**
 * Agent domain model.
 *
 * An Agent is a configured AI tool (Claude, Codex, Shell, etc.)
 * that can be assigned to execute Tasks.
 */

export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';

export type ApprovalPolicy = 'suggest' | 'auto' | 'manual';

export interface AgentConfig {
  command?: string;
  model?: string;
  approval_policy?: ApprovalPolicy;
  max_turns?: number;
  timeout_ms?: number;
  stall_timeout_ms?: number;
  env?: Record<string, string>;
  system_prompt?: string;
  workspace_mode?: WorkspaceMode;
  skills?: string[];
}

export interface AgentStats {
  tasks_completed: number;
  tasks_failed: number;
  total_runs: number;
  total_runtime_ms: number;
  tokens_used?: number;
}

export interface Agent {
  id: string;
  name: string;
  adapter: string;
  role?: string;
  config: AgentConfig;
  status: AgentStatus;
  current_task?: string;
  autonomous?: boolean;
  stats: AgentStats;
}

export interface CreateAgentInput {
  name: string;
  adapter: string;
  role?: string;
  command?: string;
  model?: string;
  approval_policy?: ApprovalPolicy;
  max_turns?: number;
  timeout_ms?: number;
  stall_timeout_ms?: number;
  env?: Record<string, string>;
  system_prompt?: string;
  workspace_mode?: WorkspaceMode;
  skills?: string[];
}

// Re-export for convenience (used in AgentConfig)
import type { WorkspaceMode } from './task.js';
export type { WorkspaceMode };
