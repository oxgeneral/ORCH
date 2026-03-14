/**
 * Tests for Detail Panel Resize hotkeys (+/=/-/M).
 * Checklist from QA task tsk_8ZRjGW7:
 *  1. +/= expand detail panel (list shrinks)
 *  2. - shrink detail panel (list grows)
 *  3. M toggles fullscreen detail (100% contentH)
 *  4. Min constraints: list >= 3, detail >= 4
 *  5. splitOffset preserved between tabs (T→A→T)
 *  6. Logs view not affected by +/-/M
 *  7. Scroll offsets clamp on resize
 *  8. +/- exit fullscreen when M is active
 *  9. Visual hint in divider
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: 'desc',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    adapter: 'claude',
    config: {},
    status: 'idle',
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

const state: OrchestratorState = { ...DEFAULT_STATE };

/* ── Test: item 9 — Visual hint in divider ──────────────────────── */

describe('Detail Panel Resize — visual hint in divider', () => {
  it('shows +/- resize │ M max hint when detail is open and not maximized', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One', description: 'some desc' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Open detail panel
    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('DETAIL');
    // Hint contains resize and M max parts
    expect(output).toContain('+/- resize');
    expect(output).toContain('M max');
  });

  it('shows +/- exit max hint when detail is maximized (M pressed)', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One', description: 'some desc' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Open detail, then press M to maximize
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    stdin.write('M');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('+/- exit max');
    // The resize │ M max part should not appear when maximized
    expect(output).not.toContain('M max');
  });
});

/* ── Test: item 3 — M toggle fullscreen ─────────────────────────── */

describe('Detail Panel Resize — M toggle fullscreen', () => {
  it('M toggles fullscreen and back to normal', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Open detail
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('+/- resize');

    // Maximize
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- exit max');

    // Toggle back
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- resize');
  });
});

/* ── Test: item 8 — +/- exit fullscreen ─────────────────────────── */

describe('Detail Panel Resize — +/- exit fullscreen when maximized', () => {
  it('+ key exits fullscreen mode', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- exit max');

    stdin.write('+');
    await delay(50);
    // Should exit fullscreen — hint reverts to resize
    expect(lastFrame()!).toContain('+/- resize');
  });

  it('= key exits fullscreen mode', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- exit max');

    stdin.write('=');
    await delay(50);
    expect(lastFrame()!).toContain('+/- resize');
  });

  it('- key exits fullscreen mode', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- exit max');

    stdin.write('-');
    await delay(50);
    expect(lastFrame()!).toContain('+/- resize');
  });
});

/* ── Test: item 6 — Logs view not affected ──────────────────────── */

describe('Detail Panel Resize — logs view not affected', () => {
  it('+/-/M keys do not crash in logs view and have no resize effect', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Switch to logs/actions view ('l' key)
    stdin.write('l');
    await delay(50);
    // Active tab is shown as "ACTIONS" in the header
    expect(lastFrame()!).toContain('ACTIONS');

    // These keys should be ignored in logs view
    stdin.write('+');
    await delay(30);
    stdin.write('-');
    await delay(30);
    stdin.write('M');
    await delay(30);

    // Still in logs/actions view, no crash
    expect(lastFrame()!).toContain('ACTIONS');
    // No resize hint should appear in logs view
    expect(lastFrame()!).not.toContain('+/- resize');
    expect(lastFrame()!).not.toContain('+/- exit max');
  });
});

/* ── Test: item 5 — splitOffset preserved between tabs ─────────── */

describe('Detail Panel Resize — splitOffset preserved between tabs', () => {
  it('isDetailMaximized state is preserved when switching T→A→T', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const agents = [makeAgent({ id: 'a1', name: 'Agent One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state }),
    );

    // Open task detail, maximize
    stdin.write('\r');
    await delay(50);
    stdin.write('M');
    await delay(50);
    expect(lastFrame()!).toContain('+/- exit max');

    // Close detail first (view switching requires !detailOpen)
    stdin.write('\x1B');
    await delay(50);
    expect(lastFrame()!).not.toContain('+/- exit max');

    // Switch to agents view
    stdin.write('a');
    await delay(50);
    expect(lastFrame()!).toContain('AGENTS');

    // Switch back to tasks view
    stdin.write('t');
    await delay(50);
    // Re-open detail to verify maximized state persists across tab switch
    stdin.write('\r');
    await delay(50);
    // isDetailMaximized state persists across tab switches
    expect(lastFrame()!).toContain('+/- exit max');
  });
});

/* ── Test: item 1/2 — +/= and - key press no crash ─────────────── */

describe('Detail Panel Resize — +/= and - key presses', () => {
  it('pressing + in task detail does not crash', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    // Multiple + presses - no crash, detail still open
    stdin.write('+');
    await delay(30);
    stdin.write('+');
    await delay(30);
    stdin.write('+');
    await delay(30);
    expect(lastFrame()!).toContain('DETAIL');
    expect(lastFrame()!).toContain('+/- resize');
  });

  it('pressing - in task detail does not crash', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    stdin.write('-');
    await delay(30);
    stdin.write('-');
    await delay(30);
    expect(lastFrame()!).toContain('DETAIL');
    expect(lastFrame()!).toContain('+/- resize');
  });

  it('pressing = (alias for +) in task detail does not crash', async () => {
    const tasks = [makeTask({ id: 't1', title: 'Task One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    stdin.write('=');
    await delay(30);
    expect(lastFrame()!).toContain('DETAIL');
  });
});

/* ── Test: item 9 — Visual hint in agent detail ─────────────────── */

describe('Detail Panel Resize — visual hint in agent detail', () => {
  it('shows resize hint in agent detail panel', async () => {
    const tasks: Task[] = [];
    const agents = [makeAgent({ id: 'a1', name: 'Agent One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state }),
    );

    // Switch to agents view and open detail
    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    const output = lastFrame()!;
    expect(output).toContain('+/- resize');
    expect(output).toContain('M max');
  });

  it('M key shows +/- exit max hint in agent detail', async () => {
    const tasks: Task[] = [];
    const agents = [makeAgent({ id: 'a1', name: 'Agent One' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state }),
    );

    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    stdin.write('M');
    await delay(50);

    expect(lastFrame()!).toContain('+/- exit max');
  });
});
