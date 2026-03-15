/**
 * File-based message store.
 *
 * Each message is a JSON file in .orchestry/messages/.
 * An _index.json file caches the full list for fast list() calls.
 * All writes are atomic (temp → rename).
 */

import type { Message } from '../../domain/message.js';
import type { IMessageStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { ensureDir, readJson, writeJson } from './fs-utils.js';
import { IndexManager } from './index-manager.js';
import fs from 'node:fs/promises';

export class MessageStore implements IMessageStore {
  private readonly index: IndexManager<Message>;

  constructor(private readonly paths: Paths) {
    this.index = new IndexManager<Message>({
      dir: paths.messagesDir,
      ext: '.json',
      itemPath: (id) => paths.messagePath(id),
      fileFilter: (fileName) => fileName !== '_index.json',
    });
  }

  async save(message: Message): Promise<void> {
    await ensureDir(this.paths.messagesDir);
    await writeJson(this.paths.messagePath(message.id), message);
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== message.id);
      filtered.push(message);
      return filtered;
    });
  }

  async get(id: string): Promise<Message | null> {
    return readJson<Message>(this.paths.messagePath(id));
  }

  async list(): Promise<Message[]> {
    const all = await this.index.readIndex();
    return all
      .filter((m): m is Message => m !== null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async listPending(agentId: string): Promise<Message[]> {
    const all = await this.list();
    const now = Date.now();
    return all.filter((m) => {
      if (m.status !== 'pending') return false;
      if (m.expires_at && new Date(m.expires_at).getTime() < now) return false;
      return m.to_agent_id === agentId;
    });
  }

  async markDelivered(id: string): Promise<void> {
    const msg = await this.get(id);
    if (!msg) return;
    msg.status = 'delivered';
    msg.delivered_at = new Date().toISOString();
    await writeJson(this.paths.messagePath(id), msg);
    // Update the index entry
    await this.index.updateIndex((idx) => {
      const filtered = idx.filter((m) => m.id !== id);
      filtered.push(msg);
      return filtered;
    });
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.messagePath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await this.index.updateIndex((idx) => idx.filter((m) => m.id !== id));
  }

  async purgeExpired(): Promise<number> {
    const all = await this.list();
    const now = Date.now();
    const toDelete = all.filter((m) => {
      const isExpired = m.expires_at && new Date(m.expires_at).getTime() < now;
      const isOldDelivered = m.delivered_at && now - new Date(m.delivered_at).getTime() > 3600_000;
      return isExpired || isOldDelivered;
    });
    const idsToDelete = new Set(toDelete.map((m) => m.id));

    // Delete files in parallel
    await Promise.all(
      toDelete.map(async (m) => {
        try {
          await fs.unlink(this.paths.messagePath(m.id));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }),
    );

    // Single index update to avoid parallel read/write race
    await this.index.updateIndex((idx) => idx.filter((m) => !idsToDelete.has(m.id)));

    return toDelete.length;
  }
}
