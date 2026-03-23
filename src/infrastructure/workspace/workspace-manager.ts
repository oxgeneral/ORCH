/**
 * Workspace manager implementation.
 *
 * Resolves workspace path based on mode priority chain:
 * task.workspace_mode → agent.config.workspace_mode → defaults.agent.workspace_mode → 'worktree'
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task, WorkspaceMode } from '../../domain/task.js';
import type { IProcessManager } from '../process/process-manager.js';
import { validateWorkspacePath, sanitizeId } from '../storage/paths.js';
import { ensureDir } from '../storage/fs-utils.js';
import type { IWorkspaceManager, PrepareResult } from './interface.js';
import { MergeStrategy, type MergeResult } from './merge-strategy.js';
import { WorkspaceError } from '../../domain/errors.js';

export class WorkspaceManager implements IWorkspaceManager {
  private readonly mergeStrategy: MergeStrategy;
  private gitRepoChecked = false;
  private isGitRepo = false;

  constructor(
    private readonly projectRoot: string,
    private readonly orchestryDir: string,
    private readonly processManager: IProcessManager,
  ) {
    this.mergeStrategy = new MergeStrategy(projectRoot, processManager);
  }

  async prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult> {
    const mode = this.resolveMode(task, agent, config);

    if (mode !== 'shared') {
      await this.requireGitRepo(mode);
    }

    switch (mode) {
      case 'shared':
        return { path: this.projectRoot };

      case 'worktree':
        return this.prepareWorktree(task);

      case 'isolated':
        return { path: await this.prepareIsolated(task) };

      default:
        return { path: this.projectRoot };
    }
  }

  private async requireGitRepo(mode: WorkspaceMode): Promise<void> {
    if (!this.gitRepoChecked) {
      const code = await this.spawnAndWait('git', ['rev-parse', '--is-inside-work-tree']);
      this.isGitRepo = code === 0;
      // Only cache positive result — negative may change if user runs git init
      if (this.isGitRepo) this.gitRepoChecked = true;
    }

    if (!this.isGitRepo) {
      throw new WorkspaceError(
        `workspace_mode "${mode}" requires a git repository`,
        'Run: git init && git add -A && git commit -m "Initial commit"\n         Or set workspace_mode: shared in .orchestry/config.yml',
      );
    }
  }

  async mergeBack(branch: string): Promise<MergeResult> {
    return this.mergeStrategy.mergeBack(branch);
  }

  async cleanup(taskId: string, branch?: string): Promise<void> {
    const workspacePath = path.join(this.orchestryDir, 'workspaces', sanitizeId(taskId));

    // Try git worktree remove first (cleans up .git/worktrees/ metadata)
    await this.spawnAndWait('git', ['worktree', 'remove', '--force', workspacePath]);

    // Delete branch + remove directory concurrently
    const branchDeletion = branch
      ? this.spawnAndWait('git', ['branch', '-D', branch]).then(() => {})
      : Promise.resolve();

    const dirRemoval = fs.rm(workspacePath, { recursive: true, force: true }).catch(() => {});

    await Promise.all([branchDeletion, dirRemoval]);
  }

  validate(workspacePath: string, projectRoot: string): void {
    validateWorkspacePath(workspacePath, projectRoot);
  }

  /**
   * Get files changed on a worktree branch relative to its merge-base.
   * Uses `git merge-base` to find the fork point dynamically (no hardcoded branch name).
   */
  async getChangedFiles(branch: string): Promise<string[]> {
    try {
      const { stdout: baseStdout } = await this.spawnAndCapture(
        'git', ['merge-base', 'HEAD', branch],
      );
      const mergeBase = baseStdout.trim();
      if (!mergeBase) return [];

      const { stdout: diffStdout, code } = await this.spawnAndCapture(
        'git', ['diff', '--name-only', `${mergeBase}...${branch}`],
      );
      if (code !== 0 || !diffStdout.trim()) return [];
      return diffStdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private resolveMode(task: Task, agent: Agent, config: OrchestratorConfig): WorkspaceMode {
    return (
      task.workspace_mode ??
      agent.config.workspace_mode ??
      config.defaults.agent.workspace_mode ??
      'worktree'
    );
  }

  private async prepareWorktree(task: Task): Promise<PrepareResult> {
    const workspacePath = path.join(
      this.orchestryDir,
      'workspaces',
      sanitizeId(task.id),
    );
    await ensureDir(path.dirname(workspacePath));

    const titleSlug = sanitizeTitle(task.title) || sanitizeId(task.id);
    const branchName = `orchestry/${sanitizeId(task.id)}/${titleSlug}`;

    // Idempotent: if worktree directory already exists (retry after failure), reuse it
    try {
      await fs.access(workspacePath);
      return { path: workspacePath, branch: branchName };
    } catch {
      // Directory doesn't exist — create fresh
    }

    // Try creating worktree: first with new branch (-b), fallback to existing branch
    const createResult = await this.spawnAndWait(
      'git', ['worktree', 'add', workspacePath, '-b', branchName],
    );
    if (createResult !== 0) {
      // Branch may already exist from a previous failed run — prune stale metadata and retry
      await this.spawnAndWait('git', ['worktree', 'prune']);
      const reuseResult = await this.spawnAndWait(
        'git', ['worktree', 'add', workspacePath, branchName],
      );
      if (reuseResult !== 0) {
        throw new WorkspaceError(
          `git worktree add failed with code ${reuseResult}`,
          'Run: git worktree prune && git branch | grep orchestry | xargs -r git branch -D',
        );
      }
    }

    // Remove .orchestry/ from worktree to prevent recursive state/workspaces
    const worktreeOrchestry = path.join(workspacePath, '.orchestry');
    await fs.rm(worktreeOrchestry, { recursive: true, force: true }).catch(() => {});

    return { path: workspacePath, branch: branchName };
  }

  /** Spawn a command and return exit code (non-throwing). */
  private async spawnAndWait(cmd: string, args: string[]): Promise<number> {
    try {
      const { process: proc } = this.processManager.spawn(cmd, args, { cwd: this.projectRoot });
      return new Promise<number>((resolve) => {
        proc.on('close', (code) => resolve(code ?? 1));
        proc.on('error', () => resolve(1));
      });
    } catch {
      return 1;
    }
  }

  /** Spawn a command and capture stdout + exit code. */
  private async spawnAndCapture(cmd: string, args: string[]): Promise<{ stdout: string; code: number }> {
    try {
      const { process: proc } = this.processManager.spawn(cmd, args, { cwd: this.projectRoot });
      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      const code = await new Promise<number>((resolve) => {
        proc.on('close', (c) => resolve(c ?? 1));
        proc.on('error', () => resolve(1));
      });
      return { stdout, code };
    } catch {
      return { stdout: '', code: 1 };
    }
  }

  private async prepareIsolated(task: Task): Promise<string> {
    const workspacePath = path.join(
      this.orchestryDir,
      'workspaces',
      sanitizeId(task.id),
    );
    await ensureDir(path.dirname(workspacePath));

    // Try git clone first, fall back to rsync
    try {
      const cloneResult = await this.spawnAndWait(
        'git', ['clone', '--local', '--no-hardlinks', this.projectRoot, workspacePath],
      );
      if (cloneResult !== 0) throw new Error('git clone failed');
    } catch {
      // Fallback: rsync
      const excludeFile = path.join(this.orchestryDir, 'workspace-exclude');
      const args = ['-a', `--exclude-from=${excludeFile}`, './', `${workspacePath}/`];

      const rsyncResult = await this.spawnAndWait('rsync', args);
      if (rsyncResult !== 0) {
        throw new Error(`rsync failed with code ${rsyncResult}`);
      }
    }

    // Remove .orchestry/ to prevent recursive workspaces (covers both clone and rsync)
    const clonedOrchestry = path.join(workspacePath, '.orchestry');
    await fs.rm(clonedOrchestry, { recursive: true, force: true }).catch(() => {});

    return workspacePath;
  }
}

function sanitizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
