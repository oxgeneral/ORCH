import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  atomicWrite,
  readYaml,
  writeYaml,
  readJson,
  writeJson,
  appendJsonl,
  readJsonl,
  ensureDir,
  pathExists,
  listFiles,
} from '../../../src/infrastructure/storage/fs-utils.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('writes file content', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await atomicWrite(filePath, 'hello world');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('creates parent directories if needed', async () => {
    const filePath = path.join(tmpDir, 'a', 'b', 'test.txt');
    await atomicWrite(filePath, 'nested');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('nested');
  });

  it('overwrites existing files', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await atomicWrite(filePath, 'v1');
    await atomicWrite(filePath, 'v2');
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('v2');
  });
});

describe('readYaml / writeYaml', () => {
  it('round-trips YAML data', async () => {
    const filePath = path.join(tmpDir, 'data.yml');
    const data = { name: 'test', count: 42, items: ['a', 'b'] };
    await writeYaml(filePath, data);
    const result = await readYaml(filePath);
    expect(result).toEqual(data);
  });

  it('returns null for non-existent file', async () => {
    const result = await readYaml(path.join(tmpDir, 'missing.yml'));
    expect(result).toBeNull();
  });
});

describe('readJson / writeJson', () => {
  it('round-trips JSON data', async () => {
    const filePath = path.join(tmpDir, 'data.json');
    const data = { version: 1, items: [1, 2, 3] };
    await writeJson(filePath, data);
    const result = await readJson(filePath);
    expect(result).toEqual(data);
  });

  it('returns null for non-existent file', async () => {
    const result = await readJson(path.join(tmpDir, 'missing.json'));
    expect(result).toBeNull();
  });
});

describe('appendJsonl / readJsonl', () => {
  it('appends and reads JSONL records', async () => {
    const filePath = path.join(tmpDir, 'events.jsonl');
    await appendJsonl(filePath, { type: 'a', data: 1 });
    await appendJsonl(filePath, { type: 'b', data: 2 });

    const records = await readJsonl(filePath);
    expect(records).toEqual([
      { type: 'a', data: 1 },
      { type: 'b', data: 2 },
    ]);
  });

  it('returns empty array for non-existent file', async () => {
    const result = await readJsonl(path.join(tmpDir, 'missing.jsonl'));
    expect(result).toEqual([]);
  });
});

describe('ensureDir', () => {
  it('creates nested directories', async () => {
    const dirPath = path.join(tmpDir, 'x', 'y', 'z');
    await ensureDir(dirPath);
    const stat = await fs.stat(dirPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it('is idempotent', async () => {
    const dirPath = path.join(tmpDir, 'once');
    await ensureDir(dirPath);
    await ensureDir(dirPath);
    const stat = await fs.stat(dirPath);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe('pathExists', () => {
  it('returns true for existing paths', async () => {
    expect(await pathExists(tmpDir)).toBe(true);
  });

  it('returns false for non-existing paths', async () => {
    expect(await pathExists(path.join(tmpDir, 'nope'))).toBe(false);
  });
});

describe('listFiles', () => {
  it('lists all files in a directory', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
    await fs.writeFile(path.join(tmpDir, 'b.yml'), '');
    const files = await listFiles(tmpDir);
    expect(files.sort()).toEqual(['a.txt', 'b.yml']);
  });

  it('filters by extension', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), '');
    await fs.writeFile(path.join(tmpDir, 'b.yml'), '');
    const files = await listFiles(tmpDir, '.yml');
    expect(files).toEqual(['b.yml']);
  });

  it('returns empty array for non-existent directory', async () => {
    const files = await listFiles(path.join(tmpDir, 'missing'));
    expect(files).toEqual([]);
  });
});
