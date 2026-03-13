#!/usr/bin/env tsx
/**
 * Benchmark script for AgentsOrchestryCLI.
 *
 * Measures CLI startup, build time, and test suite duration.
 * Results saved to .orchestry/benchmarks/<timestamp>.json.
 *
 * Usage: npx tsx scripts/benchmark.ts
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Targets ──────────────────────────────────────────────────

const TARGETS: Record<string, number> = {
  'cli-help':      50,
  'cli-task-list': 100,
  'build':         1500,
  'test-suite':    12000,
  'tick-cycle':    50,
};

// ── Types ────────────────────────────────────────────────────

interface BenchmarkResult {
  name: string;
  runs: number[];
  median: number;
  min: number;
  max: number;
  target: number;
  pass: boolean;
}

interface BenchmarkReport {
  timestamp: string;
  node: string;
  platform: string;
  results: BenchmarkResult[];
}

// ── Helpers ──────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function measure(cmd: string): number {
  const start = performance.now();
  execSync(cmd, { stdio: 'pipe', cwd: process.cwd() });
  return Math.round(performance.now() - start);
}

function measureN(cmd: string, n: number): number[] {
  const runs: number[] = [];
  for (let i = 0; i < n; i++) {
    runs.push(measure(cmd));
  }
  return runs;
}

function toBenchmarkResult(name: string, runs: number[], target: number): BenchmarkResult {
  const med = median(runs);
  return {
    name,
    runs,
    median: med,
    min: Math.min(...runs),
    max: Math.max(...runs),
    target,
    pass: med <= target,
  };
}

// ── Benchmarks ───────────────────────────────────────────────

function benchCliHelp(): BenchmarkResult {
  const runs = measureN('node dist/cli.js --help', 3);
  return toBenchmarkResult('cli-help', runs, TARGETS['cli-help']!);
}

function benchCliTaskList(): BenchmarkResult {
  const runs = measureN('node dist/cli.js task list', 3);
  return toBenchmarkResult('cli-task-list', runs, TARGETS['cli-task-list']!);
}

function benchBuild(): BenchmarkResult {
  const runs = [measure('npm run build')];
  return toBenchmarkResult('build', runs, TARGETS['build']!);
}

function benchTestSuite(): BenchmarkResult {
  const runs = [measure('npx vitest run')];
  return toBenchmarkResult('test-suite', runs, TARGETS['test-suite']!);
}

async function benchTickCycle(): Promise<BenchmarkResult> {
  // Dynamic imports — only resolved when running via tsx
  const { EventBus } = await import('../src/application/event-bus.js');
  const { TaskService } = await import('../src/application/task-service.js');
  const { AgentService } = await import('../src/application/agent-service.js');
  const { RunService } = await import('../src/application/run-service.js');
  const { AdapterRegistry } = await import('../src/infrastructure/adapters/registry.js');
  const { Orchestrator } = await import('../src/application/orchestrator.js');
  const { DEFAULT_CONFIG } = await import('../src/domain/config.js');
  const { DEFAULT_STATE } = await import('../src/domain/state.js');

  const TICK_RUNS = 100;
  const config = { ...DEFAULT_CONFIG, scheduling: { ...DEFAULT_CONFIG.scheduling, poll_interval_ms: 999_999 } };

  // Minimal in-memory mock stores
  const taskStore = {
    list: async () => Array.from({ length: 10 }, (_, i) => ({
      id: `tsk_${i}`, title: `T${i}`, description: '', status: 'todo' as const,
      priority: 2, labels: [], depends_on: [], created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z', attempts: 0, max_attempts: 3,
    })),
    get: async () => null,
    save: async () => {},
    delete: async () => {},
  };

  const agentStore = {
    list: async () => Array.from({ length: 3 }, (_, i) => ({
      id: `agt_${i}`, name: `A${i}`, adapter: 'shell', status: 'idle' as const,
      config: { approval_policy: 'auto' as const, max_turns: 50, timeout_ms: 3_600_000, stall_timeout_ms: 300_000 },
      stats: { tasks_completed: 0, tasks_failed: 0, total_runs: 0, total_runtime_ms: 0 },
    })),
    get: async () => null,
    getByName: async () => null,
    save: async () => {},
    delete: async () => {},
  };

  const runStore = {
    save: async () => {},
    get: async () => null,
    listForTask: async () => [],
    listForAgent: async () => [],
    appendEvent: async () => {},
    readEvents: async () => [],
    readEventsTail: async () => [],
    streamEvents: async function* () {},
  };

  let state = structuredClone(DEFAULT_STATE);
  const stateStore = {
    read: async () => structuredClone(state),
    write: async (s: typeof state) => { state = structuredClone(s); },
  };

  const eventBus = new EventBus();
  const processManager = {
    isAlive: () => false,
    kill: () => {},
    killWithGrace: async () => {},
    spawn: () => ({ process: {} as ReturnType<typeof import('node:child_process').spawn>, pid: 1 }),
  };

  const workspaceManager = {
    prepare: async () => ({ path: '/tmp/ws' }),
    mergeBack: async () => ({ success: true as const }),
    cleanup: async () => {},
    validate: () => {},
  };

  const templateEngine = { render: async () => 'prompt' };
  const contextStore = {
    get: async () => null, set: async () => {}, delete: async () => {},
    list: async () => [], getAll: async () => ({}),
  };

  const deps = {
    taskStore, agentStore, runStore, stateStore,
    adapterRegistry: new AdapterRegistry(),
    workspaceManager, templateEngine, processManager,
    eventBus,
    taskService: new TaskService(taskStore, eventBus, config),
    agentService: new AgentService(agentStore, stateStore, eventBus, config),
    runService: new RunService(runStore, eventBus),
    contextStore,
    config,
    projectRoot: '/tmp/bench',
    lockPath: '/tmp/bench/.orchestry/lock',
  };

  const orch = new Orchestrator(deps);

  // Warm up: force internal state load
  // Access private tick via bracket notation for benchmark purposes
  const orchAny = orch as unknown as { tick(): Promise<void>; lockAcquired: boolean; state: typeof state };
  orchAny.lockAcquired = true;
  orchAny.state = structuredClone(DEFAULT_STATE);

  const runs: number[] = [];
  for (let i = 0; i < TICK_RUNS; i++) {
    const start = performance.now();
    await orchAny.tick();
    runs.push(Math.round((performance.now() - start) * 100) / 100);
  }

  return toBenchmarkResult('tick-cycle', runs.map(Math.round), TARGETS['tick-cycle']!);
}

// ── Output ───────────────────────────────────────────────────

function printTable(results: BenchmarkResult[]): void {
  const nameW = 16;
  const colW  = 10;

  const header = [
    'Benchmark'.padEnd(nameW),
    'Median'.padStart(colW),
    'Min'.padStart(colW),
    'Max'.padStart(colW),
    'Target'.padStart(colW),
    'Status'.padStart(colW),
  ].join('  ');

  const sep = '─'.repeat(header.length);

  console.log(`\n${sep}`);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const status = r.pass ? 'PASS' : r.median <= r.target * 1.2 ? 'NEAR PASS' : 'FAIL';
    const line = [
      r.name.padEnd(nameW),
      `${r.median}ms`.padStart(colW),
      `${r.min}ms`.padStart(colW),
      `${r.max}ms`.padStart(colW),
      `${r.target}ms`.padStart(colW),
      status.padStart(colW),
    ].join('  ');
    console.log(line);
  }

  console.log(sep);

  const allPass = results.every((r) => r.pass);
  console.log(allPass ? '\nAll benchmarks PASS' : '\nSome benchmarks FAIL');
}

function saveReport(report: BenchmarkReport): string {
  const dir = join(process.cwd(), '.orchestry', 'benchmarks');
  mkdirSync(dir, { recursive: true });
  const filename = `${report.timestamp.replace(/[:.]/g, '-')}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2) + '\n');
  return filepath;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Running benchmarks...\n');

  // Ensure build exists for CLI benchmarks
  try {
    execSync('node dist/cli.js --version', { stdio: 'pipe' });
  } catch {
    console.log('Building first (dist/ not ready)...');
    execSync('npm run build', { stdio: 'inherit' });
    console.log('');
  }

  const results: BenchmarkResult[] = [];

  console.log('[1/5] CLI --help (3 runs)');
  results.push(benchCliHelp());

  console.log('[2/5] CLI task list (3 runs)');
  results.push(benchCliTaskList());

  console.log('[3/5] Build');
  results.push(benchBuild());

  console.log('[4/5] Test suite');
  results.push(benchTestSuite());

  console.log('[5/5] Tick cycle (100 runs)');
  results.push(await benchTickCycle());

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    results,
  };

  printTable(results);

  const filepath = saveReport(report);
  console.log(`\nSaved: ${filepath}`);
}

main();
