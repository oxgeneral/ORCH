/**
 * Git merge strategy for worktree branches.
 *
 * Encapsulates `git merge --no-ff` execution and conflict handling.
 */

import type { IProcessManager } from '../process/process-manager.js';

export type MergeResult =
  | { success: true }
  | { success: false; conflictInfo: string };

export class MergeStrategy {
  constructor(
    private readonly projectRoot: string,
    private readonly processManager: IProcessManager,
  ) {}

  /**
   * Merge a branch into the current branch with --no-ff.
   * On conflict, aborts the merge and returns conflict info.
   */
  async mergeBack(branch: string): Promise<MergeResult> {
    return new Promise((resolve) => {
      const { process: proc } = this.processManager.spawn(
        'git',
        ['merge', '--no-ff', branch, '-m', `Merge ${branch}`],
        { cwd: this.projectRoot },
      );

      const stdout: string[] = [];
      const stderr: string[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
      proc.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        const output = [stdout.join(''), stderr.join('')].filter(Boolean).join('\n').slice(0, 1000);
        const isConflict = output.includes('CONFLICT') || output.includes('Merge conflict');

        if (!isConflict) {
          // Non-conflict failure (branch not found, hook failure, etc.) — no merge to abort
          resolve({ success: false, conflictInfo: output });
          return;
        }

        // Abort the failed merge to restore clean state
        try {
          const { process: abortProc } = this.processManager.spawn(
            'git',
            ['merge', '--abort'],
            { cwd: this.projectRoot },
          );
          abortProc.on('close', () => {
            resolve({ success: false, conflictInfo: output });
          });
          abortProc.on('error', () => {
            resolve({ success: false, conflictInfo: output });
          });
        } catch {
          resolve({ success: false, conflictInfo: output });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, conflictInfo: err.message });
      });
    });
  }
}
