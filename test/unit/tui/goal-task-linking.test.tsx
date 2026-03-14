/**
 * Tests for Goal-Task Visual Linking:
 * 1) TaskRow shows goal badge (⊕ title) when task.goalId is linked to a goal
 * 2) TaskRow does NOT show badge when goalId is absent
 * 3) GoalRow shows progress bar (████░░ done/total) with correct counts
 * 4) G toggle switches task grouping by goals
 * 5) Section headers show goal title, count, % done
 * 6) Ungrouped section for tasks without goal
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import { TaskRow } from '../../../src/tui/components/TaskList.js';
import { GoalSectionRow, UngroupedSectionRow } from '../../../src/tui/components/TaskList.js';
import { GoalRow } from '../../../src/tui/components/GoalList.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { Goal } from '../../../src/domain/goal.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2026-03-14T10:00:00.000Z',
    updated_at: '2026-03-14T10:00:00.000Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeGoal(overrides: Partial<Goal> & { id: string; title: string }): Goal {
  return {
    description: '',
    status: 'active',
    created_at: '2026-03-14T10:00:00.000Z',
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

/* ── TaskRow goal badge ─────────────────────────────── */

describe('TaskRow goal badge', () => {
  it('shows goal badge with ⊕ and goal title when task has goalId linked to a goal', () => {
    const goal = makeGoal({ id: 'goal_1', title: 'Ship feature' });
    const task = makeTask({ id: 'tsk_1', title: 'Build API', goalId: 'goal_1' });
    const goalMap = new Map<string, Goal>([[goal.id, goal]]);

    const { lastFrame } = render(
      React.createElement(TaskRow, { task, goalMap, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('\u2295'); // ⊕
    expect(output).toContain('Ship feature');
  });

  it('does NOT show goal badge when task has no goalId', () => {
    const task = makeTask({ id: 'tsk_2', title: 'No goal task' });
    const goalMap = new Map<string, Goal>();

    const { lastFrame } = render(
      React.createElement(TaskRow, { task, goalMap, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2295'); // ⊕ not shown
  });

  it('does NOT show goal badge when task has goalId but goal is not in goalMap', () => {
    const task = makeTask({ id: 'tsk_3', title: 'Orphaned goal task', goalId: 'goal_deleted' });
    const goalMap = new Map<string, Goal>(); // empty — goal not found

    const { lastFrame } = render(
      React.createElement(TaskRow, { task, goalMap, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2295'); // ⊕ not shown for missing goal
  });

  it('does NOT show goal badge when goalMap is undefined', () => {
    const task = makeTask({ id: 'tsk_4', title: 'Task no map', goalId: 'goal_1' });

    const { lastFrame } = render(
      React.createElement(TaskRow, { task, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2295');
  });

  it('truncates long goal title in badge', () => {
    const goal = makeGoal({ id: 'goal_5', title: 'This Is A Very Long Goal Title That Should Be Truncated' });
    const task = makeTask({ id: 'tsk_5', title: 'Some task', goalId: 'goal_5' });
    const goalMap = new Map<string, Goal>([[goal.id, goal]]);

    const { lastFrame } = render(
      React.createElement(TaskRow, { task, goalMap, width: 120 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('\u2295'); // ⊕ present
    // Should NOT contain the full title (it's truncated to 13 chars max)
    expect(output).not.toContain('This Is A Very Long Goal Title That Should Be Truncated');
  });
});

/* ── GoalRow progress bar ───────────────────────────── */

describe('GoalRow progress bar', () => {
  it('shows progress bar with filled and empty blocks when tasks exist', () => {
    const goal = makeGoal({ id: 'goal_p1', title: 'Goal with tasks' });
    const tasks = [
      makeTask({ id: 't1', title: 'T1', goalId: goal.id, status: 'done' }),
      makeTask({ id: 't2', title: 'T2', goalId: goal.id, status: 'done' }),
      makeTask({ id: 't3', title: 'T3', goalId: goal.id, status: 'todo' }),
    ];

    const { lastFrame } = render(
      React.createElement(GoalRow, { goal, tasksByGoal: tasks, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('\u2588'); // █ filled block
    expect(output).toContain('\u2591'); // ░ empty block
    expect(output).toContain('2/3');   // done/total count
  });

  it('shows no progress bar when tasksByGoal is empty', () => {
    const goal = makeGoal({ id: 'goal_p2', title: 'Goal no tasks' });

    const { lastFrame } = render(
      React.createElement(GoalRow, { goal, tasksByGoal: [], width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2588'); // no filled blocks
    expect(output).not.toContain('0/0');
  });

  it('shows no progress bar when tasksByGoal is undefined', () => {
    const goal = makeGoal({ id: 'goal_p3', title: 'Goal undefined tasks' });

    const { lastFrame } = render(
      React.createElement(GoalRow, { goal, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).not.toContain('\u2588');
  });

  it('shows correct count for all-done tasks', () => {
    const goal = makeGoal({ id: 'goal_p4', title: 'All done' });
    const tasks = [
      makeTask({ id: 'd1', title: 'D1', status: 'done' }),
      makeTask({ id: 'd2', title: 'D2', status: 'done' }),
    ];

    const { lastFrame } = render(
      React.createElement(GoalRow, { goal, tasksByGoal: tasks, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('2/2');
  });

  it('shows correct count for zero-done tasks', () => {
    const goal = makeGoal({ id: 'goal_p5', title: 'None done' });
    const tasks = [
      makeTask({ id: 'n1', title: 'N1', status: 'todo' }),
      makeTask({ id: 'n2', title: 'N2', status: 'in_progress' }),
    ];

    const { lastFrame } = render(
      React.createElement(GoalRow, { goal, tasksByGoal: tasks, width: 100 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('0/2');
  });
});

/* ── GoalSectionRow ─────────────────────────────────── */

describe('GoalSectionRow section header', () => {
  it('shows goal title, task count and % done in section header', () => {
    const { lastFrame } = render(
      React.createElement(GoalSectionRow, { goalTitle: 'Launch MVP', taskCount: 4, doneCount: 2, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('LAUNCH MVP');
    expect(output).toContain('4 tasks');
    expect(output).toContain('50% done');
    expect(output).toContain('\u2295'); // ⊕
  });

  it('shows 0% done when no tasks are complete', () => {
    const { lastFrame } = render(
      React.createElement(GoalSectionRow, { goalTitle: 'Goal Zero', taskCount: 3, doneCount: 0, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('0% done');
  });

  it('shows 100% done when all tasks complete', () => {
    const { lastFrame } = render(
      React.createElement(GoalSectionRow, { goalTitle: 'Goal Full', taskCount: 3, doneCount: 3, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('100% done');
  });

  it('shows singular "task" for single task', () => {
    const { lastFrame } = render(
      React.createElement(GoalSectionRow, { goalTitle: 'Solo', taskCount: 1, doneCount: 0, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('1 task');
    expect(output).not.toContain('1 tasks');
  });
});

/* ── UngroupedSectionRow ────────────────────────────── */

describe('UngroupedSectionRow', () => {
  it('shows ungrouped section with task count', () => {
    const { lastFrame } = render(
      React.createElement(UngroupedSectionRow, { taskCount: 3, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('UNGROUPED');
    expect(output).toContain('3 tasks');
    expect(output).toContain('\u2295'); // ⊕
  });

  it('shows singular "task" for 1 ungrouped task', () => {
    const { lastFrame } = render(
      React.createElement(UngroupedSectionRow, { taskCount: 1, width: 80 }),
    );
    const output = lastFrame()!;
    expect(output).toContain('1 task');
    expect(output).not.toContain('1 tasks');
  });
});

/* ── G toggle in App ────────────────────────────────── */

describe('G toggle — group tasks by goals', () => {
  it('G key on tasks view toggles groupByGoal — shows goal section header', async () => {
    const goal = makeGoal({ id: 'goal_g1', title: 'My Goal' });
    const task = makeTask({ id: 'tsk_g1', title: 'Linked task', goalId: 'goal_g1' });
    const state = { ...DEFAULT_STATE };

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [task],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);

    // Press G to enable groupByGoal
    stdin.write('g');
    await delay(80);

    const output = lastFrame()!;
    // GoalSectionRow should be visible with goal title in uppercase
    expect(output).toContain('MY GOAL');
  });

  it('tasks without goalId go to ungrouped section when groupByGoal is active', async () => {
    const goal = makeGoal({ id: 'goal_g2', title: 'Sprint A' });
    const linkedTask = makeTask({ id: 'tsk_linked', title: 'Linked task', goalId: 'goal_g2' });
    const freeTask = makeTask({ id: 'tsk_free', title: 'Free task' }); // no goalId
    const state = { ...DEFAULT_STATE };

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [linkedTask, freeTask],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);

    // Enable groupByGoal
    stdin.write('g');
    await delay(80);

    const output = lastFrame()!;
    expect(output).toContain('SPRINT A');
    expect(output).toContain('UNGROUPED');
  });

  it('G key a second time disables groupByGoal — section headers disappear', async () => {
    const goal = makeGoal({ id: 'goal_g3', title: 'Toggle Off' });
    const task = makeTask({ id: 'tsk_g3', title: 'Task', goalId: 'goal_g3' });
    const state = { ...DEFAULT_STATE };

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [task],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);

    // Enable then disable
    stdin.write('g');
    await delay(80);
    stdin.write('g');
    await delay(80);

    const output = lastFrame()!;
    // After second G, section header should be gone
    expect(output).not.toContain('TOGGLE OFF');
    // Task still visible in normal mode
    expect(output).toContain('Task');
  });

  it('flat list shown when groupByGoal is false (default)', async () => {
    const goal = makeGoal({ id: 'goal_g4', title: 'Default Goal' });
    const task1 = makeTask({ id: 'tsk_g4a', title: 'Task Alpha', goalId: 'goal_g4' });
    const task2 = makeTask({ id: 'tsk_g4b', title: 'Task Beta', goalId: 'goal_g4' });
    const state = { ...DEFAULT_STATE };

    const { lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [task1, task2],
        state,
        onRefreshGoals: async () => [goal],
      }),
    );
    await delay(80);

    const output = lastFrame()!;
    // In flat mode (default), no section headers
    expect(output).not.toContain('DEFAULT GOAL');
    // Both tasks visible
    expect(output).toContain('Task Alpha');
    expect(output).toContain('Task Beta');
  });

  it('G key only works on tasks view — no effect on agents view', async () => {
    const agent = makeAgent({ id: 'agt_1', name: 'Backend A' });
    const state = { ...DEFAULT_STATE };

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks: [],
        agents: [agent],
        state,
      }),
    );
    await delay(80);

    // Navigate to agents tab (right arrow)
    stdin.write('\x1b[C');
    await delay(80);

    // Press G on agents view — should navigate to goals (old behavior), not groupByGoal
    stdin.write('g');
    await delay(80);

    const output = lastFrame()!;
    // On agents view G navigates to goals tab, not task grouping
    // Output should show goals tab
    expect(output).toContain('GOALS');
  });
});
