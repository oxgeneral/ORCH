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
  private wildcardHandlers = new Set<Handler<OrchestratorEvent>>();
  private maxListeners: number = 10;
  private warnedTypes = new Set<string>();

  /**
   * Set the maximum number of listeners per event type before a warning is emitted.
   * Helps detect memory leaks from repeated subscriptions in watch mode.
   */
  setMaxListeners(n: number): void {
    this.maxListeners = n;
  }

  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * Get the number of listeners for a specific event type.
   */
  listenerCount(type: OrchestratorEventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

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
    const set = this.handlers.get(type)!;
    set.add(handler);

    // Warn once per type when listener count exceeds maxListeners
    if (this.maxListeners > 0 && set.size > this.maxListeners && !this.warnedTypes.has(type)) {
      this.warnedTypes.add(type);
      console.warn(
        `EventBus: possible memory leak detected. ${set.size} listeners added for "${type}". ` +
        `Use setMaxListeners() to increase limit if this is intentional.`,
      );
    }

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
    const typed = this.handlers.get(event.type);
    if (typed) this.dispatchToSet(typed, event, 'handler');
    this.dispatchToSet(this.wildcardHandlers, event, 'wildcard handler');
  }

  private dispatchToSet(handlers: Iterable<Handler<any>>, event: OrchestratorEvent, label: string): void {
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error(`EventBus ${label} error for "${event.type}":`, err);
      }
    }
  }

  /**
   * Subscribe to ALL events regardless of type.
   */
  onAny(handler: Handler<OrchestratorEvent>): () => void {
    this.wildcardHandlers.add(handler);

    if (
      this.maxListeners > 0 &&
      this.wildcardHandlers.size > this.maxListeners &&
      !this.warnedTypes.has('*')
    ) {
      this.warnedTypes.add('*');
      console.warn(
        `EventBus: possible memory leak detected. ${this.wildcardHandlers.size} wildcard listeners added. ` +
        `Use setMaxListeners() to increase limit if this is intentional.`,
      );
    }

    return () => { this.wildcardHandlers.delete(handler); };
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.warnedTypes.clear();
  }
}
