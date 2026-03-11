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

      let output = '';
      const maxOutputLen = 2000;
      const appendOutput = (chunk: Buffer) => {
        if (output.length < maxOutputLen) output += chunk.toString();
      };
      proc.stdout?.on('data', appendOutput);
      proc.stderr?.on('data', appendOutput);

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        const trimmedOutput = output.slice(0, 1000);
        const isConflict = trimmedOutput.includes('CONFLICT') || trimmedOutput.includes('Merge conflict');

        if (!isConflict) {
          // Non-conflict failure (branch not found, hook failure, etc.) — no merge to abort
          resolve({ success: false, conflictInfo: trimmedOutput });
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
            resolve({ success: false, conflictInfo: trimmedOutput });
          });
          abortProc.on('error', () => {
            resolve({ success: false, conflictInfo: trimmedOutput });
          });
        } catch {
          resolve({ success: false, conflictInfo: trimmedOutput });
        }
      });

      proc.on('error', (err) => {
        resolve({ success: false, conflictInfo: err.message });
      });
    });
  }
}
