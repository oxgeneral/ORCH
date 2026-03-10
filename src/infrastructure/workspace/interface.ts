/**
 * Workspace manager interface.
 */

import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task } from '../../domain/task.js';

export interface IWorkspaceManager {
  prepare(task: Task, agent: Agent, config: OrchestratorConfig): Promise<string>;
  cleanup(taskId: string): Promise<void>;
  validate(workspacePath: string, projectRoot: string): void;
}
