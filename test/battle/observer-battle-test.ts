#!/usr/bin/env npx tsx
/**
 * Battle test: DiskObserver cross-process simulation.
 *
 * Simulates the real scenario:
 *   Process A — "external orchestrator" (acquires lock, writes state + JSONL)
 *   Process B — "TUI observer" (DiskObserver polls and tails events)
 *
 * Verifies real-time event delivery across process boundaries.
 */

import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Paths } from '../../src/infrastructure/storage/paths.js';
import { StateStore } from '../../src/infrastructure/storage/state-store.js';
import { acquireLock, releaseLock } from '../../src/infrastructure/storage/lock.js';
import { writeJson } from '../../src/infrastructure/storage/fs-utils.js';
import { DiskObserver } from '../../src/cli/serve/disk-observer.js';
import type { OrchestratorEvent } from '../../src/domain/events.js';

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function log(label: string, msg: string, color = CYAN) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`${DIM}${ts}${RESET} ${color}${BOLD}[${label}]${RESET} ${msg}`);
}

function makeRunEvent(type: string, data: unknown): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), type, data });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════ */

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║  BATTLE TEST: DiskObserver Cross-Process Sim     ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}\n`);

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'orch-battle-'));
  const orchDir = path.join(tmpDir, '.orchestry');
  await mkdir(orchDir);
  await mkdir(path.join(orchDir, 'runs'));
  await mkdir(path.join(orchDir, 'tasks'));
  await mkdir(path.join(orchDir, 'agents'));

  const paths = new Paths(tmpDir);
  const stateStore = new StateStore(paths);

  // Write initial state
  await writeJson(paths.statePath, {
    version: 1, running: {}, claimed: [], retry_queue: [],
    stats: { total_runs: 0, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
  });

  log('SETUP', `Project dir: ${tmpDir}`);

  // ════════════════════════════════════════════════════════
  // PHASE 1: Acquire lock (simulate external orchestrator)
  // ════════════════════════════════════════════════════════

  log('ORCH', 'Acquiring orchestrator lock...', YELLOW);
  const lockResult = await acquireLock(paths.lockPath);
  if (!lockResult.acquired) {
    log('ORCH', 'Failed to acquire lock!', RED);
    process.exit(1);
  }
  log('ORCH', `Lock acquired (PID ${lockResult.pid})`, GREEN);

  // ════════════════════════════════════════════════════════
  // PHASE 2: Start DiskObserver (simulate TUI observer)
  // ════════════════════════════════════════════════════════

  const events: OrchestratorEvent[] = [];
  const eventLog: string[] = [];

  const observer = new DiskObserver({ paths, stateStore, pollIntervalMs: 200 });

  log('TUI', 'Starting DiskObserver (poll interval: 200ms)...', CYAN);

  const unsub = observer.subscribe((event) => {
    events.push(event);
    const summary = formatEventCompact(event);
    if (summary) {
      eventLog.push(summary);
      log('EVENT', summary, GREEN);
    }
  });

  log('TUI', 'Observer active — waiting for events...', CYAN);
  await wait(300);

  // ════════════════════════════════════════════════════════
  // PHASE 3: Simulate agent run lifecycle
  // ════════════════════════════════════════════════════════

  log('ORCH', '── Starting run: run_battle_1 (agent: claude-senior, task: tsk_fix_bug) ──', YELLOW);

  // 3a. Write state with running entry
  await writeJson(paths.statePath, {
    version: 1, pid: process.pid,
    started_at: new Date().toISOString(),
    running: {
      tsk_fix_bug: {
        run_id: 'run_battle_1', agent_id: 'agt_claude_senior', task_id: 'tsk_fix_bug',
        pid: process.pid, started_at: new Date().toISOString(), last_event_at: new Date().toISOString(),
      },
    },
    claimed: ['tsk_fix_bug'], retry_queue: [],
    stats: { total_runs: 1, total_tasks_completed: 0, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 0 },
  });

  await wait(400); // Let observer detect

  // 3b. Simulate streaming agent output (like real Claude adapter)
  const jsonlPath = paths.runEventsPath('run_battle_1');

  log('ORCH', 'Agent reading codebase...', YELLOW);
  await writeFile(jsonlPath,
    makeRunEvent('agent_output', 'Reading src/auth/handler.ts to understand the bug...') + '\n');
  await wait(300);

  log('ORCH', 'Agent analyzing code...', YELLOW);
  await appendFile(jsonlPath,
    makeRunEvent('agent_output', 'Found the issue: missing null check on line 42') + '\n' +
    makeRunEvent('tool_call', { tool: 'Read', args: { file_path: 'src/auth/handler.ts', offset: 40, limit: 10 } }) + '\n');
  await wait(300);

  log('ORCH', 'Agent editing file...', YELLOW);
  await appendFile(jsonlPath,
    makeRunEvent('agent_output', 'Applying fix: add null guard before accessing user.session') + '\n' +
    makeRunEvent('file_changed', 'src/auth/handler.ts') + '\n');
  await wait(300);

  log('ORCH', 'Agent running tests...', YELLOW);
  await appendFile(jsonlPath,
    makeRunEvent('agent_output', 'Running test suite...') + '\n' +
    makeRunEvent('command_run', 'npm test -- test/auth/handler.test.ts') + '\n' +
    makeRunEvent('agent_output', '✓ 14 tests passed, 0 failed') + '\n');
  await wait(300);

  // 3c. Agent completes — write done event + run metadata
  log('ORCH', 'Agent completed — writing results...', YELLOW);
  await appendFile(jsonlPath,
    makeRunEvent('done', { tokens: { input: 12500, output: 3200, total: 15700 } }) + '\n');

  await writeJson(paths.runPath('run_battle_1'), {
    id: 'run_battle_1', task_id: 'tsk_fix_bug', agent_id: 'agt_claude_senior',
    attempt: 1, status: 'succeeded',
    started_at: new Date(Date.now() - 5000).toISOString(),
    finished_at: new Date().toISOString(),
    workspace_path: tmpDir, prompt: 'Fix the null pointer bug in auth handler',
    tokens: { input: 12500, output: 3200, reasoning: 0, total: 15700, cache_read: 0, cache_write: 0 },
  });

  // Remove from running
  await writeJson(paths.statePath, {
    version: 1, pid: process.pid,
    running: {},
    claimed: [], retry_queue: [],
    stats: { total_runs: 1, total_tasks_completed: 1, total_tasks_failed: 0, total_tokens: { input: 12500, output: 3200, total: 15700 }, total_runtime_ms: 5000 },
  });

  await wait(500);

  // ════════════════════════════════════════════════════════
  // PHASE 4: Second run — failed
  // ════════════════════════════════════════════════════════

  log('ORCH', '── Starting run: run_battle_2 (agent: codex-worker, task: tsk_refactor) ──', YELLOW);

  await writeJson(paths.statePath, {
    version: 1, pid: process.pid,
    running: {
      tsk_refactor: {
        run_id: 'run_battle_2', agent_id: 'agt_codex_worker', task_id: 'tsk_refactor',
        pid: process.pid, started_at: new Date().toISOString(), last_event_at: new Date().toISOString(),
      },
    },
    claimed: ['tsk_refactor'], retry_queue: [],
    stats: { total_runs: 2, total_tasks_completed: 1, total_tasks_failed: 0, total_tokens: {}, total_runtime_ms: 5000 },
  });

  await wait(400);

  const jsonl2 = paths.runEventsPath('run_battle_2');
  await writeFile(jsonl2,
    makeRunEvent('agent_output', 'Starting refactor of payment module...') + '\n' +
    makeRunEvent('agent_output', 'Extracting PaymentProcessor class...') + '\n');
  await wait(300);

  // Simulate error
  log('ORCH', 'Agent encountered error!', RED);
  await appendFile(jsonl2,
    makeRunEvent('error', 'EACCES: permission denied, open /etc/shadow') + '\n');
  await wait(300);

  // Complete as failed
  await writeJson(paths.runPath('run_battle_2'), {
    id: 'run_battle_2', task_id: 'tsk_refactor', agent_id: 'agt_codex_worker',
    attempt: 1, status: 'failed',
    started_at: new Date(Date.now() - 2000).toISOString(),
    finished_at: new Date().toISOString(),
    workspace_path: tmpDir, prompt: 'Refactor payment module',
    error: 'EACCES: permission denied',
  });

  await writeJson(paths.statePath, {
    version: 1, pid: process.pid, running: {}, claimed: [], retry_queue: [],
    stats: { total_runs: 2, total_tasks_completed: 1, total_tasks_failed: 1, total_tokens: {}, total_runtime_ms: 7000 },
  });

  await wait(500);

  // ════════════════════════════════════════════════════════
  // PHASE 5: Concurrent runs
  // ════════════════════════════════════════════════════════

  log('ORCH', '── Starting 3 concurrent runs ──', YELLOW);

  await writeJson(paths.statePath, {
    version: 1, pid: process.pid,
    running: {
      tsk_a: { run_id: 'run_c1', agent_id: 'agt_a', task_id: 'tsk_a', pid: process.pid, started_at: '', last_event_at: '' },
      tsk_b: { run_id: 'run_c2', agent_id: 'agt_b', task_id: 'tsk_b', pid: process.pid, started_at: '', last_event_at: '' },
      tsk_c: { run_id: 'run_c3', agent_id: 'agt_c', task_id: 'tsk_c', pid: process.pid, started_at: '', last_event_at: '' },
    },
    claimed: [], retry_queue: [],
    stats: { total_runs: 5, total_tasks_completed: 1, total_tasks_failed: 1, total_tokens: {}, total_runtime_ms: 7000 },
  });

  await writeFile(paths.runEventsPath('run_c1'), makeRunEvent('agent_output', 'Agent A working on frontend') + '\n');
  await writeFile(paths.runEventsPath('run_c2'), makeRunEvent('agent_output', 'Agent B working on backend') + '\n');
  await writeFile(paths.runEventsPath('run_c3'), makeRunEvent('agent_output', 'Agent C writing tests') + '\n');

  await wait(400);

  // All complete
  for (const id of ['run_c1', 'run_c2', 'run_c3']) {
    await writeJson(paths.runPath(id), {
      id, task_id: `tsk_${id.slice(-2)}`, agent_id: `agt_${id.slice(-2)}`,
      attempt: 1, status: 'succeeded', started_at: '', workspace_path: '', prompt: '',
    });
  }

  await writeJson(paths.statePath, {
    version: 1, pid: process.pid, running: {}, claimed: [], retry_queue: [],
    stats: { total_runs: 5, total_tasks_completed: 4, total_tasks_failed: 1, total_tokens: {}, total_runtime_ms: 10000 },
  });

  await wait(500);

  // ════════════════════════════════════════════════════════
  // PHASE 6: Cleanup and report
  // ════════════════════════════════════════════════════════

  unsub();
  await releaseLock(paths.lockPath);

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║  RESULTS                                         ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}\n`);

  // Verify all expected events
  const counts = {
    'agent:started': 0,
    'agent:output': 0,
    'agent:file_changed': 0,
    'agent:error': 0,
    'agent:completed': 0,
    'task:status_changed': 0,
    'orchestrator:tick': 0,
  };

  for (const e of events) {
    if (e.type in counts) counts[e.type as keyof typeof counts]++;
  }

  console.log(`  ${BOLD}Event counts:${RESET}`);
  for (const [type, count] of Object.entries(counts)) {
    const color = count > 0 ? GREEN : RED;
    const icon = count > 0 ? '✓' : '✗';
    console.log(`    ${color}${icon}${RESET} ${type}: ${BOLD}${count}${RESET}`);
  }

  console.log(`\n  ${BOLD}Total events captured: ${events.length}${RESET}`);

  // Assertions
  const failures: string[] = [];

  // Run 1: success lifecycle
  if (counts['agent:started'] < 5) failures.push(`Expected ≥5 agent:started, got ${counts['agent:started']}`);
  if (counts['agent:output'] < 8) failures.push(`Expected ≥8 agent:output, got ${counts['agent:output']}`);
  if (counts['agent:file_changed'] < 1) failures.push(`Expected ≥1 agent:file_changed, got ${counts['agent:file_changed']}`);
  if (counts['agent:error'] < 1) failures.push(`Expected ≥1 agent:error, got ${counts['agent:error']}`);
  if (counts['agent:completed'] < 5) failures.push(`Expected ≥5 agent:completed, got ${counts['agent:completed']}`);
  if (counts['task:status_changed'] < 5) failures.push(`Expected ≥5 task:status_changed, got ${counts['task:status_changed']}`);
  if (counts['orchestrator:tick'] < 1) failures.push(`Expected ≥1 orchestrator:tick, got ${counts['orchestrator:tick']}`);

  // Verify specific events
  const startedRuns = events.filter((e) => e.type === 'agent:started').map((e) => ('runId' in e ? e.runId : ''));
  if (!startedRuns.includes('run_battle_1')) failures.push('Missing agent:started for run_battle_1');
  if (!startedRuns.includes('run_battle_2')) failures.push('Missing agent:started for run_battle_2');
  if (!startedRuns.includes('run_c1')) failures.push('Missing agent:started for run_c1');
  if (!startedRuns.includes('run_c2')) failures.push('Missing agent:started for run_c2');
  if (!startedRuns.includes('run_c3')) failures.push('Missing agent:started for run_c3');

  // Verify success + failure outcomes
  const completedEvents = events.filter((e) => e.type === 'agent:completed') as Array<{ type: 'agent:completed'; runId: string; success: boolean }>;
  const run1Complete = completedEvents.find((e) => e.runId === 'run_battle_1');
  const run2Complete = completedEvents.find((e) => e.runId === 'run_battle_2');
  if (!run1Complete?.success) failures.push('run_battle_1 should have success=true');
  if (run2Complete?.success) failures.push('run_battle_2 should have success=false');

  // Verify file_changed
  const fileEvents = events.filter((e) => e.type === 'agent:file_changed') as Array<{ path: string }>;
  if (!fileEvents.some((e) => e.path === 'src/auth/handler.ts')) failures.push('Missing file_changed for src/auth/handler.ts');

  // Verify error
  const errorEvents = events.filter((e) => e.type === 'agent:error') as Array<{ error: string }>;
  if (!errorEvents.some((e) => e.error.includes('EACCES'))) failures.push('Missing EACCES error event');

  // Verify concurrent run ticks
  const tickWith3 = events.filter((e) => e.type === 'orchestrator:tick' && 'running' in e && e.running === 3);
  if (tickWith3.length === 0) failures.push('Missing orchestrator:tick with running=3 (concurrent runs)');

  console.log('');
  if (failures.length === 0) {
    console.log(`  ${GREEN}${BOLD}══════════════════════════════════════════════${RESET}`);
    console.log(`  ${GREEN}${BOLD}  ALL CHECKS PASSED ✓  (${events.length} events captured)${RESET}`);
    console.log(`  ${GREEN}${BOLD}══════════════════════════════════════════════${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}══════════════════════════════════════════════${RESET}`);
    console.log(`  ${RED}${BOLD}  FAILURES: ${failures.length}${RESET}`);
    for (const f of failures) {
      console.log(`  ${RED}  ✗ ${f}${RESET}`);
    }
    console.log(`  ${RED}${BOLD}══════════════════════════════════════════════${RESET}`);
  }

  // Cleanup
  await rm(tmpDir, { recursive: true, force: true });
  console.log(`\n${DIM}  Temp dir cleaned up: ${tmpDir}${RESET}\n`);

  process.exit(failures.length > 0 ? 1 : 0);
}

function formatEventCompact(event: OrchestratorEvent): string | null {
  switch (event.type) {
    case 'agent:started':
      return `▶ STARTED  run=${event.runId} agent=${event.agentId} task=${event.taskId}`;
    case 'agent:output':
      return `  OUTPUT   ${event.data.slice(0, 80)}`;
    case 'agent:file_changed':
      return `  FILE     ${event.path}`;
    case 'agent:error':
      return `  ERROR    ${event.error.slice(0, 80)}`;
    case 'agent:completed':
      return `${event.success ? '✓' : '✗'} COMPLETE run=${event.runId} success=${event.success}`;
    case 'task:status_changed':
      return `  STATUS   ${event.taskId}: ${event.from} → ${event.to}`;
    case 'orchestrator:tick':
      return event.running > 0 ? `  TICK     running=${event.running}` : null;
    default:
      return null;
  }
}

main().catch((err) => {
  console.error(RED, 'FATAL:', err, RESET);
  process.exit(1);
});
