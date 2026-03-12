import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamService } from '../../../src/application/team-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { InvalidArgumentsError, TeamNotFoundError } from '../../../src/domain/errors.js';
import type { ITeamStore, IAgentStore, ITaskStore } from '../../../src/infrastructure/storage/interfaces.js';
import type { Team } from '../../../src/domain/team.js';
import {
  makeAgent,
  makeTask,
  createMockAgentStore,
  createMockTaskStore,
  createMockTeamStore,
} from './helpers.js';

let teamStore: ITeamStore;
let agentStore: IAgentStore;
let taskStore: ITaskStore;
let eventBus: EventBus;
let service: TeamService;

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team_t1',
    name: 'Alpha Squad',
    status: 'active',
    members: [
      { agent_id: 'agt_lead', role: 'lead', joined_at: '2025-01-01T00:00:00Z' },
      { agent_id: 'agt_m1', role: 'member', joined_at: '2025-01-01T00:00:00Z' },
    ],
    task_pool: [],
    lead_agent_id: 'agt_lead',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    config: { auto_claim: true },
    ...overrides,
  };
}

beforeEach(() => {
  agentStore = createMockAgentStore([
    makeAgent({ id: 'agt_lead', name: 'Lead' }),
    makeAgent({ id: 'agt_m1', name: 'Member1' }),
    makeAgent({ id: 'agt_m2', name: 'Member2' }),
  ]);
  taskStore = createMockTaskStore([
    makeTask({ id: 'tsk_1', title: 'Task 1' }),
  ]);
  teamStore = createMockTeamStore();
  eventBus = new EventBus();
  service = new TeamService(teamStore, agentStore, taskStore, eventBus);
});

describe('TeamService', () => {
  describe('create', () => {
    it('creates team with valid input', async () => {
      const team = await service.create({
        name: 'New Team',
        lead_agent_id: 'agt_lead',
        member_agent_ids: ['agt_m1'],
      });

      expect(team.id).toMatch(/^team_/);
      expect(team.name).toBe('New Team');
      expect(team.status).toBe('active');
      expect(team.lead_agent_id).toBe('agt_lead');
      expect(team.members).toHaveLength(2);
      expect(team.members[0]).toMatchObject({ agent_id: 'agt_lead', role: 'lead' });
      expect(team.members[1]).toMatchObject({ agent_id: 'agt_m1', role: 'member' });
      expect(teamStore.save).toHaveBeenCalledOnce();
    });

    it('throws if lead agent not found', async () => {
      await expect(
        service.create({
          name: 'Bad Team',
          lead_agent_id: 'agt_nonexistent',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('throws if name already exists', async () => {
      const existing = makeTeam();
      (teamStore.getByName as ReturnType<typeof vi.fn>).mockResolvedValue(existing);

      await expect(
        service.create({
          name: 'Alpha Squad',
          lead_agent_id: 'agt_lead',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('throws if name is empty', async () => {
      await expect(
        service.create({
          name: '   ',
          lead_agent_id: 'agt_lead',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('emits team:created event', async () => {
      const events: any[] = [];
      eventBus.on('team:created', (e) => events.push(e));

      await service.create({
        name: 'EventTeam',
        lead_agent_id: 'agt_lead',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'team:created',
        name: 'EventTeam',
        leadAgentId: 'agt_lead',
      });
    });
  });

  describe('join', () => {
    it('adds member', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const updated = await service.join('team_t1', 'agt_m2');

      expect(updated.members).toHaveLength(3);
      const newMember = updated.members.find((m) => m.agent_id === 'agt_m2');
      expect(newMember).toBeDefined();
      expect(newMember!.role).toBe('member');
      expect(teamStore.save).toHaveBeenCalledOnce();
    });

    it('throws if agent already member', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      await expect(service.join('team_t1', 'agt_m1')).rejects.toThrow(InvalidArgumentsError);
    });

    it('emits team:member_joined event', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const events: any[] = [];
      eventBus.on('team:member_joined', (e) => events.push(e));

      await service.join('team_t1', 'agt_m2');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'team:member_joined',
        teamId: 'team_t1',
        agentId: 'agt_m2',
      });
    });
  });

  describe('leave', () => {
    it('removes member', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const updated = await service.leave('team_t1', 'agt_m1');

      expect(updated.members).toHaveLength(1);
      expect(updated.members[0].agent_id).toBe('agt_lead');
      expect(teamStore.save).toHaveBeenCalledOnce();
    });

    it('throws if trying to remove lead', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      await expect(service.leave('team_t1', 'agt_lead')).rejects.toThrow(InvalidArgumentsError);
    });

    it('emits team:member_left event', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const events: any[] = [];
      eventBus.on('team:member_left', (e) => events.push(e));

      await service.leave('team_t1', 'agt_m1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'team:member_left',
        teamId: 'team_t1',
        agentId: 'agt_m1',
      });
    });
  });

  describe('addTask', () => {
    it('adds task to pool', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const updated = await service.addTask('team_t1', 'tsk_1');

      expect(updated.task_pool).toContain('tsk_1');
      expect(teamStore.save).toHaveBeenCalledOnce();
    });

    it('throws if task not found', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      await expect(service.addTask('team_t1', 'tsk_nonexistent')).rejects.toThrow(
        InvalidArgumentsError,
      );
    });

    it('emits team:task_added event', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const events: any[] = [];
      eventBus.on('team:task_added', (e) => events.push(e));

      await service.addTask('team_t1', 'tsk_1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'team:task_added',
        teamId: 'team_t1',
        taskId: 'tsk_1',
      });
    });

    it('does not duplicate task in pool', async () => {
      const team = makeTeam({ task_pool: ['tsk_1'] });
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const updated = await service.addTask('team_t1', 'tsk_1');

      expect(updated.task_pool.filter((id) => id === 'tsk_1')).toHaveLength(1);
    });
  });

  describe('setLead', () => {
    it('transfers lead role', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const updated = await service.setLead('team_t1', 'agt_m1');

      expect(updated.lead_agent_id).toBe('agt_m1');
      const newLead = updated.members.find((m) => m.agent_id === 'agt_m1');
      expect(newLead!.role).toBe('lead');
      const oldLead = updated.members.find((m) => m.agent_id === 'agt_lead');
      expect(oldLead!.role).toBe('member');
      expect(teamStore.save).toHaveBeenCalledOnce();
    });

    it('throws if agent is not a member', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      await expect(service.setLead('team_t1', 'agt_m2')).rejects.toThrow(InvalidArgumentsError);
    });
  });

  describe('disband', () => {
    it('sets status to disbanded', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      await service.disband('team_t1');

      const savedTeam = (teamStore.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as Team;
      expect(savedTeam.status).toBe('disbanded');
    });

    it('emits team:disbanded event', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(structuredClone(team));

      const events: any[] = [];
      eventBus.on('team:disbanded', (e) => events.push(e));

      await service.disband('team_t1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'team:disbanded',
        teamId: 'team_t1',
      });
    });
  });

  describe('findTeamForAgent', () => {
    it('returns the team for an agent', async () => {
      const team = makeTeam();
      (teamStore.list as ReturnType<typeof vi.fn>).mockResolvedValue([team]);

      const found = await service.findTeamForAgent('agt_m1');
      expect(found).not.toBeNull();
      expect(found!.id).toBe('team_t1');
    });

    it('returns null if agent is not in any team', async () => {
      (teamStore.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const found = await service.findTeamForAgent('agt_m2');
      expect(found).toBeNull();
    });

    it('ignores disbanded teams', async () => {
      const team = makeTeam({ status: 'disbanded' });
      (teamStore.list as ReturnType<typeof vi.fn>).mockResolvedValue([team]);

      const found = await service.findTeamForAgent('agt_m1');
      expect(found).toBeNull();
    });
  });

  describe('get', () => {
    it('throws TeamNotFoundError for non-existent team', async () => {
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.get('team_nonexistent')).rejects.toThrow(TeamNotFoundError);
    });
  });
});
