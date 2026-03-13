/**
 * File-based orchestrator state store.
 *
 * State is stored in .orchestry/state.json.
 * Updated atomically on every mutation.
 */

import { DEFAULT_STATE, type OrchestratorState } from '../../domain/state.js';
import type { IStateStore } from './interfaces.js';
import type { Paths } from './paths.js';
import { readJson, writeJson } from './fs-utils.js';

export class StateStore implements IStateStore {
  constructor(private readonly paths: Paths) {}

  async read(): Promise<OrchestratorState> {
    const raw = await readJson<Partial<OrchestratorState>>(this.paths.statePath);
    if (!raw) return structuredClone(DEFAULT_STATE);

    const defaults = structuredClone(DEFAULT_STATE);
    return {
      version: raw.version ?? defaults.version,
      pid: raw.pid,
      started_at: raw.started_at,
      running:
        raw.running && typeof raw.running === 'object' ? raw.running : defaults.running,
      claimed: Array.isArray(raw.claimed) ? new Set<string>(raw.claimed) : new Set<string>(defaults.claimed),
      retry_queue: Array.isArray(raw.retry_queue) ? raw.retry_queue : defaults.retry_queue,
      stats: {
        total_runs: raw.stats?.total_runs ?? defaults.stats.total_runs,
        total_tasks_completed:
          raw.stats?.total_tasks_completed ?? defaults.stats.total_tasks_completed,
        total_tasks_failed: raw.stats?.total_tasks_failed ?? defaults.stats.total_tasks_failed,
        total_tokens: raw.stats?.total_tokens ?? defaults.stats.total_tokens,
        total_runtime_ms: raw.stats?.total_runtime_ms ?? defaults.stats.total_runtime_ms,
      },
    };
  }

  async write(state: OrchestratorState): Promise<void> {
    const serializable = { ...state, claimed: Array.from(state.claimed) };
    await writeJson(this.paths.statePath, serializable);
  }
}
