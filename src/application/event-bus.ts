/**
 * Typed event bus.
 *
 * The single communication channel between all layers.
 * Synchronous emit — handlers run inline.
 * TUI, logger, run store, state all subscribe independently.
 */

import type {
  OrchestratorEvent,
  OrchestratorEventType,
  EventPayload,
} from '../domain/events.js';

type Handler<T> = (event: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>();

  /**
   * Subscribe to events of a specific type.
   * Returns an unsubscribe function.
   */
  on<T extends OrchestratorEventType>(
    type: T,
    handler: Handler<EventPayload<T>>,
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => this.off(type, handler);
  }

  /**
   * Subscribe to an event type, auto-unsubscribe after first call.
   */
  once<T extends OrchestratorEventType>(
    type: T,
    handler: Handler<EventPayload<T>>,
  ): () => void {
    const wrapper: Handler<EventPayload<T>> = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }

  /**
   * Unsubscribe a handler from an event type.
   */
  off<T extends OrchestratorEventType>(
    type: T,
    handler: Handler<EventPayload<T>>,
  ): void {
    this.handlers.get(type)?.delete(handler);
  }

  /**
   * Emit an event synchronously to all subscribed handlers.
   */
  emit(event: OrchestratorEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        // Don't let a failing handler break the event chain
        console.error(`EventBus handler error for "${event.type}":`, err);
      }
    }
  }

  /**
   * Subscribe to ALL events regardless of type.
   */
  onAny(handler: Handler<OrchestratorEvent>): () => void {
    const unsubscribes: Array<() => void> = [];
    const allTypes: OrchestratorEventType[] = [
      'task:created',
      'task:assigned',
      'task:status_changed',
      'agent:started',
      'agent:output',
      'agent:file_changed',
      'agent:completed',
      'agent:error',
      'run:retry',
      'orchestrator:tick',
      'orchestrator:stall_detected',
    ];

    for (const type of allTypes) {
      unsubscribes.push(this.on(type, handler as Handler<any>));
    }

    return () => unsubscribes.forEach((unsub) => unsub());
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }
}
