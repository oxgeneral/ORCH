/**
 * Once-mode runner for `orch serve --once`.
 *
 * Starts the orchestrator watch loop with autonomous seeding disabled,
 * polls for task completion, and stops the orchestrator when all tasks
 * reach a terminal status. Handles orchestrator shutdown events to
 * prevent infinite hangs if the orchestrator stops unexpectedly.
 */

import { isTerminal } from '../../domain/transitions.js';
import type { Task } from '../../domain/task.js';
import type { Orchestrator } from '../../application/orchestrator.js';
import type { ITaskStore } from '../../infrastructure/storage/interfaces.js';
import type { EventBus } from '../../application/event-bus.js';

export type OnceResult = 'all_done' | 'has_failed';

/**
 * Run all current todo tasks, then stop.
 *
 * 1. Start the orchestrator with autonomous seeding disabled
 * 2. Poll until all tasks are in terminal status (or orchestrator shuts down)
 * 3. Stop the orchestrator
 * 4. Return result for exit code determination
 */
export async function runOnce(
  orchestrator: Orchestrator,
  taskStore: ITaskStore,
  eventBus: EventBus,
  pollIntervalMs = 2000,
): Promise<OnceResult> {
  // Start watch loop with autonomous seeding disabled
  await orchestrator.startWatch({ skipAutonomousSeeding: true });

  // Listen for orchestrator shutdown (e.g. consecutive tick failures)
  // to avoid infinite polling if the orchestrator gives up
  let orchestratorStopped = false;
  const unsubShutdown = eventBus.on('orchestrator:shutdown', () => {
    orchestratorStopped = true;
  });

  try {
    // Poll for completion
    const finalTasks = await waitForAllTerminal(taskStore, pollIntervalMs, () => orchestratorStopped);

    // Stop the orchestrator gracefully
    await orchestrator.stop();

    const hasFailed = finalTasks.some((t) => t.status === 'failed');
    return hasFailed ? 'has_failed' : 'all_done';
  } finally {
    unsubShutdown();
  }
}

async function waitForAllTerminal(
  taskStore: ITaskStore,
  pollIntervalMs: number,
  isStopped: () => boolean,
): Promise<Task[]> {
  for (;;) {
    const tasks = await taskStore.list();

    // Empty task list — nothing to process, exit immediately
    if (tasks.length === 0) return tasks;

    // All tasks reached terminal status — done
    if (tasks.every((t) => isTerminal(t.status))) return tasks;

    // Orchestrator shut down unexpectedly — return current state
    if (isStopped()) return tasks;

    // Keep polling
    await new Promise((r) => { setTimeout(r, pollIntervalMs); });
  }
}
