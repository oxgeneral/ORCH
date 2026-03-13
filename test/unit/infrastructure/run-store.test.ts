import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RunStore } from '../../../src/infrastructure/storage/run-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { RunEvent } from '../../../src/domain/run.js';

let tmpDir: string;
let paths: Paths;
let store: RunStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-run-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry', 'runs'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new RunStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('RunStore.streamEvents', () => {
  it('skips corrupt JSONL lines and yields valid ones', async () => {
    const eventsPath = paths.runEventsPath('run-1');
    const validEvent: RunEvent = { type: 'agent_output', timestamp: '2025-01-01T00:00:00Z', data: { message: 'hello' } };
    const lines = [
      JSON.stringify(validEvent),
      'NOT VALID JSON {{{',
      JSON.stringify({ ...validEvent, data: { message: 'world' } }),
      '',
    ].join('\n');

    await fs.writeFile(eventsPath, lines);

    const collected: RunEvent[] = [];
    for await (const event of store.streamEvents('run-1')) {
      collected.push(event);
    }

    expect(collected).toHaveLength(2);
    expect(collected[0].data).toEqual({ message: 'hello' });
    expect(collected[1].data).toEqual({ message: 'world' });
  });

  it('handles file with only corrupt lines', async () => {
    const eventsPath = paths.runEventsPath('run-2');
    await fs.writeFile(eventsPath, 'bad line 1\nbad line 2\n');

    const collected: RunEvent[] = [];
    for await (const event of store.streamEvents('run-2')) {
      collected.push(event);
    }

    expect(collected).toHaveLength(0);
  });

  it('exits immediately when AbortSignal is already aborted and file does not exist', async () => {
    const ac = new AbortController();
    ac.abort();

    const collected: RunEvent[] = [];
    for await (const event of store.streamEvents('run-aborted', ac.signal)) {
      collected.push(event);
    }

    expect(collected).toHaveLength(0);
  });

  it('exits when 30s deadline passes without file appearing', async () => {
    // Spy on Date.now: first call sets deadline, subsequent calls return past deadline
    let callCount = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => {
      // First call: sets deadline = 0 + 30_000 = 30_000
      // All subsequent calls: return 30_001 (>= deadline → loop exits)
      return callCount++ === 0 ? 0 : 30_001;
    });

    try {
      const collected: RunEvent[] = [];
      for await (const event of store.streamEvents('run-no-file')) {
        collected.push(event);
      }
      expect(collected).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
