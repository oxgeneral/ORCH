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
import { listFiles, readJson, writeJson, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export class ContextStore implements IContextStore {
  constructor(private readonly paths: Paths) {}

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
    await this.updateIndex(idx => {
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
    await this.updateIndex(idx => idx.filter(e => e.key !== key));
  }

  async list(): Promise<ContextEntry[]> {
    const entries = await this.readIndex();

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
      await this.writeIndex(valid);
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

  // --- Index management ---

  private get indexPath(): string {
    return path.join(this.paths.contextDir, '_index.json');
  }

  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  private async readIndex(): Promise<ContextEntry[]> {
    try {
      const entries = await readJson<ContextEntry[]>(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
      // Corrupted JSON — fall through to rebuild
    }
    return this.rebuildIndex();
  }

  /**
   * Rebuild the index by reading all individual context JSON files.
   * Used as fallback when _index.json is missing or corrupted.
   */
  private async rebuildIndex(): Promise<ContextEntry[]> {
    await ensureDir(this.paths.contextDir);
    const files = await listFiles(this.paths.contextDir, '.json');

    const results = await Promise.all(
      files
        .filter(f => f !== '_index.json')
        .map(file => {
          const key = file.replace('.json', '');
          return readJson<ContextEntry>(this.paths.contextPath(key));
        }),
    );

    const entries = results.filter((e): e is ContextEntry => e !== null);
    await this.writeIndex(entries);
    return entries;
  }

  /** Write the index file atomically. */
  private async writeIndex(entries: ContextEntry[]): Promise<void> {
    await ensureDir(this.paths.contextDir);
    await writeJson(this.indexPath, entries);
  }

  /** Apply a mutation to the index and write it back. */
  private async updateIndex(fn: (entries: ContextEntry[]) => ContextEntry[]): Promise<void> {
    const current = await this.readIndex();
    const updated = fn(current);
    await this.writeIndex(updated);
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
