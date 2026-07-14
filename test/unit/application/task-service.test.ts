import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../../../src/application/task-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import {
  TaskNotFoundError,
  InvalidTransitionError,
  InvalidArgumentsError,
} from '../../../src/domain/errors.js';
import type { Task } from '../../../src/domain/task.js';
import type { ITaskStore } from '../../../src/infrastructure/storage/interfaces.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test1',
    title: 'Test task',
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

function createMockTaskStore(tasks: Task[] = []): ITaskStore {
  const store = new Map(tasks.map((t) => [t.id, structuredClone(t)]));
  return {
    list: vi.fn(async (filter?) => {
      const all = [...store.values()];
      if (filter?.status) return all.filter((t) => t.status === filter.status);
      return all;
    }),
    get: vi.fn(async (id: string) => {
      const t = store.get(id);
      return t ? structuredClone(t) : null;
    }),
    save: vi.fn(async (task: Task) => {
      store.set(task.id, structuredClone(task));
    }),
    delete: vi.fn(async (id: string) => {
      store.delete(id);
    }),
  };
}

describe('TaskService', () => {
  let taskStore: ITaskStore;
  let eventBus: EventBus;
  let service: TaskService;

  beforeEach(() => {
    taskStore = createMockTaskStore();
    eventBus = new EventBus();
    service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);
  });

  describe('create', () => {
    it('creates a task with defaults', async () => {
      const task = await service.create({ title: 'Do something' });
      expect(task.id).toMatch(/^tsk_/);
      expect(task.title).toBe('Do something');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe(DEFAULT_CONFIG.defaults.task.priority);
      expect(task.max_attempts).toBe(DEFAULT_CONFIG.defaults.task.max_attempts);
      expect(taskStore.save).toHaveBeenCalledWith(task);
    });

    it('emits task:created event', async () => {
      const handler = vi.fn();
      eventBus.on('task:created', handler);
      const task = await service.create({ title: 'New' });
      expect(handler).toHaveBeenCalledWith({ type: 'task:created', task });
    });

    it('throws on empty title', async () => {
      await expect(service.create({ title: '  ' })).rejects.toThrow(InvalidArgumentsError);
    });

    it('trims title and description', async () => {
      const task = await service.create({ title: ' hello ', description: ' desc ' });
      expect(task.title).toBe('hello');
      expect(task.description).toBe('desc');
    });

    it('rejects manual creation of internal lead goal roles', async () => {
      await expect(service.create({
        title: 'Escalate',
        goalId: 'goal_1',
        goalTaskRole: 'lead_review',
      })).rejects.toThrow(InvalidArgumentsError);
    });

    it('rejects invalid goal roles', async () => {
      await expect(service.create({
        title: 'Invalid role',
        goalId: 'goal_1',
        goalTaskRole: 'lead' as any,
      })).rejects.toThrow('Goal role must be "worker"');
    });

    describe('depends_on validation', () => {
      it('throws InvalidArgumentsError for unknown single task ID', async () => {
        await expect(
          service.create({ title: 'Task', depends_on: ['tsk_nonexistent'] }),
        ).rejects.toThrow(InvalidArgumentsError);
      });

      it('error message contains the unknown task ID', async () => {
        await expect(
          service.create({ title: 'Task', depends_on: ['tsk_missing1'] }),
        ).rejects.toThrow('tsk_missing1');
      });

      it('throws with all unknown IDs listed in error message', async () => {
        await expect(
          service.create({ title: 'Task', depends_on: ['tsk_bad1', 'tsk_bad2'] }),
        ).rejects.toThrow('tsk_bad1, tsk_bad2');
      });

      it('accepts valid existing task IDs', async () => {
        const existing = makeTask({ id: 'tsk_dep1' });
        taskStore = createMockTaskStore([existing]);
        service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

        const task = await service.create({ title: 'Dependent', depends_on: ['tsk_dep1'] });
        expect(task.depends_on).toEqual(['tsk_dep1']);
      });

      it('accepts empty depends_on array without validation', async () => {
        const task = await service.create({ title: 'No deps', depends_on: [] });
        expect(task.depends_on).toEqual([]);
        expect(taskStore.get).not.toHaveBeenCalled();
      });

      it('accepts undefined depends_on without validation', async () => {
        const task = await service.create({ title: 'No deps' });
        expect(task.depends_on).toEqual([]);
        expect(taskStore.get).not.toHaveBeenCalled();
      });

      it('rejects when only some IDs are missing', async () => {
        const existing = makeTask({ id: 'tsk_real' });
        taskStore = createMockTaskStore([existing]);
        service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

        await expect(
          service.create({ title: 'Task', depends_on: ['tsk_real', 'tsk_fake'] }),
        ).rejects.toThrow('tsk_fake');
      });

      it('accepts multiple valid task IDs', async () => {
        const dep1 = makeTask({ id: 'tsk_dep1' });
        const dep2 = makeTask({ id: 'tsk_dep2' });
        taskStore = createMockTaskStore([dep1, dep2]);
        service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

        const task = await service.create({
          title: 'Multi-dep',
          depends_on: ['tsk_dep1', 'tsk_dep2'],
        });
        expect(task.depends_on).toEqual(['tsk_dep1', 'tsk_dep2']);
      });
    });
  });

  describe('get', () => {
    it('returns task when found', async () => {
      const existing = makeTask();
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);
      const task = await service.get('tsk_test1');
      expect(task.id).toBe('tsk_test1');
    });

    it('throws TaskNotFoundError when not found', async () => {
      await expect(service.get('tsk_missing')).rejects.toThrow(TaskNotFoundError);
    });
  });

  describe('updateStatus', () => {
    it('transitions valid status and emits event', async () => {
      const existing = makeTask({ status: 'todo' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const handler = vi.fn();
      eventBus.on('task:status_changed', handler);

      const task = await service.updateStatus('tsk_test1', 'in_progress');
      expect(task.status).toBe('in_progress');
      expect(handler).toHaveBeenCalledWith({
        type: 'task:status_changed',
        taskId: 'tsk_test1',
        from: 'todo',
        to: 'in_progress',
      });
    });

    it('throws InvalidTransitionError for invalid transition', async () => {
      const existing = makeTask({ status: 'todo' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      await expect(service.updateStatus('tsk_test1', 'done')).rejects.toThrow(
        InvalidTransitionError,
      );
    });
  });

  describe('assign', () => {
    it('sets assignee and emits event', async () => {
      const existing = makeTask();
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const handler = vi.fn();
      eventBus.on('task:assigned', handler);

      const task = await service.assign('tsk_test1', 'agt_1');
      expect(task.assignee).toBe('agt_1');
      expect(handler).toHaveBeenCalledWith({
        type: 'task:assigned',
        taskId: 'tsk_test1',
        agentId: 'agt_1',
      });
    });
  });

  describe('cancel', () => {
    it('cancels a todo task', async () => {
      const existing = makeTask({ status: 'todo' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const task = await service.cancel('tsk_test1');
      expect(task.status).toBe('cancelled');
    });

    it('throws on terminal task', async () => {
      const existing = makeTask({ status: 'done' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      await expect(service.cancel('tsk_test1')).rejects.toThrow(InvalidTransitionError);
    });

    it('cancels an in_progress task (process cleanup is orchestrator responsibility)', async () => {
      const existing = makeTask({ id: 'tsk_test1', status: 'in_progress' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const task = await service.cancel('tsk_test1');
      expect(task.status).toBe('cancelled');
    });
  });

  describe('retry', () => {
    it('resets failed task to todo with attempts=0', async () => {
      const existing = makeTask({ status: 'failed', attempts: 3 });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const handler = vi.fn();
      eventBus.on('task:status_changed', handler);

      const task = await service.retry('tsk_test1');
      expect(task.status).toBe('todo');
      expect(task.attempts).toBe(0);
      expect(handler).toHaveBeenCalledWith({
        type: 'task:status_changed',
        taskId: 'tsk_test1',
        from: 'failed',
        to: 'todo',
      });
    });

    it('resets cancelled task to todo', async () => {
      const existing = makeTask({ status: 'cancelled' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const task = await service.retry('tsk_test1');
      expect(task.status).toBe('todo');
    });

    it('throws on non-failed/cancelled task', async () => {
      const existing = makeTask({ status: 'todo' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      await expect(service.retry('tsk_test1')).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe('delete', () => {
    it('deletes a non-running task', async () => {
      const existing = makeTask({ status: 'done' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      await service.delete('tsk_test1');
      expect(taskStore.delete).toHaveBeenCalledWith('tsk_test1');
    });

    it('throws on running task', async () => {
      const existing = makeTask({ status: 'in_progress' });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      await expect(service.delete('tsk_test1')).rejects.toThrow(InvalidArgumentsError);
    });
  });

  describe('incrementAttempts', () => {
    it('increments attempts by 1', async () => {
      const existing = makeTask({ attempts: 1 });
      taskStore = createMockTaskStore([existing]);
      service = new TaskService(taskStore, eventBus, DEFAULT_CONFIG);

      const task = await service.incrementAttempts('tsk_test1');
      expect(task.attempts).toBe(2);
    });
  });
});
