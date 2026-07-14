/**
 * Goal domain model.
 *
 * A Goal is a persistent objective that drives autonomous agent work.
 * Goals have lower priority than tasks — agents work on goals only
 * when no regular tasks are available.
 *
 * State machine: active → achieved | abandoned | paused
 *                paused → active | achieved | abandoned
 */

export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'abandoned'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

import type { PersistedFailure } from './errors.js';

/** Terminal goal statuses — no further transitions possible. */
export const TERMINAL_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set(['achieved', 'abandoned']);

export function isGoalTerminal(status: GoalStatus): boolean {
  return TERMINAL_GOAL_STATUSES.has(status);
}

/** Canonical sort order for goal statuses. */
export const GOAL_STATUS_ORDER: Record<GoalStatus, number> = {
  active: 0,
  paused: 1,
  achieved: 2,
  abandoned: 3,
};

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  assignee?: string;
  orchestration?: GoalOrchestrationState;
  last_error?: PersistedFailure;
  created_at: string;
  updated_at?: string;
}

export type GoalOrchestrationPhase =
  | 'needs_analysis'
  | 'lead_analyzing'
  | 'workers_running'
  | 'lead_reviewing'
  | 'paused'
  | 'closed';

export interface GoalOrchestrationState {
  enabled: boolean;
  phase: GoalOrchestrationPhase;
  cycle: number;
  lead_agent_id?: string;
  last_lead_task_id?: string;
  last_review_task_id?: string;
  last_transition_at?: string;
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  assignee?: string;
}
