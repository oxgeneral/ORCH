import { AUTONOMOUS_LABEL, DEFAULT_SYSTEM_TEMPLATE, DEFAULT_USER_TEMPLATE, buildPromptContext } from './chunk-JLCWZ7UA.js';
import { sanitizeText, sanitizeForPersistence } from './chunk-3MEOFN6S.js';
import { createTokenUsage } from './chunk-GZVITBV7.js';
import { LockConflictError, WorkspaceError, TaskAlreadyRunningError, NoAgentsError, classifyAdapterError } from './chunk-IESAV453.js';
import { dirname } from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';

// src/domain/transitions.ts
var VALID_TRANSITIONS = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["review", "retrying", "failed", "cancelled"],
  retrying: ["in_progress", "failed", "cancelled"],
  review: ["done", "todo", "cancelled"],
  done: [],
  failed: ["todo", "retrying"],
  cancelled: ["todo"]
};
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function canTransition(from, to) {
  return VALID_TRANSITIONS[from].includes(to);
}
function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}
function isDispatchable(status) {
  return status === "todo" || status === "retrying";
}
function isBlocked(task, allTasks) {
  if (task.depends_on.length === 0) return false;
  if (allTasks instanceof Map) {
    return task.depends_on.some((depId) => {
      const dep = allTasks.get(depId);
      if (!dep) return false;
      return dep.status !== "done";
    });
  }
  return task.depends_on.some((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    if (!dep) return false;
    return dep.status !== "done";
  });
}
function resolveFailureStatus(task) {
  if (task.attempts < task.max_attempts) {
    return "retrying";
  }
  return "failed";
}
function resolveCompletionStatus(task, success, _autoApprove) {
  {
    return "review";
  }
}
function calculateRetryDelay(attempt, baseDelayMs, maxDelayMs) {
  const delay = baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, maxDelayMs);
}
function scopesOverlap(a, b) {
  if (!a?.length || !b?.length) return false;
  for (const pa of a) {
    for (const pb of b) {
      if (patternsOverlap(pa, pb)) return true;
    }
  }
  return false;
}
function computePatternInfo(pattern) {
  const base = pattern.split("*")[0];
  const isFile = !base.endsWith("/");
  const dir = isFile ? dirname(base) : "";
  return { raw: pattern, base, isFile, dir };
}
var ScopeIndex = class {
  entries;
  constructor(scopes) {
    this.entries = [];
    for (const scope of scopes) {
      if (scope?.length) {
        for (const p of scope) {
          this.entries.push(computePatternInfo(p));
        }
      }
    }
  }
  /** Returns true if the given scope overlaps with any pattern in the index. */
  overlapsAny(scope) {
    if (!scope?.length || this.entries.length === 0) return false;
    for (const raw of scope) {
      const info = computePatternInfo(raw);
      for (const entry of this.entries) {
        if (patternsOverlapInfo(info, entry)) return true;
      }
    }
    return false;
  }
  /** Add patterns to the index (e.g. from an approved candidate). */
  add(scope) {
    if (!scope?.length) return;
    for (const p of scope) {
      this.entries.push(computePatternInfo(p));
    }
  }
  get size() {
    return this.entries.length;
  }
};
function patternsOverlapInfo(a, b) {
  if (a.raw === b.raw) return true;
  if (a.base.startsWith(b.base) || b.base.startsWith(a.base)) return true;
  if (a.isFile && b.isFile) {
    return a.dir === b.dir && a.dir !== ".";
  }
  return false;
}
function patternsOverlap(a, b) {
  if (a === b) return true;
  const aBase = a.split("*")[0];
  const bBase = b.split("*")[0];
  if (aBase.startsWith(bBase) || bBase.startsWith(aBase)) return true;
  if (!aBase.endsWith("/") && !bBase.endsWith("/")) {
    const aDir = dirname(aBase);
    const bDir = dirname(bBase);
    return aDir === bDir && aDir !== ".";
  }
  return false;
}
var acquireMutex = Promise.resolve();
async function acquireLock(lockPath) {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const prev = acquireMutex;
  acquireMutex = gate;
  await prev;
  try {
    return await doAcquire(lockPath);
  } finally {
    release();
  }
}
var LOCK_STALE_MS = 6e4;
async function doAcquire(lockPath) {
  const existing = await readLockPid(lockPath);
  if (existing !== null) {
    if (isProcessAlive(existing)) {
      const stale = await isLockStaleByAge(lockPath);
      if (!stale) {
        return { acquired: false, pid: existing };
      }
    }
    await fs.unlink(lockPath).catch(() => {
    });
  }
  try {
    const fd = await fs.open(lockPath, "wx");
    await fd.writeFile(String(process.pid), "utf-8");
    await fd.close();
    return { acquired: true, pid: process.pid };
  } catch (err) {
    if (err.code === "EEXIST") {
      const pid = await readLockPid(lockPath);
      return { acquired: false, pid: pid ?? void 0 };
    }
    throw err;
  }
}
async function releaseLock(lockPath) {
  await fs.unlink(lockPath).catch(() => {
  });
}
async function touchLock(lockPath) {
  const now = Date.now() / 1e3;
  await fs.utimes(lockPath, now, now).catch(() => {
  });
}
async function readLockPid(lockPath) {
  try {
    const content = await fs.readFile(lockPath, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
async function isLockStaleByAge(lockPath) {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "EPERM") return true;
    return false;
  }
}

// src/infrastructure/storage/cached-stores.ts
var CachedTaskStore = class {
  constructor(inner) {
    this.inner = inner;
  }
  cache = /* @__PURE__ */ new Map();
  async list(filter) {
    const key = filter ? `${filter.status ?? ""}:${filter.goalId ?? ""}` : "__all__";
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const result = await this.inner.list(filter);
    this.cache.set(key, result);
    return result;
  }
  async get(id) {
    return this.inner.get(id);
  }
  async save(task) {
    await this.inner.save(task);
    this.cache.clear();
  }
  async delete(id) {
    await this.inner.delete(id);
    this.cache.clear();
  }
  invalidate() {
    this.cache.clear();
  }
};
var CachedAgentStore = class {
  constructor(inner) {
    this.inner = inner;
  }
  listCache = null;
  nameCache = /* @__PURE__ */ new Map();
  async list() {
    if (this.listCache) {
      return this.listCache;
    }
    const result = await this.inner.list();
    this.listCache = result;
    return result;
  }
  async get(id) {
    return this.inner.get(id);
  }
  async getByName(name) {
    if (this.nameCache.has(name)) {
      return this.nameCache.get(name) ?? null;
    }
    const result = await this.inner.getByName(name);
    this.nameCache.set(name, result);
    return result;
  }
  async save(agent) {
    await this.inner.save(agent);
    this.listCache = null;
    this.nameCache.clear();
  }
  async delete(id) {
    await this.inner.delete(id);
    this.listCache = null;
    this.nameCache.clear();
  }
  invalidate() {
    this.listCache = null;
    this.nameCache.clear();
  }
};
var CachedGoalStore = class {
  constructor(inner) {
    this.inner = inner;
  }
  cache = /* @__PURE__ */ new Map();
  async list(filter) {
    const key = filter?.status ?? "__all__";
    if (this.cache.has(key)) return this.cache.get(key);
    const result = await this.inner.list(filter);
    this.cache.set(key, result);
    return result;
  }
  async get(id) {
    return this.inner.get(id);
  }
  async save(goal) {
    await this.inner.save(goal);
    this.cache.clear();
  }
  async delete(id) {
    await this.inner.delete(id);
    this.cache.clear();
  }
  invalidate() {
    this.cache.clear();
  }
};
var CRITERION_COMMANDS = {
  test_pass: { cmd: "npm", args: ["test"] },
  typecheck: { cmd: "npx", args: ["tsc", "--noEmit"] },
  lint: { cmd: "npm", args: ["run", "lint"] }
};
var CRITERION_ORDER = ["typecheck", "lint", "test_pass"];
var ReviewRunner = class {
  cwd;
  timeoutMs;
  failFast;
  constructor(options) {
    this.cwd = options.cwd;
    this.timeoutMs = options.timeout_ms ?? 12e4;
    this.failFast = options.fail_fast ?? true;
  }
  /**
   * Run criteria in staged order (typecheck → lint → test).
   * In fail-fast mode (default), stops on first failure.
   */
  async runAll(criteria) {
    const sorted = sortCriteria(criteria);
    const results = [];
    for (const criterion of sorted) {
      const result = await this.runCriterion(criterion);
      results.push(result);
      if (this.failFast && !result.passed) break;
    }
    return results;
  }
  /**
   * Check if all results passed.
   */
  static allPassed(results) {
    return results.length > 0 && results.every((r) => r.passed);
  }
  /**
   * Format results into a human-readable report.
   */
  static formatReport(results) {
    const lines = results.map((r) => {
      const icon = r.passed ? "\u2713" : "\u2717";
      const truncated = r.output;
      return `${icon} ${r.criterion}: ${r.passed ? "PASSED" : "FAILED"}
  ${truncated}`;
    });
    return lines.join("\n\n");
  }
  runCriterion(criterion) {
    const { cmd, args } = CRITERION_COMMANDS[criterion];
    return new Promise((resolve) => {
      execFile(
        cmd,
        args,
        { cwd: this.cwd, timeout: this.timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = (stdout + "\n" + stderr).trim();
          resolve({
            criterion,
            passed: !error,
            output: output.slice(0, 2e3)
          });
        }
      );
    });
  }
};
function sortCriteria(criteria) {
  return [...criteria].sort((a, b) => {
    const ai = CRITERION_ORDER.indexOf(a);
    const bi = CRITERION_ORDER.indexOf(b);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
}

// src/application/orchestrator.ts
var MAX_EVENT_DATA_LEN = 8192;
var MAX_BUS_DATA_LEN = 4096;
var Orchestrator = class _Orchestrator {
  constructor(deps) {
    this.deps = deps;
    this.cachedTaskStore = new CachedTaskStore(deps.taskStore);
    this.cachedAgentStore = new CachedAgentStore(deps.agentStore);
    this.cachedGoalStore = deps.goalStore ? new CachedGoalStore(deps.goalStore) : null;
  }
  intervalId = null;
  shuttingDown = false;
  state = null;
  abortControllers = /* @__PURE__ */ new Map();
  cachedTaskStore;
  cachedAgentStore;
  cachedGoalStore;
  saveStateTimer = null;
  saveStateDirty = false;
  lockAcquired = false;
  consecutiveTickFailures = 0;
  maxConsecutiveTickFailures = 5;
  maxRetryQueueSize = 100;
  signalHandlers = [];
  immediateDispatchTimer = null;
  taskCreatedUnsub = null;
  tickInProgress = false;
  stoppedResolvers = [];
  /**
   * Track taskIds with an active collectEvents() background promise.
   * Reconcile skips PID-liveness and stall checks for these tasks because
   * the process may have exited cleanly but handleRunSuccess hasn't acquired
   * the mutex yet — false-positive "crash" / "stall" detection.
   */
  activeCollectors = /* @__PURE__ */ new Set();
  /** When true, `tick()` skips `seedAutonomousTasks()`. Set via `startWatch()` options. */
  skipAutonomousSeeding = false;
  /** Task IDs started via runTask; these must not trigger reactive dispatch of other tasks. */
  singleTaskRunIds = /* @__PURE__ */ new Set();
  /** Cooldown: track last auto-seed time per agent to prevent re-seed spam. */
  lastAutoSeedAt = /* @__PURE__ */ new Map();
  /** Minimum interval between auto-seed tasks for the same agent (30 seconds). */
  static AUTO_SEED_COOLDOWN_MS = 3e4;
  /** Promise-chain mutex to serialize critical state mutations. */
  stateMutex = Promise.resolve();
  /**
   * Check if this instance owns the lock (can mutate state).
   */
  get isOwner() {
    return this.lockAcquired;
  }
  /**
   * Serialize access to state mutations via a Promise-chain mutex.
   * Prevents concurrent tick/stop/reconcile from reading stale state.
   */
  withStateLock(fn) {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const prev = this.stateMutex;
    this.stateMutex = next;
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }
  /**
   * Run a single task by ID.
   * If watch mode is active (lock already held), dispatches inline via stateMutex.
   * Otherwise acquires a temporary lock for the duration of the run.
   */
  async runTask(taskId) {
    if (this.lockAcquired) {
      await this.freshDispatch(() => this.dispatchOnlyTask(taskId));
      return;
    }
    await this.withTemporaryLock(() => this.freshDispatch(() => this.dispatchOnlyTask(taskId)));
  }
  /**
   * Run all dispatchable tasks.
   * If watch mode is active (lock already held), dispatches inline via stateMutex.
   * Otherwise acquires a temporary lock for the duration of the run.
   */
  async runAll() {
    if (this.lockAcquired) {
      await this.freshDispatch(() => this.dispatchAll());
      return;
    }
    await this.withTemporaryLock(() => this.freshDispatch(() => this.dispatchAll()));
  }
  /**
   * Invalidate caches → loadState → run dispatch fn → saveState.
   * Shared by runTask, runAll, and immediateDispatch.
   */
  async freshDispatch(fn) {
    await this.withStateLock(async () => {
      this.cachedTaskStore.invalidate();
      this.cachedAgentStore.invalidate();
      await this.loadState();
      await this.cleanupStaleRunningEntries();
      await fn();
      await this.saveState();
    });
  }
  /**
   * Acquire lock, run fn, then release lock.
   * Used by single-shot commands (runTask, runAll) that don't go through startWatch.
   */
  async withTemporaryLock(fn) {
    const lockResult = await acquireLock(this.deps.lockPath);
    if (!lockResult.acquired) {
      throw new LockConflictError(lockResult.pid);
    }
    this.lockAcquired = true;
    try {
      await fn();
    } finally {
      this.lockAcquired = false;
      await releaseLock(this.deps.lockPath);
    }
  }
  /**
   * Start watch mode — continuous tick loop.
   * Acquires a PID lock to prevent multiple orchestrators.
   */
  async startWatch(opts) {
    this.skipAutonomousSeeding = opts?.skipAutonomousSeeding ?? false;
    const lockResult = await acquireLock(this.deps.lockPath);
    if (!lockResult.acquired) {
      throw new LockConflictError(lockResult.pid);
    }
    this.lockAcquired = true;
    await this.loadState();
    await this.cleanupStaleRunningEntries();
    this.state.pid = process.pid;
    this.state.started_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.saveState();
    this.registerSignalHandlers();
    this.taskCreatedUnsub = this.deps.eventBus.on("task:created", () => {
      this.scheduleImmediateDispatch();
    });
    await this.tick();
    this.intervalId = setInterval(
      () => this.tick().then(
        () => {
          this.consecutiveTickFailures = 0;
        },
        (err) => {
          this.consecutiveTickFailures++;
          const error = err instanceof Error ? err.message : String(err);
          this.deps.eventBus.emit({
            type: "orchestrator:error",
            error,
            context: "tick",
            fatal: this.consecutiveTickFailures >= this.maxConsecutiveTickFailures
          });
          if (this.consecutiveTickFailures >= this.maxConsecutiveTickFailures) {
            this.deps.eventBus.emit({
              type: "orchestrator:shutdown",
              reason: `${this.consecutiveTickFailures} consecutive tick failures`
            });
            this.stop().catch((err2) => {
              this.deps.eventBus.emit({ type: "orchestrator:error", error: err2 instanceof Error ? err2.message : String(err2), context: "stop after consecutive tick failures", fatal: false });
            });
          }
        }
      ),
      this.deps.config.scheduling.poll_interval_ms
    );
  }
  /**
   * Returns a promise that resolves when stop() completes.
   * Use in long-running modes (serve, run --watch) to keep the process alive.
   */
  waitForStop() {
    if (this.shuttingDown) return Promise.resolve();
    return new Promise((resolve) => {
      this.stoppedResolvers.push(resolve);
    });
  }
  /**
   * Register SIGINT/SIGTERM handlers for graceful shutdown.
   */
  registerSignalHandlers() {
    const handler = (signal) => {
      this.deps.eventBus.emit({
        type: "orchestrator:shutdown",
        reason: `Received ${signal}`
      });
      this.stop().catch((err) => {
        this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `stop after ${signal} signal`, fatal: false });
      });
    };
    for (const sig of ["SIGINT", "SIGTERM"]) {
      const bound = () => handler(sig);
      this.signalHandlers.push([sig, bound]);
      process.on(sig, bound);
    }
  }
  /**
   * Remove signal handlers to avoid listener leaks.
   */
  removeSignalHandlers() {
    for (const [sig, handler] of this.signalHandlers) {
      process.removeListener(sig, handler);
    }
    this.signalHandlers = [];
  }
  /**
   * Stop the watch loop and clean up.
   */
  async stop() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.taskCreatedUnsub) {
      this.taskCreatedUnsub();
      this.taskCreatedUnsub = null;
    }
    if (this.immediateDispatchTimer) {
      clearTimeout(this.immediateDispatchTimer);
      this.immediateDispatchTimer = null;
    }
    await this.flushStateLazy();
    await this.withStateLock(async () => {
      if (this.state) {
        for (const [taskId, entry] of Object.entries(this.state.running)) {
          this.abortControllers.get(taskId)?.abort();
          this.abortControllers.delete(taskId);
          await this.deps.processManager.killWithGrace(entry.pid);
          await this.deps.runService.finish(entry.run_id, "cancelled");
          const task = await this.deps.taskStore.get(taskId);
          if (task) {
            await this.deps.taskService.updateStatus(taskId, resolveFailureStatus(task));
          }
          await this.deps.agentService.setStatus(entry.agent_id, "idle");
        }
        this.state.running = {};
        this.state.claimed = /* @__PURE__ */ new Set();
        this.state.pid = void 0;
        this.state.started_at = void 0;
        await this.saveState();
      }
    });
    if (this.lockAcquired) {
      await releaseLock(this.deps.lockPath);
      this.lockAcquired = false;
    }
    this.removeSignalHandlers();
    for (const resolve of this.stoppedResolvers) resolve();
    this.stoppedResolvers = [];
  }
  /**
   * Cancel a running task: kill agent process, clean state, mark cancelled.
   * Acquires lock if not already owned (standalone CLI invocation).
   */
  async cancelTask(taskId) {
    if (!this.lockAcquired) {
      return this.withTemporaryLock(() => this.cancelTask(taskId));
    }
    await this.withStateLock(async () => {
      await this.loadState();
      const state = this.state;
      const entry = state.running[taskId];
      if (entry) {
        this.abortControllers.get(taskId)?.abort();
        this.abortControllers.delete(taskId);
        await this.deps.processManager.killWithGrace(entry.pid, 3e3).catch((err) => {
          this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `cancelTask kill process ${entry.pid} for task ${taskId}`, fatal: false });
        });
        await this.deps.runService.finish(entry.run_id, "cancelled").catch((err) => {
          this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `cancelTask finish run ${entry.run_id}`, fatal: false });
        });
        await this.deps.agentService.setStatus(entry.agent_id, "idle").catch((err) => {
          this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `cancelTask setStatus idle for agent ${entry.agent_id}`, fatal: false });
        });
        delete state.running[taskId];
        await this.saveState();
      }
      state.retry_queue = state.retry_queue.filter((r) => r.task_id !== taskId);
      try {
        await this.deps.taskService.cancel(taskId);
      } catch {
        try {
          await this.deps.taskService.updateStatus(taskId, "cancelled");
        } catch {
        }
      }
      await this.saveState();
    });
  }
  /**
   * Force-stop a specific agent: kill process, clean state, release agent.
   * Acquires lock if not already owned (standalone CLI invocation).
   */
  async forceStopAgent(agentId) {
    if (!this.lockAcquired) {
      return this.withTemporaryLock(() => this.forceStopAgent(agentId));
    }
    await this.withStateLock(async () => {
      await this.loadState();
      const state = this.state;
      for (const [taskId, entry] of Object.entries(state.running)) {
        if (entry.agent_id === agentId) {
          this.abortControllers.get(taskId)?.abort();
          this.abortControllers.delete(taskId);
          await this.deps.processManager.killWithGrace(entry.pid, 3e3);
          await this.deps.runService.finish(entry.run_id, "cancelled");
          try {
            await this.deps.taskService.updateStatus(taskId, "failed");
          } catch {
          }
          delete state.running[taskId];
        }
      }
      await this.deps.agentService.setStatus(agentId, "idle");
      await this.saveState();
    });
  }
  /**
   * Single tick: Reconcile → Dispatch → Collect
   * Serialized via mutex to prevent concurrent ticks from racing on state.
   */
  async tick() {
    if (this.shuttingDown) return;
    this.tickInProgress = true;
    try {
      await this.withStateLock(async () => {
        if (this.shuttingDown) return;
        this.cachedTaskStore.invalidate();
        this.cachedAgentStore.invalidate();
        this.cachedGoalStore?.invalidate();
        await this.loadState();
        await this.reconcile();
        if (!this.skipAutonomousSeeding) {
          await this.seedAutonomousTasks();
        }
        await this.dispatchAll();
        const tasks = await this.cachedTaskStore.list();
        const running = Object.keys(this.state.running).length;
        const queued = tasks.filter((t) => isDispatchable(t.status)).length;
        this.deps.eventBus.emit({
          type: "orchestrator:tick",
          running,
          queued
        });
      });
      await touchLock(this.deps.lockPath);
    } finally {
      this.tickInProgress = false;
    }
  }
  /**
   * Schedule an immediate dispatch with 500ms debounce.
   * Called on task:created to avoid waiting for the next 30s tick.
   * Retries up to 10 times (5s) if a tick is in progress.
   */
  scheduleImmediateDispatch(retries = 0) {
    if (this.shuttingDown) return;
    if (this.immediateDispatchTimer) return;
    this.immediateDispatchTimer = setTimeout(() => {
      this.immediateDispatchTimer = null;
      if (this.shuttingDown) return;
      if (this.tickInProgress) {
        if (retries < 10) this.scheduleImmediateDispatch(retries + 1);
        return;
      }
      this.immediateDispatch().catch((err) => {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: err instanceof Error ? err.message : String(err),
          context: "immediate dispatch on task:created",
          fatal: false
        });
      });
    }, 500);
  }
  /**
   * Mini-tick: invalidate caches → loadState → dispatchAll → saveState.
   * Skips reconcile/collect — only dispatches new tasks immediately.
   */
  async immediateDispatch() {
    if (this.shuttingDown) return;
    if (this.singleTaskRunIds.size > 0) return;
    await this.freshDispatch(() => this.shuttingDown ? Promise.resolve() : this.dispatchAll());
  }
  /**
   * Reconcile: check PID liveness, detect stalls, process retry queue.
   */
  async reconcile() {
    const state = this.state;
    const now = Date.now();
    const runningEntries = Object.entries(state.running);
    const [runningTaskData, runningAgentData] = await Promise.all([
      Promise.all(runningEntries.map(([taskId]) => this.deps.taskStore.get(taskId))),
      Promise.all(runningEntries.map(([, entry]) => this.deps.agentStore.get(entry.agent_id)))
    ]);
    for (let i = 0; i < runningEntries.length; i++) {
      const [taskId, entry] = runningEntries[i];
      const taskData = runningTaskData[i];
      if (!taskData || isTerminal(taskData.status)) {
        this.abortControllers.delete(taskId);
        delete state.running[taskId];
        await this.deps.agentService.setStatus(entry.agent_id, "idle").catch((err) => {
          this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `reconcile setStatus idle for stale agent ${entry.agent_id} (task ${taskId})`, fatal: false });
        });
        continue;
      }
      if (this.activeCollectors.has(taskId)) {
        continue;
      }
      if (!this.deps.processManager.isAlive(entry.pid)) {
        try {
          await this._handleRunFailure(taskId, entry, "Process crashed unexpectedly");
        } catch {
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, "idle").catch((err) => {
            this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `reconcile crash fallback setStatus idle for agent ${entry.agent_id} (task ${taskId})`, fatal: false });
          });
        }
        continue;
      }
      const lastEventAt = new Date(entry.last_event_at).getTime();
      const agentForStall = runningAgentData[i];
      const stallTimeout = agentForStall?.config.stall_timeout_ms ?? this.deps.config.defaults.agent.stall_timeout_ms;
      if (now - lastEventAt > stallTimeout) {
        this.deps.eventBus.emit({
          type: "orchestrator:stall_detected",
          runId: entry.run_id
        });
        this.abortControllers.get(taskId)?.abort();
        await this.deps.processManager.killWithGrace(entry.pid, 5e3);
        try {
          await this._handleRunFailure(taskId, entry, "Agent stalled (no events)");
        } catch {
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, "idle").catch((err) => {
            this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `reconcile stall fallback setStatus idle for agent ${entry.agent_id} (task ${taskId})`, fatal: false });
          });
        }
      }
    }
    const runningAgentIds = new Set(Object.values(state.running).map((e) => e.agent_id));
    const [allAgents, allTasks] = await Promise.all([
      this.cachedAgentStore.list(),
      this.cachedTaskStore.list()
    ]);
    const staleAgents = allAgents.filter(
      (a) => a.status === "running" && !runningAgentIds.has(a.id)
    );
    if (staleAgents.length > 0) {
      await Promise.all(
        staleAgents.map((agent) => this.deps.agentService.setStatus(agent.id, "idle"))
      );
    }
    const orphanedTasks = allTasks.filter(
      (t) => t.status === "in_progress" && !state.running[t.id]
    );
    if (orphanedTasks.length > 0) {
      await Promise.all(
        orphanedTasks.map(async (task) => {
          try {
            await this.deps.taskService.updateStatus(task.id, "failed");
          } catch {
            task.status = "failed";
            task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
            await this.deps.taskStore.save(task).catch((err) => {
              this.deps.eventBus.emit({
                type: "orchestrator:error",
                error: err instanceof Error ? err.message : String(err),
                context: `force-write orphaned task ${task.id}`,
                fatal: false
              });
            });
          }
          this.deps.eventBus.emit({
            type: "task:orphaned",
            taskId: task.id
          });
        })
      );
    }
    const dueRetries = [];
    state.retry_queue = state.retry_queue.filter((retry) => {
      if (now >= new Date(retry.due_at).getTime()) {
        dueRetries.push(retry.task_id);
        return false;
      }
      return true;
    });
    for (const taskId of dueRetries) {
      const retryTask = await this.deps.taskStore.get(taskId);
      if (!retryTask || !isDispatchable(retryTask.status)) continue;
      await this.dispatchTask(taskId, retryTask);
    }
    await this.saveState();
  }
  /**
   * Create tasks for autonomous agents that have no active work.
   *
   * Priority: active Goals assigned to the agent come first.
   * If no goals, falls back to role-based autonomous work.
   */
  async seedAutonomousTasks() {
    const agents = await this.cachedAgentStore.list();
    const autonomousAgents = agents.filter(
      (a) => a.autonomous && a.status === "idle"
    );
    if (autonomousAgents.length === 0) return;
    const allTasks = await this.cachedTaskStore.list();
    const activeGoals = this.cachedGoalStore ? await this.cachedGoalStore.list({ status: "active" }) : [];
    let anyCreated = false;
    const claimedGoalIds = /* @__PURE__ */ new Set();
    for (const agent of autonomousAgents) {
      const hasActiveTask = allTasks.some(
        (t) => t.assignee === agent.id && !isTerminal(t.status)
      );
      if (hasActiveTask) continue;
      const lastSeed = this.lastAutoSeedAt.get(agent.id) ?? 0;
      if (Date.now() - lastSeed < _Orchestrator.AUTO_SEED_COOLDOWN_MS) continue;
      const goal = activeGoals.find(
        (g) => g.assignee === agent.id && !claimedGoalIds.has(g.id)
      ) ?? activeGoals.find(
        (g) => !g.assignee && !claimedGoalIds.has(g.id)
      );
      if (goal) claimedGoalIds.add(goal.id);
      const role = agent.role ?? "general assistant";
      const title = goal ? `[auto] ${agent.name}: ${goal.title.slice(0, 60)}` : `[auto] ${agent.name}: ${role.slice(0, 60)}`;
      const description = goal ? `## GOAL (highest priority)

${goal.description || goal.title}

---
Agent role: ${role}` : `Autonomous work cycle. Agent role: ${role}`;
      try {
        await this.deps.taskService.create({
          title,
          description,
          assignee: agent.id,
          labels: [AUTONOMOUS_LABEL],
          priority: 3,
          goalId: goal?.id
        });
        this.lastAutoSeedAt.set(agent.id, Date.now());
        anyCreated = true;
      } catch (err) {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: err instanceof Error ? err.message : String(err),
          context: `autonomous task for agent ${agent.id}`,
          fatal: false
        });
      }
    }
    if (anyCreated) this.cachedTaskStore.invalidate();
  }
  /**
   * Dispatch all dispatchable tasks up to max_concurrent_agents.
   */
  async dispatchAll() {
    const state = this.state;
    const maxConcurrent = this.deps.config.scheduling.max_concurrent_agents;
    const currentRunning = Object.keys(state.running).length;
    const availableSlots = maxConcurrent - currentRunning;
    if (availableSlots <= 0) return;
    const allTasks = await this.cachedTaskStore.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const candidates = allTasks.filter(
      (t) => isDispatchable(t.status) && !isBlocked(t, taskMap) && !state.running[t.id] && !state.claimed.has(t.id)
    ).sort((a, b) => {
      const priDiff = (a.priority ?? 3) - (b.priority ?? 3);
      if (priDiff !== 0) return priDiff;
      const goalDiff = (a.goalId ? 0 : 1) - (b.goalId ? 0 : 1);
      if (goalDiff !== 0) return goalDiff;
      const bTime = b.updated_at ?? "";
      const aTime = a.updated_at ?? "";
      return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
    }).slice(0, availableSlots);
    const blockedIds = /* @__PURE__ */ new Set();
    const inProgressScoped = allTasks.filter((t) => t.status === "in_progress" && t.scope?.length);
    const scopeIndex = new ScopeIndex(inProgressScoped.map((t) => t.scope));
    for (const candidate of candidates) {
      if (!candidate.scope?.length) continue;
      if (scopeIndex.overlapsAny(candidate.scope)) {
        const overlapper = inProgressScoped.find((t) => scopesOverlap(candidate.scope, t.scope));
        this.deps.eventBus.emit({
          type: "task:scope_overlap",
          taskId: candidate.id,
          overlappingTaskId: overlapper?.id ?? candidate.id,
          patterns: candidate.scope
        });
        blockedIds.add(candidate.id);
      } else {
        scopeIndex.add(candidate.scope);
      }
    }
    for (const task of candidates) {
      if (blockedIds.has(task.id)) continue;
      try {
        await this.dispatchTask(task.id);
      } catch (err) {
        if (err instanceof WorkspaceError) {
          try {
            const t = await this.deps.taskStore.get(task.id);
            if (t && !isTerminal(t.status)) {
              const withAttempt = { ...t, attempts: (t.attempts ?? 0) + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() };
              const nextStatus = resolveFailureStatus(withAttempt);
              const updated = { ...withAttempt, status: nextStatus };
              await this.deps.taskStore.save(updated);
              if (nextStatus === "failed") {
                const patchedTasks = allTasks.map((at) => at.id === updated.id ? updated : at);
                this.cachedTaskStore.invalidate();
                await this.cascadeFailDependents(updated.id, patchedTasks, sanitizeText(`dependency ${updated.id} failed: ${err.message}`));
              } else {
                const delay = calculateRetryDelay(
                  updated.attempts - 1,
                  this.deps.config.scheduling.retry_base_delay_ms,
                  this.deps.config.scheduling.retry_max_delay_ms
                );
                this.enqueueRetry(state, updated.id, updated.attempts, delay, sanitizeText(err.message));
                await this.saveState();
              }
            }
          } catch {
          }
        }
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: sanitizeText(err instanceof Error ? err.message : String(err)),
          context: `dispatch task ${task.id}`,
          fatal: false
        });
      }
    }
  }
  /**
   * Dispatch exactly one requested task.
   *
   * A single-shot CLI command (`orch run <task-id>`) should not opportunistically
   * consume other ready tasks while the requested run is being collected.
   * Temporarily claiming other dispatchable tasks keeps the shared dispatch path
   * focused without changing watch/run-all semantics.
   */
  async dispatchOnlyTask(taskId) {
    const state = this.state;
    const originalClaimed = new Set(state.claimed);
    const allTasks = await this.cachedTaskStore.list();
    this.singleTaskRunIds.add(taskId);
    for (const task of allTasks) {
      if (task.id !== taskId && isDispatchable(task.status)) {
        state.claimed.add(task.id);
      }
    }
    try {
      await this.dispatchTask(taskId);
    } finally {
      state.claimed = originalClaimed;
      if (!state.running[taskId]) {
        this.singleTaskRunIds.delete(taskId);
      }
      await this.saveState();
    }
  }
  /** Dedup + bounded push onto the retry queue. */
  enqueueRetry(state, taskId, attempt, delay, error) {
    if (state.retry_queue.some((r) => r.task_id === taskId)) return;
    if (state.retry_queue.length >= this.maxRetryQueueSize) {
      state.retry_queue.shift();
    }
    state.retry_queue.push({
      task_id: taskId,
      attempt,
      due_at: new Date(Date.now() + delay).toISOString(),
      error: sanitizeText(error)
    });
  }
  /**
   * When a task permanently fails, cascade-fail all tasks that depend on it
   * (directly or transitively). Prevents dependent tasks from hanging as TODO forever.
   */
  async cascadeFailDependents(failedTaskId, allTasks, reason) {
    const reverseDeps = /* @__PURE__ */ new Map();
    for (const t of allTasks) {
      for (const dep of t.depends_on) {
        let arr = reverseDeps.get(dep);
        if (!arr) {
          arr = [];
          reverseDeps.set(dep, arr);
        }
        arr.push(t);
      }
    }
    const queue = [failedTaskId];
    let head = 0;
    const visited = /* @__PURE__ */ new Set();
    let cascadedAny = false;
    while (head < queue.length) {
      const parentId = queue[head++];
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      const dependents = reverseDeps.get(parentId);
      if (!dependents) continue;
      const toFail = [];
      for (const t of dependents) {
        if (isTerminal(t.status) || visited.has(t.id)) continue;
        toFail.push({ task: t, previousStatus: t.status });
        queue.push(t.id);
      }
      if (toFail.length === 0) continue;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await Promise.all(toFail.map(
        ({ task }) => this.deps.taskStore.save({ ...task, status: "failed", updated_at: now })
      ));
      for (const { task, previousStatus } of toFail) {
        this.deps.eventBus.emit({
          type: "task:status_changed",
          taskId: task.id,
          from: previousStatus,
          to: "failed"
        });
        this.deps.eventBus.emit({
          type: "task:cascade_failed",
          taskId: task.id,
          failedDependencyId: failedTaskId,
          reason
        });
      }
      cascadedAny = true;
    }
    if (cascadedAny) {
      this.cachedTaskStore.invalidate();
    }
  }
  /**
   * Dispatch a single task: claim → assign → execute.
   */
  async dispatchTask(taskId, prefetched) {
    const state = this.state;
    if (state.running[taskId]) {
      const entry = state.running[taskId];
      throw new TaskAlreadyRunningError(taskId, entry.run_id, entry.agent_id);
    }
    const task = prefetched ?? await this.deps.taskService.get(taskId);
    if (!isDispatchable(task.status)) {
      return;
    }
    state.claimed.add(taskId);
    await this.saveState();
    try {
      const allAgents = await this.cachedAgentStore.list();
      const agent = await this.deps.agentService.findBestAgent(task);
      if (!agent) {
        if (allAgents.length === 0) {
          throw new NoAgentsError();
        }
        this.unclaim(taskId);
        await this.saveState();
        return;
      }
      const { path: workspacePath, branch: worktreeBranch } = await this.deps.workspaceManager.prepare(
        task,
        agent,
        this.deps.config
      );
      const systemTemplate = this.deps.config.prompt?.system_template ?? DEFAULT_SYSTEM_TEMPLATE;
      const userTemplate = this.deps.config.prompt?.user_template ?? DEFAULT_USER_TEMPLATE;
      const legacyTemplate = this.deps.config.prompt?.template;
      const attempt = task.attempts + 1;
      let retryContext;
      if (attempt > 1) {
        const failedData = await this.deps.runService.getLastFailedRunContext(task.id);
        if (failedData) {
          retryContext = {
            previous_error: failedData.error,
            previous_output: failedData.output
          };
        }
      }
      const goalId = task.goalId;
      const [sharedContext, pendingMessages, goalRaw] = await Promise.all([
        this.deps.contextStore?.getAll(),
        this.deps.messageService ? this.deps.messageService.drainMailbox(agent.id, task.id) : [],
        goalId && this.cachedGoalStore ? this.cachedGoalStore.get(goalId).catch(() => null) : null
      ]);
      let goalContext;
      if (goalRaw) {
        const allTasks = await this.cachedTaskStore.list();
        const goalTasks = allTasks.filter((t) => t.goalId === goalId);
        const progressEntry = await this.deps.contextStore?.get(`${goalId}-progress`);
        const taskNames = goalTasks.map((t) => `[${t.status}] ${t.title}`);
        goalContext = {
          id: goalRaw.id,
          title: goalRaw.title,
          description: goalRaw.description,
          status: goalRaw.status,
          task_names: taskNames,
          progress: progressEntry?.value
        };
      }
      const context = buildPromptContext(
        task,
        agent,
        attempt,
        workspacePath,
        this.deps.config,
        { allAgents, retryContext, sharedContext, feedback: task.feedback, messages: pendingMessages.length ? pendingMessages : void 0, goal: goalContext }
      );
      let prompt;
      let systemPrompt;
      if (legacyTemplate) {
        prompt = await this.deps.templateEngine.render(legacyTemplate, context);
      } else {
        systemPrompt = await this.deps.templateEngine.render(systemTemplate, context);
        prompt = await this.deps.templateEngine.render(userTemplate, context);
      }
      if (this.deps.skillLoader && agent.config.skills?.length) {
        const skillBlock = await this.deps.skillLoader.loadSkills(agent.config.skills);
        if (skillBlock) {
          if (systemPrompt !== void 0) {
            systemPrompt = systemPrompt + "\n\n" + skillBlock;
          } else {
            prompt = prompt + "\n\n" + skillBlock;
          }
        }
      }
      const run = await this.deps.runService.create({
        taskId: task.id,
        agentId: agent.id,
        attempt,
        prompt,
        workspacePath,
        persistPrompt: this.deps.config.execution.security.persist_prompts
      });
      if (task.status === "failed" || task.status === "cancelled") {
        await this.deps.taskService.retry(taskId);
        task.status = "todo";
        task.attempts = 0;
      }
      await this.deps.taskService.updateStatus(taskId, "in_progress");
      await this.deps.taskService.assign(taskId, agent.id);
      await this.deps.taskService.incrementAttempts(taskId);
      if (worktreeBranch) {
        const freshTask = await this.deps.taskStore.get(taskId);
        if (freshTask) {
          freshTask.proof = { ...freshTask.proof ?? { files_changed: [] }, branch: worktreeBranch };
          freshTask.workspace = workspacePath;
          await this.deps.taskStore.save(freshTask);
        }
      }
      await this.deps.agentService.setStatus(agent.id, "running");
      const agentData = await this.deps.agentService.get(agent.id);
      agentData.current_task = taskId;
      agentData.last_error = void 0;
      await this.deps.agentStore.save(agentData);
      const adapter = this.deps.adapterRegistry.require(agent.adapter);
      const abortController = new AbortController();
      this.abortControllers.set(taskId, abortController);
      const handle = adapter.execute({
        prompt,
        systemPrompt,
        workspace: workspacePath,
        env: {
          ...agent.config.env,
          ORCH_AGENT_ID: agent.id,
          ORCH_AGENT_NAME: agent.name,
          ORCH_TASK_ID: task.id
        },
        config: agentData.config,
        security: {
          allowPermissionBypass: this.deps.config.execution.security.allow_permission_bypass,
          allowShellAdapter: this.deps.config.execution.security.allow_shell_adapter
        },
        signal: abortController.signal
      });
      const agentPid = handle.pid;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await this.deps.runService.start(run.id, agentPid);
      this.unclaim(taskId);
      state.running[taskId] = {
        run_id: run.id,
        agent_id: agent.id,
        task_id: taskId,
        pid: agentPid,
        started_at: now,
        last_event_at: now
      };
      await this.saveState();
      this.activeCollectors.add(taskId);
      this.collectEvents(
        handle.events,
        run.id,
        taskId,
        agent.id
      ).catch((err) => {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: err instanceof Error ? err.message : String(err),
          context: `adapter execution for ${taskId}`,
          fatal: false
        });
      }).finally(() => {
        this.activeCollectors.delete(taskId);
      });
    } catch (err) {
      this.abortControllers.delete(taskId);
      this.unclaim(taskId);
      await this.saveState();
      throw err;
    }
  }
  /**
   * Collect events from an adapter's async generator.
   */
  async collectEvents(generator, runId, taskId, agentId) {
    let collectedTokens;
    let resultText;
    let lastAgentMessage;
    let lastErrorKind;
    const filesChangedSet = /* @__PURE__ */ new Set();
    try {
      for await (const event of generator) {
        if (this.shuttingDown) break;
        if (event.type === "done") {
          if (event.tokens) {
            const { input, output, reasoning, cache_read, cache_write } = event.tokens;
            collectedTokens = createTokenUsage(input, output, { reasoning, cache_read, cache_write });
          }
          const data = event.data;
          if (data && typeof data.result === "string") {
            resultText = data.result;
          }
        }
        if (event.type === "output") {
          const data = event.data;
          if (data) {
            const text = typeof data.text === "string" ? data.text : typeof data.message === "string" ? data.message : void 0;
            if (text?.trim()) lastAgentMessage = text;
          }
        }
        if (event.type === "file_change") {
          const data = event.data;
          if (data && Array.isArray(data.paths)) {
            for (const p of data.paths) {
              if (typeof p === "string") filesChangedSet.add(p);
            }
          } else {
            const filePath2 = data && typeof data.path === "string" ? data.path : typeof event.data === "string" ? event.data : String(event.data);
            filesChangedSet.add(filePath2);
          }
        }
        let toolCallFilePath = null;
        if (event.type === "tool_call") {
          const data = event.data;
          if (data) {
            const toolInput = data.input;
            const toolName = typeof data.name === "string" ? data.name : "";
            if (toolInput && typeof toolInput.file_path === "string") {
              if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(toolName)) {
                toolCallFilePath = toolInput.file_path;
                filesChangedSet.add(toolCallFilePath);
              }
            }
          }
        }
        const eventTimestamp = isValidISOTimestamp(event.timestamp) ? event.timestamp : (/* @__PURE__ */ new Date()).toISOString();
        const filePath = event.type === "file_change" ? (() => {
          const d = event.data;
          return d && typeof d.path === "string" ? d.path : typeof event.data === "string" ? event.data : String(event.data);
        })() : null;
        const serialized = serializeEventData(sanitizeForPersistence(event.data), MAX_EVENT_DATA_LEN);
        event.data = void 0;
        const runEvent = {
          timestamp: eventTimestamp,
          type: event.type === "output" ? "agent_output" : event.type === "file_change" ? "file_changed" : event.type === "command" ? "command_run" : event.type === "tool_call" ? "tool_call" : event.type === "error" ? "error" : "done",
          data: serialized
        };
        await this.deps.runService.appendEvent(runId, runEvent);
        if (this.state?.running[taskId]) {
          this.state.running[taskId].last_event_at = eventTimestamp;
          this.saveStateLazy();
        }
        const busData = serializeEventData(serialized, MAX_BUS_DATA_LEN);
        if (event.type === "output" || event.type === "tool_call") {
          this.deps.eventBus.emit({
            type: "agent:output",
            runId,
            agentId,
            data: busData
          });
          if (toolCallFilePath) {
            this.deps.eventBus.emit({
              type: "agent:file_changed",
              runId,
              agentId,
              path: toolCallFilePath
            });
          }
        } else if (event.type === "file_change") {
          this.deps.eventBus.emit({
            type: "agent:file_changed",
            runId,
            agentId,
            path: filePath
          });
        } else if (event.type === "error") {
          if (event.errorKind) lastErrorKind = event.errorKind;
          this.deps.eventBus.emit({
            type: "agent:error",
            runId,
            agentId,
            error: busData,
            ...event.errorKind ? { errorKind: event.errorKind } : {}
          });
        }
      }
      const finalResult = resultText ?? lastAgentMessage;
      await this.handleRunSuccess(taskId, runId, agentId, collectedTokens, finalResult, [...filesChangedSet]);
    } catch (err) {
      const error = sanitizeText(err instanceof Error ? err.message : String(err));
      const errorKind = lastErrorKind ?? (err instanceof Error ? err.errorKind : void 0);
      const entry = this.state?.running[taskId];
      if (entry) {
        await this.handleRunFailure(taskId, entry, error, errorKind);
      } else {
        await this.deps.runService.finish(runId, "failed", void 0, error).catch(() => {
        });
      }
    } finally {
      this.deps.runStore.closeRunEvents(runId);
    }
  }
  async handleRunSuccess(taskId, runId, agentId, tokens, resultText, filesChanged) {
    return this.withStateLock(() => this._handleRunSuccess(taskId, runId, agentId, tokens, resultText, filesChanged));
  }
  async _handleRunSuccess(taskId, runId, agentId, tokens, resultText, filesChanged) {
    await this.flushStateLazy();
    this.abortControllers.delete(taskId);
    const state = this.state;
    if (!state.running[taskId]) return;
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;
    let effectiveFilesChanged = filesChanged;
    if ((!effectiveFilesChanged || effectiveFilesChanged.length === 0) && task.proof?.branch) {
      effectiveFilesChanged = await this.deps.workspaceManager.getChangedFiles(task.proof.branch);
    }
    task.proof = {
      ...task.proof,
      agent_summary: resultText ? sanitizeText(resultText).slice(0, 2e3) : task.proof?.agent_summary,
      files_changed: effectiveFilesChanged?.length ? effectiveFilesChanged : task.proof?.files_changed ?? []
    };
    delete task.feedback;
    await this.deps.taskStore.save(task);
    const agent = await this.deps.agentStore.get(agentId);
    const isAutonomousTask = task.labels?.includes(AUTONOMOUS_LABEL);
    const autoApprove = isAutonomousTask || agent?.config.approval_policy === "auto";
    const newStatus = resolveCompletionStatus();
    await this.deps.runService.finish(runId, "succeeded", tokens);
    const runningEntry = state.running[taskId];
    const successRuntimeMs = runningEntry ? Date.now() - new Date(runningEntry.started_at).getTime() : 0;
    if (runningEntry) {
      state.stats.total_runtime_ms += successRuntimeMs;
    }
    delete state.running[taskId];
    const statsUpdate = {
      tasks_completed: (agent?.stats.tasks_completed ?? 0) + 1,
      total_runs: (agent?.stats.total_runs ?? 0) + 1,
      total_runtime_ms: (agent?.stats.total_runtime_ms ?? 0) + successRuntimeMs
    };
    if (tokens) {
      statsUpdate.tokens_used = (agent?.stats.tokens_used ?? 0) + tokens.total;
    }
    await this.deps.agentService.updateStats(agentId, statsUpdate).catch((err) => {
      this.deps.eventBus.emit({
        type: "orchestrator:error",
        error: err instanceof Error ? err.message : String(err),
        context: `agent stats update for ${agentId}`,
        fatal: false
      });
    });
    state.stats.total_tasks_completed++;
    state.stats.total_runs++;
    if (tokens) {
      state.stats.total_tokens.input += tokens.input;
      state.stats.total_tokens.output += tokens.output;
      state.stats.total_tokens.reasoning += tokens.reasoning;
      state.stats.total_tokens.cache_read += tokens.cache_read;
      state.stats.total_tokens.cache_write += tokens.cache_write;
      state.stats.total_tokens.total = state.stats.total_tokens.input + state.stats.total_tokens.output + state.stats.total_tokens.reasoning;
    }
    if (task.proof?.branch) {
      try {
        const mergeResult = await this.deps.workspaceManager.mergeBack(task.proof.branch);
        if (mergeResult.success) {
          this.deps.eventBus.emit({
            type: "workspace:merge_succeeded",
            taskId,
            branch: task.proof.branch
          });
          await this.deps.workspaceManager.cleanup(taskId, task.proof.branch).catch((err) => {
            this.deps.eventBus.emit({
              type: "orchestrator:error",
              error: err instanceof Error ? err.message : String(err),
              context: `workspace cleanup for ${taskId}`,
              fatal: false
            });
          });
        } else {
          this.deps.eventBus.emit({
            type: "workspace:merge_conflict",
            taskId,
            branch: task.proof.branch,
            conflictInfo: mergeResult.conflictInfo
          });
          await this.forceTaskToReview(task, agentId, `MERGE CONFLICT: ${mergeResult.conflictInfo}`);
          return;
        }
      } catch (err) {
        const error = sanitizeText(err instanceof Error ? err.message : String(err));
        await this.forceTaskToReview(task, agentId, `MERGE ERROR: ${error}`);
        return;
      }
    }
    try {
      await this.deps.taskService.updateStatus(taskId, newStatus);
    } catch (validationErr) {
      const error = validationErr instanceof Error ? validationErr.message : String(validationErr);
      this.deps.eventBus.emit({
        type: "orchestrator:error",
        error,
        context: `state machine validation failed for task ${taskId} -> ${newStatus}, force-writing`,
        fatal: false
      });
      task.status = newStatus;
      task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
      await this.deps.taskStore.save(task).catch((saveErr) => {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: saveErr instanceof Error ? saveErr.message : String(saveErr),
          context: `force-write task ${taskId} to store failed`,
          fatal: false
        });
      });
    }
    await this.deps.agentService.setStatus(agentId, "idle").catch((err) => {
      this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `_handleRunSuccess setStatus idle for agent ${agentId}`, fatal: false });
    });
    const agentAfter = await this.deps.agentStore.get(agentId);
    if (agentAfter) {
      agentAfter.current_task = void 0;
      await this.deps.agentStore.save(agentAfter);
    }
    if (newStatus === "review" && task.review_criteria?.length) {
      await this.runAutoReview(taskId, task.review_criteria, task.workspace ?? this.deps.projectRoot, autoApprove);
    } else if (newStatus === "review" && autoApprove) {
      await this.deps.taskService.updateStatus(taskId, "done");
    }
    await this.saveState();
    const wasSingleTaskRun = this.singleTaskRunIds.delete(taskId);
    if (!wasSingleTaskRun) {
      this.scheduleImmediateDispatch();
    }
  }
  async handleRunFailure(taskId, entry, error, errorKind) {
    return this.withStateLock(() => this._handleRunFailure(taskId, entry, error, errorKind));
  }
  async _handleRunFailure(taskId, entry, error, errorKind) {
    await this.flushStateLazy();
    this.abortControllers.delete(taskId);
    const state = this.state;
    if (!state.running[taskId]) return;
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;
    await this.deps.runService.finish(entry.run_id, "failed", void 0, error);
    await this.deps.agentService.setStatus(entry.agent_id, "idle");
    const agentAfterIdle = await this.deps.agentStore.get(entry.agent_id);
    if (agentAfterIdle) {
      agentAfterIdle.current_task = void 0;
      agentAfterIdle.last_error = {
        message: error.slice(0, 500),
        kind: errorKind ?? classifyAdapterError(error),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      await this.deps.agentStore.save(agentAfterIdle);
    }
    const runtimeMs = Date.now() - new Date(entry.started_at).getTime();
    await this.deps.agentService.updateStats(entry.agent_id, {
      tasks_failed: (agentAfterIdle?.stats.tasks_failed ?? 0) + 1,
      total_runs: (agentAfterIdle?.stats.total_runs ?? 0) + 1,
      total_runtime_ms: (agentAfterIdle?.stats.total_runtime_ms ?? 0) + runtimeMs
    });
    const failureStatus = resolveFailureStatus(task);
    await this.deps.taskService.updateStatus(taskId, failureStatus);
    if (failureStatus === "retrying") {
      const delay = calculateRetryDelay(
        task.attempts - 1,
        this.deps.config.scheduling.retry_base_delay_ms,
        this.deps.config.scheduling.retry_max_delay_ms
      );
      this.enqueueRetry(state, taskId, task.attempts + 1, delay, error);
      this.deps.eventBus.emit({
        type: "run:retry",
        runId: entry.run_id,
        attempt: task.attempts + 1,
        delay_ms: delay
      });
    } else {
      state.stats.total_tasks_failed++;
      this.cachedTaskStore.invalidate();
      const allTasks = await this.cachedTaskStore.list();
      await this.cascadeFailDependents(taskId, allTasks, `dependency ${taskId} failed: ${error}`);
    }
    state.stats.total_runtime_ms += runtimeMs;
    if (task.proof?.branch) {
      await this.deps.workspaceManager.cleanup(taskId, task.proof.branch).catch((err) => {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: err instanceof Error ? err.message : String(err),
          context: `workspace cleanup for ${taskId}`,
          fatal: false
        });
      });
    }
    delete state.running[taskId];
    state.stats.total_runs++;
    await this.saveState();
    const wasSingleTaskRun = this.singleTaskRunIds.delete(taskId);
    if (!wasSingleTaskRun) {
      this.scheduleImmediateDispatch();
    }
  }
  /**
   * Run automatic review criteria on a task in 'review' status.
   * If all criteria pass, transition review → done.
   * If any fail, stay in review with results attached.
   */
  async runAutoReview(taskId, criteria, cwd, autoApprove = false) {
    const runner = new ReviewRunner({ cwd });
    const results = await runner.runAll(criteria);
    const allPassed = ReviewRunner.allPassed(results);
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;
    task.review_results = results;
    task.proof = {
      ...task.proof,
      test_results: ReviewRunner.formatReport(results),
      files_changed: task.proof?.files_changed ?? []
    };
    await this.deps.taskStore.save(task);
    this.deps.eventBus.emit({
      type: "task:auto_reviewed",
      taskId,
      passed: allPassed,
      results
    });
    if (allPassed || autoApprove) {
      if (!allPassed) {
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error: `Review criteria failed for task ${taskId} but autoApprove is set \u2014 force-approving`,
          context: "auto-review-with-auto-approve",
          fatal: false
        });
      }
      try {
        await this.deps.taskService.updateStatus(taskId, "done");
      } catch (validationErr) {
        const error = validationErr instanceof Error ? validationErr.message : String(validationErr);
        this.deps.eventBus.emit({
          type: "orchestrator:error",
          error,
          context: `auto-review transition failed for task ${taskId} -> done, force-writing`,
          fatal: false
        });
        task.status = "done";
        task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        await this.deps.taskStore.save(task).catch((saveErr) => {
          this.deps.eventBus.emit({
            type: "orchestrator:error",
            error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            context: `force-write task ${taskId} to store failed (auto-review)`,
            fatal: false
          });
        });
      }
    }
  }
  /**
   * Force a task to 'review' status with a summary prefix.
   * Used when merge-back fails (conflict or infrastructure error).
   */
  async forceTaskToReview(task, agentId, summaryPrefix) {
    task.proof = {
      ...task.proof,
      agent_summary: `${summaryPrefix}

${task.proof?.agent_summary ?? ""}`.slice(0, 2e3),
      files_changed: task.proof?.files_changed ?? []
    };
    task.status = "review";
    task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await this.deps.taskStore.save(task);
    await this.deps.agentService.setStatus(agentId, "idle").catch((err) => {
      this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `forceTaskToReview setStatus idle for agent ${agentId}`, fatal: false });
    });
    const agentAfter = await this.deps.agentStore.get(agentId);
    if (agentAfter) {
      agentAfter.current_task = void 0;
      await this.deps.agentStore.save(agentAfter);
    }
    await this.saveState();
  }
  unclaim(taskId) {
    this.state.claimed.delete(taskId);
  }
  /**
   * Throw if this instance doesn't own the lock (read-only session).
   */
  requireOwnership() {
    if (!this.lockAcquired) {
      throw new LockConflictError(0);
    }
  }
  async loadState() {
    this.state = await this.deps.stateStore.read();
  }
  /**
   * On startup, clean up stale running entries left by a crashed/restarted process.
   *
   * Instead of marking orphaned tasks as 'failed' (which triggers retry → agents
   * redo already-committed work), we cancel them. Users can manually reactivate
   * specific tasks if needed.
   */
  async cleanupStaleRunningEntries() {
    const state = this.state;
    const deadEntries = Object.entries(state.running).filter(
      ([, entry]) => !this.deps.processManager.isAlive(entry.pid)
    );
    const cleanedTaskIds = /* @__PURE__ */ new Set();
    if (deadEntries.length > 0) {
      for (const [taskId] of deadEntries) {
        delete state.running[taskId];
        cleanedTaskIds.add(taskId);
      }
      await Promise.all(
        deadEntries.map(async ([taskId, entry]) => {
          await this.deps.agentService.setStatus(entry.agent_id, "idle").catch((err) => {
            this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `startup cleanup: setStatus idle for agent ${entry.agent_id}`, fatal: false });
          });
          await this.forceTaskCancelled(taskId);
          await this.deps.runService.finish(entry.run_id, "cancelled", void 0, "Orchestrator restarted").catch((err) => {
            this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `startup cleanup: finish run ${entry.run_id}`, fatal: false });
          });
        })
      );
    }
    state.claimed = /* @__PURE__ */ new Set();
    if (cleanedTaskIds.size > 0) {
      const allTasks = await this.cachedTaskStore.list();
      const orphaned = allTasks.filter(
        (t) => t.status === "in_progress" && !state.running[t.id]
      );
      if (orphaned.length > 0) {
        await Promise.all(orphaned.map((t) => this.forceTaskCancelled(t.id)));
      }
      const cancelledIds = /* @__PURE__ */ new Set([...cleanedTaskIds, ...orphaned.map((t) => t.id)]);
      state.retry_queue = state.retry_queue.filter((r) => !cancelledIds.has(r.task_id));
      await this.saveState();
    }
    await this.cleanupOrphanedPreparingRuns();
  }
  /**
   * Find runs stuck in 'preparing' status (orphaned by a crash before adapter.execute)
   * and mark them as cancelled. Called once at startup.
   */
  async cleanupOrphanedPreparingRuns() {
    try {
      const allRuns = await this.deps.runStore.listAll();
      const preparingRuns = allRuns.filter((r) => r.status === "preparing");
      if (preparingRuns.length === 0) return;
      const activeRunIds = new Set(
        Object.values(this.state.running).map((e) => e.run_id)
      );
      const orphaned = preparingRuns.filter((r) => !activeRunIds.has(r.id));
      if (orphaned.length === 0) return;
      await Promise.all(
        orphaned.map(
          (run) => this.deps.runService.finish(run.id, "cancelled", void 0, "Orphaned preparing run (orchestrator restarted)").catch((err) => {
            this.deps.eventBus.emit({
              type: "orchestrator:error",
              error: err instanceof Error ? err.message : String(err),
              context: `startup cleanup: finish orphaned preparing run ${run.id}`,
              fatal: false
            });
          })
        )
      );
    } catch (err) {
      this.deps.eventBus.emit({
        type: "orchestrator:error",
        error: err instanceof Error ? err.message : String(err),
        context: "startup cleanup: cleanupOrphanedPreparingRuns",
        fatal: false
      });
    }
  }
  /** Cancel a task, falling back to direct store write if transition is invalid. */
  async forceTaskCancelled(taskId) {
    try {
      await this.deps.taskService.updateStatus(taskId, "cancelled");
    } catch {
      const task = await this.deps.taskStore.get(taskId);
      if (task && !isTerminal(task.status)) {
        task.status = "cancelled";
        task.updated_at = (/* @__PURE__ */ new Date()).toISOString();
        await this.deps.taskStore.save(task).catch((err) => {
          this.deps.eventBus.emit({ type: "orchestrator:error", error: err instanceof Error ? err.message : String(err), context: `startup cleanup: force-cancel task ${taskId}`, fatal: false });
        });
      }
    }
  }
  async saveState() {
    if (this.state) {
      await this.deps.stateStore.write(this.state);
    }
  }
  /**
   * Debounced saveState — batches rapid writes within 500ms window.
   * Used for non-critical updates like last_event_at in collectEvents.
   */
  saveStateLazy() {
    this.saveStateDirty = true;
    if (this.saveStateTimer) return;
    this.saveStateTimer = setTimeout(() => {
      this.saveStateTimer = null;
      if (this.saveStateDirty) {
        this.saveStateDirty = false;
        this.saveState().catch((err) => {
          this.deps.eventBus.emit({
            type: "orchestrator:error",
            error: err instanceof Error ? err.message : String(err),
            context: "debounced state save",
            fatal: false
          });
        });
      }
    }, 500);
  }
  /**
   * Flush any pending debounced saveState immediately.
   * Call before critical transitions to ensure state is persisted.
   */
  async flushStateLazy() {
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer);
      this.saveStateTimer = null;
    }
    if (this.saveStateDirty) {
      this.saveStateDirty = false;
      await this.saveState();
    }
  }
};
function isValidISOTimestamp(value) {
  if (typeof value !== "string") return false;
  const d = new Date(value);
  return !isNaN(d.getTime()) && d.toISOString() === value;
}
function serializeEventData(data, maxLen) {
  const str = typeof data === "string" ? data : JSON.stringify(data);
  return str.length > maxLen ? str.slice(0, maxLen) + "\u2026" : str;
}

export { Orchestrator, canTransition, isBlocked, isDispatchable, isTerminal, resolveFailureStatus };
//# sourceMappingURL=chunk-FKXNBGFH.js.map
//# sourceMappingURL=chunk-FKXNBGFH.js.map