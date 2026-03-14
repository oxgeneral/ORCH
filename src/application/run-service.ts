/**
 * Run service — manages run lifecycle and event streaming.
 */

import { nanoid } from 'nanoid';
import type { Run, RunEvent, RunStatus, TokenUsage } from '../domain/run.js';
import type { IRunStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';

export class RunService {
  constructor(
    private readonly runStore: IRunStore,
    private readonly eventBus: EventBus,
  ) {}

  async create(params: {
    taskId: string;
    agentId: string;
    attempt: number;
    prompt: string;
    workspacePath: string;
  }): Promise<Run> {
    const run: Run = {
      id: `run_${nanoid(7)}`,
      task_id: params.taskId,
      agent_id: params.agentId,
      attempt: params.attempt,
      status: 'preparing',
      started_at: new Date().toISOString(),
      workspace_path: params.workspacePath,
      prompt: params.prompt,
    };

    await this.runStore.save(run);
    return run;
  }

  async get(id: string): Promise<Run | null> {
    return this.runStore.get(id);
  }

  async start(id: string, pid: number): Promise<Run> {
    const run = await this.runStore.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);

    run.status = 'running';
    run.pid = pid;
    await this.runStore.save(run);

    this.eventBus.emit({
      type: 'agent:started',
      agentId: run.agent_id,
      taskId: run.task_id,
      runId: id,
    });

    return run;
  }

  async finish(
    id: string,
    status: RunStatus,
    tokens?: TokenUsage,
    error?: string,
  ): Promise<Run> {
    const run = await this.runStore.get(id);
    if (!run) throw new Error(`Run not found: ${id}`);

    run.status = status;
    run.finished_at = new Date().toISOString();
    run.tokens = tokens;
    run.error = error;
    await this.runStore.save(run);

    this.eventBus.emit({
      type: 'agent:completed',
      runId: id,
      agentId: run.agent_id,
      success: status === 'succeeded',
    });

    return run;
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    await this.runStore.appendEvent(runId, event);
  }

  async listAll(): Promise<Run[]> {
    return this.runStore.listAll();
  }

  async listForTask(taskId: string): Promise<Run[]> {
    return this.runStore.listForTask(taskId);
  }

  async listForAgent(agentId: string): Promise<Run[]> {
    return this.runStore.listForAgent(agentId);
  }

  async readEvents(runId: string): Promise<RunEvent[]> {
    return this.runStore.readEvents(runId);
  }

  async readEventsTail(runId: string, count: number): Promise<RunEvent[]> {
    return this.runStore.readEventsTail(runId, count);
  }

  /**
   * Get error and last N lines of output from the most recent failed run for a task.
   * Used to provide retry context so agents can learn from previous failures.
   */
  async getLastFailedRunContext(
    taskId: string,
  ): Promise<{ error: string; output: string } | null> {
    const runs = await this.runStore.listForTask(taskId);
    const failedRun = runs
      .filter((r) => r.status === 'failed')
      .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
      [0];

    if (!failedRun) return null;

    const error = failedRun.error ?? 'Unknown error';

    // Read all events and extract output lines
    let output = '';
    try {
      const events = await this.runStore.readEvents(failedRun.id);
      output = events
        .filter((e) => e.type === 'agent_output' || e.type === 'error')
        .map((e) => (typeof e.data === 'string' ? e.data : JSON.stringify(e.data)))
        .join('\n');
    } catch {
      // Events file may not exist — that's fine
    }

    return { error, output };
  }
}
