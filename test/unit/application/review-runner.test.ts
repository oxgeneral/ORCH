import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewRunner } from '../../../src/application/review-runner.js';
import type { ReviewCriterion, ReviewResult } from '../../../src/domain/task.js';

// Mock execFile from node:child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
const mockExecFile = vi.mocked(execFile);

function simulateExecFile(exitCode: number, stdout: string, stderr: string) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
    const error = exitCode !== 0 ? Object.assign(new Error('failed'), { code: exitCode }) : null;
    (callback as Function)(error, stdout, stderr);
    return {} as any;
  });
}

describe('ReviewRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runAll', () => {
    it('should run all criteria and return results', async () => {
      const runner = new ReviewRunner({ cwd: '/tmp/test' });

      simulateExecFile(0, 'All tests passed', '');
      simulateExecFile(0, 'No errors found', '');

      const results = await runner.runAll(['test_pass', 'typecheck']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        criterion: 'test_pass',
        passed: true,
        output: expect.stringContaining('All tests passed'),
      });
      expect(results[1]).toEqual({
        criterion: 'typecheck',
        passed: true,
        output: expect.stringContaining('No errors found'),
      });
    });

    it('should mark failed criteria correctly', async () => {
      const runner = new ReviewRunner({ cwd: '/tmp/test' });

      simulateExecFile(0, 'Tests OK', '');
      simulateExecFile(1, '', 'error TS2345: Argument of type');

      const results = await runner.runAll(['test_pass', 'typecheck']);

      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(false);
      expect(results[1]!.output).toContain('TS2345');
    });

    it('should handle all criteria failing', async () => {
      const runner = new ReviewRunner({ cwd: '/tmp/test' });

      simulateExecFile(1, '', 'FAIL src/test.ts');
      simulateExecFile(1, '', 'type error');
      simulateExecFile(1, '', 'lint error');

      const results = await runner.runAll(['test_pass', 'typecheck', 'lint']);

      expect(results).toHaveLength(3);
      expect(results.every((r) => !r.passed)).toBe(true);
    });

    it('should pass cwd and timeout to execFile', async () => {
      const runner = new ReviewRunner({ cwd: '/my/project', timeout_ms: 60_000 });

      simulateExecFile(0, 'ok', '');

      await runner.runAll(['test_pass']);

      expect(mockExecFile).toHaveBeenCalledWith(
        'npm',
        ['test'],
        expect.objectContaining({ cwd: '/my/project', timeout: 60_000 }),
        expect.any(Function),
      );
    });

    it('should truncate output to 2000 chars', async () => {
      const runner = new ReviewRunner({ cwd: '/tmp/test' });
      const longOutput = 'x'.repeat(3000);

      simulateExecFile(0, longOutput, '');

      const results = await runner.runAll(['test_pass']);

      expect(results[0]!.output.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('allPassed', () => {
    it('should return true when all results passed', () => {
      const results: ReviewResult[] = [
        { criterion: 'test_pass', passed: true, output: 'ok' },
        { criterion: 'typecheck', passed: true, output: 'ok' },
      ];
      expect(ReviewRunner.allPassed(results)).toBe(true);
    });

    it('should return false when any result failed', () => {
      const results: ReviewResult[] = [
        { criterion: 'test_pass', passed: true, output: 'ok' },
        { criterion: 'typecheck', passed: false, output: 'error' },
      ];
      expect(ReviewRunner.allPassed(results)).toBe(false);
    });

    it('should return false for empty results', () => {
      expect(ReviewRunner.allPassed([])).toBe(false);
    });
  });

  describe('formatReport', () => {
    it('should format passing results with checkmarks', () => {
      const results: ReviewResult[] = [
        { criterion: 'test_pass', passed: true, output: '42 tests passed' },
      ];
      const report = ReviewRunner.formatReport(results);
      expect(report).toContain('✓ test_pass: PASSED');
      expect(report).toContain('42 tests passed');
    });

    it('should format failing results with X marks', () => {
      const results: ReviewResult[] = [
        { criterion: 'lint', passed: false, output: '3 errors found' },
      ];
      const report = ReviewRunner.formatReport(results);
      expect(report).toContain('✗ lint: FAILED');
      expect(report).toContain('3 errors found');
    });

    it('should format mixed results', () => {
      const results: ReviewResult[] = [
        { criterion: 'test_pass', passed: true, output: 'ok' },
        { criterion: 'typecheck', passed: false, output: 'fail' },
      ];
      const report = ReviewRunner.formatReport(results);
      expect(report).toContain('✓ test_pass: PASSED');
      expect(report).toContain('✗ typecheck: FAILED');
    });
  });
});
