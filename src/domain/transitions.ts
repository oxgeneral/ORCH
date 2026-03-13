/**
 * Task state machine — pure functions, no side effects.
 *
 * State diagram:
 *   todo → in_progress → review → done
 *                      ↘ retrying → in_progress
 *                      ↘ failed (max attempts)
 *   review → todo (rejected)
 *   * → cancelled
 *   failed → todo | retrying (manual reactivation)
 *   cancelled → todo (manual reactivation)
 *
 * Terminal statuses (done, failed, cancelled) are not auto-dispatched
 * by the orchestrator but may have manual outgoing transitions.
 */

import type { Task, TaskStatus } from './task.js';

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['review', 'retrying', 'failed', 'cancelled'],
  retrying: ['in_progress', 'failed', 'cancelled'],
  review: ['done', 'todo', 'cancelled'],
  done: [],
  failed: ['todo', 'retrying'],
  cancelled: ['todo'],
};

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled']);

/**
 * Check if a status transition is valid.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Check if a task status is terminal — the orchestrator will not
 * auto-dispatch or retry it. Terminal tasks may still have valid
 * manual transitions (e.g. cancelled → todo, failed → todo).
 */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Check if a task can be dispatched (ready for execution).
 */
export function isDispatchable(status: TaskStatus): boolean {
  return status === 'todo' || status === 'retrying';
}

/**
 * Check if a task is blocked by unfinished dependencies.
 */
export function isBlocked(task: Task, allTasks: Task[]): boolean {
  if (task.depends_on.length === 0) return false;

  return task.depends_on.some((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return !dep || dep.status !== 'done';
  });
}

/**
 * Determine the next status after a task failure (run error or shutdown).
 * Returns 'retrying' if attempts remain, 'failed' otherwise.
 */
export function resolveFailureStatus(task: Task): TaskStatus {
  if (task.attempts < task.max_attempts) {
    return 'retrying';
  }
  return 'failed';
}

/**
 * Determine the next status after an agent completes or fails.
 * Always goes through 'review' on success — autoApprove is handled
 * by the orchestrator which transitions review → done immediately.
 */
export function resolveCompletionStatus(
  task: Task,
  success: boolean,
  _autoApprove: boolean,
): TaskStatus {
  if (success) {
    return 'review';
  }

  return resolveFailureStatus(task);
}

/**
 * Calculate retry delay with exponential backoff and cap.
 */
export function calculateRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}
