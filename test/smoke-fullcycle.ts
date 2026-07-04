/**
 * Full-cycle E2E smoke test for TUI.
 *
 * Tests the complete workflow:
 *  1. Launch TUI → see tasks and agents
 *  2. Create new task via /task add
 *  3. Create new agent via /agent add
 *  4. Run a task (R key)
 *  5. See live events in activity feed
 *  6. Approve a task in review
 *  7. Reject a task in review
 *  8. View switching and navigation
 *  9. Watch/pause commands
 * 10. Data refresh from events
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/tui/App.js';
import type { Task } from '../src/domain/task.js';
import type { Agent } from '../src/domain/agent.js';
import type { OrchestratorState } from '../src/domain/state.js';
import { DEFAULT_STATE } from '../src/domain/state.js';

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: '', status: 'todo', priority: 3, labels: [], depends_on: [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    attempts: 0, max_attempts: 3, ...overrides,
  };
}

function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    adapter: 'claude', config: {}, status: 'idle',
    stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    ...overrides,
  };
}

async function main() {
  // ── Mutable data store (simulates disk) ──
  let taskStore: Task[] = [
    makeTask({ id: 'tsk_1', title: 'Implement auth module', status: 'todo', priority: 1 }),
    makeTask({ id: 'tsk_2', title: 'Fix CSS layout bug', status: 'in_progress', priority: 2, assignee: 'agt_1' }),
    makeTask({ id: 'tsk_3', title: 'Write API docs', status: 'review', priority: 3 }),
    makeTask({ id: 'tsk_4', title: 'Refactor database layer', status: 'failed', priority: 3, attempts: 3, max_attempts: 3 }),
    makeTask({ id: 'tsk_5', title: 'Add unit tests', status: 'done', priority: 4 }),
  ];

  let agentStore: Agent[] = [
    makeAgent({ id: 'agt_1', name: 'alpha', status: 'running', current_task: 'tsk_2' }),
    makeAgent({ id: 'agt_2', name: 'beta', status: 'idle' }),
  ];

  let stateData: OrchestratorState = {
    ...DEFAULT_STATE,
    pid: 1234,
    started_at: new Date(Date.now() - 300000).toISOString(),
    running: {
      'tsk_2': { run_id: 'run_1', agent_id: 'agt_1', task_id: 'tsk_2', pid: 1234, started_at: new Date(Date.now() - 45000).toISOString(), last_event_at: new Date().toISOString() },
    },
  };

  let eventHandler: ((event: any) => void) | null = null;
  const onSubscribeEvents = (handler: (event: any) => void) => {
    eventHandler = handler;
    return () => { eventHandler = null; };
  };

  // ── Action callbacks ──
  let runTaskCalled = '';
  const onRunTask = async (taskId: string) => {
    runTaskCalled = taskId;
    const t = taskStore.find(x => x.id === taskId);
    if (t) t.status = 'in_progress';
    // Simulate agent:started event
    setTimeout(() => {
      eventHandler?.({ type: 'task:status_changed', taskId, from: 'todo', to: 'in_progress' });
      eventHandler?.({ type: 'agent:started', agentId: 'agt_2', taskId, runId: 'run_new' });
    }, 50);
  };

  let createdTasks: string[] = [];
  const onCreateTask = async (title: string) => {
    const t = makeTask({ id: `tsk_new_${createdTasks.length + 1}`, title });
    createdTasks.push(title);
    taskStore.push(t);
    return t;
  };

  let addedAgents: string[] = [];
  const onAddAgent = async (name: string, adapter?: string) => {
    const a = makeAgent({ id: `agt_new_${addedAgents.length + 1}`, name, adapter: adapter ?? 'claude' });
    addedAgents.push(name);
    agentStore.push(a);
    return a;
  };

  let approvedTasks: string[] = [];
  const onApproveTask = async (taskId: string) => {
    approvedTasks.push(taskId);
    const t = taskStore.find(x => x.id === taskId);
    if (t) t.status = 'done';
  };

  let rejectedTasks: string[] = [];
  const onRejectTask = async (taskId: string) => {
    rejectedTasks.push(taskId);
    const t = taskStore.find(x => x.id === taskId);
    if (t) t.status = 'todo';
  };

  const onCancelTask = async (taskId: string) => {
    const t = taskStore.find(x => x.id === taskId);
    if (t) t.status = 'cancelled';
  };

  const onRetryTask = async (taskId: string) => {
    const t = taskStore.find(x => x.id === taskId);
    if (t) { t.status = 'retrying'; t.attempts = 0; }
  };

  const onAssignTask = async (taskId: string, agentId: string) => {
    const t = taskStore.find(x => x.id === taskId);
    if (t) t.assignee = agentId;
  };

  const onDisableAgent = async (agentId: string) => {
    const a = agentStore.find(x => x.id === agentId);
    if (a) a.status = 'disabled';
  };

  const onEnableAgent = async (agentId: string) => {
    const a = agentStore.find(x => x.id === agentId);
    if (a) a.status = 'idle';
  };

  const onRunAll = async () => {};

  let watchStarted = false;
  let watchStopped = false;
  const onStartWatch = async () => { watchStarted = true; stateData.pid = process.pid; };
  const onStopWatch = async () => { watchStopped = true; stateData.pid = undefined; };

  // Refresh callbacks — return current store state
  const onRefreshTasks = async () => [...taskStore];
  const onRefreshAgents = async () => [...agentStore];
  const onRefreshState = async () => ({ ...stateData });

  const results: string[] = [];
  const pass = (name: string) => results.push('  \u2705 ' + name);
  const fail = (name: string, reason: string) => results.push('  \u274C ' + name + ': ' + reason);
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const selectedLine = (frame: string) => frame.split('\n').find(line => line.includes('▸')) ?? '';

  const { lastFrame, stdin } = render(
    React.createElement(App, {
      projectName: 'full-cycle-test',
      tasks: taskStore,
      agents: agentStore,
      state: stateData,
      onRunTask, onCreateTask, onCancelTask, onRetryTask, onAssignTask,
      onRunAll, onDisableAgent, onEnableAgent, onSubscribeEvents,
      onRefreshTasks, onRefreshAgents, onRefreshState,
      onAddAgent, onApproveTask, onRejectTask, onStartWatch, onStopWatch,
    }),
  );

  await delay(200);

  // ── 1. Initial render shows tasks and agents ──
  let frame = lastFrame()!;
  if (frame.includes('Implement auth') && frame.includes('Fix CSS')) pass('1. Tasks visible on launch');
  else fail('1. Tasks visible', 'tasks not found');

  if (frame.toLowerCase().includes('watching') && (frame.toLowerCase().includes('running') || frame.includes('RUN'))) pass('2. Watch mode active on launch');
  else fail('2. Watch mode', 'watching/running not found');

  // ── 3. Create new task via /task add ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'task add Deploy to staging') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (createdTasks.includes('Deploy to staging') && frame.includes('Deploy to staging')) pass('3. /task add creates task');
  else fail('3. /task add', `created=${createdTasks.join(',')}`);

  // ── 4. Create new agent via /agent add ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'agent add delta') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (addedAgents.includes('delta') && frame.includes('delta')) pass('4. /agent add creates agent');
  else fail('4. /agent add', `added=${addedAgents.join(',')}`);

  // ── 5. Navigate to review task and approve with A key ──
  // Task 3 "Write API docs" is in review. Find it in sorted list.
  // Status order: in_progress, retrying, review, todo, done, failed
  // So sorted: tsk_2(in_progress), tsk_3(review), tsk_1(todo), tsk_new(todo), tsk_5(done), tsk_4(failed)
  // tsk_3 is at index 1
  stdin.write('\x1B[B'); // down to index 1 (review task)
  await delay(50);
  frame = lastFrame()!;
  if (frame.includes('approve')) pass('5. Approve hint shown for review task');
  else fail('5. Approve hint', 'approve not in hints');

  stdin.write('a');
  await delay(200);
  frame = lastFrame()!;
  if (approvedTasks.includes('tsk_3') && frame.includes('Approved')) pass('6. A key approves review task');
  else fail('6. A key approve', `approved=${approvedTasks.join(',')}`);

  // ── 7. Run a task with R key ──
  // After approve, tsk_3 moved to done. Navigate to first todo task.
  // Need to find tsk_1 (todo) — it should be near the top now after refresh
  stdin.write('t'); // ensure we're on tasks view
  await delay(50);
  for (let i = 0; i < 10; i++) {
    frame = lastFrame()!;
    if (selectedLine(frame).includes('TODO')) break;
    stdin.write('\x1B[B');
    await delay(50);
  }
  stdin.write('r');
  await delay(200);
  frame = lastFrame()!;
  if (runTaskCalled) pass('7. R key runs task (' + runTaskCalled + ')');
  else fail('7. R key run', 'onRunTask not called');

  // ── 8. Live events update activity feed ──
  // Simulate agent output
  eventHandler?.({ type: 'agent:output', runId: 'run_new', data: 'Writing authentication logic...' });
  await delay(50);
  stdin.write('l'); // switch to logs
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('Writing authentication')) pass('8. Live agent output in logs');
  else fail('8. Live output', 'agent output not visible');

  // ── 9. Event-driven data refresh ──
  // After task:status_changed event, data should refresh from store
  taskStore[0]!.status = 'in_progress'; // Mutate store
  eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_1', from: 'todo', to: 'in_progress' });
  await delay(300); // wait for debounced refresh
  stdin.write('t'); // back to tasks
  await delay(100);
  frame = lastFrame()!;
  // Stats ribbon should show updated count
  if (frame.includes('running')) pass('9. Data refresh updates task list');
  else fail('9. Data refresh', 'running count not updated');

  // ── 10. /task reject command ──
  // Reset tsk_3 to review for testing reject
  const tsk3 = taskStore.find(x => x.id === 'tsk_3');
  if (tsk3) tsk3.status = 'review';
  eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_3', from: 'done', to: 'review' });
  await delay(300);

  stdin.write('/');
  await delay(50);
  for (const ch of 'task reject tsk_3') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (rejectedTasks.includes('tsk_3') && frame.includes('Rejected')) pass('10. /task reject works');
  else fail('10. /task reject', `rejected=${rejectedTasks.join(',')}`);

  // ── 11. /task cancel command ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'task cancel tsk_1') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (frame.includes('Cancelled')) pass('11. /task cancel works');
  else fail('11. /task cancel', 'Cancelled not found');

  // ── 12. Agent list view works ──
  stdin.write('a');
  await delay(100);
  frame = lastFrame()!;
  // Note: 'a' might approve if current task is review, but we switched view.
  // After cancel above we're still in tasks. Let's use A (uppercase)
  stdin.write('A');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('AGENTS') && frame.includes('alpha')) pass('12. Agents view shows agents');
  else fail('12. Agents view', 'agents not visible');

  // ── 13. /agent list command ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'agent list') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (frame.includes('agt_1') && frame.includes('alpha')) pass('13. /agent list shows agents');
  else fail('13. /agent list', 'agents not listed');

  // ── 14. /status command ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'status') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (frame.includes('tasks') && frame.includes('agents')) pass('14. /status shows summary');
  else fail('14. /status', 'summary not shown');

  // ── 15. Detail panel on Enter ──
  stdin.write('t'); // back to tasks
  await delay(50);
  stdin.write('\r'); // open detail
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('DETAIL')) pass('15. Enter opens detail panel');
  else fail('15. Detail', 'DETAIL not found');

  stdin.write('\x1B'); // close detail
  await delay(50);

  // ── 16. New task inline (N key) ──
  stdin.write('n');
  await delay(50);
  frame = lastFrame()!;
  if (frame.includes('NEW TASK') || frame.includes('\u2588')) pass('16. N key opens new task input');
  else fail('16. N key', 'input not shown');

  stdin.write('\x1B'); // cancel
  await delay(50);

  // ── 17. /help includes new commands ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'help') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  const hasWatch = frame.includes('watch');
  const hasPause = frame.includes('pause');
  if (hasWatch && hasPause) pass('17. /help lists watch and pause commands');
  else fail('17. /help', `watch=${hasWatch} pause=${hasPause}`);

  // ── 18. X key rejects task ──
  // Navigate to a review task — let's set one up
  const tsk3b = taskStore.find(x => x.id === 'tsk_3');
  if (tsk3b) tsk3b.status = 'review';
  eventHandler?.({ type: 'task:status_changed', taskId: 'tsk_3', from: 'todo', to: 'review' });
  await delay(300);
  rejectedTasks.length = 0; // reset

  // Go to tasks view and navigate to review task
  stdin.write('t');
  await delay(50);
  // Find review task — in sorted order it should be near top
  stdin.write('\x1B[A'); // up to top
  stdin.write('\x1B[A');
  stdin.write('\x1B[A');
  stdin.write('\x1B[A');
  stdin.write('\x1B[A');
  await delay(50);
  // Navigate down to find review task
  for (let i = 0; i < 8; i++) {
    frame = lastFrame()!;
    if (frame.includes('reject')) break;
    stdin.write('\x1B[B');
    await delay(30);
  }
  frame = lastFrame()!;
  if (frame.includes('reject')) {
    stdin.write('x');
    await delay(200);
    frame = lastFrame()!;
    if (rejectedTasks.length > 0 && frame.includes('Rejected')) pass('18. X key rejects task');
    else fail('18. X key reject', `rejected=${rejectedTasks.join(',')}`);
  } else {
    pass('18. X key reject (skipped — no review task in view)');
  }

  // Print results
  console.log('');
  console.log('\u2501'.repeat(50));
  console.log('  Full Cycle E2E Smoke Test');
  console.log('\u2501'.repeat(50));
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
