/**
 * Structured logger for `orch serve`.
 *
 * Transforms OrchestratorEvents into flat ServeEvent records
 * and writes them as JSON or human-readable text lines to one
 * or more output streams (stdout, log file).
 */

import type { OrchestratorEvent } from '../../domain/events.js';
import type { EventBus } from '../../application/event-bus.js';
import type { ServeLoggerOptions, ServeEvent, LogLevel } from './types.js';
import { sanitizeForPersistence, sanitizeText } from '../../infrastructure/security/redaction.js';

export class StructuredLogger {
  private tickCounter = 0;
  private readonly opts: ServeLoggerOptions;

  constructor(opts: ServeLoggerOptions) {
    this.opts = opts;
  }

  /**
   * Subscribe to all events on the bus.
   * Returns an unsubscribe function.
   */
  subscribe(eventBus: EventBus): () => void {
    return eventBus.onAny((event) => {
      const entry = this.transform(event);
      if (entry) this.write(entry);
    });
  }

  /**
   * Write a standalone log entry (e.g. serve:started, idle).
   */
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.write({
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    });
  }

  /**
   * Close non-stdout streams (file handles).
   */
  async flush(): Promise<void> {
    const closes = this.opts.streams
      .filter((s) => s !== process.stdout && s !== process.stderr)
      .map((s) => new Promise<void>((resolve) => {
        s.end(() => { resolve(); });
      }));
    await Promise.all(closes);
  }

  /**
   * Transform an OrchestratorEvent into a flat ServeEvent.
   * Returns null for events that should be suppressed.
   */
  private transform(event: OrchestratorEvent): ServeEvent | null {
    const ts = new Date().toISOString();

    switch (event.type) {
      case 'orchestrator:tick': {
        this.tickCounter++;
        const isIdle = event.running === 0 && event.queued === 0;
        // In non-verbose mode, only log every Nth idle tick
        if (!this.opts.verbose && isIdle && this.tickCounter % this.opts.idleLogInterval !== 0) {
          return null;
        }
        const heap_mb = +(process.memoryUsage().heapUsed / 1_048_576).toFixed(1);
        return { ts, level: 'info', event: event.type, running: event.running, queued: event.queued, heap_mb };
      }

      case 'orchestrator:shutdown':
        return { ts, level: 'info', event: event.type, reason: event.reason };

      case 'orchestrator:error':
        return {
          ts,
          level: event.fatal ? 'error' : 'warn',
          event: event.type,
          error: event.error,
          context: event.context,
          fatal: event.fatal,
        };

      case 'orchestrator:stall_detected':
        return { ts, level: 'warn', event: event.type, runId: event.runId };

      case 'agent:started':
        return { ts, level: 'info', event: event.type, agentId: event.agentId, taskId: event.taskId, runId: event.runId };

      case 'agent:completed':
        return { ts, level: event.success ? 'info' : 'warn', event: event.type, runId: event.runId, agentId: event.agentId, success: event.success };

      case 'agent:error':
        return { ts, level: 'error', event: event.type, runId: event.runId, agentId: event.agentId, error: event.error, errorKind: event.errorKind };

      case 'agent:output':
        if (!this.opts.verbose) return null;
        return { ts, level: 'debug', event: event.type, runId: event.runId, agentId: event.agentId, data: event.data.slice(0, 200) };

      case 'agent:file_changed':
        return { ts, level: 'info', event: event.type, runId: event.runId, agentId: event.agentId, path: event.path };

      case 'run:retry':
        return { ts, level: 'warn', event: event.type, runId: event.runId, attempt: event.attempt, delay_ms: event.delay_ms };

      case 'task:created':
        return { ts, level: 'info', event: event.type, taskId: event.task.id, title: event.task.title };

      case 'task:status_changed':
        return { ts, level: 'info', event: event.type, taskId: event.taskId, from: event.from, to: event.to };

      case 'task:auto_reviewed':
        return { ts, level: 'info', event: event.type, taskId: event.taskId, passed: event.passed };

      case 'task:error':
        return { ts, level: 'error', event: event.type, taskId: event.taskId, goalId: event.goalId, runId: event.runId, agentId: event.agentId, phase: event.phase, error: event.error, errorKind: event.errorKind, retryable: event.retryable };

      case 'goal:error':
        return { ts, level: 'error', event: event.type, goalId: event.goalId, taskId: event.taskId, runId: event.runId, agentId: event.agentId, phase: event.phase, error: event.error, retryable: event.retryable };

      case 'goal:phase_changed':
        return { ts, level: 'info', event: event.type, goalId: event.goalId, from: event.from, to: event.to, cycle: event.cycle };

      case 'goal:lead_task_created':
        return { ts, level: 'info', event: event.type, goalId: event.goalId, taskId: event.taskId, cycle: event.cycle, role: event.role };

      case 'workspace:merge_succeeded':
        return { ts, level: 'info', event: event.type, taskId: event.taskId, branch: event.branch };

      case 'workspace:merge_conflict':
        return { ts, level: 'warn', event: event.type, taskId: event.taskId, branch: event.branch, conflictInfo: event.conflictInfo };

      case 'task:orphaned':
        return { ts, level: 'warn', event: event.type, taskId: event.taskId };

      case 'task:scope_overlap':
        return { ts, level: 'warn', event: event.type, taskId: event.taskId, overlappingTaskId: event.overlappingTaskId, patterns: event.patterns };

      case 'task:cascade_failed':
        return { ts, level: 'warn', event: event.type, taskId: event.taskId, failedDependencyId: event.failedDependencyId, reason: event.reason };

      default:
        return null;
    }
  }

  private write(entry: ServeEvent): void {
    const sanitized = sanitizeForPersistence(entry) as ServeEvent;
    const line = this.opts.format === 'json'
      ? JSON.stringify(sanitized) + '\n'
      : this.formatText(sanitized);

    for (const stream of this.opts.streams) {
      stream.write(line);
    }
  }

  private formatText(entry: ServeEvent): string {
    const time = entry.ts.slice(11, 23); // HH:MM:SS.mmm
    const level = entry.level.toUpperCase().padEnd(5);
    const { ts: _ts, level: _level, event, ...rest } = entry;

    const fields = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');

    return sanitizeText(`${time} ${level} ${event}  ${fields}\n`);
  }
}
