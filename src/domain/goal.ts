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

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';

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
