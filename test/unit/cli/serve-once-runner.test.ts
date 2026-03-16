import { describe, it, expect, vi } from 'vitest';
import { runOnce } from '../../../src/cli/serve/once-runner.js';

function makeOrchestrator() {
  return {
    skipAutonomousSeeding: false,
    startWatch: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  } as any;
}

function makeTaskStore(initialTasks: Array<{ id: string; status: string }>) {
  let tasks = initialTasks;
  let callCount = 0;
  return {
    list: vi.fn(async () => {
      callCount++;
      return tasks;
    }),
    _setTasks(newTasks: Array<{ id: string; status: string }>) {
      tasks = newTasks;
    },
    _getCallCount() { return callCount; },
  } as any;
}

describe('runOnce', () => {
  it('sets skipAutonomousSeeding=true on orchestrator', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([{ id: 'tsk_1', status: 'done' }]);

    await runOnce(orchestrator, taskStore, 10);

    expect(orchestrator.skipAutonomousSeeding).toBe(true);
  });

  it('calls startWatch and stop', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([{ id: 'tsk_1', status: 'done' }]);

    await runOnce(orchestrator, taskStore, 10);

    expect(orchestrator.startWatch).toHaveBeenCalled();
    expect(orchestrator.stop).toHaveBeenCalled();
  });

  it('returns all_done when all tasks are done or cancelled', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'done' },
      { id: 'tsk_2', status: 'cancelled' },
    ]);

    const result = await runOnce(orchestrator, taskStore, 10);
    expect(result).toBe('all_done');
  });

  it('returns has_failed when any task is failed', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'done' },
      { id: 'tsk_2', status: 'failed' },
    ]);

    const result = await runOnce(orchestrator, taskStore, 10);
    expect(result).toBe('has_failed');
  });

  it('polls until all tasks reach terminal status', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'in_progress' },
      { id: 'tsk_2', status: 'todo' },
    ]);

    // After 50ms, move tasks to terminal
    setTimeout(() => {
      taskStore._setTasks([
        { id: 'tsk_1', status: 'done' },
        { id: 'tsk_2', status: 'done' },
      ]);
    }, 50);

    const result = await runOnce(orchestrator, taskStore, 10);
    expect(result).toBe('all_done');
    expect(taskStore._getCallCount()).toBeGreaterThan(1);
  });

  it('exits immediately when task list is empty', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([]);

    const result = await runOnce(orchestrator, taskStore, 10);
    expect(result).toBe('all_done');
    // Should have polled only once
    expect(taskStore._getCallCount()).toBe(1);
  });

  it('propagates taskStore.list() errors', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = {
      list: vi.fn(async () => { throw new Error('I/O error'); }),
    } as any;

    await expect(runOnce(orchestrator, taskStore, 10)).rejects.toThrow('I/O error');
  });
});
