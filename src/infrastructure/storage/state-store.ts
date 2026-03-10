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
    const state = await readJson<OrchestratorState>(this.paths.statePath);
    return state ?? structuredClone(DEFAULT_STATE);
  }

  async write(state: OrchestratorState): Promise<void> {
    await writeJson(this.paths.statePath, state);
  }
}
