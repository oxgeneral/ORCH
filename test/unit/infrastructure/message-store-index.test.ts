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

function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    channel: 'direct',
    from_agent_id: 'agt_sender',
    to_agent_id: 'agt_receiver',
    subject: 'Test',
    body: 'Test body',
    created_at: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestry-msgstore-idx-'));
  await fs.mkdir(path.join(tmpDir, '.orchestry'), { recursive: true });
  paths = new Paths(tmpDir);
  store = new MessageStore(paths);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('MessageStore _index.json cache', () => {
  it('creates _index.json on first save()', async () => {
    await store.save(makeMessage('msg_1'));
    const indexPath = path.join(paths.messagesDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Message[];
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('msg_1');
  });

  it('list() reads from _index.json instead of individual files', async () => {
    await store.save(makeMessage('msg_a'));
    await store.save(makeMessage('msg_b'));

    const messages = await store.list();
    expect(messages).toHaveLength(2);
    const ids = messages.map((m) => m.id).sort();
    expect(ids).toEqual(['msg_a', 'msg_b']);
  });

  it('delete() removes entry from _index.json', async () => {
    await store.save(makeMessage('msg_a'));
    await store.save(makeMessage('msg_b'));
    await store.delete('msg_a');

    const indexPath = path.join(paths.messagesDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Message[];
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('msg_b');
  });

  it('rebuilds index when _index.json is missing', async () => {
    await store.save(makeMessage('msg_x'));
    await store.save(makeMessage('msg_y'));

    // Delete the index file
    const indexPath = path.join(paths.messagesDir, '_index.json');
    await fs.unlink(indexPath);

    // list() should rebuild from individual JSON files
    const messages = await store.list();
    expect(messages).toHaveLength(2);
    const ids = messages.map((m) => m.id).sort();
    expect(ids).toEqual(['msg_x', 'msg_y']);

    // Index should be recreated
    await expect(fs.access(indexPath)).resolves.not.toThrow();
  });

  it('rebuilds index when _index.json is corrupted', async () => {
    await store.save(makeMessage('msg_ok'));

    // Corrupt the index
    const indexPath = path.join(paths.messagesDir, '_index.json');
    await fs.writeFile(indexPath, '{{not valid json');

    // list() should rebuild
    const messages = await store.list();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg_ok');
  });

  it('save() updates existing entry in index', async () => {
    await store.save(makeMessage('msg_1', { subject: 'Original' }));
    await store.save(makeMessage('msg_1', { subject: 'Updated' }));

    const indexPath = path.join(paths.messagesDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Message[];
    expect(index).toHaveLength(1);
    expect(index[0].subject).toBe('Updated');
  });

  it('does not include _index.json as a message during rebuild', async () => {
    await store.save(makeMessage('msg_1'));
    await store.save(makeMessage('msg_2'));

    // Delete the index to force rebuild
    const indexPath = path.join(paths.messagesDir, '_index.json');
    await fs.unlink(indexPath);

    // Write a fake _index.json that should be filtered out during rebuild
    await fs.writeFile(indexPath, '[]');
    await fs.unlink(indexPath);

    const messages = await store.list();
    expect(messages).toHaveLength(2);
    // Verify none of the entries is from _index.json
    for (const msg of messages) {
      expect(msg.id).toMatch(/^msg_/);
    }
  });

  it('markDelivered updates the index', async () => {
    await store.save(makeMessage('msg_mark', { status: 'pending' }));

    await store.markDelivered('msg_mark');

    const indexPath = path.join(paths.messagesDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Message[];
    expect(index).toHaveLength(1);
    expect(index[0].status).toBe('delivered');
    expect(index[0].delivered_at).toBeDefined();
  });

  it('purgeExpired updates the index', async () => {
    await store.save(
      makeMessage('msg_expired', {
        status: 'pending',
        expires_at: '2020-01-01T00:00:00Z',
      }),
    );
    await store.save(
      makeMessage('msg_fresh', {
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const count = await store.purgeExpired();
    expect(count).toBe(1);

    const indexPath = path.join(paths.messagesDir, '_index.json');
    const raw = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(raw) as Message[];
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe('msg_fresh');
  });
});
