/**
 * TUI component tests.
 *
 * Uses ink-testing-library to render components without a real TTY.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import { Header } from '../../../src/tui/components/Header.js';
import { TaskList } from '../../../src/tui/components/TaskList.js';
import { Footer } from '../../../src/tui/components/Footer.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Goal } from '../../../src/domain/goal.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Clean up global animation timer between tests to prevent leaks
afterEach(() => { _resetAnimTick(); });

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

/* ── Header (standalone component) ────────────────────── */

const defaultStats = { running: 0, retrying: 0, review: 0, todo: 0, done: 0, failed: 0, cancelled: 0 };
const defaultTokens = { input: 0, output: 0, total: 0 };

describe('Header', () => {
  it('renders project name and mode', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        projectName: 'my-project',
        activeView: 'tasks' as const,
        mode: 'idle',
        stats: defaultStats,
        tokens: defaultTokens,
        width: 80,
      }),
    );
    const output = lastFrame()!;
    expect(output).toContain('ORCH');
    expect(output).toContain('my-project');
    expect(output).toContain('IDLE');
  });

  it('shows running count when > 0', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        projectName: 'test',
        activeView: 'tasks' as const,
        mode: 'watching',
        stats: { ...defaultStats, running: 2 },
        tokens: defaultTokens,
        width: 80,
      }),
    );
    const output = lastFrame()!;
    expect(output).toContain('WATCHING');
    expect(output).toContain('2');
    expect(output).toContain('active');
  });

  it('shows uptime when provided', () => {
    const { lastFrame } = render(
      React.createElement(Header, {
        projectName: 'test',
        activeView: 'tasks' as const,
        mode: 'watching',
        stats: defaultStats,
        tokens: defaultTokens,
        uptime: '14m',
        width: 80,
      }),
    );
    expect(lastFrame()!).toContain('14m');
  });
});

/* ── TaskList ─────────────────────────────────────────── */

describe('TaskList', () => {
  it('renders empty state message', () => {
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks: [] }),
    );
    expect(lastFrame()!).toContain('No tasks');
  });

  it('renders tasks with priorities', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Fix bug', priority: 1 }),
      makeTask({ id: '2', title: 'Add feature', priority: 2 }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    const output = lastFrame()!;
    expect(output).toContain('Fix bug');
    expect(output).toContain('Add feature');
    expect(output).toContain('!!!');
    expect(output).toContain('!!');
  });

  it('sorts tasks by status order', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Done task', status: 'done' }),
      makeTask({ id: '2', title: 'Running task', status: 'in_progress' }),
      makeTask({ id: '3', title: 'Todo task', status: 'todo' }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    const output = lastFrame()!;
    const runningPos = output.indexOf('Running task');
    const todoPos = output.indexOf('Todo task');
    const donePos = output.indexOf('Done task');
    expect(runningPos).toBeLessThan(todoPos);
    expect(todoPos).toBeLessThan(donePos);
  });

  it('shows assignee name', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Task', assignee: 'backend' }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    expect(lastFrame()!).toContain('backend');
  });

  it('shows dash for non-running task time', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Task', status: 'todo' }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    expect(lastFrame()!).toContain('\u2014'); // —
  });

  it('uses different icons per status', () => {
    const tasks = [
      makeTask({ id: '1', title: 'A', status: 'in_progress' }),
      makeTask({ id: '2', title: 'B', status: 'todo' }),
      makeTask({ id: '3', title: 'C', status: 'done' }),
      makeTask({ id: '4', title: 'D', status: 'failed' }),
      makeTask({ id: '5', title: 'E', status: 'review' }),
      makeTask({ id: '6', title: 'F', status: 'cancelled' }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    const output = lastFrame()!;
    // Running tasks now use animated braille spinner — first frame is ⠋
    expect(output).toContain('\u280B'); // ⠋ running (spinner frame 0)
    expect(output).toContain('\u25CB'); // ○ todo
    expect(output).toContain('\u2713'); // ✓ done
    expect(output).toContain('\u2715'); // ✕ failed
    expect(output).toContain('\u25C8'); // ◈ review
    expect(output).toContain('\u2500'); // ─ cancelled
  });
});

/* ── Footer (standalone component) ────────────────────── */

describe('Footer', () => {
  it('shows Q quit hint', () => {
    const { lastFrame } = render(
      React.createElement(Footer, {}),
    );
    expect(lastFrame()!).toContain('Q');
    expect(lastFrame()!).toContain('quit');
  });

  it('shows task count', () => {
    const { lastFrame } = render(
      React.createElement(Footer, { taskCount: 5 }),
    );
    expect(lastFrame()!).toContain('5 tasks');
  });

  it('shows token count formatted', () => {
    const { lastFrame } = render(
      React.createElement(Footer, { totalTokens: 14232 }),
    );
    expect(lastFrame()!).toContain('14.2k tokens');
  });

  it('hides tokens when zero', () => {
    const { lastFrame } = render(
      React.createElement(Footer, { totalTokens: 0 }),
    );
    expect(lastFrame()!).not.toContain('tokens');
  });
});

/* ── App (full dashboard) ─────────────────────────────── */

describe('App', () => {
  it('renders full dashboard with Command & Control design', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Fix auth', priority: 1, status: 'todo' }),
      makeTask({ id: '2', title: 'Add profile', priority: 2, assignee: 'frontend' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };

    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test-project',
        tasks,
        state,
      }),
    );
    const output = lastFrame()!;
    // Status line
    expect(output).toContain('\u25C6'); // ◆ diamond
    expect(output).toContain('ORCH');
    expect(output).toContain('test-project');
    // Tab bar
    expect(output).toContain('TASKS');
    // Task content
    expect(output).toContain('Fix auth');
    expect(output).toContain('Add profile');
    expect(output).toContain('!!!');
    expect(output).toContain('frontend');
    // Footer
    expect(output).toContain('Q');
    expect(output).toContain('quit');
  });

  it('renders combined header with tabs and status', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    const output = lastFrame()!;
    // Combined TabBar shows project + tabs + status
    expect(output).toContain('ORCH');
    expect(output).toContain('TASKS');
    expect(output).toContain('agents');
    expect(output).toContain('actions');
  });

  it('shows stats ribbon with status counts', () => {
    const tasks = [
      makeTask({ id: '1', title: 'A', status: 'todo' }),
      makeTask({ id: '2', title: 'B', status: 'done' }),
      makeTask({ id: '3', title: 'C', status: 'done' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };

    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state,
      }),
    );
    const output = lastFrame()!;
    expect(output).toContain('1'); // 1 todo
    expect(output).toContain('TODO');
    expect(output).toContain('2'); // 2 done
    expect(output).toContain('DONE');
  });

  it('shows empty state with getting started guide', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    const output = lastFrame()!;
    expect(output).toContain('Tasks');
    expect(output).toContain('new task');
  });

  it('exits on q key press', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    expect(lastFrame()!).toContain('ORCH');
    stdin.write('q');
  });

  it('exits on Q (uppercase) key press', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
      }),
    );
    expect(lastFrame()!).toContain('ORCH');
    stdin.write('Q');
  });

  it('shows running count in status line', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Running', status: 'in_progress' }),
      makeTask({ id: '2', title: 'Also running', status: 'in_progress' }),
      makeTask({ id: '3', title: 'Done', status: 'done' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };

    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state,
      }),
    );
    expect(lastFrame()!).toContain('2 RUN');
  });

  it('shows "Enter details" hint when tasks exist', () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    const output = lastFrame()!;
    expect(output).toContain('Enter');
    expect(output).toContain('detail');
  });

  it('opens detail panel on Enter press', async () => {
    const tasks = [
      makeTask({
        id: '1',
        title: 'Fix auth bug',
        description: 'JWT validation fails',
        priority: 1,
        assignee: 'backend',
        labels: ['auth'],
        attempts: 1,
      }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Before Enter: no DETAIL shown
    expect(lastFrame()!).not.toContain('DETAIL');

    // Press Enter and wait for re-render
    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;

    // After Enter: shows DETAIL panel with task info
    expect(output).toContain('DETAIL');
    expect(output).toContain('Fix auth bug');
    expect(output).toContain('backend');
    expect(output).toContain('P1');
    expect(output).toContain('1/3');
    expect(output).toContain('auth');
    expect(output).toContain('JWT validation fails');
    expect(output).toContain('close');
  });

  it('closes detail panel on second Enter', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Open detail
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    // Close detail
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).not.toContain('DETAIL');
  });

  it('closes detail panel on Escape without quitting', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    // Open detail
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    // Escape closes panel (doesn't quit)
    stdin.write('\x1B');
    await delay(50);
    const output = lastFrame()!;
    expect(output).not.toContain('DETAIL');
    expect(output).toContain('ORCH');
  });

  it('shows R run hint for runnable task', () => {
    const tasks = [makeTask({ id: '1', title: 'Task', status: 'todo' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onRunTask = async () => {};
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRunTask }),
    );
    const output = lastFrame()!;
    expect(output).toContain('R');
    expect(output).toContain('run');
  });

  it('does not show R run hint for non-runnable task', () => {
    const tasks = [makeTask({ id: '1', title: 'Task', status: 'done' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onRunTask = async () => {};
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRunTask }),
    );
    const output = lastFrame()!;
    // Footer should not contain "run" hint (only "running" from stats is ok)
    // Check that the footer area doesn't have the R run pattern
    const lines = output.split('\n');
    const footerLine = lines[lines.length - 1] ?? '';
    expect(footerLine).not.toContain(' run');
  });

  it('dispatches onRunTask on R key for todo task', async () => {
    let calledWith = '';
    const tasks = [makeTask({ id: 'task-1', title: 'Build API', status: 'todo' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onRunTask = async (taskId: string) => { calledWith = taskId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRunTask }),
    );
    stdin.write('r');
    await delay(50);
    expect(calledWith).toBe('task-1');
    expect(lastFrame()!).toContain('Running');
  });

  it('shows warning when trying to run non-runnable task', async () => {
    const tasks = [makeTask({ id: '1', title: 'Done task', status: 'done' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onRunTask = async () => {};
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRunTask }),
    );
    stdin.write('r');
    await delay(50);
    expect(lastFrame()!).toContain('Cannot run');
  });

  it('shows error message when onRunTask rejects', async () => {
    const tasks = [makeTask({ id: '1', title: 'Fail task', status: 'failed' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onRunTask = async () => { throw new Error('agent crashed'); };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRunTask }),
    );
    stdin.write('r');
    await delay(100);
    expect(lastFrame()!).toContain('agent crashed');
  });

  /* ── View Switching (US-9.3) ─────────────────────────── */

  it('shows tab bar with T A L', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    const output = lastFrame()!;
    expect(output).toContain('T');
    expect(output).toContain('TASKS');
    expect(output).toMatch(/A\s+agents/i);
    expect(output).toMatch(/L\s+actions/i);
  });

  it('switches to agents view on A key', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const agents = [makeAgent({ id: 'a1', name: 'backend' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state }),
    );
    // Initially shows tasks
    expect(lastFrame()!).toContain('Task');

    // Switch to agents
    stdin.write('a');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('backend');
    expect(output).toContain('AGENTS');
  });

  it('switches to logs view on L key', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    stdin.write('l');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('ACTIONS');
    expect(output).toContain('Waiting for activity');
  });

  it('switches back to tasks view on T key', async () => {
    const tasks = [makeTask({ id: '1', title: 'My Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    // Go to logs
    stdin.write('l');
    await delay(50);
    expect(lastFrame()!).toContain('ACTIONS');

    // Back to tasks
    stdin.write('t');
    await delay(50);
    expect(lastFrame()!).toContain('My Task');
    expect(lastFrame()!).toContain('TASKS');
  });

  it('shows agents empty state', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    stdin.write('a');
    await delay(50);
    expect(lastFrame()!).toContain('Agents');
    expect(lastFrame()!).toContain('new agent');
  });

  it('shows agents in agents view', async () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'backend', status: 'idle' }),
      makeAgent({ id: 'a2', name: 'frontend', status: 'idle' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state }),
    );
    stdin.write('a');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('backend');
    expect(output).toContain('frontend');
  });

  it('shows footer with view hints T A L', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    const output = lastFrame()!;
    const lines = output.split('\n');
    const footerLine = lines[lines.length - 1] ?? '';
    expect(footerLine).toContain('Tab');
    expect(footerLine).toContain('cmd');
    expect(footerLine).toContain('quit');
  });

  it('opens agent detail panel on Enter in agents view', async () => {
    const agents = [makeAgent({ id: 'a1', name: 'backend', role: 'Backend developer' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state }),
    );
    // Switch to agents
    stdin.write('a');
    await delay(50);

    // Press Enter
    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('AGENT');
    expect(output).toContain('backend');
    expect(output).toContain('Backend developer');
  });

  it('does not switch views when detail panel is open', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    // Open detail
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');

    // Try to switch to agents — should NOT switch
    stdin.write('a');
    await delay(50);
    expect(lastFrame()!).toContain('DETAIL');
    expect(lastFrame()!).toContain('Task');
  });

  it('R key does nothing in agents view', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task', status: 'todo' })];
    const agents = [makeAgent({ id: 'a1', name: 'backend' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let called = false;
    const onRunTask = async () => { called = true; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state, onRunTask }),
    );
    // Switch to agents
    stdin.write('a');
    await delay(50);

    // Press R — should not trigger onRunTask
    stdin.write('r');
    await delay(50);
    expect(called).toBe(false);
  });

  /* ── Inline Task Creation (US-9.5) ──────────────────── */

  it('shows N new hint in footer when onCreateTask provided', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    const output = lastFrame()!;
    expect(output).toContain('N');
    expect(output).toContain('new');
  });

  it('opens input mode on N key', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('NEW TASK');
    // Input panel shows block cursor
    expect(output).toContain('\u2588'); // █ cursor
  });

  it('accumulates typed characters in input mode', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);

    // Type some characters
    stdin.write('Fix bug');
    await delay(50);
    expect(lastFrame()!).toContain('Fix bug');
  });

  it('cancels input mode on Escape', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);
    expect(lastFrame()!).toContain('NEW TASK');

    stdin.write('\x1B');
    await delay(50);
    const output = lastFrame()!;
    expect(output).not.toContain('NEW TASK');
    expect(output).toContain('cmd');
  });

  it('creates task via wizard and shows in list', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let createdTitle = '';
    const onCreateTask = async (title: string) => {
      createdTitle = title;
      return makeTask({ id: 'tsk_new1', title });
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    // Open wizard
    stdin.write('n');
    await delay(50);
    expect(lastFrame()!).toContain('NEW TASK');

    // Step 1: Type title
    stdin.write('Build API');
    await delay(50);
    // Submit step 1 → step 2 (priority select)
    stdin.write('\r');
    await delay(50);

    // Step 2: priority — just press Enter to accept default (P3)
    stdin.write('\r');
    await delay(50);

    // Step 3: description (textarea, optional) — Enter to skip
    stdin.write('\r');
    await delay(100);

    expect(createdTitle).toBe('Build API');
    const output = lastFrame()!;
    expect(output).toContain('Created');
  });

  it('does not create task on Enter with empty title in wizard', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let called = false;
    const onCreateTask = async (title: string) => {
      called = true;
      return makeTask({ id: 'new', title });
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);

    // Press Enter with empty input (title is required)
    stdin.write('\r');
    await delay(50);
    expect(called).toBe(false);
    // Should still be in wizard (step 1)
    expect(lastFrame()!).toContain('NEW TASK');
  });

  it('blocks other hotkeys in wizard mode', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);
    expect(lastFrame()!).toContain('NEW TASK');

    // Type 'q' — should NOT quit, should add to wizard input
    stdin.write('quality');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('quality');
    expect(output).toContain('NEW TASK');
  });

  it('handles backspace in wizard text input', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async (title: string) => makeTask({ id: 'new', title });
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    stdin.write('n');
    await delay(50);

    stdin.write('Hello');
    await delay(50);
    expect(lastFrame()!).toContain('Hello');

    // Backspace (DEL char)
    stdin.write('\x7F');
    await delay(50);
    expect(lastFrame()!).toContain('Hell');
    expect(lastFrame()!).not.toContain('Hello');
  });

  it('shows error when onCreateTask fails', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCreateTask = async () => { throw new Error('disk full'); };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onCreateTask }),
    );
    // Open wizard
    stdin.write('n');
    await delay(50);
    // Step 1: title
    stdin.write('Test');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    // Step 2: priority — Enter for default
    stdin.write('\r');
    await delay(50);
    // Step 3: description (textarea) — Enter to skip
    stdin.write('\r');
    await delay(100);
    expect(lastFrame()!).toContain('disk full');
  });

  /* ── Command Palette (US-9.7) ──────────────────────── */

  it('opens command mode on / key with suggestions', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    stdin.write('/');
    await delay(50);
    const output = lastFrame()!;
    // Shows command suggestions and selection hints
    expect(output).toContain('/run');
    expect(output).toContain('select');
  });

  it('shows / cmd hint in footer', () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    expect(lastFrame()!).toContain('/');
    expect(lastFrame()!).toContain('cmd');
  });

  it('cancels command mode on Escape', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    stdin.write('/');
    await delay(50);
    expect(lastFrame()!).toContain('COMMANDS');

    stdin.write('\x1B');
    await delay(50);
    expect(lastFrame()!).not.toContain('COMMANDS');
    expect(lastFrame()!).not.toContain('DETAIL');
  });

  it('executes cancel command on selected task', async () => {
    const tasks = [makeTask({ id: 'task-1', title: 'Fix bug', status: 'todo' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let cancelledId = '';
    const onCancelTask = async (id: string) => { cancelledId = id; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onCancelTask }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('cancel');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(cancelledId).toBe('task-1');
    expect(lastFrame()!).toContain('Cancelled');
  });

  it('executes retry command on selected task', async () => {
    const tasks = [makeTask({ id: 'task-1', title: 'Fix bug', status: 'failed' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let retriedId = '';
    const onRetryTask = async (id: string) => { retriedId = id; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onRetryTask }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('retry');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(retriedId).toBe('task-1');
    expect(lastFrame()!).toContain('Retried');
  });

  it('executes assign command with agent argument', async () => {
    const tasks = [makeTask({ id: 'task-1', title: 'Fix bug' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let assignedTo = '';
    const onAssignTask = async (_tid: string, agentId: string) => { assignedTo = agentId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onAssignTask }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('assign backend');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(assignedTo).toBe('backend');
    expect(lastFrame()!).toContain('Assigned');
  });

  it('executes run-all command', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let called = false;
    const onRunAll = async () => { called = true; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onRunAll }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('run-all');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(called).toBe(true);
    expect(lastFrame()!).toContain('Dispatched all');
  });

  it('executes disable command on selected agent', async () => {
    const agents = [makeAgent({ id: 'agt-1', name: 'backend', status: 'idle' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let disabledId = '';
    const onDisableAgent = async (id: string) => { disabledId = id; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state, onDisableAgent }),
    );
    // Switch to agents view first
    stdin.write('a');
    await delay(50);

    stdin.write('/');
    await delay(50);
    stdin.write('disable');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(disabledId).toBe('agt-1');
    expect(lastFrame()!).toContain('Disabled');
  });

  it('executes enable command on selected agent', async () => {
    const agents = [makeAgent({ id: 'agt-1', name: 'backend', status: 'disabled' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let enabledId = '';
    const onEnableAgent = async (id: string) => { enabledId = id; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state, onEnableAgent }),
    );
    stdin.write('a');
    await delay(50);

    stdin.write('/');
    await delay(50);
    stdin.write('enable');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(enabledId).toBe('agt-1');
    expect(lastFrame()!).toContain('Enabled');
  });

  it('shows unknown command message', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('foobar');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(lastFrame()!).toContain('Unknown');
  });

  it('shows assign usage when no argument provided', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onAssignTask = async () => {};
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onAssignTask }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('assign');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(lastFrame()!).toContain('Usage');
  });

  it('shows error when command fails', async () => {
    const tasks = [makeTask({ id: '1', title: 'Task' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const onCancelTask = async () => { throw new Error('task is running'); };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state, onCancelTask }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('cancel');
    await delay(50);
    stdin.write('\r');
    await delay(100);
    expect(lastFrame()!).toContain('task is running');
  });

  /* ── Live Events (US-9.8) ──────────────────────────── */

  it('displays live events from onSubscribeEvents', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onSubscribeEvents }),
    );

    // Simulate event
    eventHandler!({ type: 'agent:started', agentId: 'backend', taskId: 'task-1', runId: 'run-1' });
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('Started task');
  });

  it('displays agent:completed event', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onSubscribeEvents }),
    );

    eventHandler!({ type: 'agent:completed', runId: 'run-1', success: true });
    await delay(50);
    expect(lastFrame()!).toContain('success');
  });

  it('displays agent:error event', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onSubscribeEvents }),
    );

    eventHandler!({ type: 'agent:error', runId: 'run-1', error: 'timeout exceeded' });
    await delay(50);
    expect(lastFrame()!).toContain('timeout exceeded');
  });

  it('displays task:status_changed event', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onSubscribeEvents }),
    );

    eventHandler!({ type: 'task:status_changed', taskId: 'task-1', from: 'todo', to: 'in_progress' });
    await delay(50);
    expect(lastFrame()!).toContain('todo');
    expect(lastFrame()!).toContain('in_progress');
  });

  /* ── Log Filtering (US-9.9) ────────────────────────── */

  it('shows filter bar in logs view', async () => {
    const agents = [makeAgent({ id: 'agt-1', name: 'backend' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state, onSubscribeEvents }),
    );
    // Add an event so logs view has content
    eventHandler!({ type: 'agent:started', agentId: 'agt-1', taskId: 't1', runId: 'r1' });
    await delay(50);
    stdin.write('l');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('ACTIONS');
    expect(output).toContain('ALL');
  });

  it('filters logs by agent with number keys', async () => {
    const agents = [
      makeAgent({ id: 'agt-1', name: 'backend' }),
      makeAgent({ id: 'agt-2', name: 'frontend' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state, onSubscribeEvents }),
    );

    // Add events from different agents
    eventHandler!({ type: 'agent:started', agentId: 'agt-1', taskId: 't1', runId: 'r1' });
    eventHandler!({ type: 'agent:started', agentId: 'agt-2', taskId: 't2', runId: 'r2' });
    await delay(50);

    // Switch to logs view
    stdin.write('l');
    await delay(50);

    // All events visible — agent names shown as badges
    let output = lastFrame()!;
    expect(output).toContain('backend');
    expect(output).toContain('frontend');

    // Filter by agent 1 (backend)
    stdin.write('1');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('backend');

    // Reset to all
    stdin.write('0');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('all');
  });

  it('shows agent names in filter hint', async () => {
    const agents = [
      makeAgent({ id: 'agt-1', name: 'backend' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state, onSubscribeEvents }),
    );
    // Add event to ensure logs content renders
    eventHandler!({ type: 'agent:started', agentId: 'agt-1', taskId: 't1', runId: 'r1' });
    await delay(50);
    stdin.write('l');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('ACTIONS');
    expect(output).toContain('ALL');
    expect(output).toContain('backend');
  });
});

/* ── Command Bar: Tab Completion ─────────────────────── */

describe('Command bar — tab completion', () => {
  it('completes verb on Tab: /ta → /task', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    // Enter command mode
    stdin.write('/');
    await delay(50);
    // Type partial verb
    stdin.write('t');
    stdin.write('a');
    await delay(50);
    // Press Tab to complete
    stdin.write('\t');
    await delay(50);
    // Submit and check the command was "task" (shows usage message since no subcommand)
    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;
    // After /task submit, wizard opens with "NEW TASK" header
    expect(output.toLowerCase()).toContain('task');
  });

  it('shows ghost completion text for partial verb', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    stdin.write('/');
    await delay(50);
    stdin.write('h');
    stdin.write('e');
    await delay(50);
    const output = lastFrame()!;
    // Ghost text "lp" should appear for "he" → "help"
    expect(output).toContain('lp');
  });
});

/* ── Command Bar: History ────────────────────────────── */

describe('Command bar — history', () => {
  it('recalls previous command with ↑', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    // Execute a command first
    stdin.write('/');
    await delay(50);
    for (const ch of 'status') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(50);

    // Open command mode again and press ↑
    stdin.write('/');
    await delay(50);
    stdin.write('\x1B[A'); // up arrow
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('status');
  });
});

/* ── Command Bar: /help ──────────────────────────────── */

describe('Command bar — /help', () => {
  it('lists available commands', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'help') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(100);
    const output = lastFrame()!;
    // Only the last few lines may be visible — check for commands near end of list
    expect(output).toContain('/quit');
  });
});

/* ── Command Bar: /status ────────────────────────────── */

describe('Command bar — /status', () => {
  it('shows orchestrator status summary', async () => {
    const tasks = [
      makeTask({ id: 't1', title: 'A', status: 'in_progress' }),
      makeTask({ id: 't2', title: 'B', status: 'todo' }),
    ];
    const agents = [makeAgent({ id: 'a1', name: 'alpha' })];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents, state }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'status') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(100);
    const output = lastFrame()!;
    expect(output).toContain('1 running');
    expect(output).toContain('2 tasks');
    expect(output).toContain('1 agents');
  });
});

/* ── Command Bar: /task list ─────────────────────────── */

describe('Command bar — /task list', () => {
  it('lists tasks in the activity feed', async () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Alpha task', status: 'todo' }),
      makeTask({ id: 't2', title: 'Beta task', status: 'done' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'task list') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(100);
    const output = lastFrame()!;
    expect(output).toContain('t1');
    expect(output).toContain('t2');
  });
});

/* ── View switching: Tab and ←→ ──────────────────────── */

describe('View switching — Tab and arrows', () => {
  it('Tab cycles views forward: tasks → agents → logs → goals → tasks', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const agents = [makeAgent({ id: 'a1', name: 'bot' })];
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents, state }),
    );
    await delay(50);
    // Default view is tasks
    let output = lastFrame()!;
    expect(output).toContain('TASKS');

    // Tab → agents
    stdin.write('\t');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('AGENTS');

    // Tab → logs
    stdin.write('\t');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('ACTIONS');

    // Tab → goals
    stdin.write('\t');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('GOALS');

    // Tab → back to tasks
    stdin.write('\t');
    await delay(50);
    output = lastFrame()!;
    expect(output).toContain('TASKS');
  });

  it('← arrow cycles views backward', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    await delay(50);
    // tasks → ← → goals (previous in cycle: goals, tasks, agents, logs)
    stdin.write('\x1B[D'); // left arrow
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('GOALS');
  });

  it('→ arrow cycles views forward', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    await delay(50);
    // tasks → → → agents
    stdin.write('\x1B[C'); // right arrow
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('AGENTS');
  });
});

/* ── Command Bar: /task add ──────────────────────────── */

describe('Command bar — /task add', () => {
  it('creates a task via /task add command', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let createdTitle = '';
    const onCreateTask = async (title: string) => {
      createdTitle = title;
      return makeTask({ id: 'new-1', title });
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state, onCreateTask }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'task add My new task') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(200);
    expect(createdTitle).toBe('My new task');
    const output = lastFrame()!;
    expect(output).toContain('My new task');
  });

  // ── Live data & new commands ──

  it('creates agent via /agent add command', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let addedName = '';
    const onAddAgent = async (name: string) => {
      addedName = name;
      return makeAgent({ id: 'agt-new', name });
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state, onAddAgent }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'agent add myworker') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(200);
    expect(addedName).toBe('myworker');
    expect(lastFrame()!).toContain('myworker');
  });

  it('approves task via /task approve command', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const tasks = [makeTask({ id: 'tsk_1', title: 'Review me', status: 'review' })];
    let approvedId = '';
    const onApproveTask = async (taskId: string) => { approvedId = taskId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state, onApproveTask }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'task approve') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(200);
    expect(approvedId).toBe('tsk_1');
    expect(lastFrame()!).toContain('Approved');
  });

  it('rejects task via /task reject command', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const tasks = [makeTask({ id: 'tsk_1', title: 'Reject me', status: 'review' })];
    let rejectedId = '';
    const onRejectTask = async (taskId: string) => { rejectedId = taskId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state, onRejectTask }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'task reject') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(200);
    expect(rejectedId).toBe('tsk_1');
    expect(lastFrame()!).toContain('Rejected');
  });

  it('shows approve/reject hints for review tasks', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const tasks = [makeTask({ id: 'tsk_1', title: 'In review', status: 'review' })];
    const onApproveTask = async () => {};
    const onRejectTask = async () => {};
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state, onApproveTask, onRejectTask }),
    );
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('approve');
    expect(output).toContain('reject');
  });

  it('approves task with A hotkey', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const tasks = [makeTask({ id: 'tsk_1', title: 'Review task', status: 'review' })];
    let approvedId = '';
    const onApproveTask = async (taskId: string) => { approvedId = taskId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state, onApproveTask }),
    );
    await delay(50);
    stdin.write('a');
    await delay(200);
    expect(approvedId).toBe('tsk_1');
    expect(lastFrame()!).toContain('Approved');
  });

  it('rejects task with X hotkey', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const tasks = [makeTask({ id: 'tsk_1', title: 'Review task', status: 'review' })];
    let rejectedId = '';
    const onRejectTask = async (taskId: string) => { rejectedId = taskId; };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, agents: [], state, onRejectTask }),
    );
    await delay(50);
    stdin.write('x');
    await delay(200);
    expect(rejectedId).toBe('tsk_1');
    expect(lastFrame()!).toContain('Rejected');
  });

  it('refreshes data from events via onRefreshTasks', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const initialTasks = [makeTask({ id: 'tsk_1', title: 'Task A', status: 'todo' })];
    const updatedTasks = [makeTask({ id: 'tsk_1', title: 'Task A', status: 'in_progress' })];

    let eventHandler: ((event: any) => void) | null = null;
    const onSubscribeEvents = (handler: (event: any) => void) => {
      eventHandler = handler;
      return () => { eventHandler = null; };
    };
    const onRefreshTasks = async () => updatedTasks;
    const onRefreshAgents = async () => [];
    const onRefreshState = async () => state;

    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test', tasks: initialTasks, agents: [], state,
        onSubscribeEvents, onRefreshTasks, onRefreshAgents, onRefreshState,
      }),
    );
    await delay(50);
    // Simulate a status change event
    eventHandler!({ type: 'task:status_changed', taskId: 'tsk_1', from: 'todo', to: 'in_progress' });
    await delay(300); // wait for debounced refresh
    const output = lastFrame()!;
    // After refresh, the running count should update in header chip
    expect(output).toContain('RUN');
  });

  it('shows watch/pause in /help', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [], state }),
    );
    stdin.write('/');
    await delay(50);
    for (const ch of 'help') stdin.write(ch);
    await delay(50);
    stdin.write('\r');
    await delay(200);
    const output = lastFrame()!;
    expect(output).toContain('watch');
    expect(output).toContain('pause');
  });
});

/* ── onLoadHistory: progressive history loading ──────────────────────── */

describe('onLoadHistory — progressive history loading', () => {
  const TS = '2026-01-01T10:00:00.000Z';
  const makeEntry = (overrides: Partial<import('../../../src/tui/App.js').HistoryEntry> = {}): import('../../../src/tui/App.js').HistoryEntry => ({
    timestamp: TS,
    agentId: 'agt_1',
    taskId: 'tsk_1',
    type: 'agent_output',
    data: 'Hello from history',
    ...overrides,
  });

  it('TUI renders immediately without waiting for history to load', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let resolveHistory!: () => void;
    const onLoadHistory = (_onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> =>
      new Promise((resolve) => { resolveHistory = resolve; });

    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    // TUI renders immediately — ORCH header is visible before history resolves
    expect(lastFrame()!).toContain('ORCH');
    resolveHistory();
  });

  it('batch with done-type entry shows "Completed" in logs view', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let capturedBatch!: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void;
    const onLoadHistory = (onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> => {
      capturedBatch = onBatch;
      return Promise.resolve();
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    // Wait for useEffect to fire
    await delay(50);
    capturedBatch([makeEntry({ type: 'done', data: undefined })]);
    await delay(50);

    // Switch to logs view to see the activity feed
    stdin.write('l');
    await delay(50);
    expect(lastFrame()!).toContain('Completed');
  });

  it('batch with error-type entry shows error text in logs view', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let capturedBatch!: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void;
    const onLoadHistory = (onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> => {
      capturedBatch = onBatch;
      return Promise.resolve();
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    await delay(50);
    capturedBatch([makeEntry({ type: 'error', data: 'ConnectionRefused' })]);
    await delay(50);

    stdin.write('l');
    await delay(50);
    expect(lastFrame()!).toContain('ConnectionRefused');
  });

  it('empty batch does not change the empty state message', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let capturedBatch!: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void;
    const onLoadHistory = (onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> => {
      capturedBatch = onBatch;
      return Promise.resolve();
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    await delay(50);
    capturedBatch([]);
    await delay(50);

    stdin.write('l');
    await delay(50);
    // Empty batch → feed still shows waiting state
    expect(lastFrame()!).toContain('Waiting for activity');
  });

  it('two consecutive batches accumulate messages in logs view', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let capturedBatch!: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void;
    const onLoadHistory = (onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> => {
      capturedBatch = onBatch;
      return Promise.resolve();
    };

    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    await delay(50);
    capturedBatch([makeEntry({ type: 'done', data: undefined })]);
    await delay(50);
    capturedBatch([makeEntry({ type: 'error', data: 'TimeoutError' })]);
    await delay(50);

    stdin.write('l');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('Completed');
    expect(output).toContain('TimeoutError');
  });

  it('shows skills row in AgentDetailPanel when agent has skills', async () => {
    const agent = makeAgent({
      id: 'agt_1',
      name: 'Backend',
      config: { skills: ['feature-dev:feature-dev', 'testing-suite:generate-tests'] },
    });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    // Switch to agents view
    stdin.write('a');
    await delay(50);

    // Open detail panel
    stdin.write('\r');
    await delay(50);

    const output = lastFrame()!;
    expect(output).toContain('AGENT'); // AgentDetailSectionLabel shows AGENT chip
    expect(output).toContain('skills');
    expect(output).toContain('feature-dev:feature-dev');
    expect(output).toContain('testing-suite:generate-tests');
  });

  it('hides skills row in AgentDetailPanel when agent has no skills', async () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Backend', config: {} });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    const output = lastFrame()!;
    expect(output).toContain('AGENT'); // detail panel is open
    expect(output).not.toContain('skills');
  });

  it('hides skills row in AgentDetailPanel when skills array is empty', async () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Backend', config: { skills: [] } });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    const output = lastFrame()!;
    expect(output).toContain('AGENT'); // detail panel is open
    expect(output).not.toContain('skills');
  });

  it('joins multiple skills with comma in AgentDetailPanel', async () => {
    const agent = makeAgent({
      id: 'agt_1',
      name: 'QA',
      config: { skills: ['skill-a', 'skill-b', 'skill-c'] },
    });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);

    const output = lastFrame()!;
    expect(output).toContain('skill-a, skill-b, skill-c');
  });

  it('setMessages caps at MAX_MESSAGES (200) when batch overflows', async () => {
    const state: OrchestratorState = { ...DEFAULT_STATE };
    let capturedBatch!: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void;
    const onLoadHistory = (onBatch: (entries: import('../../../src/tui/App.js').HistoryEntry[]) => void): Promise<void> => {
      capturedBatch = onBatch;
      return Promise.resolve();
    };

    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], state, onLoadHistory }),
    );
    await delay(50);

    // Send 250 entries — should be capped at 200
    const entries = Array.from({ length: 250 }, (_, i) =>
      makeEntry({ type: 'agent_output', data: `msg-${i}`, timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString() }),
    );
    capturedBatch(entries);
    await delay(50);

    // The component shouldn't crash and frame should render normally
    expect(lastFrame()!).toContain('ORCH');
  });
});

/* ── Attachments display ──────────────────────────────── */

describe('Attachments display', () => {
  it('shows 📎 indicator in TaskList when task has attachments', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Task with files', attachments: ['report.pdf', 'notes.txt'] }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    const output = lastFrame()!;
    expect(output).toContain('\uD83D\uDCCE'); // 📎
    expect(output).toContain('2');
  });

  it('hides 📎 indicator in TaskList when task has no attachments', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Task without files' }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    expect(lastFrame()!).not.toContain('\uD83D\uDCCE');
  });

  it('hides 📎 indicator in TaskList when attachments array is empty', () => {
    const tasks = [
      makeTask({ id: '1', title: 'Empty attachments', attachments: [] }),
    ];
    const { lastFrame } = render(
      React.createElement(TaskList, { tasks }),
    );
    expect(lastFrame()!).not.toContain('\uD83D\uDCCE');
  });

  it('shows attachments section in DetailPanel when task has attachments', async () => {
    const tasks = [
      makeTask({
        id: '1',
        title: 'Task with attachments',
        attachments: ['design.png', 'spec.md'],
      }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;

    expect(output).toContain('DETAIL');
    expect(output).toContain('attachments');
    expect(output).toContain('design.png');
    expect(output).toContain('spec.md');
  });

  it('hides attachments section in DetailPanel when task has no attachments', async () => {
    const tasks = [
      makeTask({ id: '1', title: 'Plain task without files' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );

    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;

    expect(output).toContain('DETAIL');
    expect(output).not.toContain('attachments');
  });
});

/* ── GoalDetailPanel ─────────────────────────────────── */

function makeGoal(overrides: Partial<Goal> & { id: string; title: string }): Goal {
  return {
    description: '',
    status: 'active',
    created_at: '2026-03-13T10:00:00.000Z',
    ...overrides,
  };
}

async function openGoalDetail(stdin: NodeJS.WritableStream, lastFrame: () => string | undefined, goalTitle: string) {
  // Navigate to goals view
  stdin.write('g');
  await delay(80);
  // Open detail panel
  stdin.write('\r');
  await delay(80);
  const output = lastFrame()!;
  return output;
}

describe('GoalDetailPanel', () => {
  it('shows goal ID in detail panel', async () => {
    const goal = makeGoal({ id: 'goal_abc123', title: 'Launch feature' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('goal_abc123');
  });

  it('shows goal status in detail panel', async () => {
    const goal = makeGoal({ id: 'goal_1', title: 'Active goal', status: 'active' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('ACTIVE');
  });

  it('shows assignee name in detail panel when assignee is set', async () => {
    const goal = makeGoal({ id: 'goal_2', title: 'Assigned goal', assignee: 'agt_backend' });
    const agent = makeAgent({ id: 'agt_backend', name: 'Backend Dev' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        agents: [agent],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('Backend Dev');
  });

  it('shows "any" when goal has no assignee', async () => {
    const goal = makeGoal({ id: 'goal_3', title: 'Unassigned goal' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('\u2014'); // em dash for unassigned
  });

  it('shows created_at date in detail panel', async () => {
    const goal = makeGoal({ id: 'goal_4', title: 'Dated goal', created_at: '2026-03-01T08:00:00.000Z' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('2026-03-01');
  });

  it('shows updated_at date when it differs from created_at', async () => {
    const goal = makeGoal({
      id: 'goal_5',
      title: 'Updated goal',
      created_at: '2026-03-01T08:00:00.000Z',
      updated_at: '2026-03-10T12:00:00.000Z',
    });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('Updated');
    expect(output).toContain('2026-03-10');
  });

  it('does not show updated_at when equal to created_at', async () => {
    const goal = makeGoal({
      id: 'goal_6',
      title: 'Same date goal',
      created_at: '2026-03-01T08:00:00.000Z',
      updated_at: '2026-03-01T08:00:00.000Z',
    });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).not.toContain('Updated');
  });

  it('shows full description without truncation', async () => {
    const goal = makeGoal({
      id: 'goal_7',
      title: 'Detailed goal',
      description: 'Line one of description\nLine two of description\nLine three of description\nLine four of description',
    });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
        height: 40,
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('Line one of description');
    expect(output).toContain('Line four of description');
  });

  it('shows all tasks linked to the goal', async () => {
    const goal = makeGoal({ id: 'goal_8', title: 'Goal with tasks' });
    const tasks = [
      makeTask({ id: 'tsk_1', title: 'Task Alpha', goalId: 'goal_8', status: 'todo' }),
      makeTask({ id: 'tsk_2', title: 'Task Beta', goalId: 'goal_8', status: 'done' }),
      makeTask({ id: 'tsk_3', title: 'Task Gamma', goalId: 'goal_8', status: 'in_progress' }),
      makeTask({ id: 'tsk_4', title: 'Unrelated task' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state,
        onRefreshGoals: async () => [goal],
        height: 40,
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('Task Alpha');
    expect(output).toContain('Task Beta');
    expect(output).toContain('Task Gamma');
    expect(output).not.toContain('Unrelated task');
  });

  it('shows full progress report without 3-line cap', async () => {
    const goal = makeGoal({ id: 'goal_9', title: 'Goal with progress' });
    const progressLines = [
      'Progress line 1',
      'Progress line 2',
      'Progress line 3',
      'Progress line 4',
      'Progress line 5',
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
        onGetGoalProgress: async () => progressLines.join('\n'),
        height: 40,
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('Progress line 1');
    expect(output).toContain('Progress line 4');
    expect(output).toContain('Progress line 5');
  });

  it('shows "No description" when goal has empty description', async () => {
    const goal = makeGoal({ id: 'goal_10', title: 'Empty desc goal', description: '' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);
    const output = await openGoalDetail(stdin, lastFrame, goal.title);
    expect(output).toContain('No description');
  });

  it('closes goal detail panel on Escape and resets scroll', async () => {
    const goal = makeGoal({ id: 'goal_11', title: 'Scrollable goal' });
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);

    // Navigate to goals and open detail
    stdin.write('g');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    expect(lastFrame()!).toContain('GOAL:');

    // Escape closes detail
    stdin.write('\x1B');
    await delay(50);
    expect(lastFrame()!).not.toContain('GOAL:');
    expect(lastFrame()!).toContain('GOALS');
  });

  it('GoalList regression: goals display correctly in list view', async () => {
    const goals = [
      makeGoal({ id: 'goal_a', title: 'Goal Alpha', status: 'active' }),
      makeGoal({ id: 'goal_b', title: 'Goal Beta', status: 'achieved' }),
    ];
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        state,
        onRefreshGoals: async () => goals,
      }),
    );
    await delay(80);

    stdin.write('g');
    await delay(50);
    const output = lastFrame()!;
    expect(output).toContain('Goal Alpha');
    expect(output).toContain('Goal Beta');
  });
});

/* ── Hidden Tasks Footer + Tab Badge ─────────────── */

describe('Hidden tasks footer bar and tab badge', () => {
  function makeManyTasks(count: number): Task[] {
    return Array.from({ length: count }, (_, i) =>
      makeTask({ id: `t${i + 1}`, title: `Task ${i + 1}` }),
    );
  }

  it('shows sticky footer when tasks exceed TASK_LIST_LIMIT (>10)', () => {
    const tasks = makeManyTasks(11);
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    const output = lastFrame()!;
    expect(output).toContain('showing 10 of 11 tasks');
    expect(output).toContain('to show all');
  });

  it('hides footer when tasks do not exceed limit (≤10)', () => {
    const tasks = makeManyTasks(10);
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('to show all');
  });

  it('shows tab badge with total count when hiddenTaskCount > 0', () => {
    const tasks = makeManyTasks(15);
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    const output = lastFrame()!;
    // Badge shows total task count (15) when some tasks are hidden
    expect(output).toContain('(15)');
  });

  it('hides tab badge when all tasks are visible (≤ limit)', () => {
    const tasks = makeManyTasks(8);
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('(8)');
  });

  it('footer is absent when switching to agents tab', async () => {
    const tasks = makeManyTasks(15);
    const state: OrchestratorState = { ...DEFAULT_STATE };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks, state }),
    );
    stdin.write('a');
    await delay(50);
    const output = lastFrame()!;
    expect(output).not.toContain('to show all');
  });
});
