import { describe, it, expect, vi } from 'vitest';
import { Orchestrator } from '../../../src/application/orchestrator.js';
import {
  buildDeps,
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockWorkspaceManager,
} from './helpers.js';

describe('forceTaskToReview clears agent.current_task', () => {
  async function setup(opts: { mergeResult?: any; mergeError?: Error }) {
    const taskId = 'tsk_1';
    const agentId = 'agt_1';
    const runId = 'run_1';

    const task = makeTask({
      id: taskId,
      status: 'in_progress',
      attempts: 1,
      workspace: 'worktree',
      proof: { branch: 'orch/tsk_1', files_changed: ['a.ts'] },
    });
    const agent = makeAgent({
      id: agentId,
      status: 'busy',
      current_task: taskId,
    });
    const run = makeRun({
      id: runId,
      task_id: taskId,
      agent_id: agentId,
      status: 'streaming',
    });

    const agentStore = createMockAgentStore([agent]);
    const taskStore = createMockTaskStore([task]);
    const runStore = createMockRunStore();
    // Pre-populate run in store
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

    const workspaceManager = createMockWorkspaceManager();
    if (opts.mergeError) {
      (workspaceManager.mergeBack as ReturnType<typeof vi.fn>).mockRejectedValue(opts.mergeError);
    } else if (opts.mergeResult) {
      (workspaceManager.mergeBack as ReturnType<typeof vi.fn>).mockResolvedValue(opts.mergeResult);
    }

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      stateStore,
      workspaceManager,
    });

    const orch = new Orchestrator(deps);
    await (orch as any).loadState();

    return { orch, agentStore, taskStore, taskId, agentId, runId };
  }

  it('clears current_task when merge conflict triggers forceTaskToReview', async () => {
    const { orch, agentStore, taskId, runId, agentId } = await setup({
      mergeResult: { success: false, conflictInfo: 'conflict in a.ts' },
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'done', ['a.ts']);

    const updatedAgent = await agentStore.get(agentId);
    expect(updatedAgent).toBeTruthy();
    expect(updatedAgent!.current_task).toBeUndefined();
  });

  it('clears current_task when merge throws an error', async () => {
    const { orch, agentStore, taskId, runId, agentId } = await setup({
      mergeError: new Error('git merge failed'),
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'done', ['b.ts']);

    const updatedAgent = await agentStore.get(agentId);
    expect(updatedAgent).toBeTruthy();
    expect(updatedAgent!.current_task).toBeUndefined();
  });

  it('task status is review after forceTaskToReview', async () => {
    const { orch, taskStore, taskId, runId, agentId } = await setup({
      mergeResult: { success: false, conflictInfo: 'conflict' },
    });

    await (orch as any)._handleRunSuccess(taskId, runId, agentId, undefined, 'done', ['a.ts']);

    const updatedTask = await taskStore.get(taskId);
    expect(updatedTask!.status).toBe('review');
  });
});
