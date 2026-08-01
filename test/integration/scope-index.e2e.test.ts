/**
 * Scope scheduling — end-to-end through the real runtime stack.
 *
 * Uses real filesystem stores, Orchestrator, ShellAdapter, ProcessManager,
 * PID lock, and child processes. The only external dependency is Node itself,
 * used as a deterministic short-lived shell workload.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFullContainer, type Container } from "../../src/container.js";
import { DEFAULT_CONFIG } from "../../src/domain/config.js";
import type { OrchestratorEvent } from "../../src/domain/events.js";
import { ConfigStore } from "../../src/infrastructure/storage/config-store.js";
import { closeAllAppendHandles } from "../../src/infrastructure/storage/fs-utils.js";
import { Paths } from "../../src/infrastructure/storage/paths.js";

async function waitFor<T>(
  predicate: () => Promise<T | null | undefined> | T | null | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `waitFor: predicate did not become truthy within ${timeoutMs}ms`,
  );
}

describe("scope scheduling — real runtime e2e", () => {
  let projectRoot: string;
  let container: Container | undefined;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "orch-scope-e2e-"));

    const paths = new Paths(projectRoot);
    const config = structuredClone(DEFAULT_CONFIG);
    config.project.name = "scope-e2e";
    config.defaults.agent.workspace_mode = "shared";
    config.scheduling.max_concurrent_agents = 4;
    config.scheduling.poll_interval_ms = 25;
    await new ConfigStore(paths).write(config);

    container = await buildFullContainer({
      projectRoot,
      json: false,
      quiet: true,
      noColor: true,
      ascii: true,
    });
  });

  afterEach(async () => {
    await container?.orchestrator.stop().catch(() => {});
    container?.eventBus.clear();
    closeAllAppendHandles();
    await fs.rm(projectRoot, { recursive: true, force: true });
    container = undefined;
  });

  it("serializes overlapping scopes while filling free slots with disjoint work", async () => {
    const runtime = container!;
    const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => console.log('scope-e2e-done'), 350)"`;

    for (let i = 1; i <= 4; i++) {
      await runtime.agentService.create({
        name: `scope-worker-${i}`,
        adapter: "shell",
        command,
        approval_policy: "auto",
        workspace_mode: "shared",
      });
    }

    // Priority fixes candidate order. This exercises both radix directions:
    // a shorter parent queried after a longer base, and a longer child queried
    // after its parent was added to the same tick-scoped index.
    const authChild = await runtime.taskService.create({
      title: "auth child first",
      priority: 1,
      scope: ["src/auth/private/credentials/**"],
      workspace_mode: "shared",
      max_attempts: 1,
    });
    const authParent = await runtime.taskService.create({
      title: "auth parent blocked",
      priority: 2,
      scope: ["src/auth/**"],
      workspace_mode: "shared",
      max_attempts: 1,
    });
    const dbParent = await runtime.taskService.create({
      title: "db parent first",
      priority: 3,
      scope: ["src/db/**"],
      workspace_mode: "shared",
      max_attempts: 1,
    });
    const dbChild = await runtime.taskService.create({
      title: "db child blocked",
      priority: 4,
      scope: ["src/db/pool.ts"],
      workspace_mode: "shared",
      max_attempts: 1,
    });

    const runToTask = new Map<string, string>();
    const trace: string[] = [];
    const overlapTaskIds = new Set<string>();
    const unsubscribe = runtime.eventBus.onAny((event: OrchestratorEvent) => {
      if (event.type === "agent:started") {
        runToTask.set(event.runId, event.taskId);
        trace.push(`started:${event.taskId}`);
      } else if (event.type === "agent:completed") {
        const taskId = runToTask.get(event.runId);
        if (taskId) trace.push(`completed:${taskId}`);
      } else if (event.type === "task:scope_overlap") {
        overlapTaskIds.add(event.taskId);
      }
    });

    try {
      await runtime.orchestrator.startWatch({ skipAutonomousSeeding: true });

      await waitFor(async () => {
        const tasks = await runtime.taskService.list();
        const targetIds = new Set([
          authChild.id,
          authParent.id,
          dbParent.id,
          dbChild.id,
        ]);
        const targets = tasks.filter((task) => targetIds.has(task.id));
        return targets.length === 4 &&
          targets.every((task) => task.status === "done")
          ? targets
          : null;
      });
    } finally {
      unsubscribe();
    }

    const startedAuthChild = trace.indexOf(`started:${authChild.id}`);
    const completedAuthChild = trace.indexOf(`completed:${authChild.id}`);
    const startedAuthParent = trace.indexOf(`started:${authParent.id}`);
    const startedDbParent = trace.indexOf(`started:${dbParent.id}`);
    const completedDbParent = trace.indexOf(`completed:${dbParent.id}`);
    const startedDbChild = trace.indexOf(`started:${dbChild.id}`);
    const completionIndexes = trace
      .map((entry, index) => (entry.startsWith("completed:") ? index : -1))
      .filter((index) => index >= 0);
    const firstCompletion = Math.min(...completionIndexes);

    expect(startedAuthChild).toBeGreaterThanOrEqual(0);
    expect(startedDbParent).toBeGreaterThanOrEqual(0);
    expect(startedAuthChild).toBeLessThan(firstCompletion);
    expect(startedDbParent).toBeLessThan(firstCompletion);

    // Each conflicting task starts only after the task whose scope blocked it.
    expect(completedAuthChild).toBeGreaterThan(startedAuthChild);
    expect(startedAuthParent).toBeGreaterThan(completedAuthChild);
    expect(completedDbParent).toBeGreaterThan(startedDbParent);
    expect(startedDbChild).toBeGreaterThan(completedDbParent);

    expect(overlapTaskIds).toEqual(new Set([authParent.id, dbChild.id]));

    const runs = await runtime.runService.listAll();
    expect(runs).toHaveLength(4);
    expect(runs.every((run) => run.status === "succeeded")).toBe(true);
    expect(new Set(runs.map((run) => run.task_id))).toEqual(
      new Set([authChild.id, authParent.id, dbParent.id, dbChild.id]),
    );

    for (const run of runs) {
      const events = await runtime.runService.readEvents(run.id);
      expect(events.some((event) => event.type === "agent_output")).toBe(true);
    }

    const taskFiles = (await fs.readdir(runtime.paths.tasksDir)).filter(
      (file) => file.endsWith(".yml"),
    );
    const runFiles = (await fs.readdir(runtime.paths.runsDir)).filter((file) =>
      file.endsWith(".json"),
    );
    const eventFiles = (await fs.readdir(runtime.paths.runsDir)).filter(
      (file) => file.endsWith(".jsonl"),
    );
    expect(taskFiles).toHaveLength(4);
    expect(runFiles).toHaveLength(4);
    expect(eventFiles).toHaveLength(4);
  }, 15_000);
});
