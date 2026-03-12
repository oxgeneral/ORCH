/**
 * Team domain model.
 *
 * A Team groups agents with a lead for coordinated work.
 * Teams share a task pool and enable broadcast messaging.
 */

export type TeamStatus = 'active' | 'paused' | 'disbanded';

export interface TeamMember {
  agent_id: string;
  role: 'lead' | 'member';
  joined_at: string;
}

export interface Team {
  id: string;
  name: string;
  description?: string;
  status: TeamStatus;
  members: TeamMember[];
  task_pool: string[];
  lead_agent_id: string;
  created_at: string;
  updated_at: string;
  config: TeamConfig;
}

export interface TeamConfig {
  max_concurrent_tasks?: number;
  auto_claim: boolean;
  message_ttl_ms?: number;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  lead_agent_id: string;
  member_agent_ids?: string[];
  config?: Partial<TeamConfig>;
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  auto_claim: true,
  message_ttl_ms: 24 * 60 * 60 * 1000,
};
