import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, releaseLock, _resetAcquireMutex } from '../../../src/infrastructure/storage/lock.js';

let tmpDir: string;
let lockPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-lock-race-'));
  lockPath = path.join(tmpDir, 'orchestry.lock');
});

afterEach(async () => {
  _resetAcquireMutex();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('acquireLock TOCTOU race conditions', () => {
  it('concurrent acquires on stale lock: exactly one wins', async () => {
    // Create a stale lock with a dead PID
    await fs.writeFile(lockPath, '999999999', 'utf-8');

    // Fire 5 concurrent acquires — only one should win
    const results = await Promise.all(
      Array.from({ length: 5 }, () => acquireLock(lockPath)),
    );

    const winners = results.filter((r) => r.acquired);
    expect(winners.length).toBe(1);
    expect(winners[0]!.pid).toBe(process.pid);

    // Losers should report acquired=false
    const losers = results.filter((r) => !r.acquired);
    expect(losers.length).toBe(4);
  });

  it('concurrent acquires on empty path: exactly one wins', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => acquireLock(lockPath)),
    );

    const winners = results.filter((r) => r.acquired);
    expect(winners.length).toBe(1);
    expect(winners[0]!.pid).toBe(process.pid);
  });

  it('stale lock file is removed after recovery', async () => {
    await fs.writeFile(lockPath, '999999999', 'utf-8');
    const result = await acquireLock(lockPath);
    expect(result.acquired).toBe(true);

    // Lock file should contain our PID, not the stale one
    const content = await fs.readFile(lockPath, 'utf-8');
    expect(parseInt(content.trim(), 10)).toBe(process.pid);
  });

  it('lock file contains correct PID after stale recovery', async () => {
    await fs.writeFile(lockPath, '999999999', 'utf-8');
    await acquireLock(lockPath);

    const content = await fs.readFile(lockPath, 'utf-8');
    expect(parseInt(content.trim(), 10)).toBe(process.pid);
  });

  it('rapid acquire-release cycles do not leak', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await acquireLock(lockPath);
      expect(result.acquired).toBe(true);
      await releaseLock(lockPath);
    }

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});
