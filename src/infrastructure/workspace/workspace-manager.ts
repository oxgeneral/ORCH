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

export class WorkspaceManager implements IWorkspaceManager {
  private readonly mergeStrategy: MergeStrategy;

  constructor(
    private readonly projectRoot: string,
    private readonly orchestryDir: string,
    private readonly processManager: IProcessManager,
  ) {
    this.mergeStrategy = new MergeStrategy(projectRoot, processManager);
  }

  async prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult> {
    const mode = this.resolveMode(task, agent, config);

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

  async mergeBack(branch: string): Promise<MergeResult> {
    return this.mergeStrategy.mergeBack(branch);
  }

  async cleanup(taskId: string): Promise<void> {
    const workspacePath = path.join(this.orchestryDir, 'workspaces', sanitizeId(taskId));

    // Try git worktree remove first (cleans up .git/worktrees/ metadata)
    try {
      const { process: proc } = this.processManager.spawn(
        'git',
        ['worktree', 'remove', '--force', workspacePath],
        { cwd: this.projectRoot },
      );
      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve());
        proc.on('error', () => resolve());
      });
    } catch {
      // Not a worktree or git not available — fall through to rm
    }

    // Remove directory regardless (handles isolated mode and worktree cleanup failures)
    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Workspace may not exist
    }
  }

  validate(workspacePath: string, projectRoot: string): void {
    validateWorkspacePath(workspacePath, projectRoot);
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

    const branchName = `orchestry/${sanitizeId(task.id)}/${sanitizeTitle(task.title)}`;

    const { process: proc } = this.processManager.spawn(
      'git',
      ['worktree', 'add', workspacePath, '-b', branchName],
      { cwd: this.projectRoot },
    );

    await new Promise<void>((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`git worktree add failed with code ${code}`));
      });
      proc.on('error', reject);
    });

    return { path: workspacePath, branch: branchName };
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
      const { process: proc } = this.processManager.spawn(
        'git',
        ['clone', '--local', '--no-hardlinks', '.', workspacePath],
        { cwd: this.projectRoot },
      );

      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('git clone failed'));
        });
        proc.on('error', reject);
      });
    } catch {
      // Fallback: rsync
      const excludeFile = path.join(this.orchestryDir, 'workspace-exclude');
      const args = ['-a', `--exclude-from=${excludeFile}`, './', `${workspacePath}/`];

      const { process: proc } = this.processManager.spawn('rsync', args, {
        cwd: this.projectRoot,
      });

      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`rsync failed with code ${code}`));
        });
        proc.on('error', reject);
      });
    }

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
