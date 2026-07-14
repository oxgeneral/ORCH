// src/domain/errors.ts
var OrchestryError = class extends Error {
  constructor(message, exitCode, hint) {
    super(message);
    this.exitCode = exitCode;
    this.hint = hint;
    this.name = "OrchestryError";
  }
};
var NotInitializedError = class extends OrchestryError {
  constructor() {
    super("Not initialized", 3, "Run: orch init");
    this.name = "NotInitializedError";
  }
};
var InvalidArgumentsError = class extends OrchestryError {
  constructor(message) {
    super(message, 2);
    this.name = "InvalidArgumentsError";
  }
};
var LockConflictError = class extends OrchestryError {
  constructor(pid) {
    super(`Orchestrator already running (PID: ${pid})`, 4, "Use: orch status");
    this.name = "LockConflictError";
  }
};
var NoAgentsError = class extends OrchestryError {
  constructor() {
    super("No agents configured", 1, "Run: orch agent add <name> --adapter <adapter>");
    this.name = "NoAgentsError";
  }
};
var TaskNotFoundError = class extends OrchestryError {
  constructor(taskId) {
    super(`Task not found: ${taskId}`, 1);
    this.name = "TaskNotFoundError";
  }
};
var AgentNotFoundError = class extends OrchestryError {
  constructor(agentId) {
    super(`Agent not found: ${agentId}`, 1);
    this.name = "AgentNotFoundError";
  }
};
var TaskAlreadyRunningError = class extends OrchestryError {
  constructor(taskId, runId, agentName) {
    super(
      `Task ${taskId} is already running (run: ${runId}, agent: ${agentName})`,
      1,
      `Use: orch logs --task ${taskId} --follow`
    );
    this.name = "TaskAlreadyRunningError";
  }
};
var InvalidTransitionError = class extends OrchestryError {
  constructor(taskId, from, to) {
    super(`Invalid transition for ${taskId}: ${from} \u2192 ${to}`, 1);
    this.name = "InvalidTransitionError";
  }
};
var GoalNotFoundError = class extends OrchestryError {
  constructor(goalId) {
    super(`Goal not found: ${goalId}`, 1);
    this.name = "GoalNotFoundError";
  }
};
var GoalHasPendingTasksError = class extends OrchestryError {
  constructor(goalId, count, summary) {
    super(
      `Cannot mark goal ${goalId} as achieved: ${count} task(s) still pending \u2014 ${summary}`,
      1,
      "Use --force to cancel pending tasks and mark achieved"
    );
    this.name = "GoalHasPendingTasksError";
  }
};
var TeamNotFoundError = class extends OrchestryError {
  constructor(teamId) {
    super(`Team not found: ${teamId}`, 1);
    this.name = "TeamNotFoundError";
  }
};
var WorkspaceError = class extends OrchestryError {
  constructor(message, hint) {
    super(message, 6, hint);
    this.name = "WorkspaceError";
  }
};
var AdapterErrorKind = /* @__PURE__ */ ((AdapterErrorKind2) => {
  AdapterErrorKind2["ADAPTER_NOT_FOUND"] = "adapter_not_found";
  AdapterErrorKind2["AUTH_FAILED"] = "auth_failed";
  AdapterErrorKind2["TIMEOUT"] = "timeout";
  AdapterErrorKind2["RATE_LIMIT"] = "rate_limit";
  AdapterErrorKind2["PROCESS_CRASH"] = "process_crash";
  AdapterErrorKind2["SPAWN_FAILED"] = "spawn_failed";
  AdapterErrorKind2["UNKNOWN"] = "unknown";
  return AdapterErrorKind2;
})(AdapterErrorKind || {});
var ERROR_HINTS = {
  ["adapter_not_found" /* ADAPTER_NOT_FOUND */]: {
    message: "CLI \u043D\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
    fix: "\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0435: npm i -g @anthropic-ai/claude-code",
    doctorHint: true
  },
  ["auth_failed" /* AUTH_FAILED */]: {
    message: "API \u043A\u043B\u044E\u0447 \u043D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D.",
    fix: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435: claude auth status"
  },
  ["timeout" /* TIMEOUT */]: {
    message: "\u0410\u0433\u0435\u043D\u0442 \u043F\u0440\u0435\u0432\u044B\u0441\u0438\u043B \u043B\u0438\u043C\u0438\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438.",
    fix: "\u0423\u0432\u0435\u043B\u0438\u0447\u044C\u0442\u0435 \u0447\u0435\u0440\u0435\u0437: orch config set agent_timeout <ms>"
  },
  ["rate_limit" /* RATE_LIMIT */]: {
    message: "\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043B\u0438\u043C\u0438\u0442 API.",
    fix: "\u041F\u043E\u0434\u043E\u0436\u0434\u0438\u0442\u0435 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435: orch task retry <id>"
  },
  ["process_crash" /* PROCESS_CRASH */]: {
    message: "\u041F\u0440\u043E\u0446\u0435\u0441\u0441 \u0430\u0433\u0435\u043D\u0442\u0430 \u0443\u043F\u0430\u043B.",
    fix: "\u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435: orch task retry <id>"
  },
  ["spawn_failed" /* SPAWN_FAILED */]: {
    message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u043E\u0446\u0435\u0441\u0441.",
    fix: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 PATH \u0438 \u043F\u0440\u0430\u0432\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u0430"
  },
  ["unknown" /* UNKNOWN */]: {
    message: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430.",
    fix: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0435: orch doctor",
    doctorHint: true
  }
};
function classifyAdapterError(error, exitCode) {
  const lower = error.toLowerCase();
  if (lower.includes("enoent") || lower.includes("spawn failed")) {
    return "spawn_failed" /* SPAWN_FAILED */;
  }
  if (lower.includes("not found") || lower.includes("command not found") || lower.includes("no such file")) {
    return "adapter_not_found" /* ADAPTER_NOT_FOUND */;
  }
  if (lower.includes("auth") || lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key") || lower.includes("authentication")) {
    return "auth_failed" /* AUTH_FAILED */;
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return "timeout" /* TIMEOUT */;
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many requests")) {
    return "rate_limit" /* RATE_LIMIT */;
  }
  if (exitCode !== void 0 && exitCode !== 0) {
    return "process_crash" /* PROCESS_CRASH */;
  }
  return "unknown" /* UNKNOWN */;
}

export { AdapterErrorKind, AgentNotFoundError, ERROR_HINTS, GoalHasPendingTasksError, GoalNotFoundError, InvalidArgumentsError, InvalidTransitionError, LockConflictError, NoAgentsError, NotInitializedError, OrchestryError, TaskAlreadyRunningError, TaskNotFoundError, TeamNotFoundError, WorkspaceError, classifyAdapterError };
//# sourceMappingURL=chunk-BBYWS5VU.js.map
//# sourceMappingURL=chunk-BBYWS5VU.js.map