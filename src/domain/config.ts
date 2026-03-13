/**
 * Configuration domain model.
 *
 * Represents the structure of .orchestry/config.yml
 */

import type { ApprovalPolicy } from './agent.js';
import type { WorkspaceMode } from './task.js';

export interface ProjectConfig {
  name: string;
  description?: string;
}

export interface AgentDefaults {
  adapter: string;
  approval_policy: ApprovalPolicy;
  max_turns: number;
  timeout_ms: number;
  stall_timeout_ms: number;
  workspace_mode: WorkspaceMode;
}

export interface TaskDefaults {
  max_attempts: number;
  priority: number;
}

export interface SchedulingConfig {
  poll_interval_ms: number;
  max_concurrent_agents: number;
  retry_base_delay_ms: number;
  retry_max_delay_ms: number;
}

export interface OrchestratorConfig {
  project: ProjectConfig;
  defaults: {
    agent: AgentDefaults;
    task: TaskDefaults;
  };
  scheduling: SchedulingConfig;
  prompt?: {
    template?: string;
  };
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  project: {
    name: 'my-project',
  },
  defaults: {
    agent: {
      adapter: 'claude',
      approval_policy: 'auto',
      max_turns: 50,
      timeout_ms: 3_600_000,
      stall_timeout_ms: 300_000,
      workspace_mode: 'worktree',
    },
    task: {
      max_attempts: 3,
      priority: 3,
    },
  },
  scheduling: {
    poll_interval_ms: 30_000,
    max_concurrent_agents: 6,
    retry_base_delay_ms: 10_000,
    retry_max_delay_ms: 300_000,
  },
};
