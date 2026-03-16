import { describe, it, expect, vi } from 'vitest';
import { runOnce } from '../../../src/cli/serve/once-runner.js';
import { EventBus } from '../../../src/application/event-bus.js';

function makeOrchestrator() {
  return {
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
  it('calls startWatch with skipAutonomousSeeding option', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([{ id: 'tsk_1', status: 'done' }]);
    const eventBus = new EventBus();

    await runOnce(orchestrator, taskStore, eventBus, 10);

    expect(orchestrator.startWatch).toHaveBeenCalledWith({ skipAutonomousSeeding: true });
  });

  it('calls startWatch and stop', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([{ id: 'tsk_1', status: 'done' }]);
    const eventBus = new EventBus();

    await runOnce(orchestrator, taskStore, eventBus, 10);

    expect(orchestrator.startWatch).toHaveBeenCalled();
    expect(orchestrator.stop).toHaveBeenCalled();
  });

  it('returns all_done when all tasks are done or cancelled', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'done' },
      { id: 'tsk_2', status: 'cancelled' },
    ]);
    const eventBus = new EventBus();

    const result = await runOnce(orchestrator, taskStore, eventBus, 10);
    expect(result).toBe('all_done');
  });

  it('returns has_failed when any task is failed', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'done' },
      { id: 'tsk_2', status: 'failed' },
    ]);
    const eventBus = new EventBus();

    const result = await runOnce(orchestrator, taskStore, eventBus, 10);
    expect(result).toBe('has_failed');
  });

  it('polls until all tasks reach terminal status', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'in_progress' },
      { id: 'tsk_2', status: 'todo' },
    ]);
    const eventBus = new EventBus();

    // After 50ms, move tasks to terminal
    setTimeout(() => {
      taskStore._setTasks([
        { id: 'tsk_1', status: 'done' },
        { id: 'tsk_2', status: 'done' },
      ]);
    }, 50);

    const result = await runOnce(orchestrator, taskStore, eventBus, 10);
    expect(result).toBe('all_done');
    expect(taskStore._getCallCount()).toBeGreaterThan(1);
  });

  it('exits immediately when task list is empty', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([]);
    const eventBus = new EventBus();

    const result = await runOnce(orchestrator, taskStore, eventBus, 10);
    expect(result).toBe('all_done');
    expect(taskStore._getCallCount()).toBe(1);
  });

  it('propagates taskStore.list() errors', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = {
      list: vi.fn(async () => { throw new Error('I/O error'); }),
    } as any;
    const eventBus = new EventBus();

    await expect(runOnce(orchestrator, taskStore, eventBus, 10)).rejects.toThrow('I/O error');
  });

  it('exits polling when orchestrator emits shutdown event', async () => {
    const orchestrator = makeOrchestrator();
    const taskStore = makeTaskStore([
      { id: 'tsk_1', status: 'in_progress' },
      { id: 'tsk_2', status: 'failed' },
    ]);
    const eventBus = new EventBus();

    // After 30ms, emit orchestrator:shutdown (simulating consecutive tick failures)
    setTimeout(() => {
      eventBus.emit({ type: 'orchestrator:shutdown', reason: '5 consecutive tick failures' });
    }, 30);

    const result = await runOnce(orchestrator, taskStore, eventBus, 10);
    // has a failed task → has_failed
    expect(result).toBe('has_failed');
    // Should have stopped polling (not waiting for in_progress to become terminal)
    expect(orchestrator.stop).toHaveBeenCalled();
  });
});
