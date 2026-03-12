/**
 * MessageService — business logic for inter-agent messaging.
 *
 * Handles message creation, routing (direct/broadcast/lead),
 * delivery into agent prompts, and cleanup of expired messages.
 */

import { nanoid } from 'nanoid';
import type { Message, CreateMessageInput, MessageChannel } from '../domain/message.js';
import { DEFAULT_MESSAGE_TTL_MS, MAX_MESSAGE_TTL_MS } from '../domain/message.js';
import { InvalidArgumentsError } from '../domain/errors.js';
import type { IMessageStore, IAgentStore, ITeamStore } from '../infrastructure/storage/interfaces.js';
import type { EventBus } from './event-bus.js';

export class MessageService {
  constructor(
    private readonly messageStore: IMessageStore,
    private readonly agentStore: IAgentStore,
    private readonly teamStore: ITeamStore,
    private readonly eventBus: EventBus,
  ) {}

  /**
   * Send a message. For broadcast, creates one message per recipient agent.
   * For 'lead' channel, resolves team lead and sends direct.
   */
  async send(input: CreateMessageInput): Promise<Message[]> {
    if (!input.body.trim()) throw new InvalidArgumentsError('Message body is required');

    const ttlMs = input.ttl_ms ?? DEFAULT_MESSAGE_TTL_MS;
    if (ttlMs <= 0 || ttlMs > MAX_MESSAGE_TTL_MS) {
      throw new InvalidArgumentsError(`TTL must be between 1ms and ${MAX_MESSAGE_TTL_MS}ms`);
    }

    // Validate sender exists
    const sender = await this.agentStore.get(input.from_agent_id);
    if (!sender && input.from_agent_id !== 'cli') {
      throw new InvalidArgumentsError(`Sender agent not found: ${input.from_agent_id}`);
    }

    const now = new Date();
    const baseMessage = {
      channel: input.channel,
      from_agent_id: input.from_agent_id,
      subject: (input.subject || '(no subject)').slice(0, 200),
      body: input.body.slice(0, 4000),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      status: 'pending' as const,
      team_id: input.team_id,
      reply_to: input.reply_to,
    };

    const messages: Message[] = [];

    if (input.channel === 'broadcast') {
      // Fan-out: one message per agent (excluding sender)
      let agents = await this.agentStore.list();

      // If team_id specified, only broadcast to team members
      if (input.team_id) {
        const team = await this.teamStore.get(input.team_id);
        if (team) {
          const memberIds = new Set(team.members.map((m) => m.agent_id));
          agents = agents.filter((a) => memberIds.has(a.id));
        }
      }

      const recipients = agents.filter((a) => a.id !== input.from_agent_id && a.status !== 'disabled');
      const broadcastMsgs = recipients.map((agent) => ({
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: agent.id,
      } as Message));
      await Promise.all(broadcastMsgs.map((msg) => this.messageStore.save(msg)));
      for (const msg of broadcastMsgs) {
        messages.push(msg);
        this.emitSent(msg);
      }
    } else if (input.channel === 'lead') {
      // Resolve team lead
      if (!input.team_id) throw new InvalidArgumentsError('team_id is required for lead channel');
      const team = await this.teamStore.get(input.team_id);
      if (!team) throw new InvalidArgumentsError(`Team not found: ${input.team_id}`);

      const msg: Message = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: team.lead_agent_id,
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    } else {
      // Direct message
      if (!input.to_agent_id) throw new InvalidArgumentsError('to_agent_id is required for direct messages');
      const recipient = await this.agentStore.get(input.to_agent_id);
      if (!recipient) throw new InvalidArgumentsError(`Recipient agent not found: ${input.to_agent_id}`);

      const msg: Message = {
        ...baseMessage,
        id: `msg_${nanoid(7)}`,
        to_agent_id: input.to_agent_id,
      };
      await this.messageStore.save(msg);
      messages.push(msg);
      this.emitSent(msg);
    }

    return messages;
  }

  /**
   * Drain mailbox: fetch pending messages for an agent and mark them delivered.
   * Called by the orchestrator during dispatchTask.
   */
  async drainMailbox(agentId: string, taskId: string): Promise<Message[]> {
    const pending = await this.messageStore.listPending(agentId);
    await Promise.all(pending.map((msg) => this.messageStore.markDelivered(msg.id)));
    for (const msg of pending) {
      this.eventBus.emit({
        type: 'message:delivered',
        messageId: msg.id,
        toAgentId: agentId,
        taskId,
      });
    }
    return pending;
  }

  async listAll(): Promise<Message[]> {
    return this.messageStore.list();
  }

  async listPendingForAgent(agentId: string): Promise<Message[]> {
    return this.messageStore.listPending(agentId);
  }

  async listForAgent(agentId: string): Promise<Message[]> {
    const all = await this.messageStore.list();
    return all.filter((m) => m.to_agent_id === agentId || m.from_agent_id === agentId);
  }

  async purgeExpired(): Promise<number> {
    return this.messageStore.purgeExpired();
  }

  private emitSent(msg: Message): void {
    this.eventBus.emit({
      type: 'message:sent',
      messageId: msg.id,
      fromAgentId: msg.from_agent_id,
      toAgentId: msg.to_agent_id,
      channel: msg.channel,
    });
  }
}
