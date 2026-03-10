/**
 * File-based shared context store.
 *
 * Entries are stored as individual JSON files in .orchestry/context/.
 * Supports optional TTL for automatic expiration.
 * All writes are atomic (temp → rename).
 */

import type { ContextEntry, IContextStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readJson, writeJson, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

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

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
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
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.paths.contextPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async list(): Promise<ContextEntry[]> {
    await ensureDir(this.paths.contextDir);
    const files = await listFiles(this.paths.contextDir, '.json');

    const results = await Promise.all(
      files.map(file => {
        const key = file.replace('.json', '');
        return readJson<ContextEntry>(this.paths.contextPath(key));
      }),
    );

    const entries: ContextEntry[] = [];
    for (const entry of results) {
      if (!entry) continue;
      if (isExpired(entry)) {
        await this.delete(entry.key);
        continue;
      }
      entries.push(entry);
    }

    return entries.sort((a, b) => a.key.localeCompare(b.key));
  }

  async getAll(): Promise<Record<string, string>> {
    const entries = await this.list();
    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.key] = entry.value;
    }
    return result;
  }
}

function isExpired(entry: ContextEntry): boolean {
  if (!entry.expires_at) return false;
  return new Date(entry.expires_at).getTime() < Date.now();
}
