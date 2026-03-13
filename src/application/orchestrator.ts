/**
 * Orchestrator — the core state machine.
 *
 * Tick loop: Reconcile → Dispatch → Collect
 *
 * Reconcile: check PID liveness, detect stalls, process retry queue
 * Dispatch: claim tasks, assign to agents, launch adapters
 * Collect: process completed runs, update stats
 */

import type { OrchestratorConfig } from '../domain/config.js';
import type { OrchestratorState, RunningEntry } from '../domain/state.js';
import type { Task } from '../domain/task.js';
import { AUTONOMOUS_LABEL } from '../domain/task.js';
import type { RunEvent } from '../domain/run.js';
import {
  isDispatchable,
  isBlocked,
  isTerminal,
  resolveCompletionStatus,
  resolveFailureStatus,
  calculateRetryDelay,
} from '../domain/transitions.js';
import { NoAgentsError, TaskAlreadyRunningError, LockConflictError, WorkspaceError } from '../domain/errors.js';
import { scopesOverlap } from '../domain/scope.js';
import { acquireLock, releaseLock } from '../infrastructure/storage/lock.js';
import type { ITaskStore, IAgentStore, IRunStore, IStateStore, IContextStore, IGoalStore } from '../infrastructure/storage/interfaces.js';
import { CachedTaskStore, CachedAgentStore, CachedGoalStore } from '../infrastructure/storage/cached-stores.js';
import type { AdapterRegistry } from '../infrastructure/adapters/registry.js';
import type { IWorkspaceManager } from '../infrastructure/workspace/interface.js';
import type { ITemplateEngine } from '../infrastructure/template/template-engine.js';
import { buildPromptContext, DEFAULT_PROMPT_TEMPLATE, type RetryContext } from '../infrastructure/template/template-engine.js';
import type { IProcessManager } from '../infrastructure/process/process-manager.js';
import type { AgentEvent } from '../infrastructure/adapters/interface.js';
import type { EventBus } from './event-bus.js';
import type { TaskService } from './task-service.js';
import type { AgentService } from './agent-service.js';
import type { RunService } from './run-service.js';
import { ReviewRunner } from './review-runner.js';

/** Max serialized event data written to JSONL (8 KB) */
const MAX_EVENT_DATA_LEN = 8192;
/** Max event data sent to TUI via event bus (4 KB) */
const MAX_BUS_DATA_LEN = 4096;

export interface OrchestratorDeps {
  taskStore: ITaskStore;
  agentStore: IAgentStore;
  runStore: IRunStore;
  stateStore: IStateStore;
  adapterRegistry: AdapterRegistry;
  workspaceManager: IWorkspaceManager;
  templateEngine: ITemplateEngine;
  processManager: IProcessManager;
  eventBus: EventBus;
  taskService: TaskService;
  agentService: AgentService;
  runService: RunService;
  contextStore?: IContextStore;
  messageService?: import('./message-service.js').MessageService;
  goalStore?: IGoalStore;
  config: OrchestratorConfig;
  projectRoot: string;
  lockPath: string;
}

export class Orchestrator {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private state: OrchestratorState | null = null;
  private abortControllers = new Map<string, AbortController>();
  private readonly cachedTaskStore: CachedTaskStore;
  private readonly cachedAgentStore: CachedAgentStore;
  private readonly cachedGoalStore: CachedGoalStore | null;
  private saveStateTimer: ReturnType<typeof setTimeout> | null = null;
  private saveStateDirty = false;
  private lockAcquired = false;
  private consecutiveTickFailures = 0;
  private readonly maxConsecutiveTickFailures = 5;
  private readonly maxRetryQueueSize = 100;
  private signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  private immediateDispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private taskCreatedUnsub: (() => void) | null = null;
  private tickInProgress = false;

  /** Promise-chain mutex to serialize critical state mutations. */
  private stateMutex: Promise<void> = Promise.resolve();

  constructor(private readonly deps: OrchestratorDeps) {
    this.cachedTaskStore = new CachedTaskStore(deps.taskStore);
    this.cachedAgentStore = new CachedAgentStore(deps.agentStore);
    this.cachedGoalStore = deps.goalStore ? new CachedGoalStore(deps.goalStore) : null;
  }

  /**
   * Check if this instance owns the lock (can mutate state).
   */
  get isOwner(): boolean {
    return this.lockAcquired;
  }

  /**
   * Serialize access to state mutations via a Promise-chain mutex.
   * Prevents concurrent tick/stop/reconcile from reading stale state.
   */
  private withStateLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const prev = this.stateMutex;
    this.stateMutex = next;
    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release!();
      }
    });
  }

  /**
   * Run a single task by ID.
   * If watch mode is active (lock already held), dispatches inline via stateMutex.
   * Otherwise acquires a temporary lock for the duration of the run.
   */
  async runTask(taskId: string): Promise<void> {
    if (this.lockAcquired) {
      await this.freshDispatch(() => this.dispatchTask(taskId));
      return;
    }
    await this.withTemporaryLock(() => this.freshDispatch(() => this.dispatchTask(taskId)));
  }

  /**
   * Run all dispatchable tasks.
   * If watch mode is active (lock already held), dispatches inline via stateMutex.
   * Otherwise acquires a temporary lock for the duration of the run.
   */
  async runAll(): Promise<void> {
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
  private async freshDispatch(fn: () => Promise<void>): Promise<void> {
    await this.withStateLock(async () => {
      this.cachedTaskStore.invalidate();
      this.cachedAgentStore.invalidate();
      await this.loadState();
      await fn();
      await this.saveState();
    });
  }

  /**
   * Acquire lock, run fn, then release lock.
   * Used by single-shot commands (runTask, runAll) that don't go through startWatch.
   */
  private async withTemporaryLock(fn: () => Promise<void>): Promise<void> {
    const lockResult = await acquireLock(this.deps.lockPath);
    if (!lockResult.acquired) {
      throw new LockConflictError(lockResult.pid!);
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
  async startWatch(): Promise<void> {
    // Acquire lock — only one orchestrator per project
    const lockResult = await acquireLock(this.deps.lockPath);
    if (!lockResult.acquired) {
      throw new LockConflictError(lockResult.pid!);
    }
    this.lockAcquired = true;

    await this.loadState();

    this.state!.pid = process.pid;
    this.state!.started_at = new Date().toISOString();
    await this.saveState();

    // Register signal handlers for graceful shutdown
    this.registerSignalHandlers();

    // Subscribe to task:created for reactive dispatch
    this.taskCreatedUnsub = this.deps.eventBus.on('task:created', () => {
      this.scheduleImmediateDispatch();
    });

    // Initial tick
    await this.tick();

    // Start polling
    this.intervalId = setInterval(
      () => this.tick().then(
        () => { this.consecutiveTickFailures = 0; },
        (err) => {
          this.consecutiveTickFailures++;
          const error = err instanceof Error ? err.message : String(err);
          this.deps.eventBus.emit({
            type: 'orchestrator:error',
            error,
            context: 'tick',
            fatal: this.consecutiveTickFailures >= this.maxConsecutiveTickFailures,
          });
          if (this.consecutiveTickFailures >= this.maxConsecutiveTickFailures) {
            this.deps.eventBus.emit({
              type: 'orchestrator:shutdown',
              reason: `${this.consecutiveTickFailures} consecutive tick failures`,
            });
            this.stop().catch((err) => {
              this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: 'stop after consecutive tick failures', fatal: false });
            });
          }
        },
      ),
      this.deps.config.scheduling.poll_interval_ms,
    );
  }

  /**
   * Register SIGINT/SIGTERM handlers for graceful shutdown.
   */
  private registerSignalHandlers(): void {
    const handler = (signal: string) => {
      this.deps.eventBus.emit({
        type: 'orchestrator:shutdown',
        reason: `Received ${signal}`,
      });
      this.stop().catch((err) => {
        this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `stop after ${signal} signal`, fatal: false });
      });
    };

    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const bound = () => handler(sig);
      this.signalHandlers.push([sig, bound]);
      process.on(sig, bound);
    }
  }

  /**
   * Remove signal handlers to avoid listener leaks.
   */
  private removeSignalHandlers(): void {
    for (const [sig, handler] of this.signalHandlers) {
      process.removeListener(sig, handler);
    }
    this.signalHandlers = [];
  }

  /**
   * Stop the watch loop and clean up.
   */
  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    // Stop polling
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Unsubscribe from task:created and clear debounce timer
    if (this.taskCreatedUnsub) {
      this.taskCreatedUnsub();
      this.taskCreatedUnsub = null;
    }
    if (this.immediateDispatchTimer) {
      clearTimeout(this.immediateDispatchTimer);
      this.immediateDispatchTimer = null;
    }

    // Flush any pending debounced writes before shutdown
    await this.flushStateLazy();

    // Graceful shutdown of running agents — serialized via mutex
    await this.withStateLock(async () => {
      if (this.state) {
        for (const [taskId, entry] of Object.entries(this.state.running)) {
          this.abortControllers.get(taskId)?.abort();
          this.abortControllers.delete(taskId);
          await this.deps.processManager.killWithGrace(entry.pid);

          // Mark run as cancelled
          await this.deps.runService.finish(entry.run_id, 'cancelled');

          // Mark task for retry if possible
          const task = await this.deps.taskStore.get(taskId);
          if (task) {
            await this.deps.taskService.updateStatus(taskId, resolveFailureStatus(task));
          }

          // Release agent
          await this.deps.agentService.setStatus(entry.agent_id, 'idle');
        }

        this.state.running = {};
        this.state.claimed = [];
        this.state.pid = undefined;
        this.state.started_at = undefined;
        await this.saveState();
      }
    });

    // Release lock
    if (this.lockAcquired) {
      await releaseLock(this.deps.lockPath);
      this.lockAcquired = false;
    }

    // Remove signal handlers
    this.removeSignalHandlers();
  }

  /**
   * Cancel a running task: kill agent process, clean state, mark cancelled.
   * Acquires lock if not already owned (standalone CLI invocation).
   */
  async cancelTask(taskId: string): Promise<void> {
    if (!this.lockAcquired) {
      return this.withTemporaryLock(() => this.cancelTask(taskId));
    }

    await this.withStateLock(async () => {
      await this.loadState();
      const state = this.state!;
      const entry = state.running[taskId];

      if (entry) {
        this.abortControllers.get(taskId)?.abort();
        this.abortControllers.delete(taskId);
        await this.deps.processManager.killWithGrace(entry.pid, 3_000).catch((err) => {
          this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `cancelTask kill process ${entry.pid} for task ${taskId}`, fatal: false });
        });
        await this.deps.runService.finish(entry.run_id, 'cancelled').catch((err) => {
          this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `cancelTask finish run ${entry.run_id}`, fatal: false });
        });
        await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch((err) => {
          this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `cancelTask setStatus idle for agent ${entry.agent_id}`, fatal: false });
        });

        delete state.running[taskId];
        await this.saveState();
      }

      state.retry_queue = state.retry_queue.filter((r) => r.task_id !== taskId);

      try {
        await this.deps.taskService.cancel(taskId);
      } catch {
        try {
          await this.deps.taskService.updateStatus(taskId, 'cancelled');
        } catch {
          // Already terminal — ignore
        }
      }

      await this.saveState();
    });
  }

  /**
   * Force-stop a specific agent: kill process, clean state, release agent.
   * Acquires lock if not already owned (standalone CLI invocation).
   */
  async forceStopAgent(agentId: string): Promise<void> {
    if (!this.lockAcquired) {
      return this.withTemporaryLock(() => this.forceStopAgent(agentId));
    }

    await this.withStateLock(async () => {
      await this.loadState();
      const state = this.state!;

      for (const [taskId, entry] of Object.entries(state.running)) {
        if (entry.agent_id === agentId) {
          this.abortControllers.get(taskId)?.abort();
          this.abortControllers.delete(taskId);
          await this.deps.processManager.killWithGrace(entry.pid, 3_000);
          await this.deps.runService.finish(entry.run_id, 'cancelled');

          try {
            await this.deps.taskService.updateStatus(taskId, 'failed');
          } catch {
            // Transition may not be valid — ignore
          }

          delete state.running[taskId];
        }
      }

      await this.deps.agentService.setStatus(agentId, 'idle');
      await this.saveState();
    });
  }

  /**
   * Single tick: Reconcile → Dispatch → Collect
   * Serialized via mutex to prevent concurrent ticks from racing on state.
   */
  private async tick(): Promise<void> {
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
        await this.seedAutonomousTasks();
        await this.dispatchAll();

        const tasks = await this.cachedTaskStore.list();
        const running = Object.keys(this.state!.running).length;
        const queued = tasks.filter((t) => isDispatchable(t.status)).length;

        this.deps.eventBus.emit({
          type: 'orchestrator:tick',
          running,
          queued,
        });
      });
    } finally {
      this.tickInProgress = false;
    }
  }

  /**
   * Schedule an immediate dispatch with 500ms debounce.
   * Called on task:created to avoid waiting for the next 30s tick.
   * Retries up to 10 times (5s) if a tick is in progress.
   */
  private scheduleImmediateDispatch(retries = 0): void {
    if (this.shuttingDown) return;
    if (this.immediateDispatchTimer) return; // already scheduled

    this.immediateDispatchTimer = setTimeout(() => {
      this.immediateDispatchTimer = null;
      if (this.shuttingDown) return;
      if (this.tickInProgress) {
        if (retries < 10) this.scheduleImmediateDispatch(retries + 1);
        return;
      }
      this.immediateDispatch().catch((err) => {
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error: err instanceof Error ? err.message : String(err),
          context: 'immediate dispatch on task:created',
          fatal: false,
        });
      });
    }, 500);
  }

  /**
   * Mini-tick: invalidate caches → loadState → dispatchAll → saveState.
   * Skips reconcile/collect — only dispatches new tasks immediately.
   */
  private async immediateDispatch(): Promise<void> {
    if (this.shuttingDown) return;
    await this.freshDispatch(() => this.shuttingDown ? Promise.resolve() : this.dispatchAll());
  }

  /**
   * Reconcile: check PID liveness, detect stalls, process retry queue.
   */
  private async reconcile(): Promise<void> {
    const state = this.state!;
    const now = Date.now();

    // Check running processes
    for (const [taskId, entry] of Object.entries(state.running)) {
      // If task is already terminal (done/failed/cancelled), just clean up the stale entry
      const taskData = await this.deps.taskStore.get(taskId);
      if (!taskData || isTerminal(taskData.status)) {
        this.abortControllers.delete(taskId);
        delete state.running[taskId];
        await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch((err) => {
          this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `reconcile setStatus idle for stale agent ${entry.agent_id} (task ${taskId})`, fatal: false });
        });
        continue;
      }

      // PID check
      if (!this.deps.processManager.isAlive(entry.pid)) {
        // Process crashed — wrap in try/catch to ensure running entry is always cleaned
        try {
          await this._handleRunFailure(taskId, entry, 'Process crashed unexpectedly');
        } catch {
          // Cleanup even if _handleRunFailure fails (e.g. invalid transition)
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch((err) => {
            this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `reconcile crash fallback setStatus idle for agent ${entry.agent_id} (task ${taskId})`, fatal: false });
          });
        }
        continue;
      }

      // Stall detection
      const lastEventAt = new Date(entry.last_event_at).getTime();
      const stallTimeout = this.deps.config.defaults.agent.stall_timeout_ms;

      if (now - lastEventAt > stallTimeout) {
        this.deps.eventBus.emit({
          type: 'orchestrator:stall_detected',
          runId: entry.run_id,
        });

        this.abortControllers.get(taskId)?.abort();
        await this.deps.processManager.killWithGrace(entry.pid, 5_000);
        try {
          await this._handleRunFailure(taskId, entry, 'Agent stalled (no events)');
        } catch {
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch((err) => {
            this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `reconcile stall fallback setStatus idle for agent ${entry.agent_id} (task ${taskId})`, fatal: false });
          });
        }
      }
    }

    // Fix stale agent statuses — agents stuck in 'running' with no running entry
    const runningAgentIds = new Set(Object.values(state.running).map((e) => e.agent_id));
    const allAgents = await this.cachedAgentStore.list();
    for (const agent of allAgents) {
      if (agent.status === 'running' && !runningAgentIds.has(agent.id)) {
        await this.deps.agentService.setStatus(agent.id, 'idle');
      }
    }

    // Fix orphaned tasks — stuck in 'in_progress' with no running entry
    const allTasks = await this.cachedTaskStore.list();
    for (const task of allTasks) {
      if (task.status === 'in_progress' && !state.running[task.id]) {
        try {
          await this.deps.taskService.updateStatus(task.id, 'failed');
        } catch {
          // If 'failed' transition is invalid, force-write via store
          task.status = 'failed';
          task.updated_at = new Date().toISOString();
          await this.deps.taskStore.save(task).catch((err) => {
            this.deps.eventBus.emit({
              type: 'orchestrator:error',
              error: err instanceof Error ? err.message : String(err),
              context: `force-write orphaned task ${task.id}`,
              fatal: false,
            });
          });
        }
        this.deps.eventBus.emit({
          type: 'task:orphaned',
          taskId: task.id,
        });
      }
    }

    // Process retry queue — filter builds new array instead of mutating with splice
    const dueRetries: string[] = [];
    state.retry_queue = state.retry_queue.filter((retry) => {
      if (now >= new Date(retry.due_at).getTime()) {
        dueRetries.push(retry.task_id);
        return false;
      }
      return true;
    });
    for (const taskId of dueRetries) {
      await this.dispatchTask(taskId);
    }

    await this.saveState();
  }

  /**
   * Create tasks for autonomous agents that have no active work.
   *
   * Priority: active Goals assigned to the agent come first.
   * If no goals, falls back to role-based autonomous work.
   */
  private async seedAutonomousTasks(): Promise<void> {
    const agents = await this.cachedAgentStore.list();
    const autonomousAgents = agents.filter(
      (a) => a.autonomous && a.status === 'idle',
    );
    if (autonomousAgents.length === 0) return;

    const allTasks = await this.cachedTaskStore.list();
    const activeGoals = this.cachedGoalStore
      ? await this.cachedGoalStore.list({ status: 'active' })
      : [];

    let anyCreated = false;
    const claimedGoalIds = new Set<string>();
    for (const agent of autonomousAgents) {
      // Skip if agent already has a non-terminal task assigned
      const hasActiveTask = allTasks.some(
        (t) => t.assignee === agent.id && !isTerminal(t.status),
      );
      if (hasActiveTask) continue;

      // Find goal: prefer assigned to this agent, then unassigned (not yet claimed)
      const goal = activeGoals.find(
        (g) => g.assignee === agent.id && !claimedGoalIds.has(g.id),
      ) ?? activeGoals.find(
        (g) => !g.assignee && !claimedGoalIds.has(g.id),
      );
      if (goal) claimedGoalIds.add(goal.id);
      const role = agent.role ?? 'general assistant';

      const title = goal
        ? `[auto] ${agent.name}: ${goal.title.slice(0, 60)}`
        : `[auto] ${agent.name}: ${role.slice(0, 60)}`;
      const description = goal
        ? `## GOAL (highest priority)\n\n${goal.description || goal.title}\n\n---\nAgent role: ${role}`
        : `Autonomous work cycle. Agent role: ${role}`;

      try {
        await this.deps.taskService.create({
          title,
          description,
          assignee: agent.id,
          labels: [AUTONOMOUS_LABEL],
          priority: 3,
          goalId: goal?.id,
        });
        anyCreated = true;
      } catch (err) {
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error: err instanceof Error ? err.message : String(err),
          context: `autonomous task for agent ${agent.id}`,
          fatal: false,
        });
      }
    }
    if (anyCreated) this.cachedTaskStore.invalidate();
  }

  /**
   * Dispatch all dispatchable tasks up to max_concurrent_agents.
   */
  private async dispatchAll(): Promise<void> {
    const state = this.state!;
    const maxConcurrent = this.deps.config.scheduling.max_concurrent_agents;
    const currentRunning = Object.keys(state.running).length;
    const availableSlots = maxConcurrent - currentRunning;

    if (availableSlots <= 0) return;

    const allTasks = await this.cachedTaskStore.list();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const candidates = allTasks
      .filter(
        (t) =>
          isDispatchable(t.status) &&
          !isBlocked(t, taskMap) &&
          !state.running[t.id] &&
          !state.claimed.includes(t.id),
      )
      .sort((a, b) => {
        const bTime = b.updated_at ?? '';
        const aTime = a.updated_at ?? '';
        return bTime < aTime ? -1 : bTime > aTime ? 1 : 0;
      })
      .slice(0, availableSlots);

    // Scope overlap check — block dispatch if candidate overlaps with running or earlier candidate
    const blockedIds = new Set<string>();
    const inProgressScoped = allTasks.filter((t) => t.status === 'in_progress' && t.scope?.length);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      if (!candidate.scope?.length) continue;
      const approvedPeers = candidates.slice(0, i).filter((c) => !blockedIds.has(c.id));
      const compareTo = [...inProgressScoped, ...approvedPeers];
      let overlapping = false;
      for (const other of compareTo) {
        if (scopesOverlap(candidate.scope, other.scope)) {
          this.deps.eventBus.emit({
            type: 'task:scope_overlap',
            taskId: candidate.id,
            overlappingTaskId: other.id,
            patterns: candidate.scope!,
          });
          overlapping = true;
          break;
        }
      }
      if (overlapping) blockedIds.add(candidate.id);
    }

    for (const task of candidates) {
      if (blockedIds.has(task.id)) continue;
      try {
        await this.dispatchTask(task.id);
      } catch (err) {
        // Workspace errors are permanent — force-fail the task to prevent infinite retry loop.
        // Cannot use taskService.updateStatus because todo → failed is not a valid transition.
        if (err instanceof WorkspaceError) {
          try {
            const t = await this.deps.taskStore.get(task.id);
            if (t && !isTerminal(t.status)) {
              t.status = 'failed';
              t.updated_at = new Date().toISOString();
              await this.deps.taskStore.save(t);
            }
          } catch {
            // Task may already be in a terminal state
          }
        }

        // Log but don't stop dispatching other tasks
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error: err instanceof Error ? err.message : String(err),
          context: `dispatch task ${task.id}`,
          fatal: false,
        });
      }
    }
  }

  /**
   * Dispatch a single task: claim → assign → execute.
   */
  private async dispatchTask(taskId: string): Promise<void> {
    const state = this.state!;

    // Validate
    if (state.running[taskId]) {
      const entry = state.running[taskId]!;
      throw new TaskAlreadyRunningError(taskId, entry.run_id, entry.agent_id);
    }

    const task = await this.deps.taskService.get(taskId);

    // Claim (persist before spawning)
    state.claimed.push(taskId);
    await this.saveState();

    try {
      // Find agent
      const agent = await this.deps.agentService.findBestAgent(task);
      if (!agent) {
        const allAgents = await this.cachedAgentStore.list();
        if (allAgents.length === 0) {
          throw new NoAgentsError();
        }
        // No idle agents — unclaim and return
        this.unclaim(taskId);
        await this.saveState();
        return;
      }

      // Prepare workspace
      const { path: workspacePath, branch: worktreeBranch } = await this.deps.workspaceManager.prepare(
        task,
        agent,
        this.deps.config,
      );

      // Build prompt (with retry context if this is a retry attempt)
      const template =
        this.deps.config.prompt?.template ?? DEFAULT_PROMPT_TEMPLATE;
      const allAgents = await this.cachedAgentStore.list();
      const attempt = task.attempts + 1;

      let retryContext: RetryContext | undefined;
      if (attempt > 1) {
        const failedData = await this.deps.runService.getLastFailedRunContext(task.id);
        if (failedData) {
          retryContext = {
            previous_error: failedData.error,
            previous_output: failedData.output,
          };
        }
      }

      const sharedContext = this.deps.contextStore
        ? await this.deps.contextStore.getAll()
        : undefined;

      // Drain pending messages for this agent
      const pendingMessages = this.deps.messageService
        ? await this.deps.messageService.drainMailbox(agent.id, task.id)
        : [];

      const context = buildPromptContext(
        task,
        agent,
        attempt,
        workspacePath,
        this.deps.config,
        { allAgents, retryContext, sharedContext, feedback: task.feedback, messages: pendingMessages.length ? pendingMessages : undefined },
      );
      const prompt = await this.deps.templateEngine.render(template, context);

      // Create run
      const run = await this.deps.runService.create({
        taskId: task.id,
        agentId: agent.id,
        attempt,
        prompt,
        workspacePath,
      });

      // Reset terminal states before transitioning to in_progress
      if (task.status === 'failed' || task.status === 'cancelled') {
        await this.deps.taskService.retry(taskId);
        task.status = 'todo';
        task.attempts = 0;
      }
      // Update task status
      await this.deps.taskService.updateStatus(taskId, 'in_progress');
      await this.deps.taskService.assign(taskId, agent.id);
      await this.deps.taskService.incrementAttempts(taskId);

      // Save worktree branch on proof immediately (survives any later failure)
      if (worktreeBranch) {
        task.proof = { ...(task.proof ?? { files_changed: [] }), branch: worktreeBranch };
        task.workspace = workspacePath;
        await this.deps.taskStore.save(task);
      }

      // Update agent status
      await this.deps.agentService.setStatus(agent.id, 'running');
      const agentData = await this.deps.agentService.get(agent.id);
      agentData.current_task = taskId;
      await this.deps.agentStore.save(agentData);

      // Get adapter and execute
      const adapter = this.deps.adapterRegistry.require(agent.adapter);
      const abortController = new AbortController();
      this.abortControllers.set(taskId, abortController);

      const handle = adapter.execute({
        prompt,
        workspace: workspacePath,
        env: {
          ...agent.config.env,
          ORCH_AGENT_ID: agent.id,
          ORCH_AGENT_NAME: agent.name,
          ORCH_TASK_ID: task.id,
        },
        config: agentData.config,
        signal: abortController.signal,
      });

      const agentPid = handle.pid;
      const now = new Date().toISOString();
      await this.deps.runService.start(run.id, agentPid);

      // Move from claimed to running
      this.unclaim(taskId);
      state.running[taskId] = {
        run_id: run.id,
        agent_id: agent.id,
        task_id: taskId,
        pid: agentPid,
        started_at: now,
        last_event_at: now,
      };
      await this.saveState();

      // Collect events in background
      this.collectEvents(
        handle.events,
        run.id,
        taskId,
        agent.id,
      ).catch((err) => {
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error: err instanceof Error ? err.message : String(err),
          context: `adapter execution for ${taskId}`,
          fatal: false,
        });
      });
    } catch (err) {
      // Rollback claim
      this.unclaim(taskId);
      await this.saveState();
      throw err;
    }
  }

  /**
   * Collect events from an adapter's async generator.
   */
  private async collectEvents(
    generator: AsyncGenerator<import('../infrastructure/adapters/interface.js').AgentEvent>,
    runId: string,
    taskId: string,
    agentId: string,
  ): Promise<void> {
    let collectedTokens: import('../domain/run.js').TokenUsage | undefined;
    let resultText: string | undefined;
    let lastAgentMessage: string | undefined;
    const filesChangedSet = new Set<string>();

    try {
      for await (const event of generator) {
        if (this.shuttingDown) break;

        // Capture token usage and result text from done events
        if (event.type === 'done') {
          if (event.tokens) collectedTokens = event.tokens;
          const data = event.data as Record<string, unknown> | undefined;
          // Claude: { type: 'result', result: '...' }
          // Codex: { type: 'turn.completed', result: '...' }
          if (data && typeof data.result === 'string') {
            resultText = data.result;
          }
        }

        // Collect last agent message text as fallback for result
        // (Codex agent_message items, Claude assistant messages, etc.)
        if (event.type === 'output') {
          const data = event.data as Record<string, unknown> | undefined;
          if (data) {
            const text = typeof data.text === 'string' ? data.text :
                         typeof data.message === 'string' ? data.message : undefined;
            if (text?.trim()) lastAgentMessage = text;
          }
        }

        // Track file changes
        if (event.type === 'file_change') {
          const data = event.data as Record<string, unknown> | undefined;
          // Codex sends { paths: string[], raw: ... }
          if (data && Array.isArray(data.paths)) {
            for (const p of data.paths) {
              if (typeof p === 'string') filesChangedSet.add(p);
            }
          } else {
            const filePath = data && typeof data.path === 'string' ? data.path :
                             typeof event.data === 'string' ? event.data : String(event.data);
            filesChangedSet.add(filePath);
          }
        }

        // Validate and normalize event timestamp
        const eventTimestamp = isValidISOTimestamp(event.timestamp)
          ? event.timestamp
          : new Date().toISOString();

        // Serialize + truncate once — reused for JSONL write and event bus
        const serialized = serializeEventData(event.data, MAX_EVENT_DATA_LEN);
        // Release the original (potentially large) parsed object for GC
        (event as unknown as Record<string, unknown>).data = undefined;

        // Record event (pre-serialized string keeps JSONL lines manageable)
        const runEvent: RunEvent = {
          timestamp: eventTimestamp,
          type: event.type === 'output' ? 'agent_output' :
                event.type === 'file_change' ? 'file_changed' :
                event.type === 'command' ? 'command_run' :
                event.type === 'tool_call' ? 'tool_call' :
                event.type === 'error' ? 'error' : 'done',
          data: serialized,
        };
        await this.deps.runService.appendEvent(runId, runEvent);

        // Update last_event_at for stall detection (debounced write — non-critical)
        if (this.state?.running[taskId]) {
          this.state.running[taskId]!.last_event_at = eventTimestamp;
          this.saveStateLazy();
        }

        // Emit to event bus — further cap for TUI consumption
        const busData = serializeEventData(serialized, MAX_BUS_DATA_LEN);
        if (event.type === 'output' || event.type === 'tool_call') {
          this.deps.eventBus.emit({
            type: 'agent:output',
            runId,
            agentId,
            data: busData,
          });
        } else if (event.type === 'file_change') {
          this.deps.eventBus.emit({
            type: 'agent:file_changed',
            runId,
            agentId,
            path: typeof event.data === 'string' ? event.data : String(event.data),
          });
        } else if (event.type === 'error') {
          this.deps.eventBus.emit({
            type: 'agent:error',
            runId,
            agentId,
            error: busData,
          });
        }
      }

      // Adapter finished successfully — runService.finish emits agent:completed
      // Use resultText from done event, or fall back to last agent message
      const finalResult = resultText ?? lastAgentMessage;
      await this.handleRunSuccess(taskId, runId, agentId, collectedTokens, finalResult, [...filesChangedSet]);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const entry = this.state?.running[taskId];
      if (entry) {
        // runService.finish emits agent:completed
        await this.handleRunFailure(taskId, entry, error);
      }
    }
  }

  private async handleRunSuccess(
    taskId: string,
    runId: string,
    agentId: string,
    tokens?: import('../domain/run.js').TokenUsage,
    resultText?: string,
    filesChanged?: string[],
  ): Promise<void> {
    return this.withStateLock(() => this._handleRunSuccess(taskId, runId, agentId, tokens, resultText, filesChanged));
  }

  private async _handleRunSuccess(
    taskId: string,
    runId: string,
    agentId: string,
    tokens?: import('../domain/run.js').TokenUsage,
    resultText?: string,
    filesChanged?: string[],
  ): Promise<void> {
    await this.flushStateLazy();
    this.abortControllers.delete(taskId);
    const state = this.state!;

    // If task was already cancelled/removed from running, skip
    if (!state.running[taskId]) return;

    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;

    // Save proof of work (agent summary + files changed); clear stale feedback
    task.proof = {
      ...task.proof,
      agent_summary: resultText?.slice(0, 2000) ?? task.proof?.agent_summary,
      files_changed: filesChanged?.length ? filesChanged : (task.proof?.files_changed ?? []),
    };
    delete task.feedback;
    await this.deps.taskStore.save(task);

    const agent = await this.deps.agentStore.get(agentId);
    const isAutonomousTask = task.labels?.includes(AUTONOMOUS_LABEL);
    const autoApprove = isAutonomousTask || agent?.config.approval_policy === 'auto';

    const newStatus = resolveCompletionStatus(task, true, autoApprove);

    // Finish run first (emits agent:completed)
    await this.deps.runService.finish(runId, 'succeeded', tokens);

    // Track runtime before cleaning up
    const runningEntry = state.running[taskId];
    const successRuntimeMs = runningEntry
      ? Date.now() - new Date(runningEntry.started_at).getTime()
      : 0;
    if (runningEntry) {
      state.stats.total_runtime_ms += successRuntimeMs;
    }

    // Clean up running entry early — prevents handleRunFailure from being called on catch
    delete state.running[taskId];

    // Update agent stats (always — agent completed its work regardless of merge outcome)
    const statsUpdate: Partial<import('../domain/agent.js').AgentStats> = {
      tasks_completed: (agent?.stats.tasks_completed ?? 0) + 1,
      total_runs: (agent?.stats.total_runs ?? 0) + 1,
      total_runtime_ms: (agent?.stats.total_runtime_ms ?? 0) + successRuntimeMs,
    };
    if (tokens) {
      statsUpdate.tokens_used = (agent?.stats.tokens_used ?? 0) + tokens.total;
    }
    await this.deps.agentService.updateStats(agentId, statsUpdate).catch((err) => {
      this.deps.eventBus.emit({
        type: 'orchestrator:error',
        error: err instanceof Error ? err.message : String(err),
        context: `agent stats update for ${agentId}`,
        fatal: false,
      });
    });

    // Update global stats
    state.stats.total_tasks_completed++;
    state.stats.total_runs++;
    if (tokens) {
      state.stats.total_tokens.input += tokens.input;
      state.stats.total_tokens.output += tokens.output;
      state.stats.total_tokens.total = state.stats.total_tokens.input + state.stats.total_tokens.output;
    }

    // Auto merge-back: if task used a worktree branch, merge into current branch
    if (task.proof?.branch) {
      try {
        const mergeResult = await this.deps.workspaceManager.mergeBack(task.proof.branch);
        if (mergeResult.success) {
          this.deps.eventBus.emit({
            type: 'workspace:merge_succeeded',
            taskId,
            branch: task.proof.branch,
          });
          // Clean up worktree after successful merge
          await this.deps.workspaceManager.cleanup(taskId).catch((err) => {
            this.deps.eventBus.emit({
              type: 'orchestrator:error',
              error: err instanceof Error ? err.message : String(err),
              context: `workspace cleanup for ${taskId}`,
              fatal: false,
            });
          });
        } else {
          // Merge conflict: force task to review regardless of auto-approve
          this.deps.eventBus.emit({
            type: 'workspace:merge_conflict',
            taskId,
            branch: task.proof.branch,
            conflictInfo: mergeResult.conflictInfo,
          });
          await this.forceTaskToReview(task, agentId, `MERGE CONFLICT: ${mergeResult.conflictInfo}`);
          return;
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.forceTaskToReview(task, agentId, `MERGE ERROR: ${error}`);
        return;
      }
    }

    // Update task status — force-write via store if service validation fails
    try {
      await this.deps.taskService.updateStatus(taskId, newStatus);
    } catch (validationErr) {
      // Bypass state machine validation and force-write directly
      const error = validationErr instanceof Error ? validationErr.message : String(validationErr);
      this.deps.eventBus.emit({
        type: 'orchestrator:error',
        error,
        context: `state machine validation failed for task ${taskId} -> ${newStatus}, force-writing`,
        fatal: false,
      });
      task.status = newStatus;
      task.updated_at = new Date().toISOString();
      await this.deps.taskStore.save(task).catch((saveErr) => {
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error: saveErr instanceof Error ? saveErr.message : String(saveErr),
          context: `force-write task ${taskId} to store failed`,
          fatal: false,
        });
      });
    }
    await this.deps.agentService.setStatus(agentId, 'idle').catch((err) => {
      this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `_handleRunSuccess setStatus idle for agent ${agentId}`, fatal: false });
    });

    // Clear current_task — agent is now idle
    const agentAfter = await this.deps.agentStore.get(agentId);
    if (agentAfter) {
      agentAfter.current_task = undefined;
      await this.deps.agentStore.save(agentAfter);
    }

    // Auto-review: if task landed in 'review' and has review_criteria, run them
    if (newStatus === 'review' && task.review_criteria?.length) {
      await this.runAutoReview(taskId, task.review_criteria, task.workspace ?? this.deps.projectRoot);
    } else if (newStatus === 'review' && autoApprove) {
      // Auto-approve: skip review and transition review → done immediately
      await this.deps.taskService.updateStatus(taskId, 'done');
    }

    await this.saveState();

    // Reactive dispatch — agent is idle, try to assign next task immediately
    this.scheduleImmediateDispatch();
  }

  private async handleRunFailure(
    taskId: string,
    entry: RunningEntry,
    error: string,
  ): Promise<void> {
    return this.withStateLock(() => this._handleRunFailure(taskId, entry, error));
  }

  private async _handleRunFailure(
    taskId: string,
    entry: RunningEntry,
    error: string,
  ): Promise<void> {
    await this.flushStateLazy();
    this.abortControllers.delete(taskId);
    const state = this.state!;
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;

    await this.deps.runService.finish(entry.run_id, 'failed', undefined, error);
    await this.deps.agentService.setStatus(entry.agent_id, 'idle');

    // Clear current_task — agent is now idle
    const agentAfterIdle = await this.deps.agentStore.get(entry.agent_id);
    if (agentAfterIdle) {
      agentAfterIdle.current_task = undefined;
      await this.deps.agentStore.save(agentAfterIdle);
    }

    // Compute runtime once — used for both agent stats and global stats
    const agent = await this.deps.agentStore.get(entry.agent_id);
    const runtimeMs = Date.now() - new Date(entry.started_at).getTime();
    await this.deps.agentService.updateStats(entry.agent_id, {
      tasks_failed: (agent?.stats.tasks_failed ?? 0) + 1,
      total_runs: (agent?.stats.total_runs ?? 0) + 1,
      total_runtime_ms: (agent?.stats.total_runtime_ms ?? 0) + runtimeMs,
    });

    // Determine retry or fail via domain function
    const failureStatus = resolveFailureStatus(task);
    await this.deps.taskService.updateStatus(taskId, failureStatus);

    if (failureStatus === 'retrying') {
      const delay = calculateRetryDelay(
        task.attempts - 1,
        this.deps.config.scheduling.retry_base_delay_ms,
        this.deps.config.scheduling.retry_max_delay_ms,
      );

      // Dedup: don't add if task_id already in retry queue
      const alreadyQueued = state.retry_queue.some((r) => r.task_id === taskId);
      if (!alreadyQueued) {
        // Bounds: drop oldest entry if queue is at capacity
        if (state.retry_queue.length >= this.maxRetryQueueSize) {
          state.retry_queue.shift();
        }
        state.retry_queue.push({
          task_id: taskId,
          attempt: task.attempts + 1,
          due_at: new Date(Date.now() + delay).toISOString(),
          error,
        });
      }

      this.deps.eventBus.emit({
        type: 'run:retry',
        runId: entry.run_id,
        attempt: task.attempts + 1,
        delay_ms: delay,
      });
    } else {
      state.stats.total_tasks_failed++;
    }

    // Track runtime (reuse runtimeMs computed above)
    state.stats.total_runtime_ms += runtimeMs;

    // Clean up running entry
    delete state.running[taskId];
    state.stats.total_runs++;
    await this.saveState();

    // Reactive dispatch — agent is idle, try to assign next task immediately
    this.scheduleImmediateDispatch();
  }

  /**
   * Run automatic review criteria on a task in 'review' status.
   * If all criteria pass, transition review → done.
   * If any fail, stay in review with results attached.
   */
  private async runAutoReview(
    taskId: string,
    criteria: import('../domain/task.js').ReviewCriterion[],
    cwd: string,
  ): Promise<void> {
    const runner = new ReviewRunner({ cwd });
    const results = await runner.runAll(criteria);
    const allPassed = ReviewRunner.allPassed(results);

    // Save review results on task
    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;

    task.review_results = results;
    task.proof = {
      ...task.proof,
      test_results: ReviewRunner.formatReport(results),
      files_changed: task.proof?.files_changed ?? [],
    };
    await this.deps.taskStore.save(task);

    // Emit auto-review event
    this.deps.eventBus.emit({
      type: 'task:auto_reviewed',
      taskId,
      passed: allPassed,
      results,
    });

    // If all passed, auto-approve: review → done
    if (allPassed) {
      try {
        await this.deps.taskService.updateStatus(taskId, 'done');
      } catch (validationErr) {
        const error = validationErr instanceof Error ? validationErr.message : String(validationErr);
        this.deps.eventBus.emit({
          type: 'orchestrator:error',
          error,
          context: `auto-review transition failed for task ${taskId} -> done, force-writing`,
          fatal: false,
        });
        task.status = 'done';
        task.updated_at = new Date().toISOString();
        await this.deps.taskStore.save(task).catch((saveErr) => {
          this.deps.eventBus.emit({
            type: 'orchestrator:error',
            error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            context: `force-write task ${taskId} to store failed (auto-review)`,
            fatal: false,
          });
        });
      }
    }
  }

  /**
   * Force a task to 'review' status with a summary prefix.
   * Used when merge-back fails (conflict or infrastructure error).
   */
  private async forceTaskToReview(
    task: import('../domain/task.js').Task,
    agentId: string,
    summaryPrefix: string,
  ): Promise<void> {
    task.proof = {
      ...task.proof,
      agent_summary: `${summaryPrefix}\n\n${task.proof?.agent_summary ?? ''}`.slice(0, 2000),
      files_changed: task.proof?.files_changed ?? [],
    };
    task.status = 'review';
    task.updated_at = new Date().toISOString();
    await this.deps.taskStore.save(task);
    await this.deps.agentService.setStatus(agentId, 'idle').catch((err) => {
      this.deps.eventBus.emit({ type: 'orchestrator:error', error: err instanceof Error ? err.message : String(err), context: `forceTaskToReview setStatus idle for agent ${agentId}`, fatal: false });
    });

    // Clear current_task — agent is now idle
    const agentAfter = await this.deps.agentStore.get(agentId);
    if (agentAfter) {
      agentAfter.current_task = undefined;
      await this.deps.agentStore.save(agentAfter);
    }

    await this.saveState();
  }

  private unclaim(taskId: string): void {
    const idx = this.state!.claimed.indexOf(taskId);
    if (idx !== -1) this.state!.claimed.splice(idx, 1);
  }

  /**
   * Throw if this instance doesn't own the lock (read-only session).
   */
  private requireOwnership(): void {
    if (!this.lockAcquired) {
      throw new LockConflictError(0);
    }
  }

  private async loadState(): Promise<void> {
    this.state = await this.deps.stateStore.read();
  }

  private async saveState(): Promise<void> {
    if (this.state) {
      await this.deps.stateStore.write(this.state);
    }
  }

  /**
   * Debounced saveState — batches rapid writes within 500ms window.
   * Used for non-critical updates like last_event_at in collectEvents.
   */
  private saveStateLazy(): void {
    this.saveStateDirty = true;
    if (this.saveStateTimer) return; // already scheduled
    this.saveStateTimer = setTimeout(() => {
      this.saveStateTimer = null;
      if (this.saveStateDirty) {
        this.saveStateDirty = false;
        this.saveState().catch((err) => {
          this.deps.eventBus.emit({
            type: 'orchestrator:error',
            error: err instanceof Error ? err.message : String(err),
            context: 'debounced state save',
            fatal: false,
          });
        });
      }
    }, 500);
  }

  /**
   * Flush any pending debounced saveState immediately.
   * Call before critical transitions to ensure state is persisted.
   */
  private async flushStateLazy(): Promise<void> {
    if (this.saveStateTimer) {
      clearTimeout(this.saveStateTimer);
      this.saveStateTimer = null;
    }
    if (this.saveStateDirty) {
      this.saveStateDirty = false;
      await this.saveState();
    }
  }
}

/** Check if a string is a valid ISO 8601 timestamp. */
function isValidISOTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const d = new Date(value);
  return !isNaN(d.getTime()) && d.toISOString() === value;
}

/**
 * Serialize event data to a string, truncating if it exceeds maxLen.
 * Always returns a string — avoids double-stringify by callers (appendJsonl, event bus).
 */
function serializeEventData(data: unknown, maxLen: number): string {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}
