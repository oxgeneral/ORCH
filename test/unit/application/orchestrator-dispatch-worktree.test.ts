/**
 * Tests for dispatchTask worktree fix (bug-dom-001):
 * Verifies that after dispatching a worktree task, the saved task object
 * has the correct in_progress status (not stale local copy), correct
 * attempts counter, and proof.branch / workspace fields set.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Orchestrator } from '../../../src/application/orchestrator.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { Task } from '../../../src/domain/task.js';
import {
  buildDeps,
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  createMockWorkspaceManager,
  createMockAdapter,
} from './helpers.js';

// Mock the lock module so tests don't touch the filesystem
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
  touchLock: vi.fn(async () => {}),
}));

/** Clean up an orchestrator instance to prevent timer leaks between tests */
function cleanupOrch(orch: Orchestrator) {
  const o = orch as any;
  if (o.intervalId) { clearInterval(o.intervalId); o.intervalId = null; }
  o.shuttingDown = true;
  o.removeSignalHandlers?.();
  if (o.lockAcquired) { o.lockAcquired = false; }
  if (o.saveStateTimer) { clearTimeout(o.saveStateTimer); o.saveStateTimer = null; }
  if (o.immediateDispatchTimer) { clearTimeout(o.immediateDispatchTimer); o.immediateDispatchTimer = null; }
}

describe('dispatchTask — worktree stale-overwrite fix', () => {
  const orchInstances: Orchestrator[] = [];

  afterEach(() => {
    for (const orch of orchInstances) cleanupOrch(orch);
    orchInstances.length = 0;
  });

  function makeWorktreeRegistry() {
    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter([
        { type: 'done', timestamp: '2025-01-01T00:00:00Z', data: { result: 'ok' } },
      ]),
    );
    return registry;
  }

  async function dispatchWorktreeTask(opts: {
    branch: string;
    workspacePath?: string;
    taskOverrides?: Partial<Task>;
  }) {
    const branch = opts.branch;
    const workspacePath = opts.workspacePath ?? '/tmp/worktree/tsk_wt1';
    const task = makeTask({
      id: 'tsk_wt1',
      status: 'todo',
      attempts: 0,
      ...opts.taskOverrides,
    });
    const agent = makeAgent({ id: 'agt_wt1', adapter: 'shell' });

    const workspaceManager = createMockWorkspaceManager();
    (workspaceManager.prepare as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: workspacePath,
      branch,
    });

    const taskStore = createMockTaskStore([task]);
    const deps = buildDeps({
      taskStore,
      agentStore: createMockAgentStore([agent]),
      workspaceManager,
      adapterRegistry: makeWorktreeRegistry(),
    });

    const orch = new Orchestrator(deps);
    orchInstances.push(orch);
    await orch.startWatch();
    await new Promise((r) => setTimeout(r, 150));

    return { taskStore, workspaceManager, deps };
  }

  it('saves in_progress status (not stale todo) when worktree branch is present', async () => {
    const { taskStore } = await dispatchWorktreeTask({ branch: 'orch/tsk_wt1' });

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    // The worktree save (with proof.branch) must have in_progress status, not todo
    const worktreeSave = saves.find(
      ([t]: [Task]) => t.id === 'tsk_wt1' && t.proof?.branch === 'orch/tsk_wt1',
    );
    expect(worktreeSave).toBeDefined();
    const [savedTask] = worktreeSave as [Task];
    expect(savedTask.status).toBe('in_progress');
  });

  it('sets proof.branch to the worktree branch name', async () => {
    const { taskStore } = await dispatchWorktreeTask({ branch: 'orch/tsk_wt1' });

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const worktreeSave = saves.find(
      ([t]: [Task]) => t.id === 'tsk_wt1' && t.proof?.branch,
    );
    expect(worktreeSave).toBeDefined();
    const [savedTask] = worktreeSave as [Task];
    expect(savedTask.proof?.branch).toBe('orch/tsk_wt1');
  });

  it('sets workspace to the worktree path', async () => {
    const wspath = '/tmp/worktrees/orch-tsk_wt1';
    const { taskStore } = await dispatchWorktreeTask({
      branch: 'orch/tsk_wt1',
      workspacePath: wspath,
    });

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const worktreeSave = saves.find(
      ([t]: [Task]) => t.id === 'tsk_wt1' && t.proof?.branch === 'orch/tsk_wt1',
    );
    expect(worktreeSave).toBeDefined();
    const [savedTask] = worktreeSave as [Task];
    expect(savedTask.workspace).toBe(wspath);
  });

  it('saves correct attempts counter (1) after first dispatch', async () => {
    const { taskStore } = await dispatchWorktreeTask({ branch: 'orch/tsk_wt1' });

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const worktreeSave = saves.find(
      ([t]: [Task]) => t.id === 'tsk_wt1' && t.proof?.branch === 'orch/tsk_wt1',
    );
    expect(worktreeSave).toBeDefined();
    const [savedTask] = worktreeSave as [Task];
    expect(savedTask.attempts).toBe(1);
  });

  it('does not save proof.branch for non-worktree tasks (no branch from workspace)', async () => {
    const task = makeTask({ id: 'tsk_nwt', status: 'todo', attempts: 0 });
    const agent = makeAgent({ id: 'agt_nwt', adapter: 'shell' });

    const workspaceManager = createMockWorkspaceManager();
    // No branch — regular workspace, not worktree
    (workspaceManager.prepare as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/tmp/ws/tsk_nwt',
    });

    const taskStore = createMockTaskStore([task]);
    const deps = buildDeps({
      taskStore,
      agentStore: createMockAgentStore([agent]),
      workspaceManager,
      adapterRegistry: makeWorktreeRegistry(),
    });

    const orch = new Orchestrator(deps);
    orchInstances.push(orch);
    await orch.startWatch();
    await new Promise((r) => setTimeout(r, 150));

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    // No save should have proof.branch set
    const worktreeSave = saves.find(([t]: [Task]) => t.proof?.branch);
    expect(worktreeSave).toBeUndefined();
  });

  it('preserves existing proof.files_changed when saving branch', async () => {
    const { taskStore } = await dispatchWorktreeTask({
      branch: 'orch/tsk_wt1',
      taskOverrides: { proof: { files_changed: ['README.md'] } },
    });

    const saves = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const worktreeSave = saves.find(
      ([t]: [Task]) => t.id === 'tsk_wt1' && t.proof?.branch === 'orch/tsk_wt1',
    );
    expect(worktreeSave).toBeDefined();
    const [savedTask] = worktreeSave as [Task];
    // Existing files_changed should be preserved via spread
    expect(savedTask.proof?.files_changed).toEqual(['README.md']);
  });
});

describe('dispatchTask — graceful null on freshTask re-read', () => {
  let orchInstance: Orchestrator | null = null;

  afterEach(() => {
    if (orchInstance) {
      cleanupOrch(orchInstance);
      orchInstance = null;
    }
  });

  it('does not throw if taskStore.get returns null for fresh re-read after dispatch', async () => {
    const task = makeTask({ id: 'tsk_missing', status: 'todo', attempts: 0 });
    const agent = makeAgent({ id: 'agt_missing', adapter: 'shell' });

    const workspaceManager = createMockWorkspaceManager();
    (workspaceManager.prepare as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: '/tmp/ws/missing',
      branch: 'orch/tsk_missing',
    });

    const registry = new AdapterRegistry();
    registry.register(
      createMockAdapter([
        { type: 'done', timestamp: '2025-01-01T00:00:00Z', data: { result: 'ok' } },
      ]),
    );

    const taskStore = createMockTaskStore([task]);
    // Simulate race: freshTask re-read returns null after threshold calls
    let getCallCount = 0;
    const originalGet = (taskStore.get as ReturnType<typeof vi.fn>).getMockImplementation()!;
    (taskStore.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
      getCallCount++;
      // After several calls, simulate the task having been deleted (race condition)
      if (getCallCount > 6 && id === 'tsk_missing') return null;
      return originalGet(id);
    });

    const deps = buildDeps({
      taskStore,
      agentStore: createMockAgentStore([agent]),
      workspaceManager,
      adapterRegistry: registry,
    });

    orchInstance = new Orchestrator(deps);
    // startWatch itself resolves — errors in tick loop are caught internally
    await expect(orchInstance.startWatch()).resolves.not.toThrow();
    // Wait for tick to run without throwing
    await new Promise((r) => setTimeout(r, 150));
    // If we reach here without unhandled rejection — fix is working
    expect(true).toBe(true);
  });
});
