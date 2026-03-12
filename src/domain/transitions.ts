/**
 * Task state machine — pure functions, no side effects.
 *
 * State diagram:
 *   todo → in_progress → review → done
 *                      ↘ done (auto-approve)
 *                      ↘ retrying → in_progress
 *                      ↘ failed (max attempts)
 *   review → todo (rejected)
 *   * → cancelled
 */

import type { Task, TaskStatus } from './task.js';

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['done', 'review', 'retrying', 'failed', 'cancelled'],
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
 * Check if a task status is terminal (no further transitions expected).
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
 * Determine the next status after an agent completes or fails.
 *
 * Note: The `success=false` branch (retrying/failed) is reserved for future use.
 * Currently, failures are routed through `Orchestrator._handleRunFailure()` which
 * manages retry logic independently. This branch is kept for direct callers that
 * need to resolve completion status without orchestrator context.
 */
export function resolveCompletionStatus(
  task: Task,
  success: boolean,
  autoApprove: boolean,
): TaskStatus {
  if (success) {
    return autoApprove ? 'done' : 'review';
  }

  if (task.attempts < task.max_attempts) {
    return 'retrying';
  }

  return 'failed';
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
