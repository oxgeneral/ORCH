/**
 * Orchestrator runtime state.
 *
 * Persisted in .orchestry/state.json.
 * Updated on every mutation. Not intended for git.
 */

export interface RunningEntry {
  run_id: string;
  agent_id: string;
  task_id: string;
  pid: number;
  started_at: string;
  last_event_at: string;
}

export interface RetryEntry {
  task_id: string;
  attempt: number;
  due_at: string;
  error: string;
}

export interface OrchestratorState {
  version: 1;
  pid?: number;
  started_at?: string;
  onboardingCompleted?: boolean;
  running: Record<string, RunningEntry>;
  claimed: Set<string>;
  retry_queue: RetryEntry[];
  stats: {
    total_runs: number;
    total_tasks_completed: number;
    total_tasks_failed: number;
    total_tokens: { input: number; output: number; reasoning: number; total: number; cache_read: number; cache_write: number };
    total_runtime_ms: number;
  };
}

export const DEFAULT_STATE: OrchestratorState = {
  version: 1,
  onboardingCompleted: false,
  running: {},
  claimed: new Set<string>(),
  retry_queue: [],
  stats: {
    total_runs: 0,
    total_tasks_completed: 0,
    total_tasks_failed: 0,
    total_tokens: { input: 0, output: 0, reasoning: 0, total: 0, cache_read: 0, cache_write: 0 },
    total_runtime_ms: 0,
  },
};
