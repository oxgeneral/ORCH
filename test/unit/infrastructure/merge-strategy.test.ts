import { describe, it, expect, vi } from 'vitest';
import { MergeStrategy } from '../../../src/infrastructure/workspace/merge-strategy.js';
import type { IProcessManager } from '../../../src/infrastructure/process/process-manager.js';
import { EventEmitter } from 'node:events';

function createMockProcess(exitCode = 0, stdoutData = '', stderrData = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: null;
    pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = null;
  proc.pid = 3333;

  // Emit data + close after microtask
  Promise.resolve().then(() => {
    if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) proc.stderr.emit('data', Buffer.from(stderrData));
    proc.emit('close', exitCode);
  });

  return proc;
}

function createMockPM(
  mergeExitCode = 0,
  mergeOutput = '',
  mergeStderr = '',
  abortExitCode = 0,
): IProcessManager {
  let callCount = 0;
  return {
    isAlive: vi.fn(() => false),
    kill: vi.fn(),
    killWithGrace: vi.fn(async () => {}),
    spawn: vi.fn((_cmd: string, args: string[]) => {
      callCount++;
      // First call = merge, second call = abort
      if (args.includes('--abort')) {
        const proc = createMockProcess(abortExitCode);
        return { process: proc as any, pid: 3334 };
      }
      const proc = createMockProcess(mergeExitCode, mergeOutput, mergeStderr);
      return { process: proc as any, pid: 3333 };
    }),
  };
}

describe('MergeStrategy', () => {
  describe('mergeBack', () => {
    it('returns success on clean merge (exit code 0)', async () => {
      const pm = createMockPM(0);
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('feature-branch');

      expect(result.success).toBe(true);
      expect(pm.spawn).toHaveBeenCalledWith(
        'git',
        ['merge', '--no-ff', 'feature-branch', '-m', 'Merge feature-branch'],
        { cwd: '/project' },
      );
    });

    it('returns failure with conflict info on CONFLICT', async () => {
      const pm = createMockPM(1, 'CONFLICT (content): Merge conflict in file.ts');
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('conflict-branch');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflictInfo).toContain('CONFLICT');
      }
      // Should also spawn git merge --abort
      expect(pm.spawn).toHaveBeenCalledTimes(2);
    });

    it('returns failure with conflict info on "Merge conflict"', async () => {
      const pm = createMockPM(1, '', 'Merge conflict in src/index.ts');
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('conflict-branch');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflictInfo).toContain('Merge conflict');
      }
    });

    it('returns failure without abort on non-conflict error', async () => {
      const pm = createMockPM(128, 'fatal: branch not found');
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('nonexistent-branch');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflictInfo).toContain('branch not found');
      }
      // Should NOT call git merge --abort for non-conflict failures
      expect(pm.spawn).toHaveBeenCalledTimes(1);
    });

    it('handles process error event', async () => {
      const pm: IProcessManager = {
        isAlive: vi.fn(() => false),
        kill: vi.fn(),
        killWithGrace: vi.fn(async () => {}),
        spawn: vi.fn(() => {
          const proc = new EventEmitter() as any;
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          proc.stdin = null;
          proc.pid = 3333;
          Promise.resolve().then(() => proc.emit('error', new Error('spawn failed')));
          return { process: proc, pid: 3333 };
        }),
      };

      const strategy = new MergeStrategy('/project', pm);
      const result = await strategy.mergeBack('branch');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflictInfo).toContain('spawn failed');
      }
    });

    it('truncates long output to 1000 chars in conflictInfo', async () => {
      const longOutput = 'CONFLICT ' + 'x'.repeat(2000);
      const pm = createMockPM(1, longOutput);
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('branch');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.conflictInfo.length).toBeLessThanOrEqual(1000);
      }
    });

    it('still resolves even if abort process also fails', async () => {
      const pm = createMockPM(1, 'CONFLICT in file.ts', '', 1);
      const strategy = new MergeStrategy('/project', pm);

      const result = await strategy.mergeBack('branch');

      expect(result.success).toBe(false);
    });
  });
});
