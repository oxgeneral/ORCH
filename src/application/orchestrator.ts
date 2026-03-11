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
import type { RunEvent } from '../domain/run.js';
import {
  isDispatchable,
  isBlocked,
  isTerminal,
  resolveCompletionStatus,
  calculateRetryDelay,
} from '../domain/transitions.js';
import { NoAgentsError, TaskAlreadyRunningError, LockConflictError } from '../domain/errors.js';
import { acquireLock, releaseLock } from '../infrastructure/storage/lock.js';
import type { ITaskStore, IAgentStore, IRunStore, IStateStore, IContextStore } from '../infrastructure/storage/interfaces.js';
import { CachedTaskStore, CachedAgentStore } from '../infrastructure/storage/cached-stores.js';
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
  private saveStateTimer: ReturnType<typeof setTimeout> | null = null;
  private saveStateDirty = false;
  private lockAcquired = false;

  constructor(private readonly deps: OrchestratorDeps) {
    this.cachedTaskStore = new CachedTaskStore(deps.taskStore);
    this.cachedAgentStore = new CachedAgentStore(deps.agentStore);
  }

  /**
   * Check if this instance owns the lock (can mutate state).
   */
  get isOwner(): boolean {
    return this.lockAcquired;
  }

  /**
   * Run a single task by ID. Requires lock ownership.
   */
  async runTask(taskId: string): Promise<void> {
    this.requireOwnership();
    await this.loadState();
    await this.dispatchTask(taskId);
  }

  /**
   * Run all dispatchable tasks. Requires lock ownership.
   */
  async runAll(): Promise<void> {
    this.requireOwnership();
    await this.loadState();
    await this.dispatchAll();
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

    // Initial tick
    await this.tick();

    // Start polling
    this.intervalId = setInterval(
      () => this.tick().catch(console.error),
      this.deps.config.scheduling.poll_interval_ms,
    );
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

    // Flush any pending debounced writes before shutdown
    await this.flushStateLazy();

    // Graceful shutdown of running agents
    if (this.state) {
      for (const [taskId, entry] of Object.entries(this.state.running)) {
        this.abortControllers.get(taskId)?.abort();
        this.abortControllers.delete(taskId);
        await this.deps.processManager.killWithGrace(entry.pid);

        // Mark run as cancelled
        await this.deps.runService.finish(entry.run_id, 'cancelled');

        // Mark task for retry if possible
        const task = await this.deps.taskStore.get(taskId);
        if (task && task.attempts < task.max_attempts) {
          await this.deps.taskService.updateStatus(taskId, 'retrying');
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

    // Release lock
    if (this.lockAcquired) {
      await releaseLock(this.deps.lockPath);
      this.lockAcquired = false;
    }
  }

  /**
   * Cancel a running task: kill agent process, clean state, mark cancelled.
   * Requires lock ownership.
   */
  async cancelTask(taskId: string): Promise<void> {
    this.requireOwnership();
    await this.loadState();
    const state = this.state!;
    const entry = state.running[taskId];

    if (entry) {
      // Kill the running process via SIGTERM/SIGKILL (don't use abort — it throws unhandled AbortError)
      this.abortControllers.delete(taskId);
      await this.deps.processManager.killWithGrace(entry.pid, 3_000).catch(() => {});
      await this.deps.runService.finish(entry.run_id, 'cancelled').catch(() => {});
      await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch(() => {});

      // Clean up running entry BEFORE status transition (so TaskService.cancel won't throw)
      delete state.running[taskId];
      await this.saveState();
    }

    // Also remove from retry queue
    state.retry_queue = state.retry_queue.filter((r) => r.task_id !== taskId);

    // Now transition status to cancelled
    try {
      await this.deps.taskService.cancel(taskId);
    } catch {
      // Force the transition if normal cancel fails
      try {
        await this.deps.taskService.updateStatus(taskId, 'cancelled');
      } catch {
        // Already terminal — ignore
      }
    }

    await this.saveState();
  }

  /**
   * Force-stop a specific agent: kill process, clean state, release agent.
   * Requires lock ownership.
   */
  async forceStopAgent(agentId: string): Promise<void> {
    this.requireOwnership();
    await this.loadState();
    const state = this.state!;

    // Find running entry for this agent
    for (const [taskId, entry] of Object.entries(state.running)) {
      if (entry.agent_id === agentId) {
        this.abortControllers.get(taskId)?.abort();
        this.abortControllers.delete(taskId);
        await this.deps.processManager.killWithGrace(entry.pid, 3_000);
        await this.deps.runService.finish(entry.run_id, 'cancelled');

        // Mark task as failed
        try {
          await this.deps.taskService.updateStatus(taskId, 'failed');
        } catch {
          // Transition may not be valid — ignore
        }

        delete state.running[taskId];
      }
    }

    // Reset agent status
    await this.deps.agentService.setStatus(agentId, 'idle');
    await this.saveState();
  }

  /**
   * Single tick: Reconcile → Dispatch → Collect
   */
  private async tick(): Promise<void> {
    if (this.shuttingDown) return;

    this.cachedTaskStore.invalidate();
    this.cachedAgentStore.invalidate();

    await this.loadState();
    await this.reconcile();
    await this.dispatchAll();

    const tasks = await this.cachedTaskStore.list();
    const running = Object.keys(this.state!.running).length;
    const queued = tasks.filter((t) => isDispatchable(t.status)).length;

    this.deps.eventBus.emit({
      type: 'orchestrator:tick',
      running,
      queued,
    });
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
        await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch(() => {});
        continue;
      }

      // PID check
      if (!this.deps.processManager.isAlive(entry.pid)) {
        // Process crashed — wrap in try/catch to ensure running entry is always cleaned
        try {
          await this.handleRunFailure(taskId, entry, 'Process crashed unexpectedly');
        } catch {
          // Cleanup even if handleRunFailure fails (e.g. invalid transition)
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch(() => {});
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
          await this.handleRunFailure(taskId, entry, 'Agent stalled (no events)');
        } catch {
          delete state.running[taskId];
          await this.deps.agentService.setStatus(entry.agent_id, 'idle').catch(() => {});
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
          await this.deps.taskService.updateStatus(task.id, 'done');
        } catch {
          task.status = 'done';
          task.updated_at = new Date().toISOString();
          await this.deps.taskStore.save(task).catch(() => {});
        }
      }
    }

    // Process retry queue — dispatchTask handles the status transition
    for (let i = state.retry_queue.length - 1; i >= 0; i--) {
      const retry = state.retry_queue[i]!;
      if (now >= new Date(retry.due_at).getTime()) {
        state.retry_queue.splice(i, 1);
        await this.dispatchTask(retry.task_id);
      }
    }

    await this.saveState();
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
    const candidates = allTasks
      .filter(
        (t) =>
          isDispatchable(t.status) &&
          !isBlocked(t, allTasks) &&
          !state.running[t.id] &&
          !state.claimed.includes(t.id),
      )
      .sort((a, b) => a.priority - b.priority)
      .slice(0, availableSlots);

    for (const task of candidates) {
      try {
        await this.dispatchTask(task.id);
      } catch (err) {
        // Log but don't stop dispatching other tasks
        console.error(`Failed to dispatch ${task.id}:`, err);
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
      const workspacePath = await this.deps.workspaceManager.prepare(
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

      const context = buildPromptContext(
        task,
        agent,
        attempt,
        workspacePath,
        this.deps.config,
        allAgents,
        retryContext,
        sharedContext,
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
        env: agent.config.env,
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
      ).catch((err) =>
        console.error(`Adapter execution error for ${taskId}:`, err),
      );
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
    const filesChanged: string[] = [];

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
              if (typeof p === 'string' && !filesChanged.includes(p)) filesChanged.push(p);
            }
          } else {
            const filePath = data && typeof data.path === 'string' ? data.path :
                             typeof event.data === 'string' ? event.data : String(event.data);
            if (!filesChanged.includes(filePath)) filesChanged.push(filePath);
          }
        }

        // Record event
        const runEvent: RunEvent = {
          timestamp: event.timestamp,
          type: event.type === 'output' ? 'agent_output' :
                event.type === 'file_change' ? 'file_changed' :
                event.type === 'command' ? 'command_run' :
                event.type === 'tool_call' ? 'tool_call' :
                event.type === 'error' ? 'error' : 'done',
          data: event.data,
        };
        await this.deps.runService.appendEvent(runId, runEvent);

        // Update last_event_at for stall detection (debounced write — non-critical)
        if (this.state?.running[taskId]) {
          this.state.running[taskId]!.last_event_at = event.timestamp;
          this.saveStateLazy();
        }

        // Emit to event bus
        if (event.type === 'output' || event.type === 'tool_call') {
          this.deps.eventBus.emit({
            type: 'agent:output',
            runId,
            agentId,
            data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
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
            error: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
          });
        }
      }

      // Adapter finished successfully — runService.finish emits agent:completed
      // Use resultText from done event, or fall back to last agent message
      const finalResult = resultText ?? lastAgentMessage;
      await this.handleRunSuccess(taskId, runId, agentId, collectedTokens, finalResult, filesChanged);
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
    await this.flushStateLazy();
    this.abortControllers.delete(taskId);
    const state = this.state!;

    // If task was already cancelled/removed from running, skip
    if (!state.running[taskId]) return;

    const task = await this.deps.taskStore.get(taskId);
    if (!task) return;

    // Save proof of work (agent summary + files changed)
    task.proof = {
      ...task.proof,
      agent_summary: resultText?.slice(0, 2000) ?? task.proof?.agent_summary,
      files_changed: filesChanged?.length ? filesChanged : (task.proof?.files_changed ?? []),
    };
    await this.deps.taskStore.save(task);

    const agent = await this.deps.agentStore.get(agentId);
    const autoApprove = agent?.config.approval_policy === 'auto';

    const newStatus = resolveCompletionStatus(task, true, autoApprove);

    // Finish run first (emits agent:completed)
    await this.deps.runService.finish(runId, 'succeeded', tokens);

    // Track runtime before cleaning up
    const runningEntry = state.running[taskId];
    if (runningEntry) {
      const runtimeMs = Date.now() - new Date(runningEntry.started_at).getTime();
      state.stats.total_runtime_ms += runtimeMs;
    }

    // Clean up running entry early — prevents handleRunFailure from being called on catch
    delete state.running[taskId];

    // Update task status — force-write via store if service validation fails
    try {
      await this.deps.taskService.updateStatus(taskId, newStatus);
    } catch {
      // Bypass state machine validation and force-write directly
      task.status = newStatus;
      task.updated_at = new Date().toISOString();
      await this.deps.taskStore.save(task).catch(() => {});
    }
    await this.deps.agentService.setStatus(agentId, 'idle').catch(() => {});

    // Auto-review: if task landed in 'review' and has review_criteria, run them
    if (newStatus === 'review' && task.review_criteria?.length) {
      await this.runAutoReview(taskId, task.review_criteria, task.workspace ?? this.deps.projectRoot);
    }

    // Update agent stats
    const statsUpdate: Partial<import('../domain/agent.js').AgentStats> = {
      tasks_completed: (agent?.stats.tasks_completed ?? 0) + 1,
      total_runs: (agent?.stats.total_runs ?? 0) + 1,
    };
    if (tokens) {
      statsUpdate.tokens_used = (agent?.stats.tokens_used ?? 0) + tokens.total;
    }
    await this.deps.agentService.updateStats(agentId, statsUpdate).catch(() => {});

    // Update global stats
    state.stats.total_tasks_completed++;
    state.stats.total_runs++;
    if (tokens) {
      state.stats.total_tokens.input += tokens.input;
      state.stats.total_tokens.output += tokens.output;
      state.stats.total_tokens.total += tokens.total;
    }

    await this.saveState();
  }

  private async handleRunFailure(
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

    // Update agent stats
    const agent = await this.deps.agentStore.get(entry.agent_id);
    await this.deps.agentService.updateStats(entry.agent_id, {
      tasks_failed: (agent?.stats.tasks_failed ?? 0) + 1,
      total_runs: (agent?.stats.total_runs ?? 0) + 1,
    });

    // Determine retry or fail
    if (task.attempts < task.max_attempts) {
      await this.deps.taskService.updateStatus(taskId, 'retrying');

      const delay = calculateRetryDelay(
        task.attempts,
        this.deps.config.scheduling.retry_base_delay_ms,
        this.deps.config.scheduling.retry_max_delay_ms,
      );

      state.retry_queue.push({
        task_id: taskId,
        attempt: task.attempts + 1,
        due_at: new Date(Date.now() + delay).toISOString(),
        error,
      });

      this.deps.eventBus.emit({
        type: 'run:retry',
        runId: entry.run_id,
        attempt: task.attempts + 1,
        delay_ms: delay,
      });
    } else {
      await this.deps.taskService.updateStatus(taskId, 'failed');
      state.stats.total_tasks_failed++;
    }

    // Track runtime
    const runtimeMs = Date.now() - new Date(entry.started_at).getTime();
    state.stats.total_runtime_ms += runtimeMs;

    // Clean up running entry
    delete state.running[taskId];
    state.stats.total_runs++;
    await this.saveState();
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
      } catch {
        task.status = 'done';
        task.updated_at = new Date().toISOString();
        await this.deps.taskStore.save(task).catch(() => {});
      }
    }
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
        this.saveState().catch(console.error);
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
