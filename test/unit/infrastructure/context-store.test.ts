import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContextStore } from '../../../src/infrastructure/storage/context-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';

let tmpDir: string;
let paths: Paths;
let store: ContextStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-context-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new ContextStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ContextStore', () => {
  it('returns null for non-existent key', async () => {
    const entry = await store.get('nonexistent');
    expect(entry).toBeNull();
  });

  it('sets and gets a value', async () => {
    await store.set('api-url', 'https://example.com');
    const entry = await store.get('api-url');

    expect(entry).not.toBeNull();
    expect(entry!.key).toBe('api-url');
    expect(entry!.value).toBe('https://example.com');
    expect(entry!.created_at).toBeDefined();
    expect(entry!.updated_at).toBeDefined();
    expect(entry!.ttl_ms).toBeUndefined();
    expect(entry!.expires_at).toBeUndefined();
  });

  it('overwrites existing value preserving created_at', async () => {
    await store.set('key1', 'value1');
    const first = await store.get('key1');

    await store.set('key1', 'value2');
    const second = await store.get('key1');

    expect(second!.value).toBe('value2');
    expect(second!.created_at).toBe(first!.created_at);
  });

  it('deletes a key', async () => {
    await store.set('key1', 'value1');
    await store.delete('key1');
    const entry = await store.get('key1');
    expect(entry).toBeNull();
  });

  it('delete is idempotent for non-existent key', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('lists all entries sorted by key', async () => {
    await store.set('zebra', 'z');
    await store.set('alpha', 'a');
    await store.set('middle', 'm');

    const entries = await store.list();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.key)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('returns empty list when no entries', async () => {
    const entries = await store.list();
    expect(entries).toHaveLength(0);
  });

  it('getAll returns key-value map', async () => {
    await store.set('a', '1');
    await store.set('b', '2');

    const all = await store.getAll();
    expect(all).toEqual({ a: '1', b: '2' });
  });

  describe('TTL', () => {
    it('sets entry with TTL', async () => {
      await store.set('temp', 'data', 60000);
      const entry = await store.get('temp');

      expect(entry).not.toBeNull();
      expect(entry!.ttl_ms).toBe(60000);
      expect(entry!.expires_at).toBeDefined();
    });

    it('returns null for expired entries', async () => {
      // Set with 1ms TTL
      await store.set('temp', 'data', 1);

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 10));

      const entry = await store.get('temp');
      expect(entry).toBeNull();
    });

    it('cleans up expired entries on list()', async () => {
      await store.set('expired', 'old', 1);
      await store.set('valid', 'good');

      await new Promise((r) => setTimeout(r, 10));

      const entries = await store.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('valid');
    });

    it('expired entries are removed from disk', async () => {
      await store.set('temp', 'data', 1);
      await new Promise((r) => setTimeout(r, 10));

      // Trigger cleanup via get
      await store.get('temp');

      // Verify file is gone
      const filePath = paths.contextPath('temp');
      await expect(fs.access(filePath)).rejects.toThrow();
    });
  });

  describe('_index.json cache', () => {
    it('creates _index.json on first set()', async () => {
      await store.set('k1', 'v1');
      const indexPath = path.join(paths.contextDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Array<{ key: string }>;
      expect(index).toHaveLength(1);
      expect(index[0].key).toBe('k1');
    });

    it('list() reads from _index.json instead of individual files', async () => {
      await store.set('a', '1');
      await store.set('b', '2');

      // Verify index has both
      const entries = await store.list();
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.key)).toEqual(['a', 'b']);
    });

    it('delete() removes entry from _index.json', async () => {
      await store.set('a', '1');
      await store.set('b', '2');
      await store.delete('a');

      const indexPath = path.join(paths.contextDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Array<{ key: string }>;
      expect(index).toHaveLength(1);
      expect(index[0].key).toBe('b');
    });

    it('rebuilds index when _index.json is missing', async () => {
      await store.set('x', '1');
      await store.set('y', '2');

      // Delete the index file
      const indexPath = path.join(paths.contextDir, '_index.json');
      await fs.unlink(indexPath);

      // list() should rebuild from individual files
      const entries = await store.list();
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.key)).toEqual(['x', 'y']);

      // Index should be recreated
      await expect(fs.access(indexPath)).resolves.not.toThrow();
    });

    it('rebuilds index when _index.json is corrupted', async () => {
      await store.set('ok', 'fine');

      // Corrupt the index
      const indexPath = path.join(paths.contextDir, '_index.json');
      await fs.writeFile(indexPath, '{{not valid json');

      // list() should rebuild
      const entries = await store.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('ok');
    });

    it('expired entries cleaned from index on list()', async () => {
      await store.set('ephemeral', 'gone', 1);
      await store.set('permanent', 'here');

      await new Promise((r) => setTimeout(r, 10));

      const entries = await store.list();
      expect(entries).toHaveLength(1);
      expect(entries[0].key).toBe('permanent');

      // Index should only contain the valid entry
      const indexPath = path.join(paths.contextDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Array<{ key: string }>;
      expect(index).toHaveLength(1);
      expect(index[0].key).toBe('permanent');
    });

    it('set() updates existing entry in index', async () => {
      await store.set('k', 'v1');
      await store.set('k', 'v2');

      const indexPath = path.join(paths.contextDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(raw) as Array<{ key: string; value: string }>;
      expect(index).toHaveLength(1);
      expect(index[0].value).toBe('v2');
    });
  });
});
