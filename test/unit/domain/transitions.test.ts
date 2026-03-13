import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isTerminal,
  isDispatchable,
  isBlocked,
  resolveFailureStatus,
  resolveCompletionStatus,
  calculateRetryDelay,
} from '../../../src/domain/transitions.js';
import type { Task, TaskStatus } from '../../../src/domain/task.js';

// Helper to create a minimal task for testing
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test',
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

describe('canTransition', () => {
  const validTransitions: [TaskStatus, TaskStatus][] = [
    ['todo', 'in_progress'],
    ['todo', 'cancelled'],
    ['in_progress', 'review'],
    ['in_progress', 'retrying'],
    ['in_progress', 'failed'],
    ['in_progress', 'cancelled'],
    ['retrying', 'in_progress'],
    ['retrying', 'failed'],
    ['retrying', 'cancelled'],
    ['review', 'done'],
    ['review', 'todo'],
    ['review', 'cancelled'],
    ['failed', 'todo'],
    ['failed', 'retrying'],
    ['cancelled', 'todo'],
  ];

  it.each(validTransitions)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const invalidTransitions: [TaskStatus, TaskStatus][] = [
    ['todo', 'done'],
    ['todo', 'review'],
    ['todo', 'failed'],
    ['todo', 'retrying'],
    ['in_progress', 'done'],
    ['in_progress', 'todo'],
    ['in_progress', 'in_progress'],
    ['retrying', 'todo'],
    ['retrying', 'review'],
    ['retrying', 'done'],
    ['review', 'in_progress'],
    ['review', 'failed'],
    ['done', 'todo'],
    ['done', 'in_progress'],
    ['done', 'cancelled'],
    ['cancelled', 'in_progress'],
    ['cancelled', 'done'],
  ];

  it.each(invalidTransitions)('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('isTerminal', () => {
  it('returns true for terminal statuses', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminal('todo')).toBe(false);
    expect(isTerminal('in_progress')).toBe(false);
    expect(isTerminal('retrying')).toBe(false);
    expect(isTerminal('review')).toBe(false);
  });
});

describe('isDispatchable', () => {
  it('returns true for todo and retrying', () => {
    expect(isDispatchable('todo')).toBe(true);
    expect(isDispatchable('retrying')).toBe(true);
  });

  it('returns false for all other statuses', () => {
    expect(isDispatchable('in_progress')).toBe(false);
    expect(isDispatchable('review')).toBe(false);
    expect(isDispatchable('done')).toBe(false);
    expect(isDispatchable('failed')).toBe(false);
    expect(isDispatchable('cancelled')).toBe(false);
  });
});

describe('isBlocked', () => {
  it('returns false when task has no dependencies', () => {
    const task = makeTask({ depends_on: [] });
    expect(isBlocked(task, [])).toBe(false);
  });

  it('returns false when all dependencies are done', () => {
    const dep = makeTask({ id: 'tsk_dep', status: 'done' });
    const task = makeTask({ depends_on: ['tsk_dep'] });
    expect(isBlocked(task, [dep, task])).toBe(false);
  });

  it('returns true when a dependency is not done', () => {
    const dep = makeTask({ id: 'tsk_dep', status: 'in_progress' });
    const task = makeTask({ depends_on: ['tsk_dep'] });
    expect(isBlocked(task, [dep, task])).toBe(true);
  });

  it('returns true when a dependency does not exist', () => {
    const task = makeTask({ depends_on: ['tsk_missing'] });
    expect(isBlocked(task, [task])).toBe(true);
  });

  it('handles multiple dependencies (all must be done)', () => {
    const dep1 = makeTask({ id: 'tsk_d1', status: 'done' });
    const dep2 = makeTask({ id: 'tsk_d2', status: 'todo' });
    const task = makeTask({ depends_on: ['tsk_d1', 'tsk_d2'] });
    expect(isBlocked(task, [dep1, dep2, task])).toBe(true);
  });
});

describe('resolveFailureStatus', () => {
  it('returns retrying when attempts < max_attempts', () => {
    const task = makeTask({ attempts: 1, max_attempts: 3 });
    expect(resolveFailureStatus(task)).toBe('retrying');
  });

  it('returns failed when attempts equals max_attempts', () => {
    const task = makeTask({ attempts: 3, max_attempts: 3 });
    expect(resolveFailureStatus(task)).toBe('failed');
  });

  it('returns failed when attempts exceed max_attempts', () => {
    const task = makeTask({ attempts: 5, max_attempts: 3 });
    expect(resolveFailureStatus(task)).toBe('failed');
  });

  it('returns retrying on first attempt (0 of 3)', () => {
    const task = makeTask({ attempts: 0, max_attempts: 3 });
    expect(resolveFailureStatus(task)).toBe('retrying');
  });

  it('returns failed when max_attempts is 1 and attempts is 1', () => {
    const task = makeTask({ attempts: 1, max_attempts: 1 });
    expect(resolveFailureStatus(task)).toBe('failed');
  });
});

describe('resolveCompletionStatus', () => {
  it('returns review on success with auto-approve (review enforced)', () => {
    const task = makeTask({ attempts: 1, max_attempts: 3 });
    expect(resolveCompletionStatus(task, true, true)).toBe('review');
  });

  it('returns review on success without auto-approve', () => {
    const task = makeTask({ attempts: 1, max_attempts: 3 });
    expect(resolveCompletionStatus(task, true, false)).toBe('review');
  });

  it('returns retrying on failure when attempts remain', () => {
    const task = makeTask({ attempts: 1, max_attempts: 3 });
    expect(resolveCompletionStatus(task, false, false)).toBe('retrying');
  });

  it('returns failed on failure when max attempts reached', () => {
    const task = makeTask({ attempts: 3, max_attempts: 3 });
    expect(resolveCompletionStatus(task, false, false)).toBe('failed');
  });

  it('returns failed when attempts exceed max', () => {
    const task = makeTask({ attempts: 5, max_attempts: 3 });
    expect(resolveCompletionStatus(task, false, false)).toBe('failed');
  });

  it('delegates to resolveFailureStatus on failure — consistent results', () => {
    const task = makeTask({ attempts: 2, max_attempts: 3 });
    expect(resolveCompletionStatus(task, false, false)).toBe(resolveFailureStatus(task));
  });
});

describe('calculateRetryDelay', () => {
  it('calculates exponential backoff', () => {
    expect(calculateRetryDelay(0, 1000, 60000)).toBe(1000);
    expect(calculateRetryDelay(1, 1000, 60000)).toBe(2000);
    expect(calculateRetryDelay(2, 1000, 60000)).toBe(4000);
    expect(calculateRetryDelay(3, 1000, 60000)).toBe(8000);
  });

  it('caps at maxDelayMs', () => {
    expect(calculateRetryDelay(10, 1000, 60000)).toBe(60000);
    expect(calculateRetryDelay(20, 1000, 60000)).toBe(60000);
  });

  it('works with zero attempt', () => {
    expect(calculateRetryDelay(0, 500, 10000)).toBe(500);
  });
});
