import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageService } from '../../../src/application/message-service.js';
import { EventBus } from '../../../src/application/event-bus.js';
import { InvalidArgumentsError } from '../../../src/domain/errors.js';
import type { IMessageStore, IAgentStore, ITeamStore } from '../../../src/infrastructure/storage/interfaces.js';
import type { Message } from '../../../src/domain/message.js';
import {
  makeAgent,
  createMockAgentStore,
  createMockMessageStore,
  createMockTeamStore,
} from './helpers.js';
import type { Team } from '../../../src/domain/team.js';

let messageStore: IMessageStore;
let agentStore: IAgentStore;
let teamStore: ITeamStore;
let eventBus: EventBus;
let service: MessageService;

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team_t1',
    name: 'Test Team',
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
  messageStore = createMockMessageStore();
  agentStore = createMockAgentStore([
    makeAgent({ id: 'agt_sender', name: 'Sender' }),
    makeAgent({ id: 'agt_receiver', name: 'Receiver' }),
    makeAgent({ id: 'agt_lead', name: 'Lead' }),
    makeAgent({ id: 'agt_m1', name: 'Member1' }),
    makeAgent({ id: 'agt_disabled', name: 'Disabled', status: 'disabled' }),
  ]);
  teamStore = createMockTeamStore();
  eventBus = new EventBus();
  service = new MessageService(messageStore, agentStore, teamStore, eventBus);
});

describe('MessageService', () => {
  describe('send direct message', () => {
    it('creates message with correct fields', async () => {
      const messages = await service.send({
        channel: 'direct',
        from_agent_id: 'agt_sender',
        to_agent_id: 'agt_receiver',
        subject: 'Test Subject',
        body: 'Hello from sender',
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].channel).toBe('direct');
      expect(messages[0].from_agent_id).toBe('agt_sender');
      expect(messages[0].to_agent_id).toBe('agt_receiver');
      expect(messages[0].subject).toBe('Test Subject');
      expect(messages[0].body).toBe('Hello from sender');
      expect(messages[0].status).toBe('pending');
      expect(messages[0].id).toMatch(/^msg_/);
      expect(messages[0].created_at).toBeDefined();
      expect(messages[0].expires_at).toBeDefined();
      expect(messageStore.save).toHaveBeenCalledOnce();
    });

    it('throws if recipient not found', async () => {
      await expect(
        service.send({
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_nonexistent',
          subject: 'Test',
          body: 'Hello',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('throws if body is empty', async () => {
      await expect(
        service.send({
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'Test',
          body: '   ',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });
  });

  describe('send broadcast', () => {
    it('creates one message per non-sender agent', async () => {
      const messages = await service.send({
        channel: 'broadcast',
        from_agent_id: 'agt_sender',
        subject: 'Broadcast',
        body: 'Hello everyone',
      });

      // Should create messages for all agents except sender and disabled
      // agt_receiver, agt_lead, agt_m1 = 3 recipients
      expect(messages).toHaveLength(3);
      const recipientIds = messages.map((m) => m.to_agent_id);
      expect(recipientIds).not.toContain('agt_sender');
      expect(recipientIds).not.toContain('agt_disabled');
      expect(messageStore.save).toHaveBeenCalledTimes(3);
    });

    it('with team_id filters to team members', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(team);

      const messages = await service.send({
        channel: 'broadcast',
        from_agent_id: 'agt_lead',
        subject: 'Team broadcast',
        body: 'Team message',
        team_id: 'team_t1',
      });

      // Only agt_m1 should receive (agt_lead is sender, excluded)
      expect(messages).toHaveLength(1);
      expect(messages[0].to_agent_id).toBe('agt_m1');
    });
  });

  describe('send lead channel', () => {
    it('resolves to team lead', async () => {
      const team = makeTeam();
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(team);

      const messages = await service.send({
        channel: 'lead',
        from_agent_id: 'agt_m1',
        subject: 'To lead',
        body: 'Need guidance',
        team_id: 'team_t1',
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].to_agent_id).toBe('agt_lead');
      expect(messages[0].channel).toBe('lead');
    });

    it('throws without team_id', async () => {
      await expect(
        service.send({
          channel: 'lead',
          from_agent_id: 'agt_m1',
          subject: 'To lead',
          body: 'Need guidance',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('throws if team not found', async () => {
      (teamStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        service.send({
          channel: 'lead',
          from_agent_id: 'agt_m1',
          subject: 'To lead',
          body: 'Need guidance',
          team_id: 'team_nonexistent',
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });
  });

  describe('drainMailbox', () => {
    it('returns pending messages and marks them delivered', async () => {
      const pending: Message[] = [
        {
          id: 'msg_1',
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'Hi',
          body: 'Hello',
          created_at: '2025-01-01T00:00:00Z',
          status: 'pending',
        },
        {
          id: 'msg_2',
          channel: 'broadcast',
          from_agent_id: 'agt_lead',
          to_agent_id: 'agt_receiver',
          subject: 'Update',
          body: 'News',
          created_at: '2025-01-01T00:01:00Z',
          status: 'pending',
        },
      ];
      (messageStore.listPending as ReturnType<typeof vi.fn>).mockResolvedValue(pending);

      const result = await service.drainMailbox('agt_receiver', 'tsk_1');

      expect(result).toHaveLength(2);
      expect(messageStore.markDelivered).toHaveBeenCalledTimes(2);
      expect(messageStore.markDelivered).toHaveBeenCalledWith('msg_1');
      expect(messageStore.markDelivered).toHaveBeenCalledWith('msg_2');
    });

    it('emits message:delivered events', async () => {
      const pending: Message[] = [
        {
          id: 'msg_ev',
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'Hi',
          body: 'Hello',
          created_at: '2025-01-01T00:00:00Z',
          status: 'pending',
        },
      ];
      (messageStore.listPending as ReturnType<typeof vi.fn>).mockResolvedValue(pending);

      const events: any[] = [];
      eventBus.on('message:delivered', (e) => events.push(e));

      await service.drainMailbox('agt_receiver', 'tsk_1');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'message:delivered',
        messageId: 'msg_ev',
        toAgentId: 'agt_receiver',
        taskId: 'tsk_1',
      });
    });
  });

  describe('listForAgent', () => {
    it('returns messages sent to and from agent', async () => {
      const messages: Message[] = [
        {
          id: 'msg_to',
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'To',
          body: 'To receiver',
          created_at: '2025-01-01T00:00:00Z',
          status: 'pending',
        },
        {
          id: 'msg_from',
          channel: 'direct',
          from_agent_id: 'agt_receiver',
          to_agent_id: 'agt_sender',
          subject: 'From',
          body: 'From receiver',
          created_at: '2025-01-01T00:01:00Z',
          status: 'pending',
        },
        {
          id: 'msg_unrelated',
          channel: 'direct',
          from_agent_id: 'agt_lead',
          to_agent_id: 'agt_m1',
          subject: 'Other',
          body: 'Unrelated',
          created_at: '2025-01-01T00:02:00Z',
          status: 'pending',
        },
      ];
      (messageStore.list as ReturnType<typeof vi.fn>).mockResolvedValue(messages);

      const result = await service.listForAgent('agt_receiver');
      expect(result).toHaveLength(2);
      expect(result.map((m) => m.id).sort()).toEqual(['msg_from', 'msg_to']);
    });
  });

  describe('purgeExpired', () => {
    it('delegates to store', async () => {
      (messageStore.purgeExpired as ReturnType<typeof vi.fn>).mockResolvedValue(5);

      const count = await service.purgeExpired();
      expect(count).toBe(5);
      expect(messageStore.purgeExpired).toHaveBeenCalledOnce();
    });
  });

  describe('send emits message:sent event', () => {
    it('emits message:sent for direct message', async () => {
      const events: any[] = [];
      eventBus.on('message:sent', (e) => events.push(e));

      await service.send({
        channel: 'direct',
        from_agent_id: 'agt_sender',
        to_agent_id: 'agt_receiver',
        subject: 'Test',
        body: 'Hello',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'message:sent',
        fromAgentId: 'agt_sender',
        toAgentId: 'agt_receiver',
        channel: 'direct',
      });
    });
  });

  describe('TTL validation', () => {
    it('throws if TTL is zero', async () => {
      await expect(
        service.send({
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'Test',
          body: 'Hello',
          ttl_ms: 0,
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });

    it('throws if TTL exceeds max', async () => {
      await expect(
        service.send({
          channel: 'direct',
          from_agent_id: 'agt_sender',
          to_agent_id: 'agt_receiver',
          subject: 'Test',
          body: 'Hello',
          ttl_ms: 8 * 24 * 60 * 60 * 1000, // 8 days
        }),
      ).rejects.toThrow(InvalidArgumentsError);
    });
  });
});
