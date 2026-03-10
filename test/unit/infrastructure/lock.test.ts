import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, releaseLock, checkLock } from '../../../src/infrastructure/storage/lock.js';

let tmpDir: string;
let lockPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-lock-'));
  lockPath = path.join(tmpDir, 'orchestry.lock');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('acquires lock on first call', async () => {
    const result = await acquireLock(lockPath);
    expect(result.acquired).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it('fails when lock is already held by current process', async () => {
    await acquireLock(lockPath);
    const result = await acquireLock(lockPath);
    expect(result.acquired).toBe(false);
    expect(result.pid).toBe(process.pid);
  });

  it('removes stale lock from dead PID', async () => {
    // Write a lock with a PID that definitely doesn't exist
    await fs.writeFile(lockPath, '999999999', 'utf-8');
    const result = await acquireLock(lockPath);
    expect(result.acquired).toBe(true);
  });
});

describe('releaseLock', () => {
  it('removes the lock file', async () => {
    await acquireLock(lockPath);
    await releaseLock(lockPath);

    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('does not throw when lock file does not exist', async () => {
    await expect(releaseLock(lockPath)).resolves.not.toThrow();
  });
});

describe('checkLock', () => {
  it('returns locked=false when no lock file', async () => {
    const result = await checkLock(lockPath);
    expect(result.locked).toBe(false);
  });

  it('returns locked=true for live process', async () => {
    await acquireLock(lockPath);
    const result = await checkLock(lockPath);
    expect(result.locked).toBe(true);
    expect(result.pid).toBe(process.pid);
  });

  it('returns locked=false for stale lock', async () => {
    await fs.writeFile(lockPath, '999999999', 'utf-8');
    const result = await checkLock(lockPath);
    expect(result.locked).toBe(false);
  });
});
