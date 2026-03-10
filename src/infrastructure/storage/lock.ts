/**
 * PID-based lock file for single-process constraint.
 *
 * Only one `orch run --watch` can run at a time.
 * One-shot commands do not acquire the lock.
 */

import fs from 'node:fs/promises';
import { LockConflictError } from '../../domain/errors.js';

export interface LockResult {
  acquired: boolean;
  pid?: number;
}

/**
 * Try to acquire the lock file. Checks for stale locks (dead PIDs).
 */
export async function acquireLock(lockPath: string): Promise<LockResult> {
  // Check for stale lock first
  const existing = await readLockPid(lockPath);
  if (existing !== null) {
    if (isProcessAlive(existing)) {
      return { acquired: false, pid: existing };
    }
    // Stale lock — previous process died
    await fs.unlink(lockPath).catch(() => {});
  }

  // Atomic create: 'wx' flag fails if file already exists (prevents TOCTOU race)
  try {
    const fd = await fs.open(lockPath, 'wx');
    await fd.writeFile(String(process.pid), 'utf-8');
    await fd.close();
    return { acquired: true, pid: process.pid };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Another process created the lock between our check and create
      const pid = await readLockPid(lockPath);
      return { acquired: false, pid: pid ?? undefined };
    }
    throw err;
  }
}

/**
 * Release the lock file.
 */
export async function releaseLock(lockPath: string): Promise<void> {
  await fs.unlink(lockPath).catch(() => {});
}

/**
 * Check if a lock is held by a live process.
 */
export async function checkLock(lockPath: string): Promise<{ locked: boolean; pid?: number }> {
  const pid = await readLockPid(lockPath);

  if (pid === null) {
    return { locked: false };
  }

  if (isProcessAlive(pid)) {
    return { locked: true, pid };
  }

  // Stale lock
  return { locked: false };
}

/**
 * Acquire lock or throw LockConflictError.
 */
export async function requireLock(lockPath: string): Promise<void> {
  const result = await acquireLock(lockPath);
  if (!result.acquired && result.pid) {
    throw new LockConflictError(result.pid);
  }
}

async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
