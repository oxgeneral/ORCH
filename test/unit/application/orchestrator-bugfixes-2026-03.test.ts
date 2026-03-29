/**
 * Tests for March 2026 bugfixes from ORCH_DEBUG_REPORT:
 * P2: Proof detection — extract file paths from tool_call events (Claude adapter)
 * P3: Orphaned preparing runs — cleanup at startup
 * P4: `orch logs --since` without filter
 * Bonus: Per-agent stall_timeout_ms in reconcile
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import type { AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { Run } from '../../../src/domain/run.js';
import {
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockProcessManager,
  createMockAdapter,
  cleanupOrch,
  buildDeps,
} from './helpers.js';

// Mock the lock module
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
  touchLock: vi.fn(async () => {}),
}));

// ============================================================
// P2: Proof detection — tool_call file path extraction
// ============================================================
describe('P2: Proof detection — tool_call file path extraction', () => {
  const orchInstances: Orchestrator[] = [];

  afterEach(() => {
    for (const orch of orchInstances) cleanupOrch(orch);
    orchInstances.length = 0;
  });

  it('extracts file paths from Claude tool_use Write events into proof.files_changed', async () => {
    const task = makeTask({ id: 'tsk_p2', status: 'todo' });
    const agent = makeAgent({ id: 'agt_p2', adapter: 'shell', config: { approval_policy: 'auto' } });
    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();

    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/project/src/main.ts', content: 'hello' } },
      },
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/project/src/utils.ts', old_string: 'a', new_string: 'b' } },
      },
      {
        type: 'done',
        timestamp: new Date().toISOString(),
        data: { type: 'result', result: 'Done writing files' },
      },
    ];

    const registry = new AdapterRegistry();
    registry.register(createMockAdapter(events));

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      adapterRegistry: registry,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    // Wait for dispatch + collectEvents to finish
    await new Promise((r) => setTimeout(r, 300));

    // Check that task was saved with files_changed populated from tool_call events
    const savedCalls = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const finalSave = savedCalls.find(
      (call: any[]) => call[0].id === 'tsk_p2' && call[0].proof?.files_changed?.length > 0,
    );
    expect(finalSave).toBeDefined();

    const savedTask = finalSave![0];
    expect(savedTask.proof.files_changed).toContain('/tmp/project/src/main.ts');
    expect(savedTask.proof.files_changed).toContain('/tmp/project/src/utils.ts');
  });

  it('emits agent:file_changed events for tool_call-derived file paths', async () => {
    const task = makeTask({ id: 'tsk_p2e', status: 'todo' });
    const agent = makeAgent({ id: 'agt_p2e', adapter: 'shell', config: { approval_policy: 'auto' } });
    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();
    const eventBus = new EventBus();

    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { type: 'tool_use', name: 'Write', input: { file_path: '/tmp/file.ts', content: '' } },
      },
      { type: 'done', timestamp: new Date().toISOString(), data: { result: 'ok' } },
    ];

    const registry = new AdapterRegistry();
    registry.register(createMockAdapter(events));

    const fileChangedEvents: string[] = [];
    eventBus.on('agent:file_changed', (event) => {
      fileChangedEvents.push(event.path);
    });

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      adapterRegistry: registry,
      eventBus,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 300));

    expect(fileChangedEvents).toContain('/tmp/file.ts');
  });

  it('does not extract file paths from non-write tool_call events', async () => {
    const task = makeTask({ id: 'tsk_p2n', status: 'todo' });
    const agent = makeAgent({ id: 'agt_p2n', adapter: 'shell', config: { approval_policy: 'auto' } });
    const taskStore = createMockTaskStore([task]);
    const agentStore = createMockAgentStore([agent]);
    const runStore = createMockRunStore();

    const events: AgentEvent[] = [
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/readme.md' } },
      },
      {
        type: 'tool_call',
        timestamp: new Date().toISOString(),
        data: { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      },
      { type: 'done', timestamp: new Date().toISOString(), data: { result: 'done' } },
    ];

    const registry = new AdapterRegistry();
    registry.register(createMockAdapter(events));

    const deps = buildDeps({
      taskStore,
      agentStore,
      runStore,
      adapterRegistry: registry,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 300));

    // Check that files_changed is empty (Read and Bash are not write operations)
    const savedCalls = (taskStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const proofSaves = savedCalls.filter(
      (call: any[]) => call[0].id === 'tsk_p2n' && call[0].proof,
    );

    // Either no proof saves with files, or files_changed is empty
    for (const save of proofSaves) {
      const fc = save[0].proof?.files_changed ?? [];
      expect(fc).not.toContain('/tmp/readme.md');
    }
  });
});

// ============================================================
// P3: Orphaned preparing runs cleanup
// ============================================================
describe('P3: Orphaned preparing runs — cleanup at startup', () => {
  const orchInstances: Orchestrator[] = [];

  afterEach(() => {
    for (const orch of orchInstances) cleanupOrch(orch);
    orchInstances.length = 0;
  });

  it('finalizes orphaned preparing runs as cancelled during startup', async () => {
    const orphanedRun = makeRun({
      id: 'run_orphan1',
      status: 'preparing',
      started_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const runStore = createMockRunStore();
    await runStore.save(orphanedRun);

    const deps = buildDeps({
      taskStore: createMockTaskStore([]),
      agentStore: createMockAgentStore([]),
      runStore,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 100));

    // The orphaned run should have been finalized via runStore.save
    const saveCalls = (runStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const orphanFinish = saveCalls.find(
      (call: any[]) => call[0].id === 'run_orphan1' && call[0].status === 'cancelled',
    );
    expect(orphanFinish).toBeDefined();
    expect(orphanFinish![0].error).toContain('Orphaned');
  });

  it('does not finalize runs that are actively running (in state.running)', async () => {
    const activeRun = makeRun({
      id: 'run_active1',
      status: 'preparing',
    });

    const runStore = createMockRunStore();
    await runStore.save(activeRun);

    // Simulate an active running entry for this run
    const stateStore = createMockStateStore({
      running: {
        tsk_test1: {
          run_id: 'run_active1',
          agent_id: 'agt_test1',
          pid: 12345,
          started_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        },
      },
    });

    const processManager = createMockProcessManager();
    // Process is alive
    (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const deps = buildDeps({
      taskStore: createMockTaskStore([makeTask({ status: 'in_progress' })]),
      agentStore: createMockAgentStore([makeAgent({ status: 'running' })]),
      runStore,
      stateStore,
      processManager,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 100));

    // The active run should NOT have been cancelled
    const saveCalls = (runStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const cancelledRun = saveCalls.find(
      (call: any[]) => call[0].id === 'run_active1' && call[0].status === 'cancelled',
    );
    expect(cancelledRun).toBeUndefined();
  });

  it('handles multiple orphaned preparing runs in parallel', async () => {
    const orphans = [
      makeRun({ id: 'run_o1', status: 'preparing' }),
      makeRun({ id: 'run_o2', status: 'preparing' }),
      makeRun({ id: 'run_o3', status: 'preparing' }),
    ];

    const runStore = createMockRunStore();
    for (const run of orphans) await runStore.save(run);

    const deps = buildDeps({
      taskStore: createMockTaskStore([]),
      agentStore: createMockAgentStore([]),
      runStore,
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 100));

    const saveCalls = (runStore.save as ReturnType<typeof vi.fn>).mock.calls;
    const cancelledIds = saveCalls
      .filter((call: any[]) => call[0].status === 'cancelled')
      .map((call: any[]) => call[0].id);

    expect(cancelledIds).toContain('run_o1');
    expect(cancelledIds).toContain('run_o2');
    expect(cancelledIds).toContain('run_o3');
  });
});

// ============================================================
// Bonus: Per-agent stall_timeout_ms in reconcile
// ============================================================
describe('Bonus: Per-agent stall_timeout_ms in reconcile', () => {
  const orchInstances: Orchestrator[] = [];

  afterEach(() => {
    for (const orch of orchInstances) cleanupOrch(orch);
    orchInstances.length = 0;
  });

  it('uses per-agent stall timeout instead of global when agent has custom value', async () => {
    // Agent with a very long stall timeout (30 minutes)
    const agent = makeAgent({
      id: 'agt_long',
      status: 'running',
      config: {
        stall_timeout_ms: 1_800_000, // 30 min
        approval_policy: 'auto',
      },
    });
    const task = makeTask({ id: 'tsk_stall', status: 'in_progress' });

    const lastEventAt = new Date(Date.now() - 700_000).toISOString(); // 11.7 min ago

    const stateStore = createMockStateStore({
      running: {
        tsk_stall: {
          run_id: 'run_stall',
          agent_id: 'agt_long',
          pid: 55555,
          started_at: new Date().toISOString(),
          last_event_at: lastEventAt,
        },
      },
    });

    const processManager = createMockProcessManager();
    (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const runStore = createMockRunStore();

    const eventBus = new EventBus();
    const stallEvents: any[] = [];
    eventBus.on('orchestrator:stall_detected', (e) => stallEvents.push(e));

    // Global stall timeout is 10 min (default 600_000), but agent has 30 min
    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      runStore,
      stateStore,
      processManager,
      eventBus,
      config: {
        ...DEFAULT_CONFIG,
        scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 100_000 },
        defaults: {
          ...DEFAULT_CONFIG.defaults,
          agent: { ...DEFAULT_CONFIG.defaults.agent, stall_timeout_ms: 600_000 },
        },
      },
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 100));

    // With global timeout (10 min), 11.7 min would trigger stall.
    // With per-agent timeout (30 min), it should NOT trigger.
    expect(stallEvents).toHaveLength(0);
    expect(processManager.killWithGrace).not.toHaveBeenCalled();
  });

  it('falls back to global stall timeout when agent has no custom value', async () => {
    // Agent without custom stall_timeout_ms
    const agent = makeAgent({
      id: 'agt_default',
      status: 'running',
      config: {
        approval_policy: 'auto',
        // No stall_timeout_ms set — should use global 600_000 (10 min)
      },
    });
    const task = makeTask({ id: 'tsk_stall2', status: 'in_progress' });

    const lastEventAt = new Date(Date.now() - 700_000).toISOString(); // 11.7 min ago

    const stateStore = createMockStateStore({
      running: {
        tsk_stall2: {
          run_id: 'run_stall2',
          agent_id: 'agt_default',
          pid: 55556,
          started_at: new Date().toISOString(),
          last_event_at: lastEventAt,
        },
      },
    });

    const processManager = createMockProcessManager();
    (processManager.isAlive as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const runStore = createMockRunStore();

    const eventBus = new EventBus();
    const stallEvents: any[] = [];
    eventBus.on('orchestrator:stall_detected', (e) => stallEvents.push(e));

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      runStore,
      stateStore,
      processManager,
      eventBus,
      config: {
        ...DEFAULT_CONFIG,
        scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 100_000 },
        defaults: {
          ...DEFAULT_CONFIG.defaults,
          agent: { ...DEFAULT_CONFIG.defaults.agent, stall_timeout_ms: 600_000 },
        },
      },
    });

    const orchestrator = new Orchestrator(deps);
    orchInstances.push(orchestrator);

    await orchestrator.startWatch();
    await new Promise((r) => setTimeout(r, 100));

    // With global timeout (10 min), 11.7 min SHOULD trigger stall
    expect(stallEvents).toHaveLength(1);
    expect(stallEvents[0].runId).toBe('run_stall2');
    expect(processManager.killWithGrace).toHaveBeenCalled();
  });
});
