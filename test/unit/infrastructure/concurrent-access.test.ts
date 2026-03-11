import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, readJsonl, writeJson, readJson } from '../../../src/infrastructure/storage/fs-utils.js';
import { StateStore } from '../../../src/infrastructure/storage/state-store.js';
import { RunStore } from '../../../src/infrastructure/storage/run-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { DEFAULT_STATE, type OrchestratorState } from '../../../src/domain/state.js';
import type { RunEvent } from '../../../src/domain/run.js';

describe('Concurrent access', () => {
  let tmpDir: string;
  let orchestryDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-concurrent-'));
    orchestryDir = path.join(tmpDir, '.orchestry');
    await fs.mkdir(path.join(orchestryDir, 'runs'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('parallel appendJsonl', () => {
    it('preserves all records when 20 writers append simultaneously', async () => {
      const filePath = path.join(orchestryDir, 'runs', 'test.jsonl');
      const count = 20;

      // Launch 20 concurrent appends
      const promises = Array.from({ length: count }, (_, i) =>
        appendJsonl(filePath, { index: i, timestamp: new Date().toISOString() }),
      );

      await Promise.all(promises);

      // Read all records back
      const records = await readJsonl<{ index: number }>(filePath);
      expect(records.length).toBe(count);

      // All indices should be present (order may vary)
      const indices = records.map((r) => r.index).sort((a, b) => a - b);
      expect(indices).toEqual(Array.from({ length: count }, (_, i) => i));
    });

    it('each line is valid JSON after concurrent writes', async () => {
      const filePath = path.join(orchestryDir, 'runs', 'validate.jsonl');
      const count = 50;

      const promises = Array.from({ length: count }, (_, i) =>
        appendJsonl(filePath, { data: `event_${i}`, payload: 'x'.repeat(100) }),
      );

      await Promise.all(promises);

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      expect(lines.length).toBe(count);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it('RunStore.appendEvent handles concurrent events', async () => {
      const paths = new Paths(tmpDir);
      const store = new RunStore(paths);

      const runId = 'run_concurrent1';
      const events: RunEvent[] = Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        type: 'agent_output' as const,
        data: `output line ${i}`,
      }));

      // Append all events concurrently
      await Promise.all(events.map((e) => store.appendEvent(runId, e)));

      const readBack = await store.readEvents(runId);
      expect(readBack.length).toBe(15);
    });
  });

  describe('concurrent state mutations', () => {
    it('atomicWrite prevents partial reads under concurrent writes', async () => {
      const statePath = path.join(orchestryDir, 'state.json');

      // Write initial state
      await writeJson(statePath, DEFAULT_STATE);

      // Launch 10 concurrent writes with different stats
      const promises = Array.from({ length: 10 }, (_, i) =>
        writeJson(statePath, {
          ...DEFAULT_STATE,
          stats: { ...DEFAULT_STATE.stats, total_runs: i },
        }),
      );

      await Promise.all(promises);

      // Read the final state — it should be valid JSON
      const final = await readJson<OrchestratorState>(statePath);
      expect(final).not.toBeNull();
      expect(final!.version).toBe(1);
      expect(typeof final!.stats.total_runs).toBe('number');
    });

    it('StateStore read/write cycle under concurrent access', async () => {
      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);

      // Write initial
      await store.write(structuredClone(DEFAULT_STATE));

      // Concurrent reads should all return valid state
      const reads = await Promise.all(
        Array.from({ length: 10 }, () => store.read()),
      );

      for (const state of reads) {
        expect(state.version).toBe(1);
        expect(state.running).toBeDefined();
        expect(state.claimed).toBeDefined();
        expect(state.retry_queue).toBeDefined();
        expect(state.stats).toBeDefined();
      }
    });

    it('interleaved read-write does not corrupt state', async () => {
      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);

      await store.write(structuredClone(DEFAULT_STATE));

      // Interleave reads and writes
      const ops = Array.from({ length: 20 }, (_, i) => {
        if (i % 2 === 0) {
          const state = structuredClone(DEFAULT_STATE);
          state.stats.total_runs = i;
          return store.write(state);
        }
        return store.read();
      });

      const results = await Promise.all(ops);

      // All read results should be valid states
      for (const result of results) {
        if (result !== undefined) {
          const state = result as OrchestratorState;
          expect(state.version).toBe(1);
          expect(typeof state.stats.total_runs).toBe('number');
        }
      }
    });
  });

  describe('concurrent lock scenarios', () => {
    it('file creation race — only one writer wins with wx flag', async () => {
      const lockPath = path.join(orchestryDir, 'race-lock');

      // Simulate 5 concurrent file creators using wx flag
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, async (_, i) => {
          const fd = await fs.open(lockPath, 'wx');
          await fd.writeFile(String(i), 'utf-8');
          await fd.close();
          return i;
        }),
      );

      // Exactly one should succeed
      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(4);

      // All failures should be EEXIST
      for (const f of failures) {
        expect((f as PromiseRejectedResult).reason.code).toBe('EEXIST');
      }
    });
  });

  describe('JSONL file integrity', () => {
    it('no interleaving of JSON records across lines', async () => {
      const filePath = path.join(orchestryDir, 'runs', 'integrity.jsonl');

      // Write large payloads concurrently to increase chance of interleaving
      const count = 30;
      const promises = Array.from({ length: count }, (_, i) =>
        appendJsonl(filePath, {
          index: i,
          // Large payload to increase write buffer size
          payload: 'x'.repeat(500),
        }),
      );

      await Promise.all(promises);

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      // Every line must be individually parseable
      let parseable = 0;
      for (const line of lines) {
        try {
          JSON.parse(line);
          parseable++;
        } catch {
          // Count failures
        }
      }

      expect(parseable).toBe(count);
    });
  });
});
