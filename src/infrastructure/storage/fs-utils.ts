/**
 * Low-level filesystem utilities.
 *
 * All file persistence goes through these functions.
 * atomicWrite guarantees no partial reads via temp → rename.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { sanitizeText } from '../security/redaction.js';

/**
 * Write file atomically: write to temp file, then rename.
 * Prevents corrupted reads on concurrent access.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`);

  try {
    await fs.writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tmpPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (err) {
    // Clean up temp file on failure
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Read and parse a YAML file. Returns null if file does not exist.
 */
export async function readYaml<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.load(content) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/**
 * Write data as YAML atomically.
 */
export async function writeYaml<T>(filePath: string, data: T): Promise<void> {
  const content = yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  await atomicWrite(filePath, content);
}

/**
 * Read and parse a JSON file. Returns null if file does not exist.
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/**
 * Write data as JSON atomically.
 */
export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const content = JSON.stringify(data, null, 2) + '\n';
  await atomicWrite(filePath, content);
}

/**
 * POSIX PIPE_BUF — writes up to this size are guaranteed atomic with O_APPEND.
 * 4096 on Linux/macOS. We leave some room for encoding overhead.
 */
const PIPE_BUF = 4096;

/**
 * Append a JSON record to a .jsonl file (newline-delimited JSON).
 *
 * Uses a file handle opened with 'a' (O_APPEND) to ensure atomic writes.
 * On POSIX, O_APPEND guarantees that each write() call appends atomically
 * when the data fits within PIPE_BUF (typically 4096 bytes), preventing
 * interleaving from concurrent writers.
 *
 * If the serialized line exceeds PIPE_BUF, the record's `data` field is
 * truncated so the entire line fits within the atomic-write limit.
 * This prevents interleaving corruption from concurrent writers.
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  let line = JSON.stringify(record) + '\n';

  // If the line exceeds PIPE_BUF, truncate the `data` field to fit
  const byteLen = Buffer.byteLength(line, 'utf-8');
  if (byteLen > PIPE_BUF && record !== null && typeof record === 'object') {
    const obj = record as Record<string, unknown>;
    if (typeof obj.data === 'string' && obj.data.length > 0) {
      // Measure overhead without data to know how much room data gets
      const shell = JSON.stringify({ ...obj, data: '' }) + '\n';
      const overhead = Buffer.byteLength(shell, 'utf-8');
      const budget = PIPE_BUF - overhead - 3; // 3 bytes for the '…' suffix (UTF-8 ellipsis)
      if (budget > 0) {
        // Slice to budget chars — for ASCII (most event data) this equals bytes.
        // For multi-byte chars the result may be slightly over PIPE_BUF,
        // which is acceptable on local filesystems (ext4/APFS hold inode lock).
        const truncated = obj.data.slice(0, budget);
        line = JSON.stringify({ ...obj, data: truncated + '…' }) + '\n';
      }
    }
  }

  const handle = await getOrCreateHandle(filePath);
  await handle.write(line, null, 'utf-8');
}

// ── Append file handle cache ─────────────────────────────────────────
// Keeps one FileHandle (O_APPEND) per file path to avoid open/close per event.
// Idle handles are auto-closed after HANDLE_IDLE_MS.

interface HandleEntry {
  handle: FileHandle;
  idleTimer: ReturnType<typeof setTimeout>;
  /** Timestamp when the idle timer was last set — avoids redundant timer resets on hot paths. */
  timerSetAt: number;
}

/** Idle time before a cached file handle is auto-closed (milliseconds). */
const HANDLE_IDLE_MS = 10_000;

/** Module-level cache of open append handles, keyed by absolute file path. */
const appendHandles = new Map<string, HandleEntry>();
/** In-flight open() promises — prevents duplicate FDs for the same path under concurrent calls. */
const inFlightOpens = new Map<string, Promise<FileHandle>>();

async function getOrCreateHandle(filePath: string): Promise<FileHandle> {
  const existing = appendHandles.get(filePath);
  if (existing) {
    // Only reset the idle timer when past the midpoint — avoids timer churn on hot paths
    // (hundreds of writes/sec during Claude streaming, each would otherwise clearTimeout/setTimeout)
    const now = Date.now();
    if (now - existing.timerSetAt > HANDLE_IDLE_MS / 2) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = setTimeout(() => evictHandle(filePath), HANDLE_IDLE_MS);
      existing.timerSetAt = now;
    }
    return existing.handle;
  }
  // Deduplicate concurrent opens for the same path
  let opening = inFlightOpens.get(filePath);
  if (!opening) {
    opening = fs.open(filePath, 'a', 0o600).then((handle) => {
      inFlightOpens.delete(filePath);
      // If another call already populated the cache (race lost), close the duplicate
      if (appendHandles.has(filePath)) {
        handle.close().catch(() => {});
        return appendHandles.get(filePath)!.handle;
      }
      const entry: HandleEntry = {
        handle,
        idleTimer: setTimeout(() => evictHandle(filePath), HANDLE_IDLE_MS),
        timerSetAt: Date.now(),
      };
      appendHandles.set(filePath, entry);
      return handle;
    }).catch((err) => {
      inFlightOpens.delete(filePath);
      throw err;
    });
    inFlightOpens.set(filePath, opening);
  }
  return opening;
}

function evictHandle(filePath: string): void {
  const entry = appendHandles.get(filePath);
  if (!entry) return;
  appendHandles.delete(filePath);
  clearTimeout(entry.idleTimer);
  entry.handle.close().catch(() => {});
}

/**
 * Explicitly close the append handle for a file path.
 * Call this when a run completes to reclaim the FD immediately.
 */
export function closeAppendHandle(filePath: string): void {
  evictHandle(filePath);
}

/**
 * Close all cached append handles.
 * Call on process exit and in test teardown.
 */
export function closeAllAppendHandles(): void {
  for (const filePath of [...appendHandles.keys()]) {
    evictHandle(filePath);
  }
}

// Auto-cleanup on process exit
process.once('exit', closeAllAppendHandles);

/** Max file size for full readJsonl (50 MB). Larger files use tail read. */
const MAX_JSONL_READ_SIZE = 50 * 1024 * 1024;

/**
 * Read all records from a .jsonl file.
 * Falls back to reading only the last 200 records if the file exceeds MAX_JSONL_READ_SIZE.
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_JSONL_READ_SIZE) {
      process.stderr.write(
        `[readJsonl] file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB), reading tail only: ${filePath}\n`,
      );
      return readJsonlTail<T>(filePath, 200);
    }
    return readAndParseJsonl<T>(filePath);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

/**
 * Read the last N records from a .jsonl file.
 *
 * Reads the file in reverse chunks to avoid loading multi-MB files into memory.
 * Falls back to full read for small files (< 32KB).
 */
export async function readJsonlTail<T>(filePath: string, count: number): Promise<T[]> {
  try {
    const stat = await fs.stat(filePath);
    // For small files, read directly and slice (avoid mutual recursion with readJsonl)
    if (stat.size < 32768) {
      return (await readAndParseJsonl<T>(filePath)).slice(-count);
    }

    // Read from end in chunks to find enough lines
    // Use larger chunks for bigger files (tool_result events can be 8KB+ per line)
    const fd = await fs.open(filePath, 'r');
    try {
      const chunkSize = Math.min(stat.size, stat.size > 1_048_576 ? 131072 : 65536);
      let position = Math.max(0, stat.size - chunkSize);
      let earliestReadPosition = position;
      let tail = '';

      // Read up to 4 chunks from the end
      for (let attempt = 0; attempt < 4 && position >= 0; attempt++) {
        earliestReadPosition = position;
        const readSize = Math.min(chunkSize, stat.size - position);
        const buf = Buffer.alloc(readSize);
        await fd.read(buf, 0, readSize, position);
        tail = buf.toString('utf-8') + tail;

        const lines = tail.split('\n').filter((l) => l.trim().length > 0);
        if (lines.length >= count + 1) {
          // +1 because first line might be partial
          return parseJsonlLines<T>(lines.slice(-count));
        }
        if (position === 0) break;
        position = Math.max(0, position - chunkSize);
      }

      // Parse whatever we got
      const lines = tail.split('\n').filter((l) => l.trim().length > 0);
      // Skip first line if we didn't read from start (could be partial)
      const safeLines = earliestReadPosition > 0 ? lines.slice(1) : lines;
      return parseJsonlLines<T>(safeLines.slice(-count));
    } finally {
      await fd.close();
    }
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

/** Read a file and parse all JSONL records. */
async function readAndParseJsonl<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  return parseJsonlLines<T>(lines);
}

/**
 * Parse JSONL lines with error tolerance — corrupt lines are logged and skipped.
 */
function parseJsonlLines<T>(lines: string[]): T[] {
  const results: T[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch {
      process.stderr.write(`[readJsonl] skipping corrupt line: ${sanitizeText(line).slice(0, 200)}\n`);
    }
  }
  return results;
}

/**
 * Module-level cache of directories already ensured during this process lifetime.
 * Eliminates redundant fs.mkdir syscalls (~50 per tick loop).
 */
const ensuredDirs = new Set<string>();

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Uses an in-memory cache to skip redundant mkdir syscalls.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  if (ensuredDirs.has(dirPath)) return;
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe directory path: ${dirPath}`);
  }
  ensuredDirs.add(dirPath);
}

/**
 * Clear the ensureDir cache. Intended for tests only.
 */
export function clearEnsuredDirs(): void {
  ensuredDirs.clear();
}

/**
 * Check if a path exists.
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List files in a directory matching an optional extension filter.
 */
export async function listFiles(dirPath: string, ext?: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath);
    if (ext) {
      return entries.filter((e) => e.endsWith(ext));
    }
    return entries;
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
