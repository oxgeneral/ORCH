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
 */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const line = JSON.stringify(record) + '\n';
  await fs.appendFile(filePath, line, 'utf-8');
}

/**
 * Read all records from a .jsonl file.
 */
export async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
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
