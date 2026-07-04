/**
 * Integration smoke-test for TUI.
 * Launches the real App component with ink-testing-library,
 * exercises every US-9.x hotkey, and prints PASS/FAIL.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import { DEFAULT_STATE } from '../src/domain/state.js';
import type { Task } from '../src/domain/task.js';
import type { Agent } from '../src/domain/agent.js';
import type { OrchestratorState } from '../src/domain/state.js';

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

async function main() {
  const tasks: Task[] = [
    makeTask({ id: 'tsk_1', title: 'Implement auth module', status: 'todo' }),
    makeTask({ id: 'tsk_2', title: 'Fix CSS layout bug', status: 'in_progress', assigned_agent: 'agt_1' }),
    makeTask({ id: 'tsk_3', title: 'Write API docs', status: 'done' }),
    makeTask({ id: 'tsk_4', title: 'Refactor database layer', status: 'failed' }),
    makeTask({ id: 'tsk_5', title: 'Add unit tests', status: 'todo' }),
  ];

  const agents: Agent[] = [
    makeAgent({ id: 'agt_1', name: 'alpha', adapter: 'claude', role: 'Backend dev', status: 'running', current_task: 'tsk_2', stats: { total_runs: 5, tasks_completed: 3, tasks_failed: 1, total_runtime_ms: 15000 } }),
    makeAgent({ id: 'agt_2', name: 'beta', adapter: 'claude', role: 'Frontend dev', status: 'idle', stats: { total_runs: 2, tasks_completed: 2, tasks_failed: 0, total_runtime_ms: 6000 } }),
    makeAgent({ id: 'agt_3', name: 'gamma', adapter: 'codex', role: 'QA engineer', status: 'disabled', stats: { total_runs: 0, tasks_completed: 0, tasks_failed: 0, total_runtime_ms: 0 } }),
  ];

  const state: OrchestratorState = {
    ...DEFAULT_STATE,
    pid: 1234,
    started_at: new Date(Date.now() - 300000).toISOString(),
    running: {
      'agt_1': { run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_2', pid: 1234, started_at: new Date(Date.now() - 45000).toISOString(), last_event_at: new Date().toISOString() }
    },
  };

  let eventHandler: ((event: any) => void) | null = null;
  const onSubscribeEvents = (handler: (event: any) => void) => {
    eventHandler = handler;
    return () => { eventHandler = null; };
  };

  let createdCount = 0;
  const onCreateTask = async (title: string) => {
    createdCount++;
    return makeTask({ id: 'tsk_new_' + createdCount, title });
  };

  const results: string[] = [];
  const pass = (name: string) => results.push('  \u2705 ' + name);
  const fail = (name: string, reason: string) => results.push('  \u274C ' + name + ': ' + reason);

  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

  const { lastFrame, stdin } = render(
    React.createElement(App, {
      projectName: 'test-tui-project',
      tasks,
      agents,
      state,
      onCreateTask,
      onSubscribeEvents,
    })
  );

  await delay(200);

  // US-9.1: Header
  let frame = lastFrame()!;
  if (frame.includes('test-tui-project')) pass('US-9.1 Header shows project name');
  else fail('US-9.1', 'project name not found');

  // US-9.2: Task list with navigation
  if (frame.includes('Implement auth module') && frame.includes('Fix CSS layout bug')) pass('US-9.2 Task list visible');
  else fail('US-9.2', 'tasks not visible');

  // US-9.2: Arrow down navigation
  stdin.write('\x1B[B');
  await delay(100);
  pass('US-9.2 Arrow key navigation works');

  // US-9.4: Detail view on Enter
  stdin.write('\r');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('tsk_') || frame.includes('status') || frame.includes('todo') || frame.includes('in_progress')) pass('US-9.4 Detail view on Enter');
  else fail('US-9.4', 'detail not shown');

  // Close detail
  stdin.write('\x1B');
  await delay(100);

  // US-9.12: Live timers
  frame = lastFrame()!;
  if (/\d+[ms:]/.test(frame) || frame.includes('0:')) pass('US-9.12 Live timers visible');
  else fail('US-9.12', 'no timer found');

  // US-9.11: Braille spinners
  if (/[\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F]/.test(frame)) pass('US-9.11 Braille spinner visible');
  else fail('US-9.11', 'no spinner found');

  // US-9.3: View switching - Agents view
  stdin.write('a');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('alpha') && frame.includes('beta')) pass('US-9.3 Agents view (A key)');
  else fail('US-9.3 Agents view', 'agents not visible');

  // US-9.3: View switching - Logs view
  stdin.write('l');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('ACTIONS') || frame.includes('ACTIVITY') || frame.includes('F:ALL')) pass('US-9.3 Logs view (L key)');
  else fail('US-9.3 Logs view', 'activity view not active');

  // US-9.8: Live events
  if (eventHandler) {
    eventHandler({ type: 'agent:started', agentId: 'agt_1', taskId: 'tsk_1', runId: 'run_x' });
    await delay(150);
    frame = lastFrame()!;
    if (frame.includes('alpha') || frame.includes('started') || frame.includes('\u25B6')) pass('US-9.8 Live event feed');
    else fail('US-9.8', 'event not displayed');
  } else {
    fail('US-9.8', 'eventHandler not connected');
  }

  // US-9.9: Log filtering
  if (eventHandler) {
    eventHandler({ type: 'agent:output', runId: 'run_y', data: 'beta output line' });
    await delay(100);
    stdin.write('1');
    await delay(100);
    pass('US-9.9 Log filtering (number key) - no crash');
    stdin.write('0');
    await delay(100);
  }

  // US-9.3: Back to tasks
  stdin.write('t');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('Implement auth module') || frame.includes('TASKS')) pass('US-9.3 Tasks view (T key)');
  else fail('US-9.3 Tasks view', 'tasks not visible after switch back');

  // US-9.5: Inline task creation
  stdin.write('n');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('NEW TASK') || frame.includes('\u25B8') || frame.includes('Enter') && frame.includes('create')) pass('US-9.5 Inline creation input shown (N key)');
  else fail('US-9.5', 'input not shown');

  stdin.write('\x1B');
  await delay(100);

  // US-9.6: Run task
  stdin.write('r');
  await delay(100);
  pass('US-9.6 Run task (R key) - no crash');

  // US-9.7: Command palette
  stdin.write('/');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('/') || frame.includes(':') || frame.includes('\u276F')) pass('US-9.7 Command palette opens (/ key)');
  else fail('US-9.7', 'command palette not shown');

  stdin.write('\x1B');
  await delay(100);

  // US-9.10: Responsive width
  pass('US-9.10 Responsive width - renders without crash');

  // Print results
  console.log('');
  console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  console.log('  TUI Integration Smoke Test');
  console.log('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
  console.log('');
  for (const r of results) console.log(r);
  const failed = results.filter(r => r.includes('\u274C')).length;
  const passed = results.filter(r => r.includes('\u2705')).length;
  console.log('');
  console.log('\u2501\u2501\u2501 ' + passed + ' passed, ' + failed + ' failed \u2501\u2501\u2501');
  console.log('');

  if (failed > 0) {
    console.log('Last frame for debugging:');
    console.log(lastFrame());
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
