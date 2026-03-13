/**
 * Soft-delete with undo — unit tests.
 *
 * Covers: scheduleDeletion, undoLastDeletion, executeDeletion timer,
 * needsForceStop agents, and Z key undo.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App, _resetPendingDeletionSeq } from '../../../src/tui/App.js';
import type { Task } from '../../../src/domain/task.js';
import { DEFAULT_STATE, type OrchestratorState } from '../../../src/domain/state.js';
import { makeTask, makeAgent } from '../application/helpers.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  _resetPendingDeletionSeq();
  vi.useRealTimers();
});

const baseState: OrchestratorState = { ...DEFAULT_STATE };

describe('Soft-delete with undo', () => {
  it('D key schedules task deletion and shows undo banner', async () => {
    const tasks = [makeTask({ id: 'tsk_1', title: 'My Task' })];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Press D to schedule deletion
    stdin.write('d');
    await delay(50);

    const output = lastFrame()!;
    // Should show undo banner with entity name
    expect(output).toContain('My Task');
    expect(output).toContain('undo');
    // Should NOT have called onDeleteTask yet (pending)
    expect(onDeleteTask).not.toHaveBeenCalled();
  });

  it('Z key undoes last pending deletion', async () => {
    const tasks = [makeTask({ id: 'tsk_1', title: 'Undo Me' })];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Schedule deletion
    stdin.write('d');
    await delay(50);
    expect(lastFrame()!).toContain('Undo Me');

    // Undo
    stdin.write('z');
    await delay(50);

    // Undo banner should be gone (no pending deletions)
    // onDeleteTask still not called
    expect(onDeleteTask).not.toHaveBeenCalled();
    // Activity feed should show restore message
    expect(lastFrame()!).toContain('restored');
  });

  it('uppercase Z also undoes', async () => {
    const tasks = [makeTask({ id: 'tsk_1', title: 'Undo Upper' })];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    stdin.write('d');
    await delay(50);

    stdin.write('Z');
    await delay(50);

    expect(onDeleteTask).not.toHaveBeenCalled();
    expect(lastFrame()!).toContain('restored');
  });

  it('executeDeletion calls onDeleteTask after timeout expires', async () => {
    vi.useFakeTimers();
    const tasks = [makeTask({ id: 'tsk_1', title: 'Will Delete' })];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Schedule deletion
    stdin.write('d');
    await vi.advanceTimersByTimeAsync(200);

    // Not yet — timer hasn't expired
    expect(onDeleteTask).not.toHaveBeenCalled();

    // Advance past UNDO_TIMEOUT_MS (5000ms) + timer interval (1000ms) + microtask
    await vi.advanceTimersByTimeAsync(6200);
    // queueMicrotask needs a flush
    await vi.advanceTimersByTimeAsync(100);

    expect(onDeleteTask).toHaveBeenCalledWith('tsk_1');
  });

  it('D key on agents view schedules agent deletion', async () => {
    const tasks: Task[] = [];
    const agents = [makeAgent({ id: 'agt_1', name: 'Backend Bot', status: 'idle' })];
    const onDeleteAgent = vi.fn().mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        agents,
        state: baseState,
        onDeleteAgent,
        messageBatchMs: 0,
      }),
    );

    // Switch to agents view
    stdin.write('a');
    await delay(50);

    // Press D to schedule agent deletion
    stdin.write('d');
    await delay(50);

    // Undo banner visible, deletion not yet executed
    expect(lastFrame()!).toContain('Backend Bot');
    expect(lastFrame()!).toContain('undo');
    expect(onDeleteAgent).not.toHaveBeenCalled();
  });

  it('running agent deletion marks needsForceStop in undo banner', async () => {
    const tasks: Task[] = [];
    const agents = [makeAgent({ id: 'agt_1', name: 'Running Bot', status: 'running', current_task: 'tsk_x' })];
    const state: OrchestratorState = {
      ...DEFAULT_STATE,
      running: { tsk_x: { task_id: 'tsk_x', agent_id: 'agt_1', run_id: 'run_1', started_at: '2026-01-01T00:00:00.000Z', pid: 12345 } },
    };
    const onDeleteAgent = vi.fn().mockResolvedValue(undefined);
    const onForceStopAgent = vi.fn().mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        agents,
        state,
        onDeleteAgent,
        onForceStopAgent,
        messageBatchMs: 0,
      }),
    );

    // Switch to agents view
    stdin.write('a');
    await delay(50);

    // Press D on running agent — should schedule with needsForceStop
    stdin.write('d');
    await delay(50);

    // Undo banner visible
    expect(lastFrame()!).toContain('Running Bot');
    expect(lastFrame()!).toContain('undo');
    // Not yet executed
    expect(onForceStopAgent).not.toHaveBeenCalled();
    expect(onDeleteAgent).not.toHaveBeenCalled();
  });

  it('scheduling multiple deletions creates multiple pending entries', async () => {
    const tasks = [
      makeTask({ id: 'tsk_1', title: 'Task A' }),
      makeTask({ id: 'tsk_2', title: 'Task B' }),
    ];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Delete first task
    stdin.write('d');
    await delay(50);

    // Navigate down and delete second
    stdin.write('j');
    await delay(50);
    stdin.write('d');
    await delay(50);

    const output = lastFrame()!;
    // Both should appear in undo banner
    expect(output).toContain('Task A');
    expect(output).toContain('Task B');
  });

  it('Z undoes only the last pending deletion', async () => {
    const tasks = [
      makeTask({ id: 'tsk_1', title: 'First' }),
      makeTask({ id: 'tsk_2', title: 'Second' }),
    ];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Delete first task
    stdin.write('d');
    await delay(50);

    // Navigate down and delete second
    stdin.write('j');
    await delay(50);
    stdin.write('d');
    await delay(50);

    // Undo last (Second)
    stdin.write('z');
    await delay(50);

    const output = lastFrame()!;
    // First still pending
    expect(output).toContain('First');
    // Restored message for Second
    expect(output).toContain('restored');
  });

  it('in_progress tasks cannot be deleted via D key', async () => {
    const tasks = [makeTask({ id: 'tsk_1', title: 'Running', status: 'in_progress' })];
    const onDeleteTask = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        projectName: 'test',
        tasks,
        state: baseState,
        onDeleteTask,
        messageBatchMs: 0,
      }),
    );

    // Try to delete in_progress task
    stdin.write('d');
    await delay(50);

    // Should NOT show undo banner (deletion not scheduled)
    const output = lastFrame()!;
    expect(output).not.toContain('undo');
    expect(onDeleteTask).not.toHaveBeenCalled();
  });
});
