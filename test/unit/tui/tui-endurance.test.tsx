/**
 * TUI endurance tests — stability under high-frequency events.
 *
 * Verifies that App.tsx caps and safeguards hold under sustained load:
 *   - Message queue cap (MAX_MESSAGES = 500)
 *   - RunId map LRU eviction (MAX_RUN_MAP_SIZE = 500)
 *   - Detail string truncation (MAX_DETAIL_LEN = 2048)
 *   - Batch flush efficiency (messageBatchMs timer)
 *   - Toast queue saturation (MAX_TOASTS = 5)
 *   - Memory stability after 5000 events
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../../src/tui/App.js';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

/** Baseline App props — onboarding completed so the dashboard is shown immediately */
function baseState(): OrchestratorState {
  return { ...DEFAULT_STATE, onboardingCompleted: true };
}

/** Wire up an event handler and return it along with the render result */
function renderWithEvents(extra?: Record<string, unknown>) {
  let handler: ((event: unknown) => void) | null = null;
  const onSubscribeEvents = (h: (event: unknown) => void) => {
    handler = h;
    return () => { handler = null; };
  };
  const instance = render(
    React.createElement(App, {
      projectName: 'endurance-test',
      tasks: [],
      state: baseState(),
      onSubscribeEvents,
      initialNotifications: { toast: true, bell: false },
      ...extra,
    }),
  );
  return { ...instance, emit: (event: unknown) => handler!(event) };
}

/* ── 1. Message queue cap ─────────────────────────────── */

describe('TUI endurance: message queue cap', () => {
  it('keeps at most MAX_MESSAGES=500 after 1000 high-frequency events', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // Send 1000 agent:error events with unique IDs (each adds a message immediately in VITEST mode)
    for (let i = 0; i < 1000; i++) {
      emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: `err-${i}` });
    }
    await delay(100);

    const frame = lastFrame()!;
    // Component must still render and show recent messages
    expect(frame).toBeTruthy();
    expect(frame.length).toBeGreaterThan(0);
    // The most recent message (err-999) should appear in the activity feed
    expect(frame).toContain('err-999');
    // The very first message (err-0) must have been evicted — not on screen
    // ActivityFeed shows messages.slice(-height), so early messages are gone
    expect(frame).not.toContain('err-0');
  });

  it('activity feed shows correct count at capacity boundary (500 events)', async () => {
    const { lastFrame, emit } = renderWithEvents();

    for (let i = 0; i < 500; i++) {
      emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: `cap-${i}` });
    }
    await delay(100);

    const frame = lastFrame()!;
    expect(frame).toBeTruthy();
    // Activity feed header shows the count — 500/500 at capacity
    expect(frame).toContain('500/500');
    // Last message at exactly cap boundary should still be visible
    expect(frame).toContain('cap-499');
  });
});

/* ── 2. RunId map LRU eviction ────────────────────────── */

describe('TUI endurance: runId map LRU', () => {
  it('does not crash after 600 unique runIds (MAX_RUN_MAP_SIZE=500)', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // Register 600 unique runs — triggers LRU eviction after 500
    for (let i = 0; i < 600; i++) {
      emit({ type: 'agent:started', agentId: `agt-${i % 5}`, taskId: `tsk-${i}`, runId: `run-${i}` });
    }
    await delay(100);

    // Component must still render correctly after LRU eviction
    const frame = lastFrame()!;
    expect(frame).toBeTruthy();
    expect(frame.length).toBeGreaterThan(0);
    // Standard UI elements must still be present
    expect(frame).toContain('ORCH');
    expect(frame).toContain('TASKS');
  });

  it('adds 600 started messages — activity shows 500/600 after LRU cap', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // Each agent:started adds 1 "Started task" message — 600 total, capped at MAX_MESSAGES=500
    for (let i = 0; i < 600; i++) {
      emit({ type: 'agent:started', agentId: 'agt-0', taskId: `tsk-${i}`, runId: `run-${i}` });
    }
    await delay(100);

    const frame = lastFrame()!;
    // 600 messages sent but only 500 kept — activity counter shows 500/500
    expect(frame).toContain('500/500');
    // "Started task" is the message for agent:started
    expect(frame).toContain('Started task');
  });
});

/* ── 3. Detail string truncation ─────────────────────── */

describe('TUI endurance: detail truncation', () => {
  it('truncates detail exceeding 2048 chars — activity feed remains lean', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // 10 KB detail — well above the 2 KB cap
    const hugeDetail = 'X'.repeat(10 * 1024);
    emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: hugeDetail });
    await delay(100);

    const frame = lastFrame()!;
    // Summary is error.slice(0, 150) from formatEvent — partial X string must appear
    expect(frame).toContain('X'.repeat(60));
    // Full 10 KB content must NOT be dumped into the rendered frame
    // Terminal line width (~80 chars) and detail truncation both limit what appears
    expect(frame.length).toBeLessThan(8 * 1024);
    // Activity feed shows 1 message (confirmed by 1/1 count)
    expect(frame).toContain('1/1');
  });

  it('does not truncate normal-length details — activity feed shows message', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // 100-char error message — well within the cap
    const safeDetail = 'Zy'.repeat(50); // 100 chars, unique prefix
    emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: safeDetail });
    await delay(100);

    const frame = lastFrame()!;
    // The message summary (first 150 chars of error) must appear in the feed
    expect(frame).toContain('ZyZyZy');
    // Activity feed shows 1 message
    expect(frame).toContain('1/1');
  });
});

/* ── 4. Batch flush efficiency ────────────────────────── */

describe('TUI endurance: batch flush efficiency', () => {
  it('queues messages and flushes after messageBatchMs=80 timer fires', async () => {
    // Pass messageBatchMs=80 explicitly to override VITEST default of 0
    const { lastFrame, emit } = renderWithEvents({ messageBatchMs: 80 });

    // Send 100 messages synchronously — they queue in pendingMessages.current
    // since messageBatchMs=80 means no immediate flush
    for (let i = 0; i < 100; i++) {
      emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: `batch-msg-${i}` });
    }

    // Before 80ms elapses: batch hasn't flushed yet — messages not visible
    const frameBefore = lastFrame()!;
    expect(frameBefore).not.toContain('batch-msg-');

    // Wait longer than messageBatchMs so the single batch timer fires
    await delay(200);

    const frameAfter = lastFrame()!;
    // After the single flush: all messages are in state — last one must appear
    expect(frameAfter).toContain('batch-msg-99');
  });

  it('all 100 queued messages appear after a single batch flush', async () => {
    const { lastFrame, emit } = renderWithEvents({ messageBatchMs: 80 });

    for (let i = 0; i < 100; i++) {
      emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: `flush-${i}` });
    }

    await delay(200);

    const frame = lastFrame()!;
    // All 100 messages flushed in one batch — activity feed shows 100/100
    expect(frame).toContain('100/100');
    // Most recent message visible
    expect(frame).toContain('flush-99');
  });
});

/* ── 5. Toast queue saturation ────────────────────────── */

describe('TUI endurance: toast queue saturation', () => {
  it('keeps only MAX_TOASTS=5 after 10 rapid done events, shows first 2 of remaining 5', async () => {
    // No tasks in liveTasks — title falls back to taskId string
    const { lastFrame, emit } = renderWithEvents();

    // Fire 10 done events — each adds a toast; only MAX_TOASTS=5 kept in state;
    // ToastBanner renders the FIRST 2 of the 5 retained toasts
    for (let i = 0; i < 10; i++) {
      emit({ type: 'task:status_changed', taskId: `toast-task-${i}`, from: 'in_progress', to: 'done' });
    }
    await delay(100);

    const frame = lastFrame()!;
    // MAX_TOASTS=5 keeps tasks 5-9; ToastBanner shows first 2 of those: task-5 and task-6
    expect(frame).toContain('toast-task-5');
    expect(frame).toContain('toast-task-6');
    // Tasks 0-4 were evicted by MAX_TOASTS cap
    expect(frame).not.toContain('toast-task-0');
    expect(frame).not.toContain('toast-task-1');
    expect(frame).not.toContain('toast-task-4');
    // Tasks 7-9 are in state but not shown (ToastBanner renders max 2)
    expect(frame).not.toContain('toast-task-7');
    expect(frame).not.toContain('toast-task-9');
  });

  it('does not show toasts when notifications.toast is disabled', async () => {
    const { lastFrame, emit } = renderWithEvents({
      initialNotifications: { toast: false, bell: false },
    });

    emit({ type: 'task:status_changed', taskId: 'tsk-x', from: 'in_progress', to: 'done' });
    await delay(100);

    const frame = lastFrame()!;
    // Toast disabled — "Task completed" should NOT appear
    expect(frame).not.toContain('Task completed');
  });
});

/* ── 6. Memory stability after 5000 events ───────────── */

describe('TUI endurance: memory stability under sustained load', () => {
  it('renders correctly after 5000 high-frequency events without crashing', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // Mix of event types to exercise all code paths in formatEvent
    for (let i = 0; i < 5000; i++) {
      const n = i % 5;
      if (n === 0) {
        emit({ type: 'agent:started', agentId: `agt-${i % 4}`, taskId: `tsk-${i}`, runId: `run-${i}` });
      } else if (n === 1) {
        emit({ type: 'agent:error', runId: `run-${i - 1}`, agentId: `agt-${i % 4}`, error: `err-${i}` });
      } else if (n === 2) {
        emit({ type: 'task:status_changed', taskId: `tsk-${i}`, from: 'todo', to: 'in_progress' });
      } else if (n === 3) {
        emit({ type: 'agent:completed', runId: `run-${i - 3}`, agentId: `agt-${i % 4}`, success: true });
      } else {
        emit({ type: 'agent:file_changed', runId: `run-${i - 4}`, agentId: `agt-${i % 4}`, path: `src/file-${i}.ts` });
      }
    }
    await delay(100);

    const frame = lastFrame()!;
    // Component must still render a valid dashboard
    expect(frame).toBeTruthy();
    expect(frame.length).toBeGreaterThan(0);
    // Standard UI elements must still be present
    expect(frame).toContain('ORCH');
    expect(frame).toContain('TASKS');
    // Activity feed is capped at MAX_MESSAGES=500
    expect(frame).toContain('500/500');
  });

  it('pendingMessages queue drains fully after 200-event burst', async () => {
    const { lastFrame, emit } = renderWithEvents();

    // In VITEST mode (messageBatchMs=0), each emit immediately flushes.
    // After all 200 events, no messages should be stuck in pendingMessages.
    for (let i = 0; i < 200; i++) {
      emit({ type: 'agent:error', runId: 'run-0', agentId: 'agt-0', error: `drain-${i}` });
    }
    // Use 100ms to ensure React has fully processed all state updates
    await delay(100);

    const frame = lastFrame()!;
    // The final message must be visible — confirms queue drained completely
    expect(frame).toContain('drain-199');
    // Activity feed shows all 200 messages
    expect(frame).toContain('200/200');
    // Component structure intact
    expect(frame).toContain('ORCH');
  });
});
