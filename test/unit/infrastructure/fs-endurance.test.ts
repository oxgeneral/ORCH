/**
 * Filesystem endurance tests.
 *
 * Validates that .orchestry/ filesystem operations remain
 * correct and performant under sustained load conditions.
 *
 * Uses real temp directories — no mocks.
 * Timeout: 30s per test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  appendJsonl,
  readJsonlTail,
  atomicWrite,
  readJsonl,
  writeJson,
  readJson,
} from '../../../src/infrastructure/storage/fs-utils.js';

// Track temp dirs for cleanup
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-fs-endurance-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  tempDirs.length = 0;
});

describe('FS endurance', { timeout: 30_000 }, () => {
  /**
   * Test 1 — JSONL rotation need
   * Append 5000 records of ~200 bytes each.
   * Verify file size grows as expected and readJsonlTail(50) is still fast.
   */
  it('JSONL growth: 5000 records append and tail read stays fast', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'events.jsonl');

    // Generate a ~200 byte record
    const makeRecord = (i: number) => ({
      type: 'agent:output',
      timestamp: '2026-03-14T00:00:00.000Z',
      agentId: `agt_${String(i).padStart(5, '0')}`,
      data: 'x'.repeat(120), // pad to ~200 bytes per JSON line
    });

    // Append 5000 records
    for (let i = 0; i < 5000; i++) {
      await appendJsonl(filePath, makeRecord(i));
    }

    // Check file size — should be roughly 5000 * ~200 bytes = ~1MB
    const stat = await fs.stat(filePath);
    expect(stat.size).toBeGreaterThan(500_000); // at least 500KB
    expect(stat.size).toBeLessThan(5_000_000); // less than 5MB

    // readJsonlTail(50) should be fast (<100ms)
    const start = performance.now();
    const tail = await readJsonlTail<{ type: string; agentId: string }>(filePath, 50);
    const elapsed = performance.now() - start;

    expect(tail).toHaveLength(50);
    expect(elapsed).toBeLessThan(100);

    // Verify last record is correct
    expect(tail[49]!.agentId).toBe('agt_04999');
  });

  /**
   * Test 2 — Concurrent appendJsonl writers
   * 50 parallel writers, each appending 100 records.
   * Every line in the resulting file must be valid JSON (no interleaving).
   */
  it('concurrent appendJsonl: 50 writers × 100 records — no interleaved lines', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'concurrent.jsonl');

    const WRITERS = 50;
    const RECORDS_PER_WRITER = 100;

    // Launch all writers in parallel
    const writers = Array.from({ length: WRITERS }, (_, w) => {
      return (async () => {
        for (let r = 0; r < RECORDS_PER_WRITER; r++) {
          await appendJsonl(filePath, {
            writer: w,
            seq: r,
            ts: '2026-03-14T00:00:00.000Z',
          });
        }
      })();
    });

    await Promise.all(writers);

    // Read the raw file and validate every line
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);

    expect(lines).toHaveLength(WRITERS * RECORDS_PER_WRITER);

    let corruptCount = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { writer: number; seq: number };
        expect(typeof parsed.writer).toBe('number');
        expect(typeof parsed.seq).toBe('number');
      } catch {
        corruptCount++;
      }
    }

    expect(corruptCount).toBe(0);
  });

  /**
   * Test 3 — atomicWrite under pressure
   * 100 parallel atomicWrite calls to the same file.
   * The final file must contain valid content (not corrupted).
   */
  it('atomicWrite under pressure: 100 parallel writes — file is valid', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'state.json');

    const WRITES = 100;

    // Launch 100 parallel atomic writes
    const writers = Array.from({ length: WRITES }, (_, i) => {
      const content = JSON.stringify({ version: 1, seq: i, data: 'a'.repeat(200) }) + '\n';
      return atomicWrite(filePath, content);
    });

    await Promise.all(writers);

    // File must exist and be valid JSON
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as { version: number; seq: number; data: string };

    expect(parsed.version).toBe(1);
    expect(typeof parsed.seq).toBe('number');
    expect(parsed.seq).toBeGreaterThanOrEqual(0);
    expect(parsed.seq).toBeLessThan(WRITES);
    expect(parsed.data).toBe('a'.repeat(200));
  });

  /**
   * Test 4 — readJsonlTail on large files
   * Create a ~2MB JSONL file, verify tail read doesn't load entire file.
   * Check memory usage stays reasonable.
   */
  it('readJsonlTail on large file: 2MB JSONL — no excessive memory', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'large.jsonl');

    // Write ~2MB of JSONL directly (faster than appendJsonl for setup)
    const lines: string[] = [];
    const record = { type: 'event', data: 'x'.repeat(400), ts: '2026-03-14T00:00:00Z' };
    const jsonLine = JSON.stringify(record);
    const TARGET_SIZE = 2 * 1024 * 1024; // 2MB
    const lineSize = Buffer.byteLength(jsonLine + '\n');
    const lineCount = Math.ceil(TARGET_SIZE / lineSize);

    for (let i = 0; i < lineCount; i++) {
      lines.push(jsonLine);
    }
    await fs.writeFile(filePath, lines.join('\n') + '\n');

    const stat = await fs.stat(filePath);
    expect(stat.size).toBeGreaterThan(1_500_000); // at least 1.5MB

    // Measure heap before and after
    const heapBefore = process.memoryUsage().heapUsed;

    const tail = await readJsonlTail<{ type: string }>(filePath, 50);

    const heapAfter = process.memoryUsage().heapUsed;
    const heapGrowth = heapAfter - heapBefore;

    expect(tail).toHaveLength(50);
    expect(tail[0]!.type).toBe('event');

    // Heap growth should be well under the full file size
    // Allow generous margin for GC variance, but it shouldn't grow by >1MB
    // for a 50-line tail read
    expect(heapGrowth).toBeLessThan(1_500_000);
  });

  /**
   * Test 5 — State.json growth simulation
   * Write a state with 100 running entries, 100 retry_queue entries,
   * and large stats numbers. Verify read/write roundtrip.
   */
  it('state.json growth: 100 running + 100 retry + large stats roundtrip', async () => {
    const dir = await makeTempDir();
    const statePath = path.join(dir, 'state.json');

    // Build a large state
    const running: Record<string, { run_id: string; agent_id: string; task_id: string; pid: number; started_at: string; last_event_at: string }> = {};
    for (let i = 0; i < 100; i++) {
      const key = `run_${String(i).padStart(3, '0')}`;
      running[key] = {
        run_id: key,
        agent_id: `agt_${i}`,
        task_id: `tsk_${i}`,
        pid: 10000 + i,
        started_at: '2026-03-14T00:00:00.000Z',
        last_event_at: '2026-03-14T12:00:00.000Z',
      };
    }

    const retryQueue = Array.from({ length: 100 }, (_, i) => ({
      task_id: `tsk_retry_${i}`,
      attempt: (i % 5) + 1,
      due_at: '2026-03-14T13:00:00.000Z',
      error: `Error message for task ${i}: some failure detail`,
    }));

    const state = {
      version: 1 as const,
      pid: 12345,
      started_at: '2026-03-14T00:00:00.000Z',
      onboardingCompleted: true,
      running,
      claimed: ['tsk_1', 'tsk_2', 'tsk_3', 'tsk_50', 'tsk_99'],
      retry_queue: retryQueue,
      stats: {
        total_runs: 999_999,
        total_tasks_completed: 500_000,
        total_tasks_failed: 10_000,
        total_tokens: { input: 1_000_000_000, output: 500_000_000, total: 1_500_000_000 },
        total_runtime_ms: 86_400_000 * 10, // 10 days in ms
      },
    };

    // Write
    await writeJson(statePath, state);

    // Verify file size is reasonable (should be several KB, not MB)
    const stat = await fs.stat(statePath);
    expect(stat.size).toBeGreaterThan(1000);
    expect(stat.size).toBeLessThan(200_000); // under 200KB

    // Read back
    const loaded = await readJson<typeof state>(statePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(Object.keys(loaded!.running)).toHaveLength(100);
    expect(loaded!.retry_queue).toHaveLength(100);
    expect(loaded!.stats.total_runs).toBe(999_999);
    expect(loaded!.stats.total_tokens.total).toBe(1_500_000_000);
    expect(loaded!.stats.total_runtime_ms).toBe(864_000_000);
    expect(loaded!.claimed).toHaveLength(5);
  });

  /**
   * Test 6 — EMFILE protection
   * Open 200 files via Promise.all with batching (batch=64).
   * Verify no EMFILE error.
   */
  it('EMFILE protection: 200 file operations with batch=64 — no EMFILE', async () => {
    const dir = await makeTempDir();
    const TOTAL = 200;
    const BATCH = 64;

    // Create 200 files first (sequentially to avoid EMFILE on creation)
    for (let i = 0; i < TOTAL; i++) {
      const filePath = path.join(dir, `file_${String(i).padStart(3, '0')}.json`);
      await fs.writeFile(filePath, JSON.stringify({ id: i, data: 'test' }));
    }

    // Read all 200 files in batches of 64
    let emfileError = false;
    const results: Array<{ id: number }> = [];

    for (let offset = 0; offset < TOTAL; offset += BATCH) {
      const batchEnd = Math.min(offset + BATCH, TOTAL);
      const batch = Array.from({ length: batchEnd - offset }, (_, j) => {
        const filePath = path.join(dir, `file_${String(offset + j).padStart(3, '0')}.json`);
        return fs.readFile(filePath, 'utf-8').then((content) => JSON.parse(content) as { id: number });
      });

      try {
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EMFILE') {
          emfileError = true;
          break;
        }
        throw err;
      }
    }

    expect(emfileError).toBe(false);
    expect(results).toHaveLength(TOTAL);

    // Verify all files were read correctly
    for (let i = 0; i < TOTAL; i++) {
      expect(results[i]!.id).toBe(i);
    }
  });
});
