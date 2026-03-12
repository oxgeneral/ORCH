/**
 * Agent service — business logic for agent lifecycle.
 *
 * Manages agent CRUD, availability, and task assignment matching.
 */

import { nanoid } from 'nanoid';
import type { Agent, CreateAgentInput, AgentStatus } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import { AgentNotFoundError, InvalidArgumentsError } from '../domain/errors.js';
import type { IAgentStore, IStateStore } from '../infrastructure/storage/interfaces.js';
import type { OrchestratorConfig } from '../domain/config.js';
import type { EventBus } from './event-bus.js';

export class AgentService {
  constructor(
    private readonly agentStore: IAgentStore,
    private readonly stateStore: IStateStore,
    private readonly eventBus: EventBus,
    private readonly config: OrchestratorConfig,
  ) {}

  async create(input: CreateAgentInput): Promise<Agent> {
    if (!input.name.trim()) {
      throw new InvalidArgumentsError('Agent name is required');
    }

    // Check for duplicate name
    const existing = await this.agentStore.getByName(input.name);
    if (existing) {
      throw new InvalidArgumentsError(`Agent "${input.name}" already exists`);
    }

    const agent: Agent = {
      id: `agt_${nanoid(7)}`,
      name: input.name.trim(),
      adapter: input.adapter || this.config.defaults.agent.adapter,
      role: input.role,
      config: {
        command: input.command,
        model: input.model,
        approval_policy: input.approval_policy ?? this.config.defaults.agent.approval_policy,
        max_turns: input.max_turns ?? this.config.defaults.agent.max_turns,
        timeout_ms: input.timeout_ms ?? this.config.defaults.agent.timeout_ms,
        stall_timeout_ms: input.stall_timeout_ms ?? this.config.defaults.agent.stall_timeout_ms,
        env: input.env,
        system_prompt: input.system_prompt,
        workspace_mode: input.workspace_mode,
        skills: input.skills,
      },
      status: 'idle',
      stats: {
        tasks_completed: 0,
        tasks_failed: 0,
        total_runs: 0,
        total_runtime_ms: 0,
      },
    };

    await this.agentStore.save(agent);
    return agent;
  }

  async list(): Promise<Agent[]> {
    return this.agentStore.list();
  }

  async get(id: string): Promise<Agent> {
    const agent = await this.agentStore.get(id);
    if (!agent) throw new AgentNotFoundError(id);
    return agent;
  }

  async remove(id: string): Promise<void> {
    const agent = await this.get(id);
    if (agent.status === 'running') {
      // Check if actually running (has entry in state.running)
      const state = await this.stateStore.read();
      const isActuallyRunning = Object.values(state.running).some((e) => e.agent_id === id);
      if (isActuallyRunning) {
        throw new InvalidArgumentsError('Cannot remove a running agent. Stop it first.');
      }
      // Agent stuck in 'running' with no active run — reset and allow delete
      agent.status = 'idle';
      await this.agentStore.save(agent);
    }
    await this.agentStore.delete(id);
  }

  async update(id: string, fields: { name?: string; role?: string; model?: string; approval_policy?: Agent['config']['approval_policy'] }): Promise<Agent> {
    const agent = await this.get(id);

    if (fields.name !== undefined) {
      if (!fields.name.trim()) throw new InvalidArgumentsError('Agent name cannot be empty');
      // Check for duplicate name (excluding self)
      const existing = await this.agentStore.getByName(fields.name.trim());
      if (existing && existing.id !== id) {
        throw new InvalidArgumentsError(`Agent "${fields.name}" already exists`);
      }
      agent.name = fields.name.trim();
    }
    if (fields.role !== undefined) agent.role = fields.role || undefined;
    if (fields.model !== undefined) agent.config.model = fields.model || undefined;
    if (fields.approval_policy !== undefined) agent.config.approval_policy = fields.approval_policy;

    await this.agentStore.save(agent);
    return agent;
  }

  async disable(id: string): Promise<Agent> {
    return this.setStatus(id, 'disabled');
  }

  async enable(id: string): Promise<Agent> {
    return this.setStatus(id, 'idle');
  }

  async setAutonomous(id: string, enabled: boolean): Promise<Agent> {
    const agent = await this.get(id);
    agent.autonomous = enabled;
    await this.agentStore.save(agent);
    this.eventBus.emit({ type: 'agent:autonomous_toggled', agentId: id, autonomous: enabled });
    return agent;
  }

  async setStatus(id: string, status: AgentStatus): Promise<Agent> {
    const agent = await this.get(id);
    agent.status = status;
    await this.agentStore.save(agent);
    return agent;
  }

  async updateStats(
    id: string,
    update: Partial<Agent['stats']>,
  ): Promise<Agent> {
    const agent = await this.get(id);
    Object.assign(agent.stats, update);
    await this.agentStore.save(agent);
    return agent;
  }

  /**
   * Find the best available agent for a task using scoring.
   *
   * Scoring:
   * - Explicit assignee match = 100
   * - Skill match with task labels = 50 per match
   * - Role match with task labels = 30
   * - Idle status bonus = 20
   * - Success rate bonus = 0–10 (scaled by completed / total)
   */
  async findBestAgent(task: Task): Promise<Agent | null> {
    const agents = await this.agentStore.list();
    const available = agents.filter(
      (a) => a.status === 'idle',
    );

    if (available.length === 0) return null;

    // Explicit assignee — hard constraint
    if (task.assignee) {
      const assigned = agents.find((a) => a.id === task.assignee);
      if (assigned && assigned.status === 'idle') return assigned;
      return null;
    }

    // Score each available agent
    const scored = available.map((agent) => {
      let score = 0;

      // Skill match with task labels: 50 per matching skill
      if (task.labels?.length > 0 && agent.config.skills?.length) {
        for (const label of task.labels) {
          const lowerLabel = label.toLowerCase();
          if (agent.config.skills.some((s) => s.toLowerCase() === lowerLabel)) {
            score += 50;
          }
        }
      }

      // Role match with task labels: 30
      if (task.labels?.length > 0 && agent.role) {
        const lowerRole = agent.role.toLowerCase();
        if (task.labels.some((l) => lowerRole.includes(l.toLowerCase()))) {
          score += 30;
        }
      }

      // Idle bonus
      if (agent.status === 'idle') {
        score += 20;
      }

      // Success rate bonus: 0–10
      const totalTasks = agent.stats.tasks_completed + agent.stats.tasks_failed;
      if (totalTasks > 0) {
        score += Math.round((agent.stats.tasks_completed / totalTasks) * 10);
      }

      return { agent, score };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.agent ?? null;
  }
}
