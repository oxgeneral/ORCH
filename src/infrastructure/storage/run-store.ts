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
  readJsonlTail,
  closeAppendHandle,
  ensureDir,
  listFiles,
  pathExists,
} from './fs-utils.js';
import { createReadStream } from 'node:fs';

export class RunStore implements IRunStore {
  constructor(private readonly paths: Paths) {}

  async save(run: Run): Promise<void> {
    await ensureDir(this.paths.runsDir);
    await writeJson(this.paths.runPath(run.id), run);
  }

  async get(id: string): Promise<Run | null> {
    return readJson<Run>(this.paths.runPath(id));
  }

  async listAll(): Promise<Run[]> {
    return this.listFiltered(() => true);
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

  /**
   * Read the last N events for a run without loading the entire JSONL file.
   */
  async readEventsTail(runId: string, count: number): Promise<RunEvent[]> {
    return readJsonlTail<RunEvent>(this.paths.runEventsPath(runId), count);
  }

  closeRunEvents(runId: string): void {
    closeAppendHandle(this.paths.runEventsPath(runId));
  }

  async *streamEvents(runId: string, signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const filePath = this.paths.runEventsPath(runId);

    // Wait for file to exist (max 30s to avoid infinite polling)
    const deadline = Date.now() + 30_000;
    while (!signal?.aborted && Date.now() < deadline) {
      if (await pathExists(filePath)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (signal?.aborted || Date.now() >= deadline) return;

    const stream = createReadStream(filePath);

    const { readLines } = await import('../process/process-manager.js');

    try {
      for await (const line of readLines(stream)) {
        if (signal?.aborted) break;
        if (line.trim()) {
          try {
            yield JSON.parse(line) as RunEvent;
          } catch {
            process.stderr.write(`[RunStore] skipping corrupt JSONL line: ${line.slice(0, 200)}\n`);
          }
        }
      }
    } finally {
      stream.destroy();
    }
  }

  private async listFiltered(predicate: (run: Run) => boolean): Promise<Run[]> {
    await ensureDir(this.paths.runsDir);
    const files = await listFiles(this.paths.runsDir, '.json');

    // Batch reads to avoid EMFILE (macOS default ulimit 256)
    const BATCH = 64;
    const all: Run[] = [];
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(file => {
          const id = file.endsWith('.json') ? file.slice(0, -5) : file;
          return readJson<Run>(this.paths.runPath(id));
        }),
      );
      for (const run of results) {
        if (run !== null && predicate(run)) all.push(run);
      }
    }

    return all.sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    );
  }
}
