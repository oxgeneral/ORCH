/**
 * Dependency injection container.
 *
 * Plain TypeScript object — no framework, no decorators.
 * Two modes:
 *   - LightContainer: stores + services only (fast, for read-only commands)
 *   - Container: full (+ orchestrator, adapters, template engine)
 */

import type { OrchestratorConfig } from './domain/config.js';
import type { CliContext } from './cli/context.js';
import type { ITaskStore, IAgentStore, IRunStore, IStateStore, IConfigStore, IContextStore, IMessageStore, IGoalStore, ITeamStore } from './infrastructure/storage/interfaces.js';
import type { IWorkspaceManager } from './infrastructure/workspace/interface.js';
import type { ITemplateEngine } from './infrastructure/template/template-engine.js';
import type { IProcessManager } from './infrastructure/process/process-manager.js';
import type { AdapterRegistry } from './infrastructure/adapters/registry.js';

import type { GlobalConfig } from './domain/global-config.js';
import { Paths } from './infrastructure/storage/paths.js';
import { TaskStore } from './infrastructure/storage/task-store.js';
import { AgentStore } from './infrastructure/storage/agent-store.js';
import { RunStore } from './infrastructure/storage/run-store.js';
import { StateStore } from './infrastructure/storage/state-store.js';
import { ConfigStore } from './infrastructure/storage/config-store.js';
import { GlobalConfigStore } from './infrastructure/storage/global-config-store.js';
import { ContextStore } from './infrastructure/storage/context-store.js';
import { MessageStore } from './infrastructure/storage/message-store.js';
import { GoalStore } from './infrastructure/storage/goal-store.js';
import { TeamStore } from './infrastructure/storage/team-store.js';

import { EventBus } from './application/event-bus.js';
import { TaskService } from './application/task-service.js';
import { AgentService } from './application/agent-service.js';
import { RunService } from './application/run-service.js';
import { MessageService } from './application/message-service.js';
import { GoalService } from './application/goal-service.js';
import { TeamService } from './application/team-service.js';

import type { Orchestrator } from './application/orchestrator.js';
import type { DoctorService } from './application/doctor-service.js';

/** Light container — stores + services. No heavy deps (adapters, orchestrator, LiquidJS). */
export interface LightContainer {
  // Context
  context: CliContext;
  paths: Paths;
  config: OrchestratorConfig;

  // Infrastructure — stores only
  taskStore: ITaskStore;
  agentStore: IAgentStore;
  runStore: IRunStore;
  stateStore: IStateStore;
  configStore: IConfigStore;
  globalConfigStore: GlobalConfigStore;
  globalConfig: GlobalConfig;
  contextStore: IContextStore;
  messageStore: IMessageStore;
  goalStore: IGoalStore;
  teamStore: ITeamStore;

  // Application — services only
  eventBus: EventBus;
  taskService: TaskService;
  agentService: AgentService;
  runService: RunService;
  messageService: MessageService;
  goalService: GoalService;
  teamService: TeamService;
}

/** Full container — everything from light + orchestrator, adapters, workspace, template. */
export interface Container extends LightContainer {
  processManager: IProcessManager;
  adapterRegistry: AdapterRegistry;
  workspaceManager: IWorkspaceManager;
  templateEngine: ITemplateEngine;
  doctorService: DoctorService;
  orchestrator: Orchestrator;
}

/**
 * Build a light container (stores + services).
 * Fast — no ProcessManager, no adapters, no LiquidJS, no Orchestrator.
 * Used by read-only commands: task, agent, context, msg, goal, team, logs, status, config.
 */
export async function buildLightContainer(context: CliContext): Promise<LightContainer> {
  const paths = new Paths(context.projectRoot);

  // Fail fast if .orchestry/ does not exist
  await paths.requireInit();

  // Infrastructure — stores
  const configStore = new ConfigStore(paths);
  const [config, globalConfig] = await Promise.all([
    configStore.read(),
    new GlobalConfigStore().read(),
  ]);
  const globalConfigStore = new GlobalConfigStore();
  const taskStore = new TaskStore(paths);
  const agentStore = new AgentStore(paths);
  const runStore = new RunStore(paths);
  const stateStore = new StateStore(paths);
  const contextStore = new ContextStore(paths);
  const messageStore = new MessageStore(paths);
  const goalStore = new GoalStore(paths);
  const teamStore = new TeamStore(paths);

  // Application — services
  const eventBus = new EventBus();
  const taskService = new TaskService(taskStore, eventBus, config);
  const agentService = new AgentService(agentStore, stateStore, eventBus, config);
  const runService = new RunService(runStore, eventBus);
  const messageService = new MessageService(messageStore, agentStore, teamStore, eventBus);
  const goalService = new GoalService(goalStore, eventBus, agentService, taskService);
  const teamService = new TeamService(teamStore, agentStore, taskStore, eventBus);

  return {
    context,
    paths,
    config,
    taskStore,
    agentStore,
    runStore,
    stateStore,
    configStore,
    globalConfigStore,
    globalConfig,
    contextStore,
    messageStore,
    goalStore,
    teamStore,
    eventBus,
    taskService,
    agentService,
    runService,
    messageService,
    goalService,
    teamService,
  };
}

/**
 * Build a full container (light + orchestrator + adapters + template).
 * Used by: run, tui, doctor.
 */
export async function buildFullContainer(context: CliContext): Promise<Container> {
  const light = await buildLightContainer(context);

  // Dynamic imports — avoid loading heavy deps at top level
  const [
    { ProcessManager },
    { AdapterRegistry },
    { ClaudeAdapter },
    { CodexAdapter },
    { CursorAdapter },
    { ShellAdapter },
    { WorkspaceManager },
    { LiquidTemplateEngine },
    { Orchestrator },
    { DoctorService },
  ] = await Promise.all([
    import('./infrastructure/process/process-manager.js'),
    import('./infrastructure/adapters/registry.js'),
    import('./infrastructure/adapters/claude.js'),
    import('./infrastructure/adapters/codex.js'),
    import('./infrastructure/adapters/cursor.js'),
    import('./infrastructure/adapters/shell.js'),
    import('./infrastructure/workspace/workspace-manager.js'),
    import('./infrastructure/template/template-engine.js'),
    import('./application/orchestrator.js'),
    import('./application/doctor-service.js'),
  ]);

  const processManager = new ProcessManager();
  const templateEngine = new LiquidTemplateEngine();
  const workspaceManager = new WorkspaceManager(
    context.projectRoot,
    light.paths.root,
    processManager,
  );

  // Adapter registry
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(new ClaudeAdapter(processManager));
  adapterRegistry.register(new CodexAdapter(processManager));
  adapterRegistry.register(new CursorAdapter(processManager));
  adapterRegistry.register(new ShellAdapter(processManager));

  const doctorService = new DoctorService(adapterRegistry, processManager);
  const orchestrator = new Orchestrator({
    taskStore: light.taskStore,
    agentStore: light.agentStore,
    runStore: light.runStore,
    stateStore: light.stateStore,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    processManager,
    eventBus: light.eventBus,
    taskService: light.taskService,
    agentService: light.agentService,
    runService: light.runService,
    contextStore: light.contextStore,
    messageService: light.messageService,
    goalStore: light.goalStore,
    config: light.config,
    projectRoot: context.projectRoot,
    lockPath: light.paths.lockPath,
  });

  return {
    ...light,
    processManager,
    adapterRegistry,
    workspaceManager,
    templateEngine,
    doctorService,
    orchestrator,
  };
}

/**
 * @deprecated Use buildLightContainer or buildFullContainer directly.
 * Kept for backward compatibility with tests.
 */
export async function buildContainer(context: CliContext): Promise<Container> {
  return buildFullContainer(context);
}
