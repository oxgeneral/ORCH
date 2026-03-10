/**
 * Smoke test for the new Command Bar features.
 * Tests tab completion, history, /commands, and view switching.
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
  const tasks: Task[] = [
    makeTask({ id: 'tsk_1', title: 'Implement auth module', status: 'todo' }),
    makeTask({ id: 'tsk_2', title: 'Fix CSS layout bug', status: 'in_progress', assigned_agent: 'agt_1' }),
    makeTask({ id: 'tsk_3', title: 'Write API docs', status: 'done' }),
    makeTask({ id: 'tsk_4', title: 'Refactor database layer', status: 'failed' }),
    makeTask({ id: 'tsk_5', title: 'Add unit tests', status: 'todo' }),
  ];

  const agents: Agent[] = [
    makeAgent({ id: 'agt_1', name: 'alpha', status: 'running', current_task: 'tsk_2' }),
    makeAgent({ id: 'agt_2', name: 'beta', status: 'idle' }),
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
      projectName: 'cmd-bar-test',
      tasks, agents, state,
      onCreateTask, onSubscribeEvents,
    })
  );

  await delay(200);

  // ── 1. Command mode entry ──
  let frame = lastFrame()!;
  if (frame.includes('Tab') && frame.includes('cmd') && frame.includes('quit')) pass('Navigate mode hints');
  else fail('Navigate mode hints', 'missing hint text');

  stdin.write('/');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('\u2588') || frame.includes('/')) pass('Command mode entered (/ key)');
  else fail('Command mode entry', 'cursor or / not found');

  // ── 2. Ghost text completion ──
  stdin.write('h');
  stdin.write('e');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('lp')) pass('Ghost completion: /he → "lp" ghost');
  else fail('Ghost completion', 'ghost text "lp" not found');

  // ── 3. Tab completion ──
  stdin.write('\t');
  await delay(100);
  frame = lastFrame()!;
  // After tab, input should be /help (ghost text accepted)
  if (frame.includes('help')) pass('Tab completion applied');
  else fail('Tab completion', '"help" not found after tab');

  // ── 4. Execute /help ──
  stdin.write('\r');
  await delay(150);
  frame = lastFrame()!;
  if (frame.includes('/quit') || frame.includes('/status')) pass('/help command lists commands');
  else fail('/help', 'commands not listed');

  // ── 5. History: ↑ recalls last command ──
  // Type a unique prefix that has no matching suggestions, then ↑ to get history
  stdin.write('/');
  await delay(100);
  stdin.write('z'); // '/z' has no matching commands → no suggestions → ↑ accesses history
  await delay(50);
  stdin.write('\x1B[A'); // up arrow
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('help')) pass('History: ↑ recalls /help');
  else fail('History ↑', '"help" not found');

  stdin.write('\x1B'); // cancel
  await delay(100);

  // ── 6. /status command ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'status') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(150);
  frame = lastFrame()!;
  if (frame.includes('running') && frame.includes('tasks') && frame.includes('agents')) pass('/status shows summary');
  else fail('/status', 'summary not shown');

  // ── 7. /task list ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'task list') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(150);
  frame = lastFrame()!;
  if (frame.includes('tsk_') && frame.includes('todo')) pass('/task list shows tasks');
  else fail('/task list', 'tasks not listed');

  // ── 8. /task add ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'task add Smoke test task') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(200);
  frame = lastFrame()!;
  if (createdCount > 0 && frame.includes('Smoke test task')) pass('/task add creates task');
  else fail('/task add', `createdCount=${createdCount}`);

  // ── 9. Tab key cycles views: tasks → agents ──
  stdin.write('\t');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('AGENTS')) pass('Tab cycles to AGENTS view');
  else fail('Tab view cycle', 'AGENTS not found');

  // ── 10. Tab → logs ──
  stdin.write('\t');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('LOGS')) pass('Tab cycles to LOGS view');
  else fail('Tab view cycle 2', 'LOGS not found');

  // ── 11. Tab → back to tasks ──
  stdin.write('\t');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('TASKS')) pass('Tab cycles back to TASKS');
  else fail('Tab view cycle 3', 'TASKS not found');

  // ── 12. ← arrow: tasks → logs ──
  stdin.write('\x1B[D'); // left
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('LOGS')) pass('← arrow: TASKS → LOGS');
  else fail('← arrow', 'LOGS not found');

  // ── 13. → arrow: logs → tasks ──
  stdin.write('\x1B[C'); // right
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('TASKS')) pass('→ arrow: LOGS → TASKS');
  else fail('→ arrow', 'TASKS not found');

  // ── 14. Subcommand completion: /task c → ancel ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'task c') stdin.write(ch);
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('ancel')) pass('Subcommand ghost: /task c → "ancel"');
  else fail('Subcommand ghost', '"ancel" not found');

  stdin.write('\x1B'); // cancel
  await delay(100);

  // ── 15. Esc cancels command mode ──
  stdin.write('/');
  await delay(50);
  stdin.write('x');
  await delay(50);
  stdin.write('\x1B');
  await delay(100);
  frame = lastFrame()!;
  if (frame.includes('Tab') && frame.includes('cmd')) pass('Esc returns to navigate mode');
  else fail('Esc cancel', 'navigate hints not found');

  // ── 16. Unknown command ──
  stdin.write('/');
  await delay(50);
  for (const ch of 'foobar') stdin.write(ch);
  await delay(50);
  stdin.write('\r');
  await delay(150);
  frame = lastFrame()!;
  if (frame.includes('Unknown') && frame.includes('foobar')) pass('Unknown command feedback');
  else fail('Unknown command', 'error message not found');

  // Print results
  console.log('');
  console.log('\u2501'.repeat(45));
  console.log('  Command Bar Smoke Test');
  console.log('\u2501'.repeat(45));
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
