/**
 * Orchestrator event system.
 *
 * All communication between layers goes through typed events.
 * The EventBus emits these synchronously; subscribers (TUI, logger,
 * run store, state) react independently.
 */

import type { Task, TaskStatus, ReviewResult } from './task.js';

export type OrchestratorEvent =
  | { type: 'task:created'; task: Task }
  | { type: 'task:assigned'; taskId: string; agentId: string }
  | { type: 'task:status_changed'; taskId: string; from: TaskStatus; to: TaskStatus }
  | { type: 'task:auto_reviewed'; taskId: string; passed: boolean; results: ReviewResult[] }
  | { type: 'agent:started'; agentId: string; taskId: string; runId: string }
  | { type: 'agent:output'; runId: string; agentId: string; data: string }
  | { type: 'agent:file_changed'; runId: string; agentId: string; path: string }
  | { type: 'agent:completed'; runId: string; agentId: string; success: boolean }
  | { type: 'agent:error'; runId: string; agentId: string; error: string }
  | { type: 'run:retry'; runId: string; attempt: number; delay_ms: number }
  | { type: 'orchestrator:tick'; running: number; queued: number }
  | { type: 'orchestrator:stall_detected'; runId: string }
  | { type: 'task:scope_overlap'; taskId: string; overlappingTaskId: string; patterns: string[] }
  | { type: 'workspace:merge_succeeded'; taskId: string; branch: string }
  | { type: 'workspace:merge_conflict'; taskId: string; branch: string; conflictInfo: string };

export type OrchestratorEventType = OrchestratorEvent['type'];

/**
 * Extract event payload by type discriminator.
 */
export type EventPayload<T extends OrchestratorEventType> = Extract<
  OrchestratorEvent,
  { type: T }
>;
