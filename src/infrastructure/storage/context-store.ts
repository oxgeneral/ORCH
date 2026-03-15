/**
 * File-based shared context store.
 *
 * Entries are stored as individual JSON files in .orchestry/context/.
 * An _index.json file caches the full list for fast list() calls.
 * Supports optional TTL for automatic expiration.
 * All writes are atomic (temp → rename).
 */

import type { ContextEntry, IContextStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { ensureDir, readJson, writeJson } from './fs-utils.js';
import { IndexManager } from './index-manager.js';
import fs from 'node:fs/promises';

export class ContextStore implements IContextStore {
  private readonly index: IndexManager<ContextEntry>;

  constructor(private readonly paths: Paths) {
    this.index = new IndexManager<ContextEntry>({
      dir: paths.contextDir,
      ext: '.json',
      itemPath: (key) => paths.contextPath(key),
      fileFilter: (f) => f !== '_index.json',
    });
  }

  async get(key: string): Promise<ContextEntry | null> {
    const entry = await readJson<ContextEntry>(this.paths.contextPath(key));
    if (!entry) return null;

    if (isExpired(entry)) {
      await this.delete(key);
      return null;
    }

    return entry;
  }

  /** Max TTL: 30 days in milliseconds */
  private static readonly MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs !== undefined) {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > ContextStore.MAX_TTL_MS) {
        throw new Error(`TTL must be a positive number up to ${ContextStore.MAX_TTL_MS}ms (30 days)`);
      }
    }

    await ensureDir(this.paths.contextDir);

    const now = new Date().toISOString();
    const existing = await readJson<ContextEntry>(this.paths.contextPath(key));

    const entry: ContextEntry = {
      key,
      value,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      ttl_ms: ttlMs,
      expires_at: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    };

    await writeJson(this.paths.contextPath(key), entry);
    await this.index.updateIndex(idx => {
      const filtered = idx.filter(e => e.key !== key);
      filtered.push(entry);
      return filtered;
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.paths.contextPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.index.updateIndex(idx => idx.filter(e => e.key !== key));
  }

  async list(): Promise<ContextEntry[]> {
    const entries = await this.index.readIndex();

    // Lazy cleanup of expired entries
    const expired: ContextEntry[] = [];
    const valid: ContextEntry[] = [];

    for (const entry of entries) {
      if (isExpired(entry)) {
        expired.push(entry);
      } else {
        valid.push(entry);
      }
    }

    if (expired.length > 0) {
      // Batch delete expired entries in parallel
      await Promise.all(expired.map(e => this.deleteFile(e.key)));
      await this.index.writeIndex(valid);
    }

    return valid.sort((a, b) => a.key.localeCompare(b.key));
  }

  async getAll(): Promise<Record<string, string>> {
    const entries = await this.list();
    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  }

  /** Delete just the file (no index update). Used by lazy expiry cleanup. */
  private async deleteFile(key: string): Promise<void> {
    try {
      await fs.unlink(this.paths.contextPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

function isExpired(entry: ContextEntry): boolean {
  if (!entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() < Date.now();
}
