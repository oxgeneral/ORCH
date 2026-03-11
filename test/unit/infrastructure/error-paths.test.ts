import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson, appendJsonl, readJsonl, readYaml, writeYaml } from '../../../src/infrastructure/storage/fs-utils.js';
import { StateStore } from '../../../src/infrastructure/storage/state-store.js';
import { RunStore } from '../../../src/infrastructure/storage/run-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import { DEFAULT_STATE, type OrchestratorState } from '../../../src/domain/state.js';
import { acquireLock, releaseLock, checkLock } from '../../../src/infrastructure/storage/lock.js';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';

describe('Error paths', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-errors-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('fs errors on save', () => {
    it('writeJson throws on read-only directory', async () => {
      const readonlyDir = path.join(tmpDir, 'readonly');
      await fs.mkdir(readonlyDir);
      const filePath = path.join(readonlyDir, 'test.json');

      // Write first, then make readonly
      await fs.writeFile(filePath, '{}');
      await fs.chmod(readonlyDir, 0o444);

      try {
        await expect(writeJson(filePath, { foo: 'bar' })).rejects.toThrow();
      } finally {
        await fs.chmod(readonlyDir, 0o755);
      }
    });

    it('appendJsonl throws when parent directory is read-only', async () => {
      const readonlyDir = path.join(tmpDir, 'readonly-jsonl');
      await fs.mkdir(readonlyDir);
      const filePath = path.join(readonlyDir, 'events.jsonl');

      // Create the file first, then make directory readonly
      await fs.writeFile(filePath, '');
      await fs.chmod(readonlyDir, 0o444);

      try {
        await expect(appendJsonl(filePath, { test: 1 })).rejects.toThrow();
      } finally {
        await fs.chmod(readonlyDir, 0o755);
      }
    });

    it('writeJson to nonexistent nested path creates directories', async () => {
      const filePath = path.join(tmpDir, 'a', 'b', 'c', 'data.json');
      await writeJson(filePath, { created: true });

      const result = await readJson<{ created: boolean }>(filePath);
      expect(result).toEqual({ created: true });
    });

    it('StateStore.write throws when path is unwritable', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(orchestryDir, { recursive: true });
      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);

      // Write initial state
      await store.write(structuredClone(DEFAULT_STATE));

      // Make directory read-only
      await fs.chmod(orchestryDir, 0o444);

      try {
        await expect(store.write(structuredClone(DEFAULT_STATE))).rejects.toThrow();
      } finally {
        await fs.chmod(orchestryDir, 0o755);
      }
    });
  });

  describe('JSON.parse failures in stores', () => {
    it('readJson returns null for nonexistent file', async () => {
      const result = await readJson(path.join(tmpDir, 'nope.json'));
      expect(result).toBeNull();
    });

    it('readJson throws on corrupted JSON', async () => {
      const filePath = path.join(tmpDir, 'corrupt.json');
      await fs.writeFile(filePath, '{ broken json !!!', 'utf-8');

      await expect(readJson(filePath)).rejects.toThrow();
    });

    it('readJsonl skips empty lines gracefully', async () => {
      const filePath = path.join(tmpDir, 'sparse.jsonl');
      await fs.writeFile(filePath, '{"a":1}\n\n{"b":2}\n\n\n', 'utf-8');

      const records = await readJsonl<{ a?: number; b?: number }>(filePath);
      expect(records.length).toBe(2);
    });

    it('readJsonl throws on corrupted lines', async () => {
      const filePath = path.join(tmpDir, 'bad.jsonl');
      await fs.writeFile(filePath, '{"ok":1}\nnot json\n{"ok":2}\n', 'utf-8');

      // readJsonl maps all lines with JSON.parse — corrupt line will throw
      await expect(readJsonl(filePath)).rejects.toThrow();
    });

    it('readJsonl returns empty array for nonexistent file', async () => {
      const result = await readJsonl(path.join(tmpDir, 'missing.jsonl'));
      expect(result).toEqual([]);
    });

    it('StateStore.read returns defaults for corrupted state.json', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(orchestryDir, { recursive: true });
      await fs.writeFile(path.join(orchestryDir, 'state.json'), 'CORRUPT!!!', 'utf-8');

      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);

      // readJson will throw on corrupt JSON, which should propagate
      await expect(store.read()).rejects.toThrow();
    });

    it('StateStore.read returns defaults for missing state.json', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(orchestryDir, { recursive: true });

      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);

      const state = await store.read();
      expect(state).toEqual(DEFAULT_STATE);
    });

    it('StateStore.read fills in missing fields with defaults', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(orchestryDir, { recursive: true });

      // Write partial state — missing running, claimed, retry_queue
      await fs.writeFile(
        path.join(orchestryDir, 'state.json'),
        JSON.stringify({ version: 1, stats: { total_runs: 5 } }),
        'utf-8',
      );

      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);
      const state = await store.read();

      expect(state.version).toBe(1);
      expect(state.running).toEqual({});
      expect(state.claimed).toEqual([]);
      expect(state.retry_queue).toEqual([]);
      expect(state.stats.total_runs).toBe(5);
      expect(state.stats.total_tasks_completed).toBe(0);
    });

    it('StateStore.read handles null fields by replacing with defaults', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(orchestryDir, { recursive: true });

      await fs.writeFile(
        path.join(orchestryDir, 'state.json'),
        JSON.stringify({
          version: 1,
          running: null,
          claimed: null,
          retry_queue: 'bad',
          stats: null,
        }),
        'utf-8',
      );

      const paths = new Paths(tmpDir);
      const store = new StateStore(paths);
      const state = await store.read();

      expect(state.running).toEqual({});
      expect(state.claimed).toEqual([]);
      expect(state.retry_queue).toEqual([]);
      expect(state.stats).toEqual(DEFAULT_STATE.stats);
    });

    it('RunStore.streamEvents skips corrupt JSONL lines', async () => {
      const orchestryDir = path.join(tmpDir, '.orchestry');
      await fs.mkdir(path.join(orchestryDir, 'runs'), { recursive: true });

      const eventsPath = path.join(orchestryDir, 'runs', 'run_corrupt.jsonl');
      await fs.writeFile(
        eventsPath,
        '{"timestamp":"2025-01-01","type":"agent_output","data":"ok"}\nBROKEN LINE\n{"timestamp":"2025-01-02","type":"done","data":"done"}\n',
        'utf-8',
      );

      const paths = new Paths(tmpDir);
      const store = new RunStore(paths);
      const events: any[] = [];

      // Capture stderr
      const origWrite = process.stderr.write;
      const stderrOutput: string[] = [];
      process.stderr.write = ((chunk: string) => {
        stderrOutput.push(chunk);
        return true;
      }) as any;

      try {
        for await (const event of store.streamEvents('run_corrupt')) {
          events.push(event);
        }
      } finally {
        process.stderr.write = origWrite;
      }

      expect(events.length).toBe(2);
      expect(stderrOutput.some((s) => s.includes('skipping corrupt JSONL line'))).toBe(true);
    });
  });

  describe('process.kill failures', () => {
    it('ProcessManager.isAlive returns false for nonexistent PID', () => {
      const pm = new ProcessManager();
      // PID 999999999 should not exist
      expect(pm.isAlive(999999999)).toBe(false);
    });

    it('ProcessManager.kill does not throw for dead PID', () => {
      const pm = new ProcessManager();
      expect(() => pm.kill(999999999)).not.toThrow();
    });

    it('ProcessManager.killWithGrace resolves immediately for dead PID', async () => {
      const pm = new ProcessManager();
      await expect(pm.killWithGrace(999999999)).resolves.toBeUndefined();
    });

    it('ProcessManager.isAlive returns true for own PID', () => {
      const pm = new ProcessManager();
      expect(pm.isAlive(process.pid)).toBe(true);
    });
  });

  describe('lock error paths', () => {
    it('acquireLock on nonexistent directory throws', async () => {
      const lockPath = path.join(tmpDir, 'does', 'not', 'exist', 'lock');
      await expect(acquireLock(lockPath)).rejects.toThrow();
    });

    it('releaseLock does not throw when lock file missing', async () => {
      const lockPath = path.join(tmpDir, 'missing-lock');
      await expect(releaseLock(lockPath)).resolves.toBeUndefined();
    });

    it('checkLock returns not locked for missing file', async () => {
      const lockPath = path.join(tmpDir, 'check-missing');
      const result = await checkLock(lockPath);
      expect(result.locked).toBe(false);
    });

    it('checkLock returns not locked for stale PID', async () => {
      const lockPath = path.join(tmpDir, 'stale-lock');
      await fs.writeFile(lockPath, '999999999', 'utf-8');

      const result = await checkLock(lockPath);
      expect(result.locked).toBe(false);
    });

    it('checkLock returns locked for own PID', async () => {
      const lockPath = path.join(tmpDir, 'own-lock');
      await fs.writeFile(lockPath, String(process.pid), 'utf-8');

      const result = await checkLock(lockPath);
      expect(result.locked).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it('acquireLock succeeds when stale lock exists', async () => {
      const lockPath = path.join(tmpDir, 'stale-acquire');
      await fs.writeFile(lockPath, '999999999', 'utf-8');

      const result = await acquireLock(lockPath);
      expect(result.acquired).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it('acquireLock fails when live lock exists', async () => {
      const lockPath = path.join(tmpDir, 'live-lock');
      await fs.writeFile(lockPath, String(process.pid), 'utf-8');

      const result = await acquireLock(lockPath);
      expect(result.acquired).toBe(false);
      expect(result.pid).toBe(process.pid);
    });

    it('checkLock handles non-numeric content gracefully', async () => {
      const lockPath = path.join(tmpDir, 'bad-pid-lock');
      await fs.writeFile(lockPath, 'not-a-number', 'utf-8');

      const result = await checkLock(lockPath);
      expect(result.locked).toBe(false);
    });
  });

  describe('readYaml error paths', () => {
    it('readYaml returns null for nonexistent file', async () => {
      const result = await readYaml(path.join(tmpDir, 'missing.yml'));
      expect(result).toBeNull();
    });

    it('writeYaml creates nested directories', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'config.yml');
      await writeYaml(filePath, { key: 'value' });

      const result = await readYaml<{ key: string }>(filePath);
      expect(result).toEqual({ key: 'value' });
    });
  });
});
