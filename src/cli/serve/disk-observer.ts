/**
 * Disk-based observer for cross-process TUI event delivery.
 *
 * When `orch tui` cannot acquire the orchestrator lock (another process
 * owns it, e.g. `orch run --watch` or `orch serve`), this observer polls
 * `.orchestry/state.json` and tails `.orchestry/runs/<id>.jsonl` files
 * to synthesize OrchestratorEvents that feed the same TUI pipeline.
 *
 * The result: TUI shows real-time activity (logs, file changes, status
 * transitions) even when orchestration runs in a separate process.
 */

import { open } from 'node:fs/promises';
import type { OrchestratorEvent } from '../../domain/events.js';
import type { RunEvent } from '../../domain/run.js';
import type { RunningEntry, OrchestratorState } from '../../domain/state.js';
import type { IStateStore } from '../../infrastructure/storage/interfaces.js';
import type { Paths } from '../../infrastructure/storage/paths.js';
import { readJson } from '../../infrastructure/storage/fs-utils.js';
import type { Run } from '../../domain/run.js';

/** How long to keep offset entries after a run disappears from state */
const EVICTION_TTL_MS = 5 * 60_000;

/** Max bytes to read from a single JSONL file per poll tick */
const MAX_READ_PER_TICK = 512 * 1024;

/** Max remainder size before discarding (prevents unbounded growth on stalled writes) */
const MAX_REMAINDER_LEN = 64 * 1024;

export interface DiskObserverOptions {
  paths: Paths;
  stateStore: IStateStore;
  pollIntervalMs?: number;
}

interface TrackedRun {
  runId: string;
  agentId: string;
  taskId: string;
  offset: number;
  remainder: string;
  lastSeenAt: number;
}

export class DiskObserver {
  private readonly pollIntervalMs: number;
  private handler: ((event: OrchestratorEvent) => void) | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  /** Byte offsets and metadata for each tracked run */
  private tracked = new Map<string, TrackedRun>();
  /** Previous tick's running map for diff detection */
  private prevRunning = new Map<string, RunningEntry>();
  /** Previous state.pid — detect orchestrator restart */
  private prevPid: number | undefined;
  /** Guard against concurrent poll() executions */
  private isPolling = false;

  constructor(private readonly opts: DiskObserverOptions) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
  }

  /**
   * Start observing. Returns an unsubscribe function.
   * Signature matches `eventBus.onAny(handler)` for seamless TUI integration.
   */
  subscribe(handler: (event: OrchestratorEvent) => void): () => void {
    this.handler = handler;
    if (!this.intervalHandle) {
      // Fire immediately, then at interval
      this.poll().catch(() => {});
      this.intervalHandle = setInterval(() => { this.poll().catch(() => {}); }, this.pollIntervalMs);
    }
    return () => {
      this.handler = null;
      this.stop();
    };
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private emit(event: OrchestratorEvent): void {
    try { this.handler?.(event); } catch { /* handler error — don't crash observer */ }
  }

  private async poll(): Promise<void> {
    if (!this.handler || this.isPolling) return;
    this.isPolling = true;
    try {
      await this.doPoll();
    } finally {
      this.isPolling = false;
    }
  }

  private async doPoll(): Promise<void> {
    let state: OrchestratorState;
    try {
      state = await this.opts.stateStore.read();
    } catch {
      return; // state.json unreadable — skip tick
    }

    const now = Date.now();
    const currentRunIds = new Set(Object.keys(state.running));

    // ── Detect orchestrator restart — reset all tracked runs ──
    if (this.prevPid !== undefined && state.pid !== undefined && state.pid !== this.prevPid) {
      this.tracked.clear();
      this.prevRunning.clear();
    }

    // ── Detect new runs ──
    for (const [runId, entry] of Object.entries(state.running)) {
      const existing = this.tracked.get(runId);
      if (existing) {
        existing.lastSeenAt = now;
        continue;
      }
      // New run appeared — start tracking
      this.tracked.set(runId, {
        runId,
        agentId: entry.agent_id,
        taskId: entry.task_id,
        offset: 0,
        remainder: '',
        lastSeenAt: now,
      });
      this.emit({ type: 'agent:started', agentId: entry.agent_id, taskId: entry.task_id, runId });
    }

    // ── Detect completed runs ──
    for (const [runId, prevEntry] of this.prevRunning) {
      if (currentRunIds.has(runId)) continue;
      // Run disappeared — drain remaining events, then emit completed
      const tr = this.tracked.get(runId);
      if (tr) {
        await this.tailRunEvents(tr);
      }

      const run = await readJson<Run>(this.opts.paths.runPath(runId)).catch(() => null);
      const success = run?.status === 'succeeded';
      this.emit({ type: 'agent:completed', runId, agentId: prevEntry.agent_id, success });
      if (run?.task_id) {
        const to = success ? 'review' : 'failed';
        this.emit({ type: 'task:status_changed', taskId: run.task_id, from: 'in_progress', to });
      }
    }

    // ── Tail active runs ──
    for (const tr of this.tracked.values()) {
      if (!currentRunIds.has(tr.runId)) continue;
      await this.tailRunEvents(tr);
    }

    // ── Emit synthetic tick ──
    const running = Object.keys(state.running).length;
    if (running > 0) {
      this.emit({ type: 'orchestrator:tick', running, queued: 0 });
    }

    // ── Update prev snapshot ──
    this.prevRunning = new Map(Object.entries(state.running));
    this.prevPid = state.pid;

    // ── Evict stale tracked entries ──
    for (const [runId, tr] of this.tracked) {
      if (!currentRunIds.has(runId) && now - tr.lastSeenAt > EVICTION_TTL_MS) {
        this.tracked.delete(runId);
      }
    }
  }

  private async tailRunEvents(tr: TrackedRun): Promise<void> {
    const filePath = this.opts.paths.runEventsPath(tr.runId);
    let fd: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fd = await open(filePath, 'r');
      const stat = await fd.stat();
      if (stat.size <= tr.offset) return; // no new bytes

      const bytesToRead = Math.min(stat.size - tr.offset, MAX_READ_PER_TICK);
      const buf = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await fd.read(buf, 0, bytesToRead, tr.offset);
      if (bytesRead === 0) return;

      const chunk = tr.remainder + buf.subarray(0, bytesRead).toString('utf8');

      // Split into lines; last element may be partial (no trailing newline)
      const lines = chunk.split('\n');
      const lastLine = lines.pop() ?? '';

      // If the chunk ended mid-line, keep remainder for next tick
      if (chunk.endsWith('\n')) {
        tr.remainder = '';
        tr.offset += bytesRead;
      } else {
        // Cap remainder to prevent unbounded growth on stalled writes
        tr.remainder = lastLine.length > MAX_REMAINDER_LEN ? '' : lastLine;
        // Advance offset past all complete lines only
        const remainderBytes = tr.remainder ? Buffer.byteLength(lastLine, 'utf8') : 0;
        tr.offset += bytesRead - remainderBytes;
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const runEvent = JSON.parse(trimmed) as RunEvent;
          const orchEvent = this.translateEvent(runEvent, tr);
          if (orchEvent) this.emit(orchEvent);
        } catch {
          // Corrupt JSONL line — skip
        }
      }
    } catch {
      // File not yet created or read error — skip
    } finally {
      await fd?.close().catch(() => {});
    }
  }

  private translateEvent(event: RunEvent, tr: TrackedRun): OrchestratorEvent | null {
    switch (event.type) {
      case 'agent_output': {
        const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        return { type: 'agent:output', runId: tr.runId, agentId: tr.agentId, data };
      }
      case 'file_changed': {
        const path = typeof event.data === 'string'
          ? event.data
          : (event.data as Record<string, unknown>)?.path as string ?? '';
        return { type: 'agent:file_changed', runId: tr.runId, agentId: tr.agentId, path };
      }
      case 'error': {
        const error = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        return { type: 'agent:error', runId: tr.runId, agentId: tr.agentId, error };
      }
      case 'tool_call':
      case 'command_run': {
        const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        return { type: 'agent:output', runId: tr.runId, agentId: tr.agentId, data };
      }
      case 'done':
        // Lifecycle handled by state diff — avoid duplicate
        return null;
      default:
        return null;
    }
  }
}
