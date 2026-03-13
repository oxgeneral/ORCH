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

  it('truncates data field when line exceeds PIPE_BUF (4096 bytes)', async () => {
    const filePath = path.join(tmpDir, 'large.jsonl');
    // Create a record with data > 4096 bytes
    const largeData = 'x'.repeat(8000);
    await appendJsonl(filePath, { type: 'agent_output', data: largeData, timestamp: '2026-01-01T00:00:00Z' });

    const raw = await fs.readFile(filePath, 'utf-8');
    const lineBytes = Buffer.byteLength(raw.trimEnd(), 'utf-8');
    // The written line should fit within PIPE_BUF (4096)
    expect(lineBytes).toBeLessThanOrEqual(4096);
    // The data should end with ellipsis indicating truncation
    const parsed = JSON.parse(raw.trimEnd()) as { data: string };
    expect(parsed.data.endsWith('…')).toBe(true);
    expect(parsed.data.length).toBeLessThan(largeData.length);
  });

  it('does not truncate records that fit within PIPE_BUF', async () => {
    const filePath = path.join(tmpDir, 'small.jsonl');
    const smallData = 'hello world';
    await appendJsonl(filePath, { type: 'test', data: smallData });

    const records = await readJsonl<{ type: string; data: string }>(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].data).toBe(smallData);
  });

  it('handles records without data field exceeding PIPE_BUF', async () => {
    const filePath = path.join(tmpDir, 'nodata.jsonl');
    // Large record with numeric data (not truncatable)
    const record = { type: 'test', data: 12345, extra: 'y'.repeat(5000) };
    await appendJsonl(filePath, record);

    // Should still write (no crash), even if > PIPE_BUF
    const records = await readJsonl<typeof record>(filePath);
    expect(records).toHaveLength(1);
    expect(records[0].data).toBe(12345);
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
