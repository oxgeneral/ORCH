/**
 * Generic index manager for file-based stores.
 *
 * Encapsulates the readIndex/rebuildIndex/writeIndex/updateIndex pattern
 * shared by TaskStore, AgentStore, and ContextStore.
 *
 * Each store keeps individual files (YAML or JSON) and an _index.json cache
 * for fast list() calls. IndexManager handles index I/O and rebuild logic.
 */

import path from 'node:path';
import { listFiles, readYaml, readJson, writeJson, ensureDir } from './fs-utils.js';

/** Configuration for how to read individual item files. */
export interface IndexManagerConfig<T> {
  /** Directory containing the individual files and _index.json. */
  dir: string;

  /** File extension for individual item files (e.g. '.yml', '.json'). */
  ext: '.yml' | '.json';

  /** Resolve the full path for an item given its extracted ID. */
  itemPath: (id: string) => string;

  /**
   * Optional filter for file names during rebuildIndex scan.
   * Return false to exclude a file (e.g. '_index.json' for .json stores).
   * By default, no files are excluded.
   */
  fileFilter?: (fileName: string) => boolean;

  /**
   * Read a single item file. Defaults to readYaml for .yml, readJson for .json.
   * Can be overridden for custom deserialization.
   */
  readItem?: (filePath: string) => Promise<T | null>;
}

/**
 * Generic index manager that handles _index.json caching for file-based stores.
 *
 * @typeParam T - The stored item type. Must be an object (items are filtered via !== null).
 */
export class IndexManager<T> {
  private readonly indexPath: string;
  private readonly dir: string;
  private readonly ext: string;
  private readonly itemPath: (id: string) => string;
  private readonly fileFilter: (fileName: string) => boolean;
  private readonly readItemFn: (filePath: string) => Promise<T | null>;

  /** Promise-chain mutex to serialize updateIndex read-modify-write cycles. */
  private mutex: Promise<void> = Promise.resolve();

  /** True while executing inside withMutex — prevents re-entrant deadlock. */
  private insideMutex = false;

  constructor(config: IndexManagerConfig<T>) {
    this.dir = config.dir;
    this.ext = config.ext;
    this.itemPath = config.itemPath;
    this.indexPath = path.join(config.dir, '_index.json');

    this.fileFilter = config.fileFilter ?? (() => true);

    if (config.readItem) {
      this.readItemFn = config.readItem;
    } else if (config.ext === '.yml') {
      this.readItemFn = (fp) => readYaml<T>(fp);
    } else {
      this.readItemFn = (fp) => readJson<T>(fp);
    }
  }

  /**
   * Read the index file. Falls back to rebuilding from individual files
   * if the index is missing or corrupt.
   */
  async readIndex(): Promise<T[]> {
    try {
      const entries = await readJson<T[]>(this.indexPath);
      if (Array.isArray(entries)) return entries;
    } catch {
      // Corrupted JSON — fall through to rebuild
    }
    return this.rebuildIndex();
  }

  /**
   * Rebuild the index by reading all individual item files.
   * Used as fallback when _index.json is missing or corrupted.
   *
   * When called from outside the mutex (standalone), the write is serialized
   * through {@link withMutex} to prevent races with concurrent updateIndex.
   * When called from within the mutex (e.g. updateIndex → readIndex fallback),
   * it writes directly to avoid re-entrant deadlock.
   */
  async rebuildIndex(): Promise<T[]> {
    await ensureDir(this.dir);
    const files = await listFiles(this.dir, this.ext);

    const results = await Promise.all(
      files
        .filter(this.fileFilter)
        .map(async (file) => {
          const id = file.replace(this.ext, '');
          try {
            return await this.readItemFn(this.itemPath(id));
          } catch {
            return null;
          }
        }),
    );

    const items: T[] = [];
    for (const item of results) {
      if (item != null) items.push(item);
    }

    // If already inside the mutex (called via updateIndex → readIndex),
    // write directly to avoid deadlock. Otherwise serialize through mutex.
    if (this.insideMutex) {
      await this.writeIndexUnsafe(items);
    } else {
      await this.withMutex(() => this.writeIndexUnsafe(items));
    }
    return items;
  }

  /**
   * Write the index file atomically.
   * Serialized through the mutex to prevent races with concurrent updateIndex.
   */
  async writeIndex(items: T[]): Promise<void> {
    return this.withMutex(() => this.writeIndexUnsafe(items));
  }

  /**
   * Apply a mutation to the index and write it back.
   *
   * Serialized through a promise-chain mutex to prevent TOCTOU races
   * where parallel callers could overwrite each other's changes
   * (e.g. two `orch task add` invocations losing data).
   */
  async updateIndex(fn: (items: T[]) => T[]): Promise<void> {
    return this.withMutex(async () => {
      const current = await this.readIndex();
      const updated = fn(current);
      await this.writeIndexUnsafe(updated);
    });
  }

  /** Internal write without mutex — called only from within withMutex. */
  private async writeIndexUnsafe(items: T[]): Promise<void> {
    await ensureDir(this.dir);
    await writeJson(this.indexPath, items);
  }

  /** Promise-chain mutex: serializes all index-mutating operations. */
  private withMutex<R>(fn: () => Promise<R>): Promise<R> {
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const prev = this.mutex;
    this.mutex = next;
    return prev.then(async () => {
      this.insideMutex = true;
      try {
        return await fn();
      } finally {
        this.insideMutex = false;
        release!();
      }
    });
  }
}
