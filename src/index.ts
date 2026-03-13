/**
 * Library entry point.
 *
 * Re-exports domain types and core services for programmatic use.
 */

// Domain
export type { Task, TaskStatus, CreateTaskInput, WorkspaceMode, TaskProof } from './domain/task.js';
export type { Agent, AgentStatus, AgentConfig, CreateAgentInput, ApprovalPolicy, AgentStats } from './domain/agent.js';
export type { Run, RunStatus, RunEvent, RunEventType, TokenUsage } from './domain/run.js';
export { createTokenUsage } from './domain/run.js';
export type { OrchestratorConfig, ProjectConfig, SchedulingConfig } from './domain/config.js';
export type { OrchestratorState, RunningEntry, RetryEntry } from './domain/state.js';
export type { OrchestratorEvent, OrchestratorEventType, EventPayload } from './domain/events.js';
export { OrchestryError, NotInitializedError, TaskNotFoundError, AgentNotFoundError, WorkspaceError, AdapterErrorKind, ERROR_HINTS, classifyAdapterError } from './domain/errors.js';
export type { AdapterErrorHint } from './domain/errors.js';
export { canTransition, isTerminal, isDispatchable, isBlocked, resolveFailureStatus } from './domain/transitions.js';

// Application
export { EventBus } from './application/event-bus.js';
export { TaskService } from './application/task-service.js';
export { AgentService } from './application/agent-service.js';
export { RunService } from './application/run-service.js';
export { Orchestrator } from './application/orchestrator.js';

// Infrastructure interfaces
export type { IAgentAdapter, AgentEvent, ExecuteParams, AdapterTestResult } from './infrastructure/adapters/interface.js';
export { AdapterRegistry } from './infrastructure/adapters/registry.js';

// Clipboard
export { detectClipboardType, getClipboardImage, isClipboardToolAvailable } from './infrastructure/clipboard-service.js';
export type { ClipboardContentType, ClipboardImage } from './infrastructure/clipboard-service.js';

// Container
export { buildContainer, buildLightContainer, buildFullContainer } from './container.js';
export type { Container, LightContainer } from './container.js';
