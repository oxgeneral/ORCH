/**
 * File-based message store.
 *
 * Each message is a JSON file in .orchestry/messages/.
 * All writes are atomic (temp → rename).
 */

import type { Message } from '../../domain/message.js';
import type { IMessageStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { listFiles, readJson, writeJson, ensureDir } from './fs-utils.js';
import fs from 'node:fs/promises';

export class MessageStore implements IMessageStore {
  constructor(private readonly paths: Paths) {}

  async save(message: Message): Promise<void> {
    await ensureDir(this.paths.messagesDir);
    await writeJson(this.paths.messagePath(message.id), message);
  }

  async get(id: string): Promise<Message | null> {
    return readJson<Message>(this.paths.messagePath(id));
  }

  async list(): Promise<Message[]> {
    await ensureDir(this.paths.messagesDir);
    const files = await listFiles(this.paths.messagesDir, '.json');
    const results = await Promise.all(
      files.map((f) => readJson<Message>(this.paths.messagePath(f.replace('.json', '')))),
    );
    return results
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

  async listForTeam(teamId: string): Promise<Message[]> {
    const all = await this.list();
    return all.filter((m) => m.team_id === teamId);
  }

  async markDelivered(id: string): Promise<void> {
    const msg = await this.get(id);
    if (!msg) return;
    msg.status = 'delivered';
    msg.delivered_at = new Date().toISOString();
    await writeJson(this.paths.messagePath(id), msg);
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.paths.messagePath(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async purgeExpired(): Promise<number> {
    const all = await this.list();
    const now = Date.now();
    let count = 0;
    for (const m of all) {
      const isExpired = m.expires_at && new Date(m.expires_at).getTime() < now;
      const isOldDelivered = m.delivered_at && Date.now() - new Date(m.delivered_at).getTime() > 3600_000;
      if (isExpired || isOldDelivered) {
        await this.delete(m.id);
        count++;
      }
    }
    return count;
  }
}
