/**
 * ReviewRunner — automatic review of completed tasks.
 *
 * Executes review criteria (test_pass, typecheck, lint) as shell commands
 * and returns pass/fail results. Used by the orchestrator to auto-approve
 * tasks that have review_criteria defined.
 *
 * Staged evaluation: criteria are sorted by speed (typecheck → test → lint)
 * and execution stops on first failure (fail-fast) to save compute.
 */

import { execFile } from 'node:child_process';
import type { ReviewCriterion, ReviewResult } from '../domain/task.js';

const CRITERION_COMMANDS: Record<ReviewCriterion, { cmd: string; args: string[] }> = {
  test_pass: { cmd: 'npm', args: ['test'] },
  typecheck: { cmd: 'npx', args: ['tsc', '--noEmit'] },
  lint: { cmd: 'npm', args: ['run', 'lint'] },
};

/** Execution order: fastest checks first. */
const CRITERION_ORDER: readonly ReviewCriterion[] = ['typecheck', 'lint', 'test_pass'];

export interface ReviewRunnerOptions {
  cwd: string;
  timeout_ms?: number;
  /** When true, stop on first failed criterion (default: true). */
  fail_fast?: boolean;
}

export class ReviewRunner {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly failFast: boolean;

  constructor(options: ReviewRunnerOptions) {
    this.cwd = options.cwd;
    this.timeoutMs = options.timeout_ms ?? 120_000;
    this.failFast = options.fail_fast ?? true;
  }

  /**
   * Run criteria in staged order (typecheck → lint → test).
   * In fail-fast mode (default), stops on first failure.
   */
  async runAll(criteria: ReviewCriterion[]): Promise<ReviewResult[]> {
    const sorted = sortCriteria(criteria);
    const results: ReviewResult[] = [];

    for (const criterion of sorted) {
      const result = await this.runCriterion(criterion);
      results.push(result);
      if (this.failFast && !result.passed) break;
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
      const truncated = r.output;
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

/** Sort criteria by CRITERION_ORDER (fastest first). */
function sortCriteria(criteria: ReviewCriterion[]): ReviewCriterion[] {
  return [...criteria].sort((a, b) => {
    const ai = CRITERION_ORDER.indexOf(a);
    const bi = CRITERION_ORDER.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}
