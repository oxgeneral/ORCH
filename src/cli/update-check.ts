/**
 * Background update checker.
 *
 * Checks npm registry for newer versions, caches result for 4 hours.
 * Non-blocking — errors are silently ignored.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const PACKAGE_NAME = '@oxgeneral/orch';
const CACHE_DIR = path.join(os.homedir(), '.orchestry');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface UpdateCache {
  latest: string;
  checked_at: number;
}

/** Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Read cached check result. Returns null if stale or missing. */
async function readCache(): Promise<UpdateCache | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw) as UpdateCache;
    if (Date.now() - data.checked_at < CHECK_INTERVAL_MS) return data;
  } catch {
    // missing or corrupt — treat as stale
  }
  return null;
}

/** Write cache file atomically (temp → rename). */
async function writeCache(latest: string): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const data: UpdateCache = { latest, checked_at: Date.now() };
  const tmp = `${CACHE_FILE}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf-8');
  await fs.rename(tmp, CACHE_FILE);
}

/** Fetch latest version from npm registry via `npm view`. */
function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('npm', ['view', PACKAGE_NAME, 'version', '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim()) as string);
      } catch {
        resolve(null);
      }
    });
  });
}

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/**
 * Check for updates. Non-blocking, returns quickly from cache.
 * Triggers a background fetch if cache is stale.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    // Try cache first
    const cached = await readCache();
    if (cached) {
      return {
        current: currentVersion,
        latest: cached.latest,
        updateAvailable: compareSemver(cached.latest, currentVersion) > 0,
      };
    }

    // Cache stale — fetch in background, don't block
    fetchLatestVersion().then(async (latest) => {
      if (latest) await writeCache(latest).catch(() => {});
    }).catch(() => {});

    return null;
  } catch {
    return null;
  }
}

/**
 * Check for updates synchronously from cache only (for fast startup).
 * Returns null if no cached data.
 */
export async function checkForUpdateCached(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const cached = await readCache();
    if (!cached) return null;
    return {
      current: currentVersion,
      latest: cached.latest,
      updateAvailable: compareSemver(cached.latest, currentVersion) > 0,
    };
  } catch {
    return null;
  }
}

/**
 * Force-check npm registry and return update info.
 * Used by `orch update` command.
 */
export async function checkForUpdateNow(currentVersion: string): Promise<UpdateInfo | null> {
  const latest = await fetchLatestVersion();
  if (!latest) return null;
  await writeCache(latest).catch(() => {});
  return {
    current: currentVersion,
    latest,
    updateAvailable: compareSemver(latest, currentVersion) > 0,
  };
}

/** Print update notification to stderr (non-intrusive). */
export function printUpdateNotification(info: UpdateInfo): void {
  if (!info.updateAvailable) return;
  const msg = `\n  Update available: ${info.current} → ${info.latest}\n  Run: npm install -g ${PACKAGE_NAME}\n`;
  process.stderr.write(msg);
}
