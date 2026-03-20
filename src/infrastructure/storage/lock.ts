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

// In-process mutex: serializes acquireLock calls to prevent
// concurrent async calls from racing on the same lock file.
let acquireMutex = Promise.resolve();

/** Reset the in-process mutex — for tests only. */
export function _resetAcquireMutex(): void { acquireMutex = Promise.resolve(); }

/**
 * Try to acquire the lock file. Checks for stale locks (dead PIDs).
 * Serialized within the process to prevent intra-process races.
 */
export async function acquireLock(lockPath: string): Promise<LockResult> {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const prev = acquireMutex;
  acquireMutex = gate;
  await prev;
  try {
    return await doAcquire(lockPath);
  } finally {
    release();
  }
}

/** Lock is stale if mtime is older than this. Set high enough to survive slow ticks (worktree ops + adapter spawns). */
const LOCK_STALE_MS = 60_000;

async function doAcquire(lockPath: string): Promise<LockResult> {
  // Check for existing lock
  const existing = await readLockPid(lockPath);
  if (existing !== null) {
    if (isProcessAlive(existing)) {
      // Guard against PID recycling: if the lock file hasn't been touched
      // recently (via touchLock), the original holder is likely dead and
      // the OS recycled its PID for an unrelated process.
      const stale = await isLockStaleByAge(lockPath);
      if (!stale) {
        return { acquired: false, pid: existing };
      }
    }
    // Stale lock (dead PID or untouched mtime) — remove it
    await fs.unlink(lockPath).catch(() => {});
  }

  // Atomic create: O_CREAT|O_EXCL fails if file already exists
  try {
    const fd = await fs.open(lockPath, 'wx');
    await fd.writeFile(String(process.pid), 'utf-8');
    await fd.close();
    return { acquired: true, pid: process.pid };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
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
 * Touch the lock file (update mtime) to prove the holder is still alive.
 * Call this periodically (e.g. every tick) so stale-lock detection works.
 */
export async function touchLock(lockPath: string): Promise<void> {
  const now = new Date();
  await fs.utimes(lockPath, now, now).catch(() => {});
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

async function isLockStaleByAge(lockPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means process exists but we lack permission to signal it
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}
