/**
 * Workspace manager interface.
 */

import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task } from '../../domain/task.js';
import type { MergeResult } from './merge-strategy.js';

export interface PrepareResult {
  path: string;
  branch?: string;
}

export interface IWorkspaceManager {
  prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<PrepareResult>;
  mergeBack(branch: string): Promise<MergeResult>;
  cleanup(taskId: string, branch?: string): Promise<void>;
  validate(workspacePath: string, projectRoot: string): void;
}
