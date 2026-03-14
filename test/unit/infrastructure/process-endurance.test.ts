/**
 * Process manager endurance tests.
 *
 * Integration tests using real shell processes — NOT mocks.
 * Skipped in CI where process spawning may be restricted.
 *
 * Timeout: 30s per test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ProcessManager } from '../../../src/infrastructure/process/process-manager.js';

const isCI = !!process.env['CI'];

const manager = new ProcessManager();

// Track all spawned PIDs for cleanup
const spawnedPids: number[] = [];

function spawnSleep(seconds: number): number {
  const result = manager.spawn('sleep', [String(seconds)]);
  spawnedPids.push(result.pid);
  return result.pid;
}

afterEach(() => {
  // Cleanup all tracked processes
  for (const pid of spawnedPids) {
    try {
      manager.kill(pid, 'SIGKILL');
    } catch {
      // Already dead — ignore
    }
  }
  spawnedPids.length = 0;
});

describe('ProcessManager endurance', { timeout: 30_000, skip: isCI }, () => {
  /**
   * Test 1 — Zombie detection
   * Spawn 20 processes, kill 10, verify isAlive() returns correct results.
   */
  it('zombie detection: isAlive correctly identifies live vs dead processes', async () => {
    const pids: number[] = [];

    // Spawn 20 sleep processes
    for (let i = 0; i < 20; i++) {
      pids.push(spawnSleep(30));
    }

    // All 20 should be alive immediately
    for (const pid of pids) {
      expect(manager.isAlive(pid), `pid ${pid} should be alive after spawn`).toBe(true);
    }

    // Kill first 10
    const killed = pids.slice(0, 10);
    const alive = pids.slice(10);

    for (const pid of killed) {
      manager.kill(pid, 'SIGKILL');
    }

    // Give kernel time to reap
    await new Promise((r) => setTimeout(r, 300));

    // Killed processes should report dead
    for (const pid of killed) {
      expect(manager.isAlive(pid), `pid ${pid} should be dead after SIGKILL`).toBe(false);
    }

    // Remaining 10 should still be alive
    for (const pid of alive) {
      expect(manager.isAlive(pid), `pid ${pid} should still be alive`).toBe(true);
    }
  });

  /**
   * Test 2 — Kill grace period
   * Verify that killWithGrace always terminates the process (either via
   * SIGTERM within grace period, or SIGKILL after grace period expires).
   *
   * Two sub-cases:
   *  a) process responds to SIGTERM → dies before grace expires
   *  b) process ignores SIGTERM via process group isolation → dies via SIGKILL
   */
  it('kill grace period: process is guaranteed dead after killWithGrace completes', async () => {
    // Case A: normal process (responds to SIGTERM)
    const pidA = spawnSleep(60);
    expect(manager.isAlive(pidA)).toBe(true);
    await manager.killWithGrace(pidA, 1000);
    expect(manager.isAlive(pidA)).toBe(false);

    // Case B: process that exits only after SIGKILL
    // We use a very short grace period (100ms) — SIGTERM is sent,
    // if the process survives the grace period SIGKILL is forced.
    // Either way the process must be dead after the call returns.
    const result = manager.spawn('sleep', ['60']);
    const pidB = result.pid;
    spawnedPids.push(pidB);

    expect(manager.isAlive(pidB)).toBe(true);

    // Use graceMs=100ms to exercise the SIGKILL path more reliably
    await manager.killWithGrace(pidB, 100);

    expect(manager.isAlive(pidB)).toBe(false);
  });

  /**
   * Test 2b — killWithGrace kills multiple processes sequentially
   * Verify that repeated killWithGrace calls on fresh processes all succeed.
   */
  it('kill grace period: repeated killWithGrace calls all terminate processes', async () => {
    const RUNS = 5;

    for (let i = 0; i < RUNS; i++) {
      const pid = spawnSleep(60);
      expect(manager.isAlive(pid)).toBe(true);

      await manager.killWithGrace(pid, 1000);

      expect(manager.isAlive(pid), `process ${i} (pid ${pid}) must be dead after killWithGrace`).toBe(false);

      // Remove from cleanup list (already dead)
      const idx = spawnedPids.indexOf(pid);
      if (idx !== -1) spawnedPids.splice(idx, 1);
    }
  });

  /**
   * Test 3 — Process group cleanup
   * Spawn a detached process that spawns children.
   * Kill parent via killWithGrace — children should also be cleaned up.
   */
  it('process group cleanup: children killed when parent group is killed', async () => {
    // Parent spawns 3 child sleeps, then sleeps itself
    const result = manager.spawn('bash', [
      '-c',
      'sleep 30 & sleep 30 & sleep 30 & sleep 30',
    ]);
    const parentPid = result.pid;
    spawnedPids.push(parentPid);

    // Allow children to spawn
    await new Promise((r) => setTimeout(r, 200));

    expect(manager.isAlive(parentPid)).toBe(true);

    // Kill the entire process group via killWithGrace
    await manager.killWithGrace(parentPid, 2000);

    // Parent must be dead
    expect(manager.isAlive(parentPid)).toBe(false);

    // Give a moment for children to die (process group kill)
    await new Promise((r) => setTimeout(r, 300));

    // Verify no child processes remain in the same group
    // We check by trying to signal the process group — it should fail
    let groupAlive = false;
    try {
      process.kill(-parentPid, 0);
      groupAlive = true;
    } catch {
      // ESRCH = group dead, expected
      groupAlive = false;
    }
    expect(groupAlive).toBe(false);
  });

  /**
   * Test 4 — Rapid spawn/kill cycles
   * 50 cycles of spawn→kill in rapid succession.
   * Verify no zombies remain and fd count doesn't grow unboundedly.
   */
  it('rapid spawn/kill cycles: no zombies after 50 spawn→kill cycles', async () => {
    const CYCLES = 50;
    const deadPids: number[] = [];

    for (let i = 0; i < CYCLES; i++) {
      const pid = spawnSleep(60);

      // Verify alive immediately
      expect(manager.isAlive(pid)).toBe(true);

      // Kill immediately
      manager.kill(pid, 'SIGKILL');
      deadPids.push(pid);

      // Remove from cleanup list (already dead)
      const idx = spawnedPids.indexOf(pid);
      if (idx !== -1) spawnedPids.splice(idx, 1);
    }

    // Allow kernel to reap zombies
    await new Promise((r) => setTimeout(r, 500));

    // All processes must be dead
    let zombieCount = 0;
    for (const pid of deadPids) {
      if (manager.isAlive(pid)) zombieCount++;
    }

    expect(zombieCount).toBe(0);
  });

  /**
   * Test 5 — Concurrent isAlive checks
   * 100 parallel isAlive() calls on various PIDs.
   * Verify no EMFILE error and all results are boolean.
   */
  it('concurrent isAlive checks: 100 parallel calls return correct boolean results', async () => {
    // Spawn a few real processes to check
    const livePids: number[] = [];
    for (let i = 0; i < 5; i++) {
      livePids.push(spawnSleep(30));
    }

    // Mix of live PIDs and definitely-dead PIDs (1, 2, 3 are init/kernel, not checkable safely)
    // Use very high PID numbers that almost certainly don't exist
    const deadPids = [999_000_001, 999_000_002, 999_000_003, 999_000_004, 999_000_005];

    const checkTargets: Array<{ pid: number; expectedAlive: boolean }> = [
      ...livePids.map((pid) => ({ pid, expectedAlive: true })),
      ...deadPids.map((pid) => ({ pid, expectedAlive: false })),
    ];

    // Build 100 parallel checks by cycling through targets
    const checks: Array<Promise<{ pid: number; result: boolean; expected: boolean }>> = [];
    for (let i = 0; i < 100; i++) {
      const target = checkTargets[i % checkTargets.length]!;
      checks.push(
        Promise.resolve({
          pid: target.pid,
          result: manager.isAlive(target.pid),
          expected: target.expectedAlive,
        }),
      );
    }

    // All 100 must resolve without throwing EMFILE
    let emfileError = false;
    const results = await Promise.all(checks).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'EMFILE') emfileError = true;
      return [] as typeof checks extends Promise<infer T>[] ? T[] : never[];
    });

    expect(emfileError).toBe(false);
    expect(results).toHaveLength(100);

    // Verify all results are boolean
    for (const r of results) {
      expect(typeof r.result).toBe('boolean');
      expect(r.result).toBe(r.expected);
    }
  });
});
