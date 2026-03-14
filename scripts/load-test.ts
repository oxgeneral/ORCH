#!/usr/bin/env tsx
/**
 * Load test script for AgentsOrchestryCLI.
 *
 * Simulates 10+ hours of continuous orchestrator operation with shell-adapter tasks.
 * Monitors heap, directory sizes, file counts, and event listener counts every 5 minutes.
 * Logs all metrics to a CSV file for post-analysis.
 *
 * Usage:
 *   npm run load-test                    # 10-hour run
 *   npm run load-test -- --duration 600  # 10-minute smoke test
 */

import { mkdtemp, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createWriteStream, WriteStream } from 'node:fs';

// ── Configuration ────────────────────────────────────────────────────────────

/** ms between task creation batches */
const TASK_INTERVAL_MS = 45_000;
/** ms between metric snapshots */
const MONITOR_INTERVAL_MS = 5 * 60_000;
/** ms until burst phase */
const BURST_AFTER_MS = 60 * 60_000;
/** number of tasks in burst */
const BURST_TASK_COUNT = 50;
/** default run duration: 10 hours */
const DEFAULT_DURATION_S = 10 * 3600;

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  ts: string;
  elapsed_min: number;
  heap_mb: number;
  rss_mb: number;
  external_mb: number;
  orchestry_kb: number;
  runs_count: number;
  state_json_kb: number;
  largest_jsonl_kb: number;
  event_listeners: number;
  tasks_total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function dirSizeKb(dir: string): Promise<number> {
  try {
    const out = execSync(`du -sk "${dir}"`, { stdio: 'pipe' }).toString();
    return parseInt(out.split('\t')[0] ?? '0', 10);
  } catch {
    return 0;
  }
}

async function countJsonlFiles(dir: string): Promise<number> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

async function fileSizeKb(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return round1(s.size / 1024);
  } catch {
    return 0;
  }
}

async function largestJsonlKb(dir: string): Promise<number> {
  try {
    const files = await readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
    let max = 0;
    await Promise.all(
      jsonlFiles.map(async (f) => {
        const kb = await fileSizeKb(join(dir, f));
        if (kb > max) max = kb;
      }),
    );
    return max;
  } catch {
    return 0;
  }
}

function csvRow(snap: MetricsSnapshot): string {
  return [
    snap.ts,
    snap.elapsed_min,
    snap.heap_mb,
    snap.rss_mb,
    snap.external_mb,
    snap.orchestry_kb,
    snap.runs_count,
    snap.state_json_kb,
    snap.largest_jsonl_kb,
    snap.event_listeners,
    snap.tasks_total,
  ].join(',') + '\n';
}

const CSV_HEADER =
  'ts,elapsed_min,heap_mb,rss_mb,external_mb,orchestry_kb,runs_count,state_json_kb,largest_jsonl_kb,event_listeners,tasks_total\n';

// ── Setup ─────────────────────────────────────────────────────────────────────

async function initOrchestry(projectRoot: string): Promise<void> {
  const orchestryDir = join(projectRoot, '.orchestry');

  await Promise.all([
    mkdir(join(orchestryDir, 'tasks'), { recursive: true }),
    mkdir(join(orchestryDir, 'agents'), { recursive: true }),
    mkdir(join(orchestryDir, 'runs'), { recursive: true }),
    mkdir(join(orchestryDir, 'goals'), { recursive: true }),
    mkdir(join(orchestryDir, 'templates'), { recursive: true }),
    mkdir(join(orchestryDir, 'logs'), { recursive: true }),
  ]);

  // Config — 3 concurrent agents, 10s poll
  const config = {
    project: { name: 'load-test' },
    defaults: {
      agent: {
        adapter: 'shell',
        approval_policy: 'auto',
        max_turns: 5,
        timeout_ms: 120_000,
        stall_timeout_ms: 60_000,
        workspace_mode: 'shared',
      },
      task: {
        max_attempts: 3,
        priority: 3,
      },
    },
    scheduling: {
      poll_interval_ms: 10_000,
      max_concurrent_agents: 3,
      retry_base_delay_ms: 5_000,
      retry_max_delay_ms: 30_000,
    },
  };

  const { dump } = await import('js-yaml');
  await writeFile(join(orchestryDir, 'config.yml'), dump(config, { lineWidth: -1 }));

  // Minimal prompt template
  await writeFile(
    join(orchestryDir, 'templates', 'default.md'),
    '# Task: {{ task.title }}\n\n{{ task.description }}\n',
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  const dIdx = args.indexOf('--duration');
  const durationSec = dIdx >= 0 ? parseInt(args[dIdx + 1] ?? String(DEFAULT_DURATION_S), 10) : DEFAULT_DURATION_S;
  const DURATION_MS = durationSec * 1000;

  console.log('='.repeat(65));
  console.log('AgentsOrchestryCLI — Load Test');
  console.log(`Duration: ${round1(durationSec / 3600)}h  (${durationSec}s)`);
  console.log(`Task interval: ${TASK_INTERVAL_MS / 1000}s`);
  console.log(`Monitor interval: ${MONITOR_INTERVAL_MS / 60000}min`);
  console.log(`Burst: ${BURST_TASK_COUNT} tasks after ${BURST_AFTER_MS / 3600000}h`);
  console.log('='.repeat(65));

  // ── 1. Create temp project ─────────────────────────────────────────────────
  const projectRoot = await mkdtemp(join(tmpdir(), 'orch-load-'));
  console.log(`\n[SETUP] Project root: ${projectRoot}`);
  await initOrchestry(projectRoot);

  // ── 2. Build container ─────────────────────────────────────────────────────
  const { buildFullContainer } = await import('../src/container.js');
  const context = {
    projectRoot,
    json: false,
    quiet: true,
    noColor: true,
    ascii: true,
  };
  const c = await buildFullContainer(context);
  const orchestryDir = join(projectRoot, '.orchestry');
  console.log('[SETUP] Container built.');

  // ── 3. Create agents ───────────────────────────────────────────────────────
  const [agentSuccess, agentFail, agentLong] = await Promise.all([
    c.agentService.create({
      name: 'Worker Success',
      adapter: 'shell',
      command: 'sleep 5 && echo "task completed successfully"',
      approval_policy: 'auto',
      max_turns: 5,
      timeout_ms: 30_000,
      stall_timeout_ms: 20_000,
      workspace_mode: 'shared',
    }),
    c.agentService.create({
      name: 'Worker Fail',
      adapter: 'shell',
      command: 'sleep 2 && exit 1',
      approval_policy: 'auto',
      max_turns: 5,
      timeout_ms: 30_000,
      stall_timeout_ms: 20_000,
      workspace_mode: 'shared',
    }),
    c.agentService.create({
      name: 'Worker Long',
      adapter: 'shell',
      command: 'sleep 30 && echo "long task completed"',
      approval_policy: 'auto',
      max_turns: 5,
      timeout_ms: 90_000,
      stall_timeout_ms: 60_000,
      workspace_mode: 'shared',
    }),
  ]);
  console.log(`[SETUP] Agents: ${agentSuccess.id}, ${agentFail.id}, ${agentLong.id}`);

  // ── 4. CSV output ──────────────────────────────────────────────────────────
  const csvPath = join(process.cwd(), `load-test-metrics-${Date.now()}.csv`);
  const csvFile: WriteStream = createWriteStream(csvPath);
  csvFile.write(CSV_HEADER);
  console.log(`[SETUP] Metrics CSV: ${csvPath}`);

  // ── 5. Start orchestrator ──────────────────────────────────────────────────
  await c.orchestrator.startWatch();
  console.log('[SETUP] Orchestrator watch started.\n');

  // ── State ──────────────────────────────────────────────────────────────────
  let taskCounter = 0;
  let burstFired = false;
  let isShuttingDown = false;
  const metricsHistory: MetricsSnapshot[] = [];
  const startTime = Date.now();
  const agents = [agentSuccess.id, agentFail.id, agentLong.id] as const;

  // ── Collect metrics ────────────────────────────────────────────────────────
  async function collectMetrics(elapsedMin: number): Promise<MetricsSnapshot> {
    const mem = process.memoryUsage();
    const runsDir = join(orchestryDir, 'runs');

    const [orchestryKb, runsCount, stateKb, largestKb] = await Promise.all([
      dirSizeKb(orchestryDir),
      countJsonlFiles(runsDir),
      fileSizeKb(join(orchestryDir, 'state.json')),
      largestJsonlKb(runsDir),
    ]);

    // Sum known event type listener counts
    let eventListeners = 0;
    const eb = c.eventBus as unknown as { listenerCount?: (ev: string) => number };
    if (typeof eb.listenerCount === 'function') {
      const knownEvents = [
        'task:created',
        'task:status_changed',
        'agent:completed',
        'agent:error',
        'orchestrator:error',
        'orchestrator:shutdown',
      ];
      for (const ev of knownEvents) {
        eventListeners += eb.listenerCount(ev);
      }
    }

    return {
      ts: new Date().toISOString(),
      elapsed_min: elapsedMin,
      heap_mb: round1(mem.heapUsed / 1024 / 1024),
      rss_mb: round1(mem.rss / 1024 / 1024),
      external_mb: round1(mem.external / 1024 / 1024),
      orchestry_kb: orchestryKb,
      runs_count: runsCount,
      state_json_kb: stateKb,
      largest_jsonl_kb: largestKb,
      event_listeners: eventListeners,
      tasks_total: taskCounter,
    };
  }

  function printMetrics(snap: MetricsSnapshot): void {
    console.log(`\n[METRICS T+${snap.elapsed_min}min @ ${snap.ts}]`);
    console.log(`  Heap:            ${snap.heap_mb} MB`);
    console.log(`  RSS:             ${snap.rss_mb} MB`);
    console.log(`  .orchestry/:     ${snap.orchestry_kb} KB`);
    console.log(`  runs/ files:     ${snap.runs_count}`);
    console.log(`  state.json:      ${snap.state_json_kb} KB`);
    console.log(`  Largest JSONL:   ${snap.largest_jsonl_kb} KB`);
    console.log(`  Event listeners: ${snap.event_listeners}`);
    console.log(`  Tasks created:   ${snap.tasks_total}`);

    if (snap.heap_mb > 300) {
      console.warn(`  [ALERT] ⚠  Heap ${snap.heap_mb}MB exceeds 300MB threshold!`);
    }
    if (snap.state_json_kb > 1024) {
      console.warn(`  [ALERT] ⚠  state.json ${snap.state_json_kb}KB exceeds 1MB threshold!`);
    }
  }

  // ── Create task batch ──────────────────────────────────────────────────────
  async function createTasks(count: number): Promise<void> {
    const creations = Array.from({ length: count }, async (_, i) => {
      const idx = (taskCounter + i) % 3;
      const types = ['success', 'fail', 'long'] as const;
      const type = types[idx]!;
      const assignee = agents[idx]!;

      try {
        await c.taskService.create({
          title: `Load test #${taskCounter + i + 1} (${type})`,
          description: `Automated load test task, type: ${type}, seq: ${taskCounter + i + 1}`,
          priority: 3,
          assignee,
          labels: [type],
          max_attempts: 3,
        });
      } catch (err) {
        console.error(`[WARN] Failed to create task: ${err}`);
      }
    });

    await Promise.all(creations);
    taskCounter += count;
    const elapsed = Math.round((Date.now() - startTime) / 60000);
    console.log(`[T+${elapsed}min] Created ${count} tasks (total: ${taskCounter})`);
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  async function shutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[SHUTDOWN] Stopping orchestrator...');

    try {
      await c.orchestrator.stop();
      console.log('[SHUTDOWN] Orchestrator stopped.');
    } catch (err) {
      console.error(`[SHUTDOWN] Stop error: ${err}`);
    }

    // Final metrics
    const elapsed_min = Math.round((Date.now() - startTime) / 60000);
    const finalSnap = await collectMetrics(elapsed_min);
    metricsHistory.push(finalSnap);
    printMetrics(finalSnap);
    csvFile.write(csvRow(finalSnap));
    csvFile.end();

    // ── Final report ─────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(65));
    console.log('FINAL REPORT');
    console.log('='.repeat(65));
    console.log(`Total run time:  ${elapsed_min} min (${round1(elapsed_min / 60)}h)`);
    console.log(`Tasks created:   ${taskCounter}`);
    console.log(`Final heap:      ${finalSnap.heap_mb} MB`);
    console.log(`Final RSS:       ${finalSnap.rss_mb} MB`);
    console.log(`Runs dir files:  ${finalSnap.runs_count}`);
    console.log(`state.json:      ${finalSnap.state_json_kb} KB`);
    console.log(`Metrics CSV:     ${csvPath}`);

    if (metricsHistory.length > 0) {
      const peakHeap = Math.max(...metricsHistory.map((s) => s.heap_mb));
      const peakRss = Math.max(...metricsHistory.map((s) => s.rss_mb));
      console.log(`\nPeak heap:       ${peakHeap} MB`);
      console.log(`Peak RSS:        ${peakRss} MB`);

      // SLO checks
      const slos: Array<{ name: string; pass: boolean }> = [
        { name: `Heap < 300MB (peak: ${peakHeap}MB)`, pass: peakHeap < 300 },
        {
          name: `state.json < 1MB after 500 tasks (${finalSnap.state_json_kb}KB, ${taskCounter} tasks)`,
          pass: taskCounter < 500 || finalSnap.state_json_kb < 1024,
        },
      ];

      console.log('\nSLO Results:');
      let allPass = true;
      for (const slo of slos) {
        const icon = slo.pass ? '✓' : '✗';
        console.log(`  ${icon} ${slo.name}`);
        if (!slo.pass) allPass = false;
      }
      console.log('\n' + (allPass ? 'All SLOs PASS' : 'Some SLOs FAIL'));
    }

    // Cleanup temp dir
    try {
      await rm(projectRoot, { recursive: true, force: true });
      console.log(`\n[CLEANUP] Removed ${projectRoot}`);
    } catch {
      console.warn(`[CLEANUP] Could not remove ${projectRoot}`);
    }

    process.exit(0);
  }

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });

  // ── Main loop ──────────────────────────────────────────────────────────────
  let lastTaskTime = Date.now();
  let lastMonitorTime = Date.now();

  // Initial batch
  await createTasks(3);

  while (!isShuttingDown && Date.now() - startTime < DURATION_MS) {
    const now = Date.now();
    const elapsed = now - startTime;

    // Create tasks on interval
    if (now - lastTaskTime >= TASK_INTERVAL_MS) {
      const count = 2 + (Math.random() < 0.33 ? 1 : 0); // 2 or 3
      await createTasks(count);
      lastTaskTime = now;
    }

    // Burst at 1 hour
    if (!burstFired && elapsed >= BURST_AFTER_MS) {
      burstFired = true;
      console.log(`\n[BURST] T+1h reached — creating ${BURST_TASK_COUNT} tasks in one batch...`);
      await createTasks(BURST_TASK_COUNT);
    }

    // Monitor on interval
    if (now - lastMonitorTime >= MONITOR_INTERVAL_MS) {
      const elapsedMin = Math.round(elapsed / 60000);
      const snap = await collectMetrics(elapsedMin);
      metricsHistory.push(snap);
      printMetrics(snap);
      csvFile.write(csvRow(snap));
      lastMonitorTime = now;
    }

    // Lightweight idle sleep (5s checks)
    await sleep(5_000);
  }

  if (!isShuttingDown) {
    await shutdown();
  }
}

// AbortError is expected when the orchestrator kills running child processes on shutdown.
// Without this handler Node.js would crash with an unhandled 'error' event on ChildProcess.
process.on('uncaughtException', (err: Error) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ABORT_ERR' || err.name === 'AbortError') return;
  console.error('[UNCAUGHT ERROR]', err);
  process.exit(1);
});

main().catch((err: unknown) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
