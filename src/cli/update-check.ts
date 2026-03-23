/**
 * Background update checker.
 *
 * Checks npm registry for newer versions, caches result for 4 hours.
 * Non-blocking — errors are silently ignored.
 */

import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const PACKAGE_NAME = '@oxgeneral/orch';
const CACHE_DIR = path.join(os.homedir(), '.orchestry');
const CACHE_FILE = path.join(CACHE_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
/** Revalidate when cache is past 75% of its TTL */
const REVALIDATE_AFTER_MS = CHECK_INTERVAL_MS * 0.75;

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
    const child = execFile('npm', ['view', PACKAGE_NAME, 'version', '--json'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim()) as string);
      } catch {
        resolve(null);
      }
    });
    child.unref(); // don't keep the event loop alive for fire-and-forget callers
  });
}

export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/** Build an UpdateInfo from current and latest version strings. */
function buildUpdateInfo(current: string, latest: string): UpdateInfo {
  return { current, latest, updateAvailable: compareSemver(latest, current) > 0 };
}

/**
 * Force-check npm registry and return update info.
 * Used by `orch update` command.
 */
export async function checkForUpdateNow(currentVersion: string): Promise<UpdateInfo | null> {
  const latest = await fetchLatestVersion();
  if (!latest) return null;
  await writeCache(latest).catch(() => {});
  return buildUpdateInfo(currentVersion, latest);
}

/**
 * Stale-while-revalidate: returns cached result instantly (single cache read),
 * fires a background refresh only when cache is near expiry (>75% TTL).
 * On cold start (no cache), awaits the fetch so the first run also gets a result.
 */
export async function checkForUpdateSWR(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const cached = await readCache();
    if (!cached) {
      // Cold start — await fetch (up to 5s) so first run also shows notification
      return checkForUpdateNow(currentVersion).catch(() => null);
    }
    // Revalidate only when cache is past 75% of its 4-hour TTL
    const age = Date.now() - cached.checked_at;
    if (age >= REVALIDATE_AFTER_MS) {
      checkForUpdateNow(currentVersion).catch(() => {});
    }
    return buildUpdateInfo(currentVersion, cached.latest);
  } catch {
    return null;
  }
}

/** Print update notification to stderr (non-intrusive). */
export function printUpdateNotification(info: UpdateInfo): void {
  if (!info.updateAvailable) return;
  const msg = `\n  Update available: ${info.current} → ${info.latest}\n  Run: npm install -g ${PACKAGE_NAME}\n`;
  process.stderr.write(msg);
}

const INSTALL_MARKER = path.join(CACHE_DIR, 'update-installed.json');

/**
 * Install the specified version via npm in the background.
 * Writes a marker file on success to prevent re-install within the same check cycle.
 * Returns true if install completed successfully, false if skipped or failed.
 */
export function backgroundInstall(version: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Skip if already installed this version
    try {
      const marker = JSON.parse(readFileSync(INSTALL_MARKER, 'utf-8'));
      if (marker.version === version && Date.now() - marker.installed_at < CHECK_INTERVAL_MS) {
        resolve(false);
        return;
      }
    } catch {
      // No marker — proceed
    }

    const child = execFile(
      'npm',
      ['install', '-g', `${PACKAGE_NAME}@${version}`],
      { timeout: 60_000 },
      (err) => {
        if (!err) {
          // Write marker so we don't re-install until next check cycle
          mkdirSync(CACHE_DIR, { recursive: true });
          writeFileSync(INSTALL_MARKER, JSON.stringify({ version, installed_at: Date.now() }));
        }
        resolve(!err);
      },
    );
  });
}

/**
 * Check if a background install completed and restart is needed.
 */
export function isRestartNeeded(currentVersion: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(INSTALL_MARKER, 'utf-8'));
    return marker.version !== currentVersion && Date.now() - marker.installed_at < CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}
