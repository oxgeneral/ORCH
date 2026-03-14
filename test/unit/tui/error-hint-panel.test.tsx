/**
 * Tests for ErrorHintPanel in AgentDetailPanel + inline error summary in AgentList.
 * Verifies commit d44996d.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';
import { AdapterErrorKind } from '../../../src/domain/errors.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    adapter: 'claude',
    config: {},
    status: 'idle',
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

/* ── AgentRow inline error summary ──────────────────────────────── */

describe('AgentRow — inline error summary', () => {
  it('shows ERROR_HINTS message in role column when status=error and last_error exists', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'raw error text',
        kind: AdapterErrorKind.AUTH_FAILED,
        timestamp: new Date().toISOString(),
      },
    });
    const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);

    const output = lastFrame()!;
    // Should show the ERROR_HINTS message for AUTH_FAILED, not the raw error
    expect(output).toContain('API ключ невалиден.');
    expect(output).not.toContain('raw error text');
  });

  it('shows role text when agent status is not error', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'idle',
      role: 'Backend developer role',
    });
    const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);

    expect(lastFrame()!).toContain('Backend developer role');
  });

  it('shows fallback raw message when kind is unrecognized and last_error exists', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'raw fallback err',  // short message fits in 22-char role column
        kind: 'totally_unknown_kind',
        timestamp: new Date().toISOString(),
      },
    });
    const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);

    // No hint for unrecognized kind → shows raw message in role column
    expect(lastFrame()!).toContain('raw fallback err');
  });

  it('shows agent name even when status=error', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'my-agent',
      status: 'error',
      last_error: {
        message: 'err',
        kind: AdapterErrorKind.TIMEOUT,
        timestamp: new Date().toISOString(),
      },
    });
    const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );

    stdin.write('a');
    await delay(50);

    expect(lastFrame()!).toContain('my-agent');
  });
});

/* ── AgentDetailPanel — ErrorHintPanel ──────────────────────────── */

describe('AgentDetailPanel — ErrorHintPanel', () => {
  async function openDetailPanel(agent: Agent) {
    const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
    const { stdin, lastFrame } = render(
      React.createElement(App, { projectName: 'test', tasks: [], agents: [agent], state }),
    );
    stdin.write('a');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    return lastFrame()!;
  }

  it('shows ⚠ Ошибка header when agent has last_error', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'raw error',
        kind: AdapterErrorKind.RATE_LIMIT,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    expect(output).toContain('Ошибка');
  });

  it('shows hint.message for known error kind', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'rate limit exceeded',
        kind: AdapterErrorKind.RATE_LIMIT,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    // ERROR_HINTS[RATE_LIMIT].message = 'Достигнут лимит API.'
    expect(output).toContain('Достигнут лимит API.');
  });

  it('shows hint.fix for known error kind', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'rate limit exceeded',
        kind: AdapterErrorKind.RATE_LIMIT,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    // ERROR_HINTS[RATE_LIMIT].fix = 'Подождите и повторите: orch task retry <id>'
    expect(output).toContain('orch task retry');
  });

  it('shows doctorHint text when kind has doctorHint=true (ADAPTER_NOT_FOUND)', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'claude not found',
        kind: AdapterErrorKind.ADAPTER_NOT_FOUND,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    expect(output).toContain('orch doctor');
  });

  it('does NOT show doctorHint for kind without doctorHint flag (PROCESS_CRASH)', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'process crashed',
        kind: AdapterErrorKind.PROCESS_CRASH,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    // PROCESS_CRASH has no doctorHint — should not show doctor hint line
    expect(output).not.toContain('Диагностика: orch doctor');
  });

  it('shows raw error message for UNKNOWN kind', async () => {
    const rawMsg = 'something went wrong internally';
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: rawMsg,
        kind: AdapterErrorKind.UNKNOWN,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    expect(output).toContain(rawMsg);
  });

  it('does NOT show raw message for non-UNKNOWN kind', async () => {
    const rawMsg = 'internal raw error details';
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: rawMsg,
        kind: AdapterErrorKind.AUTH_FAILED,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    expect(output).not.toContain(rawMsg);
  });

  it('shows relative timestamp with "ago" suffix', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'timeout',
        kind: AdapterErrorKind.TIMEOUT,
        timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      },
    });
    const output = await openDetailPanel(agent);
    expect(output).toContain('ago');
  });

  it('does NOT show ErrorHintPanel when agent has no last_error', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'idle',
    });
    const output = await openDetailPanel(agent);
    expect(output).not.toContain('Ошибка');
    expect(output).not.toContain('ago');
  });

  it('shows UNKNOWN doctorHint (orch doctor) for UNKNOWN kind', async () => {
    const agent = makeAgent({
      id: 'a1',
      name: 'backend',
      status: 'error',
      last_error: {
        message: 'unexpected failure',
        kind: AdapterErrorKind.UNKNOWN,
        timestamp: new Date().toISOString(),
      },
    });
    const output = await openDetailPanel(agent);
    // UNKNOWN has doctorHint=true, so should show orch doctor hint
    expect(output).toContain('orch doctor');
  });
});
