/**
 * `orch tui` command.
 *
 * Launches the interactive TUI dashboard using Ink.
 * Passes action callbacks to the App for interactive features.
 * Automatically starts watch mode for live orchestration.
 */

import type { Command } from 'commander';
import type { Container } from '../../container.js';

export function registerTuiCommand(program: Command, container: Container): void {
  program
    .command('tui')
    .description('Launch interactive TUI dashboard')
    .action(async () => {
      await container.paths.requireInit();

      const tasks = await container.taskService.list();
      const agents = await container.agentService.list();
      const state = await container.stateStore.read();

      // Dynamic import — Ink + React are heavy, only load when needed
      const { render } = await import('ink');
      const { createElement } = await import('react');
      const { App } = await import('../../tui/App.js');

      const onRunTask = async (taskId: string) => {
        await container.orchestrator.runTask(taskId);
      };

      const onCreateTask = async (title: string, opts?: { priority?: number; description?: string }) => {
        return container.taskService.create({
          title,
          priority: opts?.priority,
          description: opts?.description,
        });
      };

      const onCancelTask = async (taskId: string) => {
        await container.orchestrator.cancelTask(taskId);
      };

      const onRetryTask = async (taskId: string) => {
        await container.taskService.retry(taskId);
      };

      const onAssignTask = async (taskId: string, agentId: string) => {
        await container.taskService.assign(taskId, agentId);
      };

      const onRunAll = async () => {
        await container.orchestrator.runAll();
      };

      const onDisableAgent = async (agentId: string) => {
        await container.agentService.disable(agentId);
      };

      const onEnableAgent = async (agentId: string) => {
        await container.agentService.enable(agentId);
      };

      const onSubscribeEvents = (handler: (event: import('../../domain/events.js').OrchestratorEvent) => void) => {
        return container.eventBus.onAny(handler);
      };

      // ── New callbacks for live TUI ──

      const onRefreshTasks = async () => {
        return container.taskService.list();
      };

      const onRefreshAgents = async () => {
        return container.agentService.list();
      };

      const onRefreshState = async () => {
        return container.stateStore.read();
      };

      const onAddAgent = async (name: string, adapter?: string, opts?: { model?: string; role?: string; approval_policy?: string }) => {
        return container.agentService.create({
          name,
          adapter: adapter ?? 'claude',
          model: opts?.model || undefined,
          role: opts?.role || undefined,
          approval_policy: (opts?.approval_policy as import('../../domain/agent.js').ApprovalPolicy) || undefined,
        });
      };

      const onDeleteAgent = async (agentId: string) => {
        await container.agentService.remove(agentId);
      };

      const onDeleteTask = async (taskId: string) => {
        await container.taskService.delete(taskId);
      };

      const onApproveTask = async (taskId: string) => {
        await container.taskService.updateStatus(taskId, 'done');
      };

      const onRejectTask = async (taskId: string, feedback?: string) => {
        await container.taskService.reject(taskId, feedback);
      };

      const onUpdateTask = async (taskId: string, fields: { title?: string; description?: string; priority?: number }) => {
        return container.taskService.update(taskId, fields);
      };

      const onUpdateAgent = async (agentId: string, fields: { name?: string; role?: string; model?: string; approval_policy?: string }) => {
        return container.agentService.update(agentId, {
          ...fields,
          approval_policy: fields.approval_policy as import('../../domain/agent.js').ApprovalPolicy | undefined,
        });
      };

      const onForceStopAgent = async (agentId: string) => {
        await container.orchestrator.forceStopAgent(agentId);
      };

      const onLoadHistory = async (): Promise<import('../../tui/App.js').HistoryEntry[]> => {
        const allRuns: import('../../domain/run.js').Run[] = [];
        // Collect recent runs from all tasks
        for (const task of tasks) {
          const runs = await container.runService.listForTask(task.id);
          allRuns.push(...runs);
        }
        // Sort by start time, take last 10 runs
        allRuns.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
        const recentRuns = allRuns.slice(-10);

        const entries: import('../../tui/App.js').HistoryEntry[] = [];
        for (const run of recentRuns) {
          const events = await container.runService.readEvents(run.id);
          // Take last 30 events per run to keep it manageable
          for (const evt of events.slice(-30)) {
            entries.push({
              timestamp: evt.timestamp,
              agentId: run.agent_id,
              taskId: run.task_id,
              type: evt.type,
              data: evt.data,
            });
          }
        }
        // Sort all entries chronologically, limit total
        entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        return entries.slice(-200);
      };

      const onStartWatch = async () => {
        await container.orchestrator.startWatch();
      };

      const onStopWatch = async () => {
        await container.orchestrator.stop();
      };

      // Auto-start watch mode so the orchestrator is live
      let watchStarted = false;
      try {
        await container.orchestrator.startWatch();
        watchStarted = true;
      } catch {
        // Watch mode may fail if lock is held by another process — continue without it
      }

      const { waitUntilExit } = render(
        createElement(App, {
          projectName: container.config.project.name,
          tasks,
          agents,
          state,
          onRunTask,
          onCreateTask,
          onCancelTask,
          onRetryTask,
          onAssignTask,
          onRunAll,
          onDisableAgent,
          onEnableAgent,
          onSubscribeEvents,
          onRefreshTasks,
          onRefreshAgents,
          onRefreshState,
          onLoadHistory,
          onAddAgent,
          onDeleteAgent,
          onApproveTask,
          onRejectTask,
          onDeleteTask,
          onUpdateTask,
          onUpdateAgent,
          onForceStopAgent,
          onStartWatch,
          onStopWatch,
        }),
      );

      await waitUntilExit();

      // Cleanup: stop watch mode on exit
      if (watchStarted) {
        await container.orchestrator.stop().catch(() => {});
      }
    });
}
