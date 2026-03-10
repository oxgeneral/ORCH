import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../../src/application/event-bus.js';
import type { OrchestratorEvent } from '../../../src/domain/events.js';
import type { Task } from '../../../src/domain/task.js';

function makeTask(): Task {
  return {
    id: 'tsk_1',
    title: 'Test',
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on / emit', () => {
    it('delivers events to matching handler', () => {
      const handler = vi.fn();
      bus.on('task:created', handler);

      const event: OrchestratorEvent = { type: 'task:created', task: makeTask() };
      bus.emit(event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not deliver events to non-matching handlers', () => {
      const handler = vi.fn();
      bus.on('task:assigned', handler);

      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple handlers for same event type', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('task:created', h1);
      bus.on('task:created', h2);

      bus.emit({ type: 'task:created', task: makeTask() });

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('returns an unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = bus.on('task:created', handler);

      unsub();
      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('removes a specific handler', () => {
      const handler = vi.fn();
      bus.on('task:created', handler);
      bus.off('task:created', handler);

      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('handler fires only once then auto-unsubscribes', () => {
      const handler = vi.fn();
      bus.once('task:created', handler);

      bus.emit({ type: 'task:created', task: makeTask() });
      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe that prevents even the first call', () => {
      const handler = vi.fn();
      const unsub = bus.once('task:created', handler);

      unsub();
      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onAny', () => {
    it('receives all event types', () => {
      const handler = vi.fn();
      bus.onAny(handler);

      bus.emit({ type: 'task:created', task: makeTask() });
      bus.emit({ type: 'orchestrator:tick', running: 1, queued: 2 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe removes from all event types', () => {
      const handler = vi.fn();
      const unsub = bus.onAny(handler);

      unsub();
      bus.emit({ type: 'task:created', task: makeTask() });
      bus.emit({ type: 'orchestrator:tick', running: 0, queued: 0 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('does not break event chain when handler throws', () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const badHandler = vi.fn(() => { throw new Error('boom'); });
      const goodHandler = vi.fn();

      bus.on('task:created', badHandler);
      bus.on('task:created', goodHandler);

      bus.emit({ type: 'task:created', task: makeTask() });

      expect(badHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledOnce();
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });
  });

  describe('clear', () => {
    it('removes all handlers', () => {
      const handler = vi.fn();
      bus.on('task:created', handler);
      bus.onAny(vi.fn());

      bus.clear();
      bus.emit({ type: 'task:created', task: makeTask() });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
