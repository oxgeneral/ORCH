/**
 * TeamService — business logic for team lifecycle.
 *
 * Manages team creation, membership, task pool, and self-claiming.
 */

import { nanoid } from 'nanoid';
import type { Team, CreateTeamInput, TeamMember } from '../domain/team.js';
import { DEFAULT_TEAM_CONFIG } from '../domain/team.js';
import { InvalidArgumentsError, TeamNotFoundError } from '../domain/errors.js';
import type { ITeamStore, IAgentStore, ITaskStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';

export class TeamService {
  constructor(
    private readonly teamStore: ITeamStore,
    private readonly agentStore: IAgentStore,
    private readonly taskStore: ITaskStore,
    private readonly eventBus: EventBus,
  ) {}

  async create(input: CreateTeamInput): Promise<Team> {
    if (!input.name.trim()) throw new InvalidArgumentsError('Team name is required');

    const lead = await this.agentStore.get(input.lead_agent_id);
    if (!lead) throw new InvalidArgumentsError(`Lead agent not found: ${input.lead_agent_id}`);

    const existing = await this.teamStore.getByName(input.name.trim());
    if (existing) throw new InvalidArgumentsError(`Team "${input.name}" already exists`);

    const now = new Date().toISOString();
    const leadMember: TeamMember = { agent_id: input.lead_agent_id, role: 'lead', joined_at: now };

    const additionalMembers: TeamMember[] = [];
    for (const agentId of input.member_agent_ids ?? []) {
      if (agentId === input.lead_agent_id) continue;
      const agent = await this.agentStore.get(agentId);
      if (!agent) throw new InvalidArgumentsError(`Member agent not found: ${agentId}`);
      additionalMembers.push({ agent_id: agentId, role: 'member', joined_at: now });
    }

    const team: Team = {
      id: `team_${nanoid(7)}`,
      name: input.name.trim(),
      description: input.description,
      status: 'active',
      members: [leadMember, ...additionalMembers],
      task_pool: [],
      lead_agent_id: input.lead_agent_id,
      created_at: now,
      updated_at: now,
      config: { ...DEFAULT_TEAM_CONFIG, ...(input.config ?? {}) },
    };

    await this.teamStore.save(team);

    this.eventBus.emit({ type: 'team:created', teamId: team.id, name: team.name, leadAgentId: team.lead_agent_id });
    for (const member of additionalMembers) {
      this.eventBus.emit({ type: 'team:member_joined', teamId: team.id, agentId: member.agent_id });
    }

    return team;
  }

  async get(id: string): Promise<Team> {
    const team = await this.teamStore.get(id);
    if (!team) throw new TeamNotFoundError(id);
    return team;
  }

  async list(): Promise<Team[]> {
    return this.teamStore.list();
  }

  async join(teamId: string, agentId: string): Promise<Team> {
    const team = await this.get(teamId);
    if (team.members.some((m) => m.agent_id === agentId)) {
      throw new InvalidArgumentsError(`Agent ${agentId} is already a member of team ${teamId}`);
    }
    const agent = await this.agentStore.get(agentId);
    if (!agent) throw new InvalidArgumentsError(`Agent not found: ${agentId}`);

    team.members.push({ agent_id: agentId, role: 'member', joined_at: new Date().toISOString() });
    team.updated_at = new Date().toISOString();
    await this.teamStore.save(team);

    this.eventBus.emit({ type: 'team:member_joined', teamId, agentId });
    return team;
  }

  async leave(teamId: string, agentId: string): Promise<Team> {
    const team = await this.get(teamId);
    if (agentId === team.lead_agent_id) {
      throw new InvalidArgumentsError('Lead cannot leave team. Disband the team or transfer lead first.');
    }
    team.members = team.members.filter((m) => m.agent_id !== agentId);
    team.updated_at = new Date().toISOString();
    await this.teamStore.save(team);

    this.eventBus.emit({ type: 'team:member_left', teamId, agentId });
    return team;
  }

  async addTask(teamId: string, taskId: string): Promise<Team> {
    const team = await this.get(teamId);
    const task = await this.taskStore.get(taskId);
    if (!task) throw new InvalidArgumentsError(`Task not found: ${taskId}`);

    if (!team.task_pool.includes(taskId)) {
      team.task_pool.push(taskId);
      team.updated_at = new Date().toISOString();
      await this.teamStore.save(team);
      this.eventBus.emit({ type: 'team:task_added', teamId, taskId });
    }
    return team;
  }

  async removeTask(teamId: string, taskId: string): Promise<Team> {
    const team = await this.get(teamId);
    team.task_pool = team.task_pool.filter((id) => id !== taskId);
    team.updated_at = new Date().toISOString();
    await this.teamStore.save(team);
    return team;
  }

  async setLead(teamId: string, agentId: string): Promise<Team> {
    const team = await this.get(teamId);
    const member = team.members.find((m) => m.agent_id === agentId);
    if (!member) throw new InvalidArgumentsError(`Agent ${agentId} is not a member of team ${teamId}`);

    // Demote current lead
    const currentLead = team.members.find((m) => m.agent_id === team.lead_agent_id);
    if (currentLead) currentLead.role = 'member';

    member.role = 'lead';
    team.lead_agent_id = agentId;
    team.updated_at = new Date().toISOString();
    await this.teamStore.save(team);
    return team;
  }

  async disband(teamId: string): Promise<void> {
    const team = await this.get(teamId);
    team.status = 'disbanded';
    team.updated_at = new Date().toISOString();
    await this.teamStore.save(team);
    this.eventBus.emit({ type: 'team:disbanded', teamId });
  }

  /**
   * Find the team an agent belongs to (if any).
   */
  async findTeamForAgent(agentId: string): Promise<Team | null> {
    const teams = await this.teamStore.list();
    return teams.find((t) => t.status === 'active' && t.members.some((m) => m.agent_id === agentId)) ?? null;
  }
}
