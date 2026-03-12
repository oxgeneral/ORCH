/**
 * Goal domain model.
 *
 * A Goal is a persistent objective that drives autonomous agent work.
 * Goals have lower priority than tasks — agents work on goals only
 * when no regular tasks are available.
 *
 * State machine: active → achieved | abandoned
 *                active ↔ paused
 */

export const GOAL_STATUSES = ['active', 'paused', 'achieved', 'abandoned'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

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
  created_at: string;
  updated_at?: string;
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  assignee?: string;
}
