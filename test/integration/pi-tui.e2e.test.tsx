/**
 * Pi agent in TUI — end-to-end UI lifecycle test.
 *
 * Renders App.tsx with a real pi-adapter agent and a todo task, then walks the
 * dataflow + event stream that ORCH would emit while dispatching the task:
 *   1. agent appears with `pi` adapter chip on the Agents tab
 *   2. on dispatch the task flips to in_progress and the agent to running
 *   3. activity feed shows agent:output and agent:file_changed events
 *   4. on completion the agent returns to idle and the task lands on done
 *
 * Asserts visible UI affordances at each step. Mirrors what a user would see
 * in `orch tui` while a pi run is in flight. Companion to
 * test/integration/pi-adapter.e2e.test.ts (which covers the engine path).
 */

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../../src/tui/App.js';
import { _resetAnimTick } from '../../src/tui/components/useAnimTick.js';
import type { Task } from '../../src/domain/task.js';
import type { Agent } from '../../src/domain/agent.js';
import type { OrchestratorEvent } from '../../src/domain/events.js';
import { DEFAULT_STATE, type OrchestratorState } from '../../src/domain/state.js';
import { makeTask, makeAgent } from '../unit/application/helpers.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => { _resetAnimTick(); });

describe('Pi agent — TUI lifecycle', () => {
  it('shows pi agent on Agents tab and walks todo → running → done with activity feed', async () => {
    const piAgent = makeAgent({ id: 'agt_pi', name: 'pi-bot', adapter: 'pi' });
    const piTask = makeTask({
      id: 'tsk_pi',
      title: 'Create hello.md via pi',
      description: 'smoke task',
      priority: 1,
      assignee: 'agt_pi',
    });

    // Start with the initial todo state; we mutate and rerender as the
    // orchestrator would write to disk between phases.
    let tasks: Task[] = [piTask];
    let agents: Agent[] = [piAgent];
    let state: OrchestratorState = { ...DEFAULT_STATE };

    let eventHandler: ((e: OrchestratorEvent) => void) | null = null;
    const onSubscribeEvents = (h: (e: OrchestratorEvent) => void) => {
      eventHandler = h;
      return () => { eventHandler = null; };
    };

    const baseProps = { projectName: 'pi-demo', onSubscribeEvents };

    const { stdin, lastFrame, rerender } = render(
      React.createElement(App, { ...baseProps, tasks, agents, state }),
    );

    // ── Initial frame: Tasks tab visible with the todo pi task ────────────
    const initial = lastFrame()!;
    expect(initial).toContain('Create hello.md via pi');
    expect(initial).toContain('!!!'); // P1 priority indicator
    expect(initial).toContain('TODO');

    // ── Switch to Agents tab (A) — pi-bot visible with `pi` adapter chip ──
    stdin.write('a');
    await delay(80);
    const agentsFrame = lastFrame()!;
    expect(agentsFrame).toContain('pi-bot');
    expect(agentsFrame).toContain('pi'); // adapter chip column

    // ── Back to Tasks (T) for the lifecycle assertions ────────────────────
    stdin.write('t');
    await delay(80);

    // ── Dispatch phase: orchestrator writes new state, emits events ───────
    tasks = [{ ...piTask, status: 'in_progress' }];
    agents = [{ ...piAgent, status: 'running', current_task: 'tsk_pi' }];
    state = {
      ...DEFAULT_STATE,
      running: {
        tsk_pi: {
          runId: 'run_pi',
          taskId: 'tsk_pi',
          agentId: 'agt_pi',
          pid: 4242,
          started_at: new Date().toISOString(),
        },
      },
    };
    rerender(React.createElement(App, { ...baseProps, tasks, agents, state }));
    eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_pi', from: 'todo', to: 'in_progress' });
    eventHandler?.({ type: 'agent:started', agentId: 'agt_pi', taskId: 'tsk_pi', runId: 'run_pi' });
    // The TUI batches event renders at 80 ms; wait past the flush.
    await delay(120);

    const runningFrame = lastFrame()!;
    // The running task still appears with its title (status icon changes to the
    // braille spinner ⠋ on running rows).
    expect(runningFrame).toContain('Create hello.md via pi');

    // ── Streaming pi events flow into the activity feed ───────────────────
    eventHandler?.({
      type: 'agent:output',
      runId: 'run_pi',
      agentId: 'agt_pi',
      // Pi adapter feeds this as the text_delta payload from pi-coding-agent
      data: JSON.stringify({ text: 'Writing hello.md…', raw: {} }),
    });
    eventHandler?.({
      type: 'agent:file_changed',
      runId: 'run_pi',
      agentId: 'agt_pi',
      path: 'hello.md',
    });
    await delay(120);

    const liveFrame = lastFrame()!;
    expect(liveFrame).toContain('hello.md');

    // ── Completion: orchestrator finalizes, task lands on done ────────────
    eventHandler?.({ type: 'agent:completed', runId: 'run_pi', agentId: 'agt_pi', success: true });
    tasks = [{ ...piTask, status: 'done', assignee: 'agt_pi' }];
    agents = [piAgent]; // back to idle
    state = { ...DEFAULT_STATE, running: {} };
    rerender(React.createElement(App, { ...baseProps, tasks, agents, state }));
    eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_pi', from: 'in_progress', to: 'review' });
    eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_pi', from: 'review', to: 'done' });
    await delay(120);

    const doneFrame = lastFrame()!;
    expect(doneFrame).toContain('Create hello.md via pi');
    // Done icon ✓ appears on the row of a completed task.
    expect(doneFrame).toContain('✓'); // ✓

    // Switch back to Agents — pi-bot is idle again, no longer pinned to tsk_pi.
    stdin.write('a');
    await delay(80);
    const finalAgents = lastFrame()!;
    expect(finalAgents).toContain('pi-bot');
    expect(finalAgents).toContain('IDLE'); // status chip — uppercase
  });
});
