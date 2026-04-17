/**
 * Tests that semantic tier aliases (capable/balanced/fast) stored in agent YAML
 * are resolved to concrete model strings before adapter.execute() is called.
 *
 * This is intentional behaviour (option b): agents can store a tier alias so
 * they automatically ride the latest flagship whenever MODEL_TIER_MAP is bumped,
 * without requiring a migration of every agent YAML file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Orchestrator } from '../../../src/application/orchestrator.js';
import { AdapterRegistry } from '../../../src/infrastructure/adapters/registry.js';
import type { IAgentAdapter, ExecuteHandle, AgentEvent } from '../../../src/infrastructure/adapters/interface.js';
import { MODEL_TIER_MAP } from '../../../src/domain/model-tiers.js';
import {
  makeTask,
  makeAgent,
  createMockTaskStore,
  createMockAgentStore,
  buildDeps,
} from './helpers.js';

vi.mock('../../../src/infrastructure/storage/lock.js', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, pid: process.pid })),
  releaseLock: vi.fn(async () => {}),
  touchLock: vi.fn(async () => {}),
}));

function createCapturingAdapter(): {
  adapter: IAgentAdapter;
  getLastConfig: () => Record<string, unknown> | undefined;
} {
  let lastConfig: Record<string, unknown> | undefined;

  const adapter: IAgentAdapter = {
    kind: 'claude',
    test: vi.fn(async () => ({ ok: true })),
    execute: vi.fn((params): ExecuteHandle => {
      lastConfig = params.config as Record<string, unknown>;
      return {
        pid: 11111,
        events: (async function* (): AsyncGenerator<AgentEvent> {
          yield { type: 'output', data: 'done' };
        })(),
      };
    }),
    stop: vi.fn(async () => {}),
  };

  return { adapter, getLastConfig: () => lastConfig };
}

function waitForDispatch(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Orchestrator tier alias resolution at dispatch', () => {
  let orchestrator: Orchestrator;

  afterEach(() => {
    const o = orchestrator as any;
    if (o.intervalId) { clearInterval(o.intervalId); o.intervalId = null; }
    if (o.immediateDispatchTimer) { clearTimeout(o.immediateDispatchTimer); o.immediateDispatchTimer = null; }
    if (o.saveStateTimer) { clearTimeout(o.saveStateTimer); o.saveStateTimer = null; }
    o.shuttingDown = true;
    o.removeSignalHandlers?.();
    o.lockAcquired = false;
  });

  it('resolves "capable" tier alias to the current claude flagship before dispatch', async () => {
    const task = makeTask({ status: 'todo' });
    const agent = makeAgent({ adapter: 'claude', config: { approval_policy: 'auto', model: 'capable' } });

    const { adapter, getLastConfig } = createCapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });

    orchestrator = new Orchestrator(deps);
    await orchestrator.startWatch({ skipAutonomousSeeding: true });
    await waitForDispatch();

    const config = getLastConfig();
    expect(config).not.toBeUndefined();
    expect(config!['model']).toBe(MODEL_TIER_MAP.claude.capable);
    expect(config!['model']).toBe('claude-opus-4-7');
  });

  it('resolves "balanced" tier alias before dispatch', async () => {
    const task = makeTask({ status: 'todo', id: 'tsk_bal' });
    const agent = makeAgent({ id: 'agt_bal', adapter: 'claude', config: { approval_policy: 'auto', model: 'balanced' } });

    const { adapter, getLastConfig } = createCapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });

    orchestrator = new Orchestrator(deps);
    await orchestrator.startWatch({ skipAutonomousSeeding: true });
    await waitForDispatch();

    expect(getLastConfig()!['model']).toBe(MODEL_TIER_MAP.claude.balanced);
  });

  it('resolves "fast" tier alias before dispatch', async () => {
    const task = makeTask({ status: 'todo', id: 'tsk_fast' });
    const agent = makeAgent({ id: 'agt_fast', adapter: 'claude', config: { approval_policy: 'auto', model: 'fast' } });

    const { adapter, getLastConfig } = createCapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });

    orchestrator = new Orchestrator(deps);
    await orchestrator.startWatch({ skipAutonomousSeeding: true });
    await waitForDispatch();

    expect(getLastConfig()!['model']).toBe(MODEL_TIER_MAP.claude.fast);
  });

  it('passes concrete model strings through unchanged', async () => {
    const task = makeTask({ status: 'todo', id: 'tsk_concrete' });
    const agent = makeAgent({
      id: 'agt_concrete',
      adapter: 'claude',
      config: { approval_policy: 'auto', model: 'claude-sonnet-4-6' },
    });

    const { adapter, getLastConfig } = createCapturingAdapter();
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const deps = buildDeps({
      taskStore: createMockTaskStore([task]),
      agentStore: createMockAgentStore([agent]),
      adapterRegistry: registry,
    });

    orchestrator = new Orchestrator(deps);
    await orchestrator.startWatch({ skipAutonomousSeeding: true });
    await waitForDispatch();

    expect(getLastConfig()!['model']).toBe('claude-sonnet-4-6');
  });
});
