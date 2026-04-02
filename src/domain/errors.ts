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

export class GoalNotFoundError extends OrchestryError {
  constructor(goalId: string) {
    super(`Goal not found: ${goalId}`, 1);
    this.name = 'GoalNotFoundError';
  }
}

export class GoalHasPendingTasksError extends OrchestryError {
  constructor(goalId: string, count: number, summary: string) {
    super(
      `Cannot mark goal ${goalId} as achieved: ${count} task(s) still pending — ${summary}`,
      1,
      'Use --force to cancel pending tasks and mark achieved',
    );
    this.name = 'GoalHasPendingTasksError';
  }
}

export class TeamNotFoundError extends OrchestryError {
  constructor(teamId: string) {
    super(`Team not found: ${teamId}`, 1);
    this.name = 'TeamNotFoundError';
  }
}

export class MessageNotFoundError extends OrchestryError {
  constructor(messageId: string) {
    super(`Message not found: ${messageId}`, 1);
    this.name = 'MessageNotFoundError';
  }
}

export class WorkspaceError extends OrchestryError {
  constructor(message: string, hint?: string) {
    super(message, 6, hint);
    this.name = 'WorkspaceError';
  }
}

// ── Adapter Error Classification ──────────────────────────────────

export enum AdapterErrorKind {
  ADAPTER_NOT_FOUND = 'adapter_not_found',
  AUTH_FAILED = 'auth_failed',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  PROCESS_CRASH = 'process_crash',
  SPAWN_FAILED = 'spawn_failed',
  UNKNOWN = 'unknown',
}

export interface AdapterErrorHint {
  message: string;
  fix: string;
  doctorHint?: boolean;
}

export const ERROR_HINTS: Record<AdapterErrorKind, AdapterErrorHint> = {
  [AdapterErrorKind.ADAPTER_NOT_FOUND]: {
    message: 'CLI не установлен.',
    fix: 'Установите: npm i -g @anthropic-ai/claude-code',
    doctorHint: true,
  },
  [AdapterErrorKind.AUTH_FAILED]: {
    message: 'API ключ невалиден.',
    fix: 'Проверьте: claude auth status',
  },
  [AdapterErrorKind.TIMEOUT]: {
    message: 'Агент превысил лимит времени.',
    fix: 'Увеличьте через: orch config set agent_timeout <ms>',
  },
  [AdapterErrorKind.RATE_LIMIT]: {
    message: 'Достигнут лимит API.',
    fix: 'Подождите и повторите: orch task retry <id>',
  },
  [AdapterErrorKind.PROCESS_CRASH]: {
    message: 'Процесс агента упал.',
    fix: 'Попробуйте: orch task retry <id>',
  },
  [AdapterErrorKind.SPAWN_FAILED]: {
    message: 'Не удалось запустить процесс.',
    fix: 'Проверьте PATH и права доступа',
  },
  [AdapterErrorKind.UNKNOWN]: {
    message: 'Неизвестная ошибка.',
    fix: 'Запустите: orch doctor',
    doctorHint: true,
  },
};

export function classifyAdapterError(error: string, exitCode?: number): AdapterErrorKind {
  const lower = error.toLowerCase();

  if (lower.includes('enoent') || lower.includes('spawn failed')) {
    return AdapterErrorKind.SPAWN_FAILED;
  }
  if (lower.includes('not found') || lower.includes('command not found') || lower.includes('no such file')) {
    return AdapterErrorKind.ADAPTER_NOT_FOUND;
  }
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('invalid api key') || lower.includes('authentication')) {
    return AdapterErrorKind.AUTH_FAILED;
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return AdapterErrorKind.TIMEOUT;
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
    return AdapterErrorKind.RATE_LIMIT;
  }
  if (exitCode !== undefined && exitCode !== 0) {
    return AdapterErrorKind.PROCESS_CRASH;
  }

  return AdapterErrorKind.UNKNOWN;
}
