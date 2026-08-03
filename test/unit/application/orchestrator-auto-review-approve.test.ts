import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../../../src/application/orchestrator.js';
import type { ReviewCriterion } from '../../../src/domain/task.js';
import type { ApprovalPolicy } from '../../../src/domain/agent.js';
import {
  buildDeps,
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
} from './helpers.js';

// Mock ReviewRunner to control criteria results
vi.mock('../../../src/application/review-runner.js', () => {
  return {
    ReviewRunner: class {
      private static _results: Array<{ criterion: string; passed: boolean; output: string }> = [];

      static setResults(results: Array<{ criterion: string; passed: boolean; output: string }>) {
        ReviewRunner._results = results;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_opts: { cwd: string }) {}

      async runAll() {
        return ReviewRunner._results;
      }

      static allPassed(results: Array<{ passed: boolean }>) {
        return results.length > 0 && results.every((r) => r.passed);
      }

      static formatReport(results: Array<{ criterion: string; passed: boolean; output: string }>) {
        return results.map((r) => `${r.passed ? '✓' : '✗'} ${r.criterion}`).join('\n');
      }
    },
  };
});

// Access the mocked class
const { ReviewRunner } = await import('../../../src/application/review-runner.js');

describe('autoApprove + review_criteria interaction', () => {
  async function setup(opts: {
    autoApprove: boolean;
    reviewCriteria?: ReviewCriterion[];
    criteriaPass: boolean;
  }) {
    const taskId = 'tsk_ar1';
    const agentId = 'agt_ar1';
    const runId = 'run_ar1';

    const approvalPolicy: ApprovalPolicy = opts.autoApprove ? 'auto' : 'suggest';

    const task = makeTask({
      id: taskId,
      status: 'in_progress',
      attempts: 1,
      review_criteria: opts.reviewCriteria ?? ['test_pass'],
    });
    const agent = makeAgent({
      id: agentId,
      status: 'busy',
      current_task: taskId,
      config: {
        approval_policy: approvalPolicy,
        max_turns: 50,
        timeout_ms: 3_600_000,
        stall_timeout_ms: 300_000,
      },
    });
    const run = makeRun({
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      status: 'streaming',
    });

    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();
    await runStore.save(run);

    const stateStore = createMockStateStore({
      running: {
        [taskId]: {
          runId,
          taskId,
          agentId,
          pid: 12345,
          started_at: '2025-01-01T00:00:00Z',
        },
      },
    });

    // Set up mock review results
    const results = (opts.reviewCriteria ?? ['test_pass']).map((c) => ({
      criterion: c,
      passed: opts.criteriaPass,
      output: opts.criteriaPass ? 'ok' : 'FAILED',
    }));
    (ReviewRunner as unknown as { setResults: (r: typeof results) => void }).setResults(results);

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      stateStore,
    });

    const emittedEvents: any[] = [];
    deps.eventBus.onAny((event: any) => {
      emittedEvents.push(event);
    });

    const orch = new Orchestrator(deps);
    await (orch as any).loadState();

    return { orch, taskStore, agentStore, deps, emittedEvents, taskId, agentId, runId };
  }

  it('transitions to done when review_criteria pass and autoApprove is set', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      autoApprove: true,
      criteriaPass: true,
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const task = await taskStore.get(taskId);
    expect(task!.status).toBe('done');
  });

  it('stays in review when review_criteria fail even if autoApprove is set', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      autoApprove: true,
      criteriaPass: false,
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const task = await taskStore.get(taskId);
    expect(task!.status).toBe('review');
  });

  it('does not emit a force-approval warning when failed criteria block completion', async () => {
    const { orch, emittedEvents, taskId, runId, agentId } = await setup({
      autoApprove: true,
      criteriaPass: false,
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const warningEvent = emittedEvents.find(
      (e) => e.type === 'orchestrator:error' && e.context === 'auto-review-with-auto-approve',
    );
    expect(warningEvent).toBeUndefined();
  });

  it('stays in review when criteria fail and autoApprove is NOT set', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      autoApprove: false,
      criteriaPass: false,
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const task = await taskStore.get(taskId);
    expect(task!.status).toBe('review');
  });

  it('saves review_results when autoApprove cannot override failed checks', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      autoApprove: true,
      criteriaPass: false,
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const task = await taskStore.get(taskId);
    expect(task!.review_results).toBeDefined();
    expect(task!.review_results!.length).toBe(1);
    expect(task!.review_results![0]!.passed).toBe(false);
  });

  it('transitions review → done directly when autoApprove is set and no review_criteria', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      autoApprove: true,
      reviewCriteria: [],
      criteriaPass: true, // irrelevant — no criteria to run
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'result text', []);

    const task = await taskStore.get(taskId);
    expect(task!.status).toBe('done');
    // review_results should NOT be set — runAutoReview was never called
    expect(task!.review_results).toBeUndefined();
  });
});
