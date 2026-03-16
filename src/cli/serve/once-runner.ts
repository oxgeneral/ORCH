/**
 * Once-mode runner for `orch serve --once`.
 *
 * Starts the orchestrator watch loop with autonomous seeding disabled,
 * polls for task completion, and stops the orchestrator when all tasks
 * reach a terminal status.
 */

import { isTerminal } from '../../domain/transitions.js';
import type { Task } from '../../domain/task.js';
import type { Orchestrator } from '../../application/orchestrator.js';
import type { ITaskStore } from '../../infrastructure/storage/interfaces.js';

export type OnceResult = 'all_done' | 'has_failed';

/**
 * Run all current todo tasks, then stop.
 *
 * 1. Disable autonomous seeding (prevents infinite [auto] tasks)
 * 2. Start the orchestrator watch loop
 * 3. Poll until all tasks are in terminal status (or empty)
 * 4. Stop the orchestrator
 * 5. Return result for exit code determination
 */
export async function runOnce(
  orchestrator: Orchestrator,
  taskStore: ITaskStore,
  pollIntervalMs = 2000,
): Promise<OnceResult> {
  orchestrator.skipAutonomousSeeding = true;

  // Start watch loop — resolves immediately after registering interval
  await orchestrator.startWatch();

  // Poll for completion
  const finalTasks = await waitForAllTerminal(taskStore, pollIntervalMs);

  // Stop the orchestrator gracefully
  await orchestrator.stop();

  const hasFailed = finalTasks.some((t) => t.status === 'failed');
  return hasFailed ? 'has_failed' : 'all_done';
}

async function waitForAllTerminal(taskStore: ITaskStore, pollIntervalMs: number): Promise<Task[]> {
  for (;;) {
    const tasks = await taskStore.list();

    // Empty task list — nothing to process, exit immediately
    if (tasks.length === 0) return tasks;

    // All tasks reached terminal status — done
    if (tasks.every((t) => isTerminal(t.status))) return tasks;

    // Keep polling
    await new Promise((r) => { setTimeout(r, pollIntervalMs); });
  }
}
