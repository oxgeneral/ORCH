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
import { randomBytes } from 'node:crypto';

const PACKAGE_NAME = '@oxgeneral/orch';
const NPM_REGISTRY = 'https://registry.npmjs.org/';
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

function isStrictSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function npmEnv(): NodeJS.ProcessEnv {
  const emptyUserConfig = path.join(CACHE_DIR, 'empty-user.npmrc');
  const emptyGlobalConfig = path.join(CACHE_DIR, 'empty-global.npmrc');
  return {
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    USERPROFILE: process.env['USERPROFILE'],
    SystemRoot: process.env['SystemRoot'],
    NPM_CONFIG_REGISTRY: NPM_REGISTRY,
    NPM_CONFIG_USERCONFIG: emptyUserConfig,
    NPM_CONFIG_GLOBALCONFIG: emptyGlobalConfig,
  };
}

async function ensureEmptyNpmConfigs(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  await Promise.all([
    fs.writeFile(path.join(CACHE_DIR, 'empty-user.npmrc'), '', { mode: 0o600 }),
    fs.writeFile(path.join(CACHE_DIR, 'empty-global.npmrc'), '', { mode: 0o600 }),
  ]);
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
  const tmp = `${CACHE_FILE}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf-8');
  await fs.rename(tmp, CACHE_FILE);
}

/** Fetch latest version from npm registry via `npm view`. */
function fetchLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    ensureEmptyNpmConfigs().then(() => {
      const child = execFile('npm', ['view', PACKAGE_NAME, 'version', '--json', '--registry', NPM_REGISTRY], {
        timeout: 5000,
        cwd: os.homedir(),
        env: npmEnv(),
      }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const version = JSON.parse(stdout.trim()) as string;
          resolve(isStrictSemver(version) ? version : null);
        } catch {
          resolve(null);
        }
      });
      child.unref(); // don't keep the event loop alive for fire-and-forget callers
    }).catch(() => resolve(null));
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
