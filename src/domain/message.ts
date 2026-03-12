/**
 * Message domain model.
 *
 * A Message is a unit of inter-agent communication.
 * Messages are stored as JSON files and injected into agent prompts at dispatch time.
 */

export type MessageChannel = 'direct' | 'broadcast' | 'lead';

export type MessageStatus = 'pending' | 'delivered' | 'expired';

export interface Message {
  id: string;
  channel: MessageChannel;
  from_agent_id: string;
  to_agent_id: string | null;
  subject: string;
  body: string;
  created_at: string;
  expires_at?: string;
  status: MessageStatus;
  delivered_at?: string;
  team_id?: string;
  reply_to?: string;
}

export interface CreateMessageInput {
  channel: MessageChannel;
  from_agent_id: string;
  to_agent_id?: string;
  subject: string;
  body: string;
  ttl_ms?: number;
  team_id?: string;
  reply_to?: string;
}

/** Maximum TTL: 7 days */
export const MAX_MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default TTL: 24 hours */
export const DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
