import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceManager } from '../../../src/infrastructure/workspace/workspace-manager.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import { DEFAULT_CONFIG, type OrchestratorConfig } from '../../../src/domain/config.js';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_ws1',
    title: 'Workspace test',
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_ws1',
    name: 'WsAgent',
    adapter: 'claude',
    config: {
      approval_policy: 'auto',
      max_turns: 50,
      timeout_ms: 3_600_000,
      stall_timeout_ms: 300_000,
    },
    status: 'idle',
    stats: {
      tasks_completed: 0,
      tasks_failed: 0,
      total_runs: 0,
      total_runtime_ms: 0,
    },
    ...overrides,
  };
}

function createMockProcess(exitCode = 0): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  (proc as any).stdout = new EventEmitter();
  (proc as any).stderr = new EventEmitter();
  (proc as any).stdin = null;
  (proc as any).pid = 12345;
  // Auto-emit close after microtask
  Promise.resolve().then(() => proc.emit('close', exitCode));
  return proc;
}

function createMockProcessManager(exitCode = 0): IProcessManager {
  return {
    isAlive: vi.fn(() => false),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn(() => ({
      process: createMockProcess(exitCode),
      pid: 12345,
    })),
  };
}

describe('WorkspaceManager', () => {
  let tmpDir: string;
  let orchestryDir: string;
  let processManager: IProcessManager;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-ws-'));
    orchestryDir = path.join(tmpDir, '.orchestry');
    await fs.mkdir(orchestryDir, { recursive: true });
    processManager = createMockProcessManager();
    manager = new WorkspaceManager(tmpDir, orchestryDir, processManager);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('resolveMode (via prepare)', () => {
    it('returns shared mode path (project root) for shared workspace', async () => {
      const task = makeTask({ workspace_mode: 'shared' });
      const result = await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);
      expect(result.path).toBe(tmpDir);
      expect(result.branch).toBeUndefined();
    });

    it('uses task.workspace_mode over agent config', async () => {
      const task = makeTask({ workspace_mode: 'shared' });
      const agent = makeAgent({ config: { ...makeAgent().config, workspace_mode: 'worktree' } });
      const result = await manager.prepare(task, agent, DEFAULT_CONFIG);
      expect(result.path).toBe(tmpDir);
    });

    it('uses agent.config.workspace_mode when task has none', async () => {
      const task = makeTask({ workspace_mode: undefined });
      const agent = makeAgent({ config: { ...makeAgent().config, workspace_mode: 'shared' } });
      const result = await manager.prepare(task, agent, DEFAULT_CONFIG);
      expect(result.path).toBe(tmpDir);
    });

    it('uses config defaults when neither task nor agent specify mode', async () => {
      const task = makeTask({ workspace_mode: undefined });
      const agent = makeAgent({ config: { ...makeAgent().config, workspace_mode: undefined } });
      const configWithShared = {
        ...DEFAULT_CONFIG,
        defaults: {
          ...DEFAULT_CONFIG.defaults,
          agent: { ...DEFAULT_CONFIG.defaults.agent, workspace_mode: 'shared' as const },
        },
      };
      const result = await manager.prepare(task, agent, configWithShared);
      expect(result.path).toBe(tmpDir);
    });

    it('defaults to worktree when nothing specified', async () => {
      const task = makeTask({ workspace_mode: undefined });
      const agent = makeAgent({ config: { ...makeAgent().config, workspace_mode: undefined } });
      const configNoMode = {
        ...DEFAULT_CONFIG,
        defaults: {
          ...DEFAULT_CONFIG.defaults,
          agent: { ...DEFAULT_CONFIG.defaults.agent, workspace_mode: undefined as any },
        },
      };
      const result = await manager.prepare(task, agent, configNoMode);
      // Should call git worktree add
      expect(processManager.spawn).toHaveBeenCalled();
    });
  });

  describe('prepareWorktree', () => {
    it('spawns git worktree add with correct branch name', async () => {
      const task = makeTask({ id: 'tsk_wt1', title: 'My Cool Feature!' });
      const result = await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);

      expect(processManager.spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.objectContaining({ cwd: tmpDir }),
      );

      // Branch should be sanitized
      const spawnArgs = (processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const branchArg = spawnArgs[1][spawnArgs[1].indexOf('-b') + 1];
      expect(branchArg).toMatch(/^orchestry\//);
      expect(branchArg).toContain('my-cool-feature');
      expect(branchArg).not.toContain('!');
    });

    it('returns branch name in result', async () => {
      const task = makeTask({ title: 'Feature X' });
      const result = await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);
      expect(result.branch).toMatch(/^orchestry\//);
    });

    it('uses task id as fallback when title has only CJK characters', async () => {
      const task = makeTask({ id: 'tsk_cjk1', title: '修复数据库连接' });
      const result = await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);

      const spawnArgs = (processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const branchArg = spawnArgs[1][spawnArgs[1].indexOf('-b') + 1];
      // sanitizeTitle returns '' for CJK → fallback to sanitizeId(task.id)
      expect(branchArg).toBe('orchestry/tsk_cjk1/tsk_cjk1');
      expect(result.branch).toBe('orchestry/tsk_cjk1/tsk_cjk1');
    });

    it('uses task id as fallback when title has only emoji', async () => {
      const task = makeTask({ id: 'tsk_emo1', title: '🚀🎉✨' });
      const result = await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);

      const spawnArgs = (processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[0];
      const branchArg = spawnArgs[1][spawnArgs[1].indexOf('-b') + 1];
      expect(branchArg).toBe('orchestry/tsk_emo1/tsk_emo1');
    });

    it('throws when git worktree add fails', async () => {
      processManager = createMockProcessManager(1); // exit code 1
      manager = new WorkspaceManager(tmpDir, orchestryDir, processManager);

      const task = makeTask();
      await expect(manager.prepare(task, makeAgent(), DEFAULT_CONFIG))
        .rejects.toThrow('git worktree add failed');
    });
  });

  describe('prepareIsolated', () => {
    it('spawns git clone for isolated mode', async () => {
      const task = makeTask({ workspace_mode: 'isolated' });
      await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);

      expect(processManager.spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['clone', '--local', '--no-hardlinks']),
        expect.objectContaining({ cwd: tmpDir }),
      );
    });

    it('falls back to rsync when git clone fails', async () => {
      let callCount = 0;
      (processManager.spawn as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // git clone fails
          return { process: createMockProcess(1), pid: 12345 };
        }
        // rsync succeeds
        return { process: createMockProcess(0), pid: 12346 };
      });

      const task = makeTask({ workspace_mode: 'isolated' });
      await manager.prepare(task, makeAgent(), DEFAULT_CONFIG);

      // Should have called spawn twice: git clone + rsync
      expect(processManager.spawn).toHaveBeenCalledTimes(2);
      const secondCall = (processManager.spawn as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall[0]).toBe('rsync');
    });
  });

  describe('cleanup', () => {
    it('tries git worktree remove then falls back to fs.rm', async () => {
      const workspacePath = path.join(orchestryDir, 'workspaces', 'tsk_clean');
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.writeFile(path.join(workspacePath, 'file.txt'), 'test');

      await manager.cleanup('tsk_clean');

      expect(processManager.spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove', '--force']),
        expect.objectContaining({ cwd: tmpDir }),
      );

      // Directory should be removed even if git worktree remove "succeeds"
      const exists = await fs.access(workspacePath).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it('does not throw when workspace does not exist', async () => {
      await expect(manager.cleanup('tsk_nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('mergeBack', () => {
    it('delegates to MergeStrategy', async () => {
      const result = await manager.mergeBack('orchestry/tsk_1/test-branch');
      // Our mock process exits with code 0 → success
      expect(result.success).toBe(true);
    });
  });
});
