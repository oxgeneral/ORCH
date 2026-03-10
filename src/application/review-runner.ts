/**
 * ReviewRunner — automatic review of completed tasks.
 *
 * Executes review criteria (test_pass, typecheck, lint) as shell commands
 * and returns pass/fail results. Used by the orchestrator to auto-approve
 * tasks that have review_criteria defined.
 */

import { execFile } from 'node:child_process';
import type { ReviewCriterion, ReviewResult } from '../domain/task.js';

const CRITERION_COMMANDS: Record<ReviewCriterion, { cmd: string; args: string[] }> = {
  test_pass: { cmd: 'npm', args: ['test'] },
  typecheck: { cmd: 'npx', args: ['tsc', '--noEmit'] },
  lint: { cmd: 'npm', args: ['run', 'lint'] },
};

export interface ReviewRunnerOptions {
  cwd: string;
  timeout_ms?: number;
}

export class ReviewRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;

  constructor(options: ReviewRunnerOptions) {
    this.cwd = options.cwd;
    this.timeoutMs = options.timeout_ms ?? 120_000;
  }

  /**
   * Run all criteria and return results.
   * Continues running even if one criterion fails.
   */
  async runAll(criteria: ReviewCriterion[]): Promise<ReviewResult[]> {
    const results: ReviewResult[] = [];

    for (const criterion of criteria) {
      const result = await this.runCriterion(criterion);
      results.push(result);
    }

    return results;
  }

  /**
   * Check if all results passed.
   */
  static allPassed(results: ReviewResult[]): boolean {
    return results.length > 0 && results.every((r) => r.passed);
  }

  /**
   * Format results into a human-readable report.
   */
  static formatReport(results: ReviewResult[]): string {
    const lines = results.map((r) => {
      const icon = r.passed ? '✓' : '✗';
      const truncated = r.output.slice(0, 500);
      return `${icon} ${r.criterion}: ${r.passed ? 'PASSED' : 'FAILED'}\n  ${truncated}`;
    });
    return lines.join('\n\n');
  }

  private runCriterion(criterion: ReviewCriterion): Promise<ReviewResult> {
    const { cmd, args } = CRITERION_COMMANDS[criterion];

    return new Promise((resolve) => {
      execFile(
        cmd,
        args,
        { cwd: this.cwd, timeout: this.timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = (stdout + '\n' + stderr).trim();
          resolve({
            criterion,
            passed: !error,
            output: output.slice(0, 2000),
          });
        },
      );
    });
  }
}
