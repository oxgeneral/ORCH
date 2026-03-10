import { describe, it, expect } from 'vitest';
import { EventBuffer } from '../../../src/infrastructure/adapters/event-buffer.js';
import type { AgentEvent } from '../../../src/infrastructure/adapters/interface.js';

function makeEvent(data: string, type: AgentEvent['type'] = 'output'): AgentEvent {
  return { type, timestamp: '2026-01-01T00:00:00.000Z', data };
}

describe('EventBuffer', () => {
  it('push and take in FIFO order', async () => {
    const buf = new EventBuffer();
    await buf.push(makeEvent('a'));
    await buf.push(makeEvent('b'));
    expect((await buf.take())!.data).toBe('a');
    expect((await buf.take())!.data).toBe('b');
  });

  it('take waits for push', async () => {
    const buf = new EventBuffer();
    const p = buf.take();
    await buf.push(makeEvent('delayed'));
    expect((await p)!.data).toBe('delayed');
  });

  it('returns undefined after close on empty buffer', async () => {
    const buf = new EventBuffer();
    buf.close();
    expect(await buf.take()).toBeUndefined();
  });

  it('drains remaining events after close', async () => {
    const buf = new EventBuffer();
    await buf.push(makeEvent('x'));
    buf.close();
    expect((await buf.take())!.data).toBe('x');
    expect(await buf.take()).toBeUndefined();
  });

  it('tracks size correctly', async () => {
    const buf = new EventBuffer(4);
    expect(buf.size).toBe(0);
    await buf.push(makeEvent('1'));
    await buf.push(makeEvent('2'));
    expect(buf.size).toBe(2);
    await buf.take();
    expect(buf.size).toBe(1);
  });

  it('wraps around ring correctly', async () => {
    const buf = new EventBuffer(3);
    // Fill and drain to advance head/tail
    await buf.push(makeEvent('a'));
    await buf.push(makeEvent('b'));
    await buf.take(); // head=1
    await buf.take(); // head=2
    // Now push wraps around
    await buf.push(makeEvent('c'));
    await buf.push(makeEvent('d'));
    await buf.push(makeEvent('e'));
    expect((await buf.take())!.data).toBe('c');
    expect((await buf.take())!.data).toBe('d');
    expect((await buf.take())!.data).toBe('e');
  });

  it('applies backpressure when full', async () => {
    const buf = new EventBuffer(2);
    await buf.push(makeEvent('1'));
    await buf.push(makeEvent('2'));
    expect(buf.isFull).toBe(true);

    let pushed = false;
    const pushPromise = buf.push(makeEvent('3')).then(() => { pushed = true; });

    // push should be blocked
    await new Promise((r) => setTimeout(r, 10));
    expect(pushed).toBe(false);

    // Free space
    await buf.take();
    await pushPromise;
    expect(pushed).toBe(true);
  });

  it('async iterator drains all events', async () => {
    const buf = new EventBuffer();
    await buf.push(makeEvent('x'));
    await buf.push(makeEvent('y'));
    buf.close();

    const results: string[] = [];
    for await (const ev of buf) {
      results.push(ev.data as string);
    }
    expect(results).toEqual(['x', 'y']);
  });

  it('async iterator waits for events then stops on close', async () => {
    const buf = new EventBuffer();
    const results: string[] = [];

    const consumer = (async () => {
      for await (const ev of buf) {
        results.push(ev.data as string);
      }
    })();

    await buf.push(makeEvent('a'));
    await buf.push(makeEvent('b'));
    // Give consumer time to process
    await new Promise((r) => setTimeout(r, 10));
    buf.close();
    await consumer;
    expect(results).toEqual(['a', 'b']);
  });

  it('close unblocks waiting push', async () => {
    const buf = new EventBuffer(1);
    await buf.push(makeEvent('1'));
    const pushDone = buf.push(makeEvent('2'));
    buf.close();
    await pushDone; // should resolve without hanging
  });
});
