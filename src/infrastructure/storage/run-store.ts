/**
 * File-based run store.
 *
 * Run metadata: .orchestry/runs/<id>.json (atomic write)
 * Run events:   .orchestry/runs/<id>.jsonl (append-only)
 */

import type { Run, RunEvent } from '../../domain/run.js';
import type { IRunStore } from './interfaces.js';
import type { Paths } from './paths.js';
import {
  readJson,
  writeJson,
  appendJsonl,
  readJsonl,
  ensureDir,
  listFiles,
} from './fs-utils.js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

export class RunStore implements IRunStore {
  constructor(private readonly paths: Paths) {}

  async save(run: Run): Promise<void> {
    await ensureDir(this.paths.runsDir);
    await writeJson(this.paths.runPath(run.id), run);
  }

  async get(id: string): Promise<Run | null> {
    return readJson<Run>(this.paths.runPath(id));
  }

  async listForTask(taskId: string): Promise<Run[]> {
    return this.listFiltered((run) => run.task_id === taskId);
  }

  async listForAgent(agentId: string): Promise<Run[]> {
    return this.listFiltered((run) => run.agent_id === agentId);
  }

  async appendEvent(runId: string, event: RunEvent): Promise<void> {
    await ensureDir(this.paths.runsDir);
    await appendJsonl(this.paths.runEventsPath(runId), event);
  }

  async readEvents(runId: string): Promise<RunEvent[]> {
    return readJsonl<RunEvent>(this.paths.runEventsPath(runId));
  }

  async *streamEvents(runId: string, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const filePath = this.paths.runEventsPath(runId);

    // Wait for file to exist
    while (!signal?.aborted) {
      try {
        await fs.access(filePath);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    if (signal?.aborted) return;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        if (signal?.aborted) break;
        if (line.trim()) {
          yield JSON.parse(line) as RunEvent;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  private async listFiltered(predicate: (run: Run) => boolean): Promise<Run[]> {
    await ensureDir(this.paths.runsDir);
    const files = await listFiles(this.paths.runsDir, '.json');
    const runs: Run[] = [];

    for (const file of files) {
      const id = file.replace('.json', '');
      const run = await readJson<Run>(this.paths.runPath(id));
      if (run && predicate(run)) {
        runs.push(run);
      }
    }

    return runs.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );
  }
}
