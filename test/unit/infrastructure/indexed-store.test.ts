import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IndexManager } from '../../../src/infrastructure/storage/index-manager.js';
import { writeYaml, writeJson, clearEnsuredDirs } from '../../../src/infrastructure/storage/fs-utils.js';

interface TestItem {
  id: string;
  name: string;
}

let tmpDir: string;

beforeEach(async () => {
  clearEnsuredDirs();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-indexmgr-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('IndexManager', () => {
  describe('with YAML items (.yml)', () => {
    let manager: IndexManager<TestItem>;

    beforeEach(() => {
      manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });
    });

    it('readIndex returns empty array when no index and no files', async () => {
      const items = await manager.readIndex();
      expect(items).toEqual([]);
    });

    it('readIndex reads from _index.json when it exists', async () => {
      const data: TestItem[] = [{ id: 'a', name: 'Alpha' }];
      await writeJson(path.join(tmpDir, '_index.json'), data);

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ id: 'a', name: 'Alpha' });
    });

    it('rebuildIndex scans individual YAML files', async () => {
      await writeYaml(path.join(tmpDir, 'item1.yml'), { id: 'item1', name: 'First' });
      await writeYaml(path.join(tmpDir, 'item2.yml'), { id: 'item2', name: 'Second' });

      const items = await manager.rebuildIndex();
      expect(items).toHaveLength(2);
      const ids = items.map((i) => i.id).sort();
      expect(ids).toEqual(['item1', 'item2']);
    });

    it('rebuildIndex creates _index.json', async () => {
      await writeYaml(path.join(tmpDir, 'x.yml'), { id: 'x', name: 'X' });
      await manager.rebuildIndex();

      const indexPath = path.join(tmpDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as TestItem[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({ id: 'x', name: 'X' });
    });

    it('readIndex falls back to rebuildIndex when _index.json is corrupted', async () => {
      await writeYaml(path.join(tmpDir, 'ok.yml'), { id: 'ok', name: 'OK' });
      await fs.writeFile(path.join(tmpDir, '_index.json'), '{{invalid json');

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('ok');
    });

    it('readIndex falls back to rebuildIndex when _index.json is not an array', async () => {
      await writeYaml(path.join(tmpDir, 'ok.yml'), { id: 'ok', name: 'OK' });
      await fs.writeFile(path.join(tmpDir, '_index.json'), '{"not": "array"}');

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('ok');
    });

    it('writeIndex writes _index.json', async () => {
      const data: TestItem[] = [{ id: 'w', name: 'Written' }];
      await manager.writeIndex(data);

      const indexPath = path.join(tmpDir, '_index.json');
      const raw = await fs.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as TestItem[];
      expect(parsed).toEqual(data);
    });

    it('updateIndex applies mutation and writes back', async () => {
      await manager.writeIndex([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);

      await manager.updateIndex((items) => items.filter((i) => i.id !== 'a'));

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('b');
    });

    it('updateIndex works when index is empty', async () => {
      await manager.updateIndex((items) => {
        items.push({ id: 'new', name: 'New' });
        return items;
      });

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('new');
    });

    it('rebuildIndex skips files that fail to parse', async () => {
      await writeYaml(path.join(tmpDir, 'good.yml'), { id: 'good', name: 'Good' });
      // Write an empty file — readYaml returns null for empty YAML
      await fs.writeFile(path.join(tmpDir, 'empty.yml'), '');

      const items = await manager.rebuildIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('good');
    });
  });

  describe('with JSON items (.json) and fileFilter', () => {
    let manager: IndexManager<TestItem>;

    beforeEach(() => {
      manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.json',
        itemPath: (id) => path.join(tmpDir, `${id}.json`),
        fileFilter: (f) => f !== '_index.json',
      });
    });

    it('rebuildIndex excludes _index.json from scan', async () => {
      await writeJson(path.join(tmpDir, 'entry1.json'), { id: 'entry1', name: 'E1' });
      await writeJson(path.join(tmpDir, 'entry2.json'), { id: 'entry2', name: 'E2' });
      // _index.json should not be read as an item
      await writeJson(path.join(tmpDir, '_index.json'), []);

      const items = await manager.rebuildIndex();
      expect(items).toHaveLength(2);
      const ids = items.map((i) => i.id).sort();
      expect(ids).toEqual(['entry1', 'entry2']);
    });

    it('readIndex reads from _index.json for JSON stores', async () => {
      const data: TestItem[] = [{ id: 'j1', name: 'JSON One' }];
      await writeJson(path.join(tmpDir, '_index.json'), data);

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('JSON One');
    });

    it('readIndex rebuilds when _index.json is missing for JSON stores', async () => {
      await writeJson(path.join(tmpDir, 'ctx.json'), { id: 'ctx', name: 'Context' });

      const items = await manager.readIndex();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('ctx');
    });
  });

  describe('custom readItem', () => {
    it('uses custom readItem function', async () => {
      const customRead = async (filePath: string): Promise<TestItem | null> => {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as TestItem;
        return { ...parsed, name: `custom_${parsed.name}` };
      };

      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.json',
        itemPath: (id) => path.join(tmpDir, `${id}.json`),
        fileFilter: (f) => f !== '_index.json',
        readItem: customRead,
      });

      await writeJson(path.join(tmpDir, 'c1.json'), { id: 'c1', name: 'Original' });

      const items = await manager.rebuildIndex();
      expect(items).toHaveLength(1);
      expect(items[0].name).toBe('custom_Original');
    });
  });

  describe('edge cases', () => {
    it('handles concurrent updateIndex calls', async () => {
      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });

      // Seed initial index
      await manager.writeIndex([]);

      // Run two sequential updates — each completes before the next starts
      await manager.updateIndex((items) => [...items, { id: 'a', name: 'A' }]);
      await manager.updateIndex((items) => [...items, { id: 'b', name: 'B' }]);

      const items = await manager.readIndex();
      expect(items).toHaveLength(2);
    });

    it('concurrent updateIndex calls are serialized by mutex (no data loss)', async () => {
      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });

      await manager.writeIndex([]);

      // Fire both updates concurrently — mutex must serialize them
      // so both A and B end up in the final index (no lost writes)
      await Promise.all([
        manager.updateIndex((items) => [...items, { id: 'a', name: 'A' }]),
        manager.updateIndex((items) => [...items, { id: 'b', name: 'B' }]),
      ]);

      const items = await manager.readIndex();
      const ids = items.map((i) => i.id).sort();
      expect(ids).toEqual(['a', 'b']);
    });

    it('rebuildIndex with empty directory returns empty array', async () => {
      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });

      const items = await manager.rebuildIndex();
      expect(items).toEqual([]);
    });

    it('rebuildIndex creates directory if it does not exist', async () => {
      const subDir = path.join(tmpDir, 'nested', 'deep');
      const manager = new IndexManager<TestItem>({
        dir: subDir,
        ext: '.yml',
        itemPath: (id) => path.join(subDir, `${id}.yml`),
      });

      const items = await manager.rebuildIndex();
      expect(items).toEqual([]);

      // Directory should have been created
      const stat = await fs.stat(subDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('updateIndex does not deadlock when _index.json is corrupt (insideMutex path)', async () => {
      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });

      // Seed one item file so rebuildIndex returns something
      await writeYaml(path.join(tmpDir, 'existing.yml'), { id: 'existing', name: 'Existing' });
      // Write corrupt index — will force rebuildIndex inside the mutex
      await fs.writeFile(path.join(tmpDir, '_index.json'), '{{corrupt');

      // This must complete without deadlocking: updateIndex → withMutex →
      // readIndex → rebuildIndex (insideMutex=true → writeIndexUnsafe directly)
      const result = await Promise.race([
        manager.updateIndex((items) => [...items, { id: 'new', name: 'New' }]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('deadlock: updateIndex timed out')), 2000),
        ),
      ]);

      expect(result).toBeUndefined(); // updateIndex returns void

      // Final index must contain both the rebuilt item and the appended one
      const final = await manager.readIndex();
      const ids = final.map((i) => i.id).sort();
      expect(ids).toEqual(['existing', 'new']);
    });

    it('standalone rebuildIndex races are serialized (concurrent calls produce consistent index)', async () => {
      const manager = new IndexManager<TestItem>({
        dir: tmpDir,
        ext: '.yml',
        itemPath: (id) => path.join(tmpDir, `${id}.yml`),
      });

      await writeYaml(path.join(tmpDir, 'item.yml'), { id: 'item', name: 'Item' });

      // Both concurrent standalone rebuildIndex calls go through withMutex —
      // the last one wins but neither should corrupt the index
      const [items1, items2] = await Promise.all([
        manager.rebuildIndex(),
        manager.rebuildIndex(),
      ]);

      expect(items1).toHaveLength(1);
      expect(items2).toHaveLength(1);

      const final = await manager.readIndex();
      expect(final).toHaveLength(1);
      expect(final[0]!.id).toBe('item');
    });
  });
});
