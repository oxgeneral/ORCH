import { describe, it, expect } from 'vitest';

/**
 * Test the async mutex pattern used by Orchestrator.
 * We extract and test the mutex logic in isolation (same algorithm as withStateLock).
 */
describe('Orchestrator state mutex', () => {
  function createMutex() {
    let chain = Promise.resolve();
    return {
      withLock<T>(fn: () => Promise<T>): Promise<T> {
        let release: () => void;
        const next = new Promise<void>((resolve) => { release = resolve; });
        const prev = chain;
        chain = next;
        return prev.then(async () => {
          try {
            return await fn();
          } finally {
            release!();
          }
        });
      },
    };
  }

  it('serializes concurrent mutations', async () => {
    const mutex = createMutex();
    const order: number[] = [];

    // Simulate concurrent state mutations
    const p1 = mutex.withLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
    });

    const p2 = mutex.withLock(async () => {
      order.push(3);
      await new Promise((r) => setTimeout(r, 10));
      order.push(4);
    });

    const p3 = mutex.withLock(async () => {
      order.push(5);
    });

    await Promise.all([p1, p2, p3]);

    // Must execute in strict serial order despite different timings
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('releases lock even if fn throws', async () => {
    const mutex = createMutex();

    // First call throws
    const p1 = mutex.withLock(async () => {
      throw new Error('boom');
    }).catch(() => {});

    // Second call should still execute
    const result = await mutex.withLock(async () => 'ok');
    await p1;

    expect(result).toBe('ok');
  });

  it('prevents read-after-write race on shared state', async () => {
    const mutex = createMutex();
    let state = { counter: 0 };

    // Simulate tick + stop racing on the same state
    const ops = Array.from({ length: 20 }, (_, i) =>
      mutex.withLock(async () => {
        const current = state.counter;
        // Simulate async save gap where another tick could read stale state
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        state.counter = current + 1;
      }),
    );

    await Promise.all(ops);

    // Without mutex this would be < 20 due to lost updates
    expect(state.counter).toBe(20);
  });

  it('handles high contention without deadlock', async () => {
    const mutex = createMutex();
    let sum = 0;

    const ops = Array.from({ length: 100 }, () =>
      mutex.withLock(async () => {
        sum += 1;
      }),
    );

    await Promise.all(ops);
    expect(sum).toBe(100);
  });
});
