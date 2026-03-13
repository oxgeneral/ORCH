/**
 * Shared test helpers for CLI command tests.
 * Provides a base makeContainer factory with sensible defaults.
 */
import { vi } from 'vitest';
import type { Container, LightContainer } from '../../../src/container.js';

export function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    paths: {
      requireInit: vi.fn(async () => {}),
      isInitialized: vi.fn(async () => true),
    } as any,
    context: { json: false, quiet: false, noColor: false, ascii: false, projectRoot: '/tmp' },
    configStore: {
      get: vi.fn(async () => 'value'),
      set: vi.fn(async () => {}),
      read: vi.fn(async () => ({})),
      write: vi.fn(async () => {}),
    },
    contextStore: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      getAll: vi.fn(async () => ({})),
    },
    taskService: {
      get: vi.fn(async () => ({ id: 'tsk_1', title: 'Test task', status: 'todo' })),
      list: vi.fn(async () => [{ id: 'tsk_1', title: 'T1' }]),
    },
    agentService: {
      list: vi.fn(async () => [{ id: 'agt_1', name: 'A1' }]),
    },
    runService: {
      readEvents: vi.fn(async () => []),
      readEventsTail: vi.fn(async () => []),
      listForTask: vi.fn(async () => []),
      listForAgent: vi.fn(async () => []),
    },
    orchestrator: {
      runTask: vi.fn(async () => {}),
      runAll: vi.fn(async () => {}),
      startWatch: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    },
    eventBus: {
      onAny: vi.fn(() => vi.fn()),
    },
    config: { scheduling: { poll_interval_ms: 5000 } } as any,
    doctorService: {
      runAll: vi.fn(async () => ({ checks: [], passed: 0, failed: 0, warnings: 0 })),
    },
    messageStore: {
      save: vi.fn(async () => {}),
      get: vi.fn(async () => null),
      list: vi.fn(async () => []),
      listPending: vi.fn(async () => []),
      markDelivered: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      purgeExpired: vi.fn(async () => 0),
    },
    teamStore: {
      save: vi.fn(async () => {}),
      get: vi.fn(async () => null),
      getByName: vi.fn(async () => null),
      list: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    },
    messageService: {
      send: vi.fn(async () => []),
      drainMailbox: vi.fn(async () => []),
      listAll: vi.fn(async () => []),
      listPendingForAgent: vi.fn(async () => []),
      listForAgent: vi.fn(async () => []),
      purgeExpired: vi.fn(async () => 0),
    },
    teamService: {
      create: vi.fn(async () => ({})),
      get: vi.fn(async () => ({})),
      list: vi.fn(async () => []),
      join: vi.fn(async () => ({})),
      leave: vi.fn(async () => ({})),
      addTask: vi.fn(async () => ({})),
      removeTask: vi.fn(async () => ({})),
      setLead: vi.fn(async () => ({})),
      disband: vi.fn(async () => {}),
      findTeamForAgent: vi.fn(async () => null),
    },
    ...overrides,
  } as any;
}
