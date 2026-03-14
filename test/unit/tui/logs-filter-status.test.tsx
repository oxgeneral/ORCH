/**
 * Tests for the Logs filter status bar.
 *
 * Verifies the status bar shows active filters (agent, type)
 * and the filtered/total message count.
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { _resetAnimTick } from '../../../src/tui/components/useAnimTick.js';
import { App } from '../../../src/tui/App.js';
import type { Task } from '../../../src/domain/task.js';
import type { Agent } from '../../../src/domain/agent.js';
import type { OrchestratorState } from '../../../src/domain/state.js';
import { DEFAULT_STATE } from '../../../src/domain/state.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '',
    status: 'todo',
    priority: 3,
    labels: [],
    depends_on: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempts: 0,
    max_attempts: 3,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    adapter: 'claude',
    config: {},
    status: 'idle',
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

function renderApp(agents: Agent[] = [], tasks: Task[] = []) {
  const state: OrchestratorState = { ...DEFAULT_STATE, onboardingCompleted: true };
  return render(
    React.createElement(App, {
      projectName: 'test',
      tasks,
      agents,
      state,
      messageBatchMs: 0,
    }),
  );
}

describe('Logs filter status bar', () => {
  it('does not show filter status bar when no filters are active on logs tab', async () => {
    const agents = [makeAgent({ id: 'a1', name: 'Backend A' })];
    const { lastFrame, stdin } = renderApp(agents);
    stdin.write('l'); // switch to logs tab
    await delay(50);
    const output = lastFrame()!;
    // Should show ACTIONS tab as active
    expect(output).toContain('ACTIONS');
    // No LOGS · agent: or LOGS · type: status bar when no filters active
    expect(output).not.toContain('agent:');
    expect(output).not.toContain('type:');
  });

  it('shows type filter in status bar when F cycles type preset', async () => {
    const agents = [makeAgent({ id: 'a1', name: 'Backend A' })];
    const { lastFrame, stdin } = renderApp(agents);
    stdin.write('l'); // switch to logs tab
    await delay(50);
    // Press F to cycle type filter (from 'all' to a subset)
    stdin.write('F');
    await delay(50);
    const output = lastFrame()!;
    // Status bar should appear with type: filter and count
    expect(output).toContain('LOGS');
    expect(output).toContain('type:');
    expect(output).toContain('0/0');
  });

  it('shows agent filter in status bar when agent is filtered', async () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Backend A' }),
      makeAgent({ id: 'a2', name: 'QA' }),
    ];
    const { lastFrame, stdin } = renderApp(agents);
    stdin.write('l'); // switch to logs tab
    await delay(50);
    // Open agent picker
    stdin.write('a');
    await delay(50);
    // Toggle first agent with Space, then confirm with Enter
    stdin.write(' ');
    await delay(50);
    stdin.write('\r');
    await delay(50);
    const output = lastFrame()!;
    // Status bar should show agent filter
    expect(output).toContain('agent:');
    expect(output).toContain('0/0');
  });

  it('always shows filtered/total count when any filter is active', async () => {
    const agents = [makeAgent({ id: 'a1', name: 'Backend A' })];
    const { lastFrame, stdin } = renderApp(agents);
    stdin.write('l');
    await delay(50);
    stdin.write('F'); // activate type filter
    await delay(50);
    const output = lastFrame()!;
    // Count should be in format N/N
    expect(output).toMatch(/\d+\/\d+/);
  });
});
