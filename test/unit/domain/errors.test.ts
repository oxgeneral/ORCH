import { describe, it, expect } from 'vitest';
import {
  OrchestryError,
  NotInitializedError,
  InvalidArgumentsError,
  LockConflictError,
  AgentAdapterError,
  NoAgentsError,
  TaskNotFoundError,
  AgentNotFoundError,
  TaskAlreadyRunningError,
  InvalidTransitionError,
} from '../../../src/domain/errors.js';

describe('OrchestryError', () => {
  it('stores message, exitCode, and hint', () => {
    const err = new OrchestryError('test error', 42, 'do something');
    expect(err.message).toBe('test error');
    expect(err.exitCode).toBe(42);
    expect(err.hint).toBe('do something');
    expect(err.name).toBe('OrchestryError');
  });

  it('is an instance of Error', () => {
    const err = new OrchestryError('msg', 1);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OrchestryError);
  });

  it('hint is optional', () => {
    const err = new OrchestryError('msg', 1);
    expect(err.hint).toBeUndefined();
  });
});

describe('NotInitializedError', () => {
  it('has exit code 3 and helpful hint', () => {
    const err = new NotInitializedError();
    expect(err.exitCode).toBe(3);
    expect(err.hint).toBe('Run: orch init');
    expect(err.message).toBe('Not initialized');
    expect(err.name).toBe('NotInitializedError');
    expect(err).toBeInstanceOf(OrchestryError);
  });
});

describe('InvalidArgumentsError', () => {
  it('has exit code 2', () => {
    const err = new InvalidArgumentsError('bad input');
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe('bad input');
    expect(err.name).toBe('InvalidArgumentsError');
  });
});

describe('LockConflictError', () => {
  it('includes PID in message and has exit code 4', () => {
    const err = new LockConflictError(12345);
    expect(err.exitCode).toBe(4);
    expect(err.message).toContain('12345');
    expect(err.hint).toBe('Use: orch status');
    expect(err.name).toBe('LockConflictError');
  });
});

describe('AgentAdapterError', () => {
  it('has exit code 5 with adapter name and detail', () => {
    const err = new AgentAdapterError('claude', 'not installed');
    expect(err.exitCode).toBe(5);
    expect(err.message).toContain('claude');
    expect(err.hint).toBe('not installed');
    expect(err.name).toBe('AgentAdapterError');
  });
});

describe('NoAgentsError', () => {
  it('has exit code 1 and guidance hint', () => {
    const err = new NoAgentsError();
    expect(err.exitCode).toBe(1);
    expect(err.hint).toContain('orch agent add');
    expect(err.name).toBe('NoAgentsError');
  });
});

describe('TaskNotFoundError', () => {
  it('includes task ID in message', () => {
    const err = new TaskNotFoundError('tsk_abc');
    expect(err.message).toContain('tsk_abc');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('TaskNotFoundError');
  });
});

describe('AgentNotFoundError', () => {
  it('includes agent ID in message', () => {
    const err = new AgentNotFoundError('agt_xyz');
    expect(err.message).toContain('agt_xyz');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('AgentNotFoundError');
  });
});

describe('TaskAlreadyRunningError', () => {
  it('includes task, run, and agent info', () => {
    const err = new TaskAlreadyRunningError('tsk_1', 'run_2', 'claude-1');
    expect(err.message).toContain('tsk_1');
    expect(err.message).toContain('run_2');
    expect(err.message).toContain('claude-1');
    expect(err.hint).toContain('tsk_1');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('TaskAlreadyRunningError');
  });
});

describe('InvalidTransitionError', () => {
  it('includes task ID and transition info', () => {
    const err = new InvalidTransitionError('tsk_1', 'todo', 'done');
    expect(err.message).toContain('tsk_1');
    expect(err.message).toContain('todo');
    expect(err.message).toContain('done');
    expect(err.exitCode).toBe(1);
    expect(err.name).toBe('InvalidTransitionError');
  });
});
