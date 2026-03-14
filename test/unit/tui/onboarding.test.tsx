/**
 * Unit tests for the TUI Guided Onboarding state machine.
 *
 * Tests cover:
 *  - OnboardingStep type exports
 *  - WelcomeScreen / OnboardingNudge / OnboardingToast render
 *  - App onboardingStep initialisation logic
 *  - welcome→task_created→run_started→completed→dismissed transitions
 *  - onCompleteOnboarding callback on auto-dismiss
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import {
  WelcomeScreen,
  OnboardingNudge,
  OnboardingToast,
  type OnboardingStep,
} from '../../../src/tui/components/OnboardingBox.js';
import { App } from '../../../src/tui/App.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';
import type { Task } from '../../../src/domain/task.js';

afterEach(() => { _resetAnimTick(); });

/* ── Helpers ─────────────────────────────────────── */

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeState(overrides?: Partial<OrchestratorState>): OrchestratorState {
  return { ...DEFAULT_STATE, claimed: new Set<string>(), ...overrides };
}

/* ── OnboardingStep type ─────────────────────────── */

describe('OnboardingStep type', () => {
  it('valid step values are: welcome, task_created, run_started, completed, dismissed', () => {
    // Type-level smoke test — just ensure all step values can be assigned
    const steps: OnboardingStep[] = ['welcome', 'task_created', 'run_started', 'completed', 'dismissed'];
    expect(steps).toHaveLength(5);
  });
});

/* ── WelcomeScreen component ─────────────────────── */

describe('WelcomeScreen', () => {
  it('renders Welcome to Orch title', () => {
    const { lastFrame } = render(
      React.createElement(WelcomeScreen, { width: 80, height: 24 }),
    );
    expect(lastFrame()!).toContain('Welcome to Orch');
  });

  it('shows N hotkey hint for creating first task', () => {
    const { lastFrame } = render(
      React.createElement(WelcomeScreen, { width: 80, height: 24 }),
    );
    expect(lastFrame()!).toContain('N');
    expect(lastFrame()!).toContain('first task');
  });

  it('renders without crashing at narrow width', () => {
    expect(() =>
      render(React.createElement(WelcomeScreen, { width: 40, height: 10 })),
    ).not.toThrow();
  });
});

/* ── OnboardingNudge component ───────────────────── */

describe('OnboardingNudge', () => {
  it('task_created step shows R hotkey and run hint', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingNudge, { step: 'task_created', width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('R');
    expect(output).toContain('run task');
  });

  it('task_created step mentions pressing R to run', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingNudge, { step: 'task_created', width: 80 }),
    );
    expect(lastFrame()!).toContain('run');
  });

  it('run_started step shows orchestrator running message', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingNudge, { step: 'run_started', width: 80 }),
    );
    expect(lastFrame()!).toContain('running');
  });

  it('run_started step does NOT show task run hint (task already running)', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingNudge, { step: 'run_started', width: 80 }),
    );
    // No R key hint on run_started — task is already running
    expect(lastFrame()!).not.toContain('run task');
  });
});

/* ── OnboardingToast component ───────────────────── */

describe('OnboardingToast', () => {
  it('renders celebration message for first task completion', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingToast, { width: 80 }),
    );
    expect(lastFrame()!).toContain('First task completed');
  });

  it('shows helpful next-step hints', () => {
    const { lastFrame } = render(
      React.createElement(OnboardingToast, { width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('/');
    expect(output).toContain('commands');
  });

  it('renders without crashing at narrow width', () => {
    expect(() =>
      render(React.createElement(OnboardingToast, { width: 30 })),
    ).not.toThrow();
  });
});

/* ── App onboarding state machine initialisation ─── */

describe('App onboarding state machine — initial step', () => {
  it('initialises to welcome when 0 tasks, 0 runs, onboardingCompleted=false', () => {
    const state = makeState({ onboardingCompleted: false });
    // With 0 tasks and default state the welcome screen should be active
    // The App initialises onboardingStep=welcome; WelcomeScreen is rendered when step=welcome
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    // WelcomeScreen should be visible
    expect(lastFrame()!).toContain('Welcome to Orch');
  });

  it('skips welcome when onboardingCompleted=true', () => {
    const state = makeState({ onboardingCompleted: true });
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    // WelcomeScreen should NOT appear
    expect(lastFrame()!).not.toContain('Welcome to Orch');
  });

  it('skips welcome when there are existing tasks', () => {
    const state = makeState({ onboardingCompleted: false });
    const tasks = [makeTask({ id: 't1', title: 'Existing task' })];
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state,
      }),
    );
    // task_created step, not welcome — no WelcomeScreen
    expect(lastFrame()!).not.toContain('Welcome to Orch');
  });

  it('skips welcome when total_tasks_completed > 0', () => {
    const state = makeState({
      onboardingCompleted: false,
      stats: { ...DEFAULT_STATE.stats, total_tasks_completed: 1 },
    });
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    // dismissed step — no WelcomeScreen
    expect(lastFrame()!).not.toContain('Welcome to Orch');
  });

  it('skips welcome when there are running entries', () => {
    const state = makeState({
      onboardingCompleted: false,
      running: {
        run1: {
          run_id: 'run1',
          agent_id: 'a1',
          task_id: 't1',
          pid: 1234,
          started_at: '2025-01-01T00:00:00Z',
          last_event_at: '2025-01-01T00:00:00Z',
        },
      },
    });
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    // run_started step — no WelcomeScreen
    expect(lastFrame()!).not.toContain('Welcome to Orch');
  });
});

/* ── Event-driven transitions ─────────────────────── */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('App onboarding state machine — transitions', () => {
  /** Captures the event handler registered via onSubscribeEvents */
  function mountWithEvents(opts?: { tasks?: Task[]; state?: OrchestratorState; onCompleteOnboarding?: () => Promise<void> }) {
    let handler: ((event: OrchestratorEvent) => void) | undefined;
    const onSubscribeEvents = (h: (event: OrchestratorEvent) => void) => {
      handler = h;
      return () => { handler = undefined; };
    };
    const result = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: opts?.tasks ?? [],
        state: opts?.state ?? makeState({ onboardingCompleted: false }),
        onSubscribeEvents,
        messageBatchMs: 0,
        onCompleteOnboarding: opts?.onCompleteOnboarding,
      }),
    );
    const emit = (event: OrchestratorEvent) => { handler?.(event); };
    return { ...result, emit };
  }

  it('welcome → task_created on task:created event', async () => {
    const { lastFrame, emit } = mountWithEvents();
    expect(lastFrame()!).toContain('Welcome to Orch');

    emit({ type: 'task:created', task: makeTask({ id: 't1', title: 'First task' }) } as OrchestratorEvent);
    await delay(50);
    // WelcomeScreen should disappear, nudge should appear
    expect(lastFrame()!).not.toContain('Welcome to Orch');
    expect(lastFrame()!).toContain('run task');
  });

  it('task_created → run_started on agent:started event', async () => {
    const tasks = [makeTask({ id: 't1', title: 'My task' })];
    const { lastFrame, emit } = mountWithEvents({ tasks });
    // Should be in task_created step (has tasks, no runs)
    expect(lastFrame()!).toContain('run task');

    emit({ type: 'agent:started', agentId: 'a1', taskId: 't1', runId: 'r1' } as OrchestratorEvent);
    await delay(50);
    // Should show running message
    expect(lastFrame()!).toContain('running');
  });

  it('run_started → completed on task:status_changed to done', async () => {
    const state = makeState({
      onboardingCompleted: false,
      running: {
        r1: { run_id: 'r1', agent_id: 'a1', task_id: 't1', pid: 123, started_at: '2025-01-01T00:00:00Z', last_event_at: '2025-01-01T00:00:00Z' },
      },
    });
    const { lastFrame, emit } = mountWithEvents({ state });
    // run_started step
    expect(lastFrame()!).toContain('running');

    emit({ type: 'task:status_changed', taskId: 't1', from: 'in_progress', to: 'done' } as OrchestratorEvent);
    await delay(50);
    // Should show completion toast
    expect(lastFrame()!).toContain('First task completed');
  });

  it('completed → dismissed after 5s timeout and calls onCompleteOnboarding', async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    const state = makeState({
      onboardingCompleted: false,
      running: {
        r1: { run_id: 'r1', agent_id: 'a1', task_id: 't1', pid: 123, started_at: '2025-01-01T00:00:00Z', last_event_at: '2025-01-01T00:00:00Z' },
      },
    });
    const { lastFrame, emit } = mountWithEvents({ state, onCompleteOnboarding: onComplete });

    // Transition to completed
    emit({ type: 'task:status_changed', taskId: 't1', from: 'in_progress', to: 'done' } as OrchestratorEvent);
    await vi.advanceTimersByTimeAsync(50);
    expect(lastFrame()!).toContain('First task completed');

    // After 5s it should auto-dismiss
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastFrame()!).not.toContain('First task completed');
    expect(onComplete).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it('does not transition from dismissed on new events', async () => {
    const state = makeState({ onboardingCompleted: true });
    const { lastFrame, emit } = mountWithEvents({ state });
    // dismissed — no onboarding UI
    expect(lastFrame()!).not.toContain('Welcome to Orch');
    expect(lastFrame()!).not.toContain('run task');

    emit({ type: 'task:created', task: makeTask({ id: 't1', title: 'New task' }) } as OrchestratorEvent);
    await delay(50);
    // Still no onboarding UI
    expect(lastFrame()!).not.toContain('Welcome to Orch');
    expect(lastFrame()!).not.toContain('run task');
  });
});
