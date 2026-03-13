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
  'build':         2000,
  'test-suite':    12000,
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
    const status = r.pass ? 'PASS' : 'FAIL';
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

function main(): void {
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

  console.log('[1/4] CLI --help (3 runs)');
  results.push(benchCliHelp());

  console.log('[2/4] CLI task list (3 runs)');
  results.push(benchCliTaskList());

  console.log('[3/4] Build');
  results.push(benchBuild());

  console.log('[4/4] Test suite');
  results.push(benchTestSuite());

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
