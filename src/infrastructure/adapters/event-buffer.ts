/**
 * Lock-free ring buffer for AgentEvent streaming.
 *
 * Replaces Array.shift() O(n) polling with O(1) dequeue
 * and event-driven notification instead of 50ms busy-wait.
 * Includes backpressure: when buffer is full, push() returns
 * a promise that resolves when space is available.
 */

import type { AgentEvent } from './interface.js';

const DEFAULT_CAPACITY = 1024;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export class EventBuffer {
  private buf: (AgentEvent | undefined)[];
  private head = 0;  // read index
  private tail = 0;  // write index
  private count = 0;
  private readonly capacity: number;

  // Consumer notification: resolved when new data is available
  private dataReady: Deferred<void> | null = null;
  // Producer notification: resolved when space is available
  private spaceReady: Deferred<void> | null = null;

  private closed = false;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  /** Number of buffered events. */
  get size(): number {
    return this.count;
  }

  get isFull(): boolean {
    return this.count >= this.capacity;
  }

  /**
   * Push an event into the buffer.
   * If the buffer is full, waits until space is available (backpressure).
   */
  async push(event: AgentEvent): Promise<void> {
    while (this.isFull && !this.closed) {
      if (!this.spaceReady) {
        this.spaceReady = deferred<void>();
      }
      await this.spaceReady.promise;
    }
    if (this.closed) return;

    this.buf[this.tail] = event;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;

    // Wake up consumer if waiting
    if (this.dataReady) {
      const dr = this.dataReady;
      this.dataReady = null;
      dr.resolve();
    }
  }

  /**
   * Dequeue the next event. O(1).
   * Returns undefined only when buffer is empty AND closed.
   */
  async take(): Promise<AgentEvent | undefined> {
    while (this.count === 0) {
      if (this.closed) return undefined;
      if (!this.dataReady) {
        this.dataReady = deferred<void>();
      }
      await this.dataReady.promise;
    }

    const event = this.buf[this.head];
    this.buf[this.head] = undefined; // allow GC
    this.head = (this.head + 1) % this.capacity;
    this.count--;

    // Wake up producer if waiting for space
    if (this.spaceReady) {
      const sr = this.spaceReady;
      this.spaceReady = null;
      sr.resolve();
    }

    return event;
  }

  /**
   * Signal that no more events will be pushed.
   * Wakes up any waiting consumer/producer.
   */
  close(): void {
    this.closed = true;
    if (this.dataReady) {
      const dr = this.dataReady;
      this.dataReady = null;
      dr.resolve();
    }
    if (this.spaceReady) {
      const sr = this.spaceReady;
      this.spaceReady = null;
      sr.resolve();
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Async iterator that drains the buffer until closed and empty.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      const event = await this.take();
      if (event === undefined) return;
      yield event;
    }
  }
}
