/**
 * Dependency injection container.
 *
 * Plain TypeScript object — no framework, no decorators.
 * Built once at startup, passed to all CLI commands.
 */

import type { OrchestratorConfig } from './domain/config.js';
import type { CliContext } from './cli/context.js';
import type { ITaskStore, IAgentStore, IRunStore, IStateStore, IConfigStore, IContextStore } from './infrastructure/storage/interfaces.js';
import type { IWorkspaceManager } from './infrastructure/workspace/interface.js';
import type { ITemplateEngine } from './infrastructure/template/template-engine.js';
import type { IProcessManager } from './infrastructure/process/process-manager.js';

import { Paths } from './infrastructure/storage/paths.js';
import { TaskStore } from './infrastructure/storage/task-store.js';
import { AgentStore } from './infrastructure/storage/agent-store.js';
import { RunStore } from './infrastructure/storage/run-store.js';
import { StateStore } from './infrastructure/storage/state-store.js';
import { ConfigStore } from './infrastructure/storage/config-store.js';
import { ContextStore } from './infrastructure/storage/context-store.js';
import { ProcessManager } from './infrastructure/process/process-manager.js';
import { AdapterRegistry } from './infrastructure/adapters/registry.js';
import { ClaudeAdapter } from './infrastructure/adapters/claude.js';
import { CodexAdapter } from './infrastructure/adapters/codex.js';
import { CursorAdapter } from './infrastructure/adapters/cursor.js';
import { ShellAdapter } from './infrastructure/adapters/shell.js';
import { WorkspaceManager } from './infrastructure/workspace/workspace-manager.js';
import { LiquidTemplateEngine } from './infrastructure/template/template-engine.js';

import { EventBus } from './application/event-bus.js';
import { TaskService } from './application/task-service.js';
import { AgentService } from './application/agent-service.js';
import { RunService } from './application/run-service.js';
import { DoctorService } from './application/doctor-service.js';
import { Orchestrator } from './application/orchestrator.js';

export interface Container {
  // Context
  context: CliContext;
  paths: Paths;
  config: OrchestratorConfig;

  // Infrastructure (interfaces for testability)
  taskStore: ITaskStore;
  agentStore: IAgentStore;
  runStore: IRunStore;
  stateStore: IStateStore;
  configStore: IConfigStore;
  contextStore: IContextStore;
  processManager: IProcessManager;
  adapterRegistry: AdapterRegistry;
  workspaceManager: IWorkspaceManager;
  templateEngine: ITemplateEngine;

  // Application
  eventBus: EventBus;
  taskService: TaskService;
  agentService: AgentService;
  runService: RunService;
  doctorService: DoctorService;
  orchestrator: Orchestrator;
}

export async function buildContainer(context: CliContext): Promise<Container> {
  const paths = new Paths(context.projectRoot);

  // Fail fast if .orchestry/ does not exist
  await paths.requireInit();

  // Infrastructure
  const configStore = new ConfigStore(paths);
  const config = await configStore.read();
  const taskStore = new TaskStore(paths);
  const agentStore = new AgentStore(paths);
  const runStore = new RunStore(paths);
  const stateStore = new StateStore(paths);
  const contextStore = new ContextStore(paths);
  const processManager = new ProcessManager();
  const templateEngine = new LiquidTemplateEngine();
  const workspaceManager = new WorkspaceManager(
    context.projectRoot,
    paths.root,
    processManager,
  );

  // Adapter registry
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(new ClaudeAdapter(processManager));
  adapterRegistry.register(new CodexAdapter(processManager));
  adapterRegistry.register(new CursorAdapter(processManager));
  adapterRegistry.register(new ShellAdapter(processManager));

  // Application
  const eventBus = new EventBus();
  const taskService = new TaskService(taskStore, stateStore, eventBus, config);
  const agentService = new AgentService(agentStore, stateStore, eventBus, config);
  const runService = new RunService(runStore, eventBus);
  const doctorService = new DoctorService(adapterRegistry, processManager);
  const orchestrator = new Orchestrator({
    taskStore,
    agentStore,
    runStore,
    stateStore,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    processManager,
    eventBus,
    taskService,
    agentService,
    runService,
    contextStore,
    config,
    projectRoot: context.projectRoot,
    lockPath: paths.lockPath,
  });

  return {
    context,
    paths,
    config,
    taskStore,
    agentStore,
    runStore,
    stateStore,
    configStore,
    contextStore,
    processManager,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    eventBus,
    taskService,
    agentService,
    runService,
    doctorService,
    orchestrator,
  };
}
