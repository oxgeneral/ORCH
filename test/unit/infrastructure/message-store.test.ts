import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MessageStore } from '../../../src/infrastructure/storage/message-store.js';
import { Paths } from '../../../src/infrastructure/storage/paths.js';
import type { Message } from '../../../src/domain/message.js';

let tmpDir: string;
let paths: Paths;
let store: MessageStore;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_test1',
    channel: 'direct',
    from_agent_id: 'agt_sender',
    to_agent_id: 'agt_receiver',
    subject: 'Hello',
    body: 'Test message body',
    created_at: '2025-01-01T00:00:00Z',
    status: 'pending',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-msgstore-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new MessageStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('MessageStore', () => {
  it('save and get a message', async () => {
    const msg = makeMessage();
    await store.save(msg);
    const retrieved = await store.get('msg_test1');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('msg_test1');
    expect(retrieved!.channel).toBe('direct');
    expect(retrieved!.from_agent_id).toBe('agt_sender');
    expect(retrieved!.to_agent_id).toBe('agt_receiver');
    expect(retrieved!.subject).toBe('Hello');
    expect(retrieved!.body).toBe('Test message body');
    expect(retrieved!.status).toBe('pending');
  });

  it('list returns all messages sorted by created_at', async () => {
    const msg1 = makeMessage({ id: 'msg_a', created_at: '2025-01-03T00:00:00Z' });
    const msg2 = makeMessage({ id: 'msg_b', created_at: '2025-01-01T00:00:00Z' });
    const msg3 = makeMessage({ id: 'msg_c', created_at: '2025-01-02T00:00:00Z' });

    await store.save(msg1);
    await store.save(msg2);
    await store.save(msg3);

    const list = await store.list();
    expect(list).toHaveLength(3);
    expect(list.map((m) => m.id)).toEqual(['msg_b', 'msg_c', 'msg_a']);
  });

  it('listPending returns only pending messages for specific agent, excludes expired and delivered', async () => {
    const pending = makeMessage({
      id: 'msg_pending',
      to_agent_id: 'agt_target',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const delivered = makeMessage({
      id: 'msg_delivered',
      to_agent_id: 'agt_target',
      status: 'delivered',
    });
    const expired = makeMessage({
      id: 'msg_expired',
      to_agent_id: 'agt_target',
      status: 'pending',
      expires_at: '2020-01-01T00:00:00Z',
    });
    const otherAgent = makeMessage({
      id: 'msg_other',
      to_agent_id: 'agt_other',
      status: 'pending',
    });

    await store.save(pending);
    await store.save(delivered);
    await store.save(expired);
    await store.save(otherAgent);

    const result = await store.listPending('agt_target');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('msg_pending');
  });

  it('listForTeam returns messages for a team', async () => {
    const teamMsg = makeMessage({ id: 'msg_team', team_id: 'team_alpha' });
    const noTeamMsg = makeMessage({ id: 'msg_noteam' });
    const otherTeamMsg = makeMessage({ id: 'msg_other', team_id: 'team_beta' });

    await store.save(teamMsg);
    await store.save(noTeamMsg);
    await store.save(otherTeamMsg);

    const result = await store.listForTeam('team_alpha');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('msg_team');
  });

  it('markDelivered updates status and delivered_at', async () => {
    const msg = makeMessage({ id: 'msg_deliver' });
    await store.save(msg);

    await store.markDelivered('msg_deliver');

    const updated = await store.get('msg_deliver');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('delivered');
    expect(updated!.delivered_at).toBeDefined();
  });

  it('delete removes the file', async () => {
    const msg = makeMessage({ id: 'msg_del' });
    await store.save(msg);

    await store.delete('msg_del');

    const result = await store.get('msg_del');
    expect(result).toBeNull();
  });

  it('purgeExpired removes expired and old delivered messages', async () => {
    const expiredMsg = makeMessage({
      id: 'msg_exp',
      status: 'pending',
      expires_at: '2020-01-01T00:00:00Z',
    });
    const oldDelivered = makeMessage({
      id: 'msg_old_del',
      status: 'delivered',
      delivered_at: new Date(Date.now() - 7_200_000).toISOString(), // 2 hours ago
    });
    const freshMsg = makeMessage({
      id: 'msg_fresh',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await store.save(expiredMsg);
    await store.save(oldDelivered);
    await store.save(freshMsg);

    const count = await store.purgeExpired();
    expect(count).toBe(2);

    const remaining = await store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('msg_fresh');
  });

  it('get returns null for non-existent message', async () => {
    const result = await store.get('msg_nonexistent');
    expect(result).toBeNull();
  });
});
