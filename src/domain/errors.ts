/**
 * Typed error hierarchy for the orchestrator.
 *
 * Every error carries an exit code (matching CLI_UI_DESIGN.md §11)
 * and an optional hint for the user.
 *
 * Exit codes:
 *   0 - Success
 *   1 - General error
 *   2 - Invalid arguments
 *   3 - Not initialized (.orchestry/ not found)
 *   4 - Lock conflict (orchestrator already running)
 *   5 - Agent error (adapter test failed)
 */

export class OrchestryError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'OrchestryError';
  }
}

export class NotInitializedError extends OrchestryError {
  constructor() {
    super('Not initialized', 3, 'Run: orch init');
    this.name = 'NotInitializedError';
  }
}

export class InvalidArgumentsError extends OrchestryError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'InvalidArgumentsError';
  }
}

export class LockConflictError extends OrchestryError {
  constructor(pid: number) {
    super(`Orchestrator already running (PID: ${pid})`, 4, 'Use: orch status');
    this.name = 'LockConflictError';
  }
}

export class AgentAdapterError extends OrchestryError {
  constructor(adapter: string, detail: string) {
    super(`Agent adapter "${adapter}" not available`, 5, detail);
    this.name = 'AgentAdapterError';
  }
}

export class NoAgentsError extends OrchestryError {
  constructor() {
    super('No agents configured', 1, 'Run: orch agent add <name> --adapter claude');
    this.name = 'NoAgentsError';
  }
}

export class TaskNotFoundError extends OrchestryError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, 1);
    this.name = 'TaskNotFoundError';
  }
}

export class AgentNotFoundError extends OrchestryError {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, 1);
    this.name = 'AgentNotFoundError';
  }
}

export class TaskAlreadyRunningError extends OrchestryError {
  constructor(taskId: string, runId: string, agentName: string) {
    super(
      `Task ${taskId} is already running (run: ${runId}, agent: ${agentName})`,
      1,
      `Use: orch logs --task ${taskId} --follow`,
    );
    this.name = 'TaskAlreadyRunningError';
  }
}

export class InvalidTransitionError extends OrchestryError {
  constructor(taskId: string, from: string, to: string) {
    super(`Invalid transition for ${taskId}: ${from} → ${to}`, 1);
    this.name = 'InvalidTransitionError';
  }
}
