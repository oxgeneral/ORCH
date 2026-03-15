/**
 * Tests for IndexManager mutex serialization.
 *
 * Verifies that concurrent updateIndex calls are serialized
 * and do not lose data due to TOCTOU races.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexManager } from '../../../../src/infrastructure/storage/index-manager.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

interface TestItem {
  id: string;
  value: number;
}

describe('IndexManager mutex', () => {
  let tmpDir: string;
  let manager: IndexManager<TestItem>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-mutex-'));
    manager = new IndexManager<TestItem>({
      dir: tmpDir,
      ext: '.json',
      itemPath: (id) => path.join(tmpDir, `${id}.json`),
      fileFilter: (f) => f !== '_index.json',
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('serializes concurrent updateIndex calls — no data loss', async () => {
    // Seed index with empty array
    await manager.writeIndex([]);

    // Launch 10 concurrent updates, each adding a unique item
    const count = 10;
    const promises = Array.from({ length: count }, (_, i) =>
      manager.updateIndex((items) => [...items, { id: `item_${i}`, value: i }]),
    );

    await Promise.all(promises);

    const result = await manager.readIndex();
    expect(result).toHaveLength(count);

    // Every item should be present (no lost writes)
    const ids = result.map((item) => item.id).sort();
    const expected = Array.from({ length: count }, (_, i) => `item_${i}`).sort();
    expect(ids).toEqual(expected);
  });

  it('serializes writeIndex with concurrent updateIndex', async () => {
    await manager.writeIndex([{ id: 'seed', value: 0 }]);

    // Interleave a direct writeIndex with updateIndex calls
    const p1 = manager.updateIndex((items) => [...items, { id: 'a', value: 1 }]);
    const p2 = manager.writeIndex([{ id: 'replaced', value: 99 }]);
    const p3 = manager.updateIndex((items) => [...items, { id: 'b', value: 2 }]);

    await Promise.all([p1, p2, p3]);

    const result = await manager.readIndex();
    // p1 runs first: [seed, a]
    // p2 runs second: [replaced] (full overwrite)
    // p3 runs third: [replaced, b]
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(['b', 'replaced']);
  });

  it('mutex releases on error — subsequent calls proceed', async () => {
    await manager.writeIndex([]);

    // First call throws
    const failing = manager.updateIndex(() => {
      throw new Error('intentional');
    });
    await expect(failing).rejects.toThrow('intentional');

    // Second call should still work (mutex released in finally)
    await manager.updateIndex((items) => [...items, { id: 'ok', value: 1 }]);

    const result = await manager.readIndex();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('ok');
  });
});
