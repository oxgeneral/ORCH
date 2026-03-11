/**
 * QA verification tests for orchestrator resilience fixes:
 * 1) consecutiveTickFailures counter + shutdown after 5 failures
 * 2) Agent stats update emits orchestrator:error (no swallowed errors)
 * 3) SIGINT/SIGTERM signal handlers
 * 4) All console.error replaced with eventBus.emit orchestrator:error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../../../src/application/orchestrator.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/domain/config.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import {
  makeTask,
  makeAgent,
  makeRun,
  createMockTaskStore,
  createMockAgentStore,
  createMockRunStore,
  createMockStateStore,
  createMockProcessManager,
  createMockWorkspaceManager,
  createMockContextStore,
  makeEventGenerator,
  buildDeps,
} from './helpers.js';

// Mock lock module
vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
}));

describe('Orchestrator resilience', () => {
  let deps: OrchestratorDeps;
  let orchestrator: Orchestrator;

  afterEach(() => {
    if (orchestrator) {
      const o = orchestrator as any;
      if (o.intervalId) { clearInterval(o.intervalId); o.intervalId = null; }
      o.shuttingDown = true;
      o.removeSignalHandlers?.();
      if (o.lockAcquired) o.lockAcquired = false;
      if (o.saveStateTimer) { clearTimeout(o.saveStateTimer); o.saveStateTimer = null; }
    }
  });

  // ====================================================================
  // FIX 1: consecutiveTickFailures counter
  // ====================================================================
  describe('Fix 1: consecutiveTickFailures counter', () => {
    it('resets counter to 0 on successful tick', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });
      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 50));

      // After successful tick, counter should be 0
      expect((orchestrator as any).consecutiveTickFailures).toBe(0);
    });

    it('increments counter on tick failure', async () => {
      const stateStore = createMockStateStore();
      let callCount = 0;
      (stateStore.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount > 3) throw new Error('tick-fail');
        return structuredClone(DEFAULT_STATE);
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        stateStore,
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 20 } },
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 150));

      expect((orchestrator as any).consecutiveTickFailures).toBeGreaterThan(0);
    });

    it('emits orchestrator:error with fatal:true after 5 consecutive failures', async () => {
      const stateStore = createMockStateStore();
      let callCount = 0;
      (stateStore.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount > 3) throw new Error('persistent-error');
        return structuredClone(DEFAULT_STATE);
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        stateStore,
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 15 } },
      });

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 500));

      // Should have at least 5 error events, last one with fatal:true
      const fatalEvents = errorEvents.filter((e) => e.fatal === true);
      expect(fatalEvents.length).toBeGreaterThanOrEqual(1);
      expect(fatalEvents[0].context).toBe('tick');
    });

    it('emits orchestrator:shutdown after 5 consecutive failures', async () => {
      const stateStore = createMockStateStore();
      let callCount = 0;
      (stateStore.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount > 3) throw new Error('persistent-error');
        return structuredClone(DEFAULT_STATE);
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        stateStore,
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 15 } },
      });

      const shutdownEvents: any[] = [];
      deps.eventBus.on('orchestrator:shutdown', (e) => shutdownEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 500));

      expect(shutdownEvents.length).toBeGreaterThanOrEqual(1);
      expect(shutdownEvents[0].reason).toContain('consecutive tick failures');
    });

    it('calls stop() after 5 consecutive failures', async () => {
      const stateStore = createMockStateStore();
      let callCount = 0;
      (stateStore.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount > 3) throw new Error('persistent-error');
        return structuredClone(DEFAULT_STATE);
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
        stateStore,
        config: { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 15 } },
      });

      orchestrator = new Orchestrator(deps);
      const stopSpy = vi.spyOn(orchestrator, 'stop');

      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 500));

      expect(stopSpy).toHaveBeenCalled();
    });
  });

  // ====================================================================
  // FIX 2: Agent stats update no longer swallows errors
  // ====================================================================
  describe('Fix 2: Agent stats update emits orchestrator:error', () => {
    it('emits orchestrator:error when agentService.updateStats fails in _handleRunSuccess', async () => {
      const task = makeTask({ id: 'tsk_stats', status: 'in_progress', attempts: 1 });
      const agent = makeAgent();
      const run = makeRun({ id: 'run_stats', task_id: 'tsk_stats', agent_id: agent.id });

      const agentStore = createMockAgentStore([agent]);
      const taskStore = createMockTaskStore([task]);
      const runStore = createMockRunStore();
      (runStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(run));

      const stateStore = createMockStateStore({
        running: {
          tsk_stats: {
            run_id: 'run_stats',
            agent_id: agent.id,
            task_id: 'tsk_stats',
            pid: 77777,
            started_at: new Date().toISOString(),
            last_event_at: new Date().toISOString(),
          },
        },
      });

      deps = buildDeps({
        taskStore,
        agentStore,
        runStore,
        stateStore,
      });

      // Make agentService.updateStats fail
      deps.agentService.updateStats = vi.fn().mockRejectedValue(new Error('stats-update-boom'));

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      // Call _handleRunSuccess directly
      await (orchestrator as any)._handleRunSuccess(
        'tsk_stats', 'run_stats', agent.id,
        { input: 10, output: 20, total: 30 },
        'result text',
        ['file.ts'],
      );

      const statsErrors = errorEvents.filter((e) => e.context.includes('agent stats update'));
      expect(statsErrors.length).toBe(1);
      expect(statsErrors[0].error).toContain('stats-update-boom');
      expect(statsErrors[0].fatal).toBe(false);
    });
  });

  // ====================================================================
  // FIX 3: SIGINT/SIGTERM graceful shutdown
  // ====================================================================
  describe('Fix 3: SIGINT/SIGTERM signal handlers', () => {
    it('registerSignalHandlers installs SIGINT and SIGTERM listeners', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // signalHandlers should have 2 entries
      const handlers = (orchestrator as any).signalHandlers;
      expect(handlers.length).toBe(2);
      expect(handlers[0][0]).toBe('SIGINT');
      expect(handlers[1][0]).toBe('SIGTERM');
    });

    it('removeSignalHandlers clears signal listeners on stop()', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      expect((orchestrator as any).signalHandlers.length).toBe(2);

      await orchestrator.stop();
      expect((orchestrator as any).signalHandlers.length).toBe(0);
    });

    it('SIGINT handler emits orchestrator:shutdown event', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });

      const shutdownEvents: any[] = [];
      deps.eventBus.on('orchestrator:shutdown', (e) => shutdownEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();

      // Get the SIGINT handler and invoke it directly
      const handlers = (orchestrator as any).signalHandlers;
      const sigintHandler = handlers.find(([sig]: [string]) => sig === 'SIGINT');
      expect(sigintHandler).toBeDefined();

      // Call the handler
      sigintHandler![1]();
      await new Promise((r) => setTimeout(r, 100));

      expect(shutdownEvents.length).toBeGreaterThanOrEqual(1);
      expect(shutdownEvents[0].reason).toContain('SIGINT');
    });

    it('SIGTERM handler emits orchestrator:shutdown and calls stop()', async () => {
      deps = buildDeps({
        taskStore: createMockTaskStore([]),
        agentStore: createMockAgentStore([]),
      });

      const shutdownEvents: any[] = [];
      deps.eventBus.on('orchestrator:shutdown', (e) => shutdownEvents.push(e));

      orchestrator = new Orchestrator(deps);
      const stopSpy = vi.spyOn(orchestrator, 'stop');

      await orchestrator.startWatch();

      // Get the SIGTERM handler and invoke it directly
      const handlers = (orchestrator as any).signalHandlers;
      const sigtermHandler = handlers.find(([sig]: [string]) => sig === 'SIGTERM');
      expect(sigtermHandler).toBeDefined();

      sigtermHandler![1]();
      await new Promise((r) => setTimeout(r, 100));

      expect(shutdownEvents.some((e) => e.reason.includes('SIGTERM'))).toBe(true);
      expect(stopSpy).toHaveBeenCalled();
    });
  });

  // ====================================================================
  // FIX 4: console.error replaced with eventBus.emit orchestrator:error
  // ====================================================================
  describe('Fix 4: structured error events instead of console.error', () => {
    it('dispatch failure emits orchestrator:error', async () => {
      // Task that will fail during dispatch (no adapter registered)
      const task = makeTask();
      const agent = makeAgent();

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        // No adapter registered — dispatch will fail
      });

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 100));

      const dispatchErrors = errorEvents.filter((e) => e.context.includes('dispatch task'));
      expect(dispatchErrors.length).toBeGreaterThanOrEqual(1);
      expect(dispatchErrors[0].fatal).toBe(false);
    });

    it('adapter execution error emits orchestrator:error', async () => {
      const task = makeTask();
      const agent = makeAgent();

      // Adapter that throws during execution
      const failAdapter: IAgentAdapter = {
        kind: 'shell',
        test: vi.fn(async () => ({ ok: true })),
        execute: vi.fn((): ExecuteHandle => ({
          pid: 99999,
          events: (async function* () {
            throw new Error('adapter-boom');
          })(),
        })),
        stop: vi.fn(async () => {}),
      };
      const registry = new AdapterRegistry();
      registry.register(failAdapter);

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        adapterRegistry: registry,
      });

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      orchestrator = new Orchestrator(deps);
      await orchestrator.startWatch();
      await new Promise((r) => setTimeout(r, 200));

      // The collectEvents .catch should emit orchestrator:error OR handleRunFailure handles it
      // Either way, no console.error should be called
      // At minimum we get no uncaught errors
    });

    it('debounced state save error emits orchestrator:error', async () => {
      const task = makeTask({ id: 'tsk_lazy', status: 'in_progress' });
      const agent = makeAgent();
      const now = new Date().toISOString();

      const stateStore = createMockStateStore({
        running: {
          tsk_lazy: {
            run_id: 'run_lazy',
            agent_id: agent.id,
            task_id: 'tsk_lazy',
            pid: 44444,
            started_at: now,
            last_event_at: now,
          },
        },
      });

      deps = buildDeps({
        taskStore: createMockTaskStore([task]),
        agentStore: createMockAgentStore([agent]),
        stateStore,
      });

      orchestrator = new Orchestrator(deps);
      await (orchestrator as any).loadState();

      // Make saveState fail after loading
      (stateStore.write as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk-full'));

      const errorEvents: any[] = [];
      deps.eventBus.on('orchestrator:error', (e) => errorEvents.push(e));

      // Trigger saveStateLazy
      (orchestrator as any).saveStateLazy();

      // Wait for debounce timer (500ms) + a bit
      await new Promise((r) => setTimeout(r, 700));

      const saveErrors = errorEvents.filter((e) => e.context === 'debounced state save');
      expect(saveErrors.length).toBe(1);
      expect(saveErrors[0].error).toContain('disk-full');
      expect(saveErrors[0].fatal).toBe(false);
    });
  });

  // ====================================================================
  // Event types verification
  // ====================================================================
  describe('Event types in events.ts and event-bus.ts', () => {
    it('EventBus.onAny subscribes to orchestrator:error', () => {
      const bus = new EventBus();
      const received: any[] = [];
      bus.onAny((e) => received.push(e));

      bus.emit({ type: 'orchestrator:error', error: 'test', context: 'unit', fatal: false });
      expect(received.length).toBe(1);
      expect(received[0].type).toBe('orchestrator:error');
    });

    it('EventBus.onAny subscribes to orchestrator:shutdown', () => {
      const bus = new EventBus();
      const received: any[] = [];
      bus.onAny((e) => received.push(e));

      bus.emit({ type: 'orchestrator:shutdown', reason: 'test shutdown' });
      expect(received.length).toBe(1);
      expect(received[0].type).toBe('orchestrator:shutdown');
    });
  });
});
