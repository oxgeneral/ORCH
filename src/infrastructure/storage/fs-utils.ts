/**
 * Low-level filesystem utilities.
 *
 * All file persistence goes through these functions.
 * atomicWrite guarantees no partial reads via temp → rename.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Write file atomically: write to temp file, then rename.
 * Prevents corrupted reads on concurrent access.
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${randomBytes(4).toString('hex')}.tmp`);

  try {
    await fs.writeFile(tmpPath, content, 'utf-8');
    await fs.rename(tmpPath, filePath);
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
 * Append a JSON record to a .jsonl file (newline-delimited JSON).
 *
 * Uses a file handle opened with 'a' (O_APPEND) to ensure atomic writes.
 * On POSIX, O_APPEND guarantees that each write() call appends atomically
 * when the data fits within PIPE_BUF (typically 4096 bytes), preventing
 * interleaving from concurrent writers.
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const line = JSON.stringify(record) + '\n';
  const fd = await fs.open(filePath, 'a');
  try {
    await fd.write(line, null, 'utf-8');
  } finally {
    await fd.close();
  }
}

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
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    return parseJsonlLines<T>(lines);
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
    // For small files, just read the whole thing and slice
    if (stat.size < 32768) {
      const all = await readJsonl<T>(filePath);
      return all.slice(-count);
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
      process.stderr.write(`[readJsonl] skipping corrupt line: ${line.slice(0, 200)}\n`);
    }
  }
  return results;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
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
