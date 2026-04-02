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

      const onCreateTask = async (title: string, opts?: { priority?: number; description?: string; attachments?: string[] }) => {
        return container.taskService.create({
          title,
          priority: opts?.priority,
          description: opts?.description,
          attachments: opts?.attachments,
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

      let onSubscribeEvents = (handler: (event: import('../../domain/events.js').OrchestratorEvent) => void) => {
        return container.eventBus.onAny(handler);
      };

      // ── Data-refresh callbacks (polled by TUI on state-changing events) ──

      const onRefreshTasks = async () => {
        return container.taskService.list();
      };

      const onRefreshAgents = async () => {
        return container.agentService.list();
      };

      const onRefreshState = async () => {
        return container.stateStore.read();
      };

      const onAddAgent = async (name: string, adapter?: string, opts?: { model?: string; effort?: string; role?: string; approval_policy?: string; skills?: string[] }) => {
        return container.agentService.create({
          name,
          adapter: adapter ?? container.config.defaults.agent.adapter,
          model: opts?.model || undefined,
          effort: (opts?.effort as import('../../domain/agent.js').ReasoningEffort) || undefined,
          role: opts?.role || undefined,
          approval_policy: (opts?.approval_policy as import('../../domain/agent.js').ApprovalPolicy) || undefined,
          skills: opts?.skills || undefined,
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

      const onUpdateTask = async (taskId: string, fields: { title?: string; description?: string; priority?: number; attachments?: string[] }) => {
        return container.taskService.update(taskId, fields);
      };

      const onUpdateAgent = async (agentId: string, fields: { name?: string; role?: string; model?: string; effort?: string; approval_policy?: string }) => {
        return container.agentService.update(agentId, {
          ...fields,
          effort: fields.effort as import('../../domain/agent.js').ReasoningEffort | undefined,
          approval_policy: fields.approval_policy as import('../../domain/agent.js').ApprovalPolicy | undefined,
        });
      };

      const onForceStopAgent = async (agentId: string) => {
        await container.orchestrator.forceStopAgent(agentId);
      };

      const onToggleAutonomous = async (agentId: string, enabled: boolean) => {
        return container.agentService.setAutonomous(agentId, enabled);
      };

      const onLoadHistory = async (onBatch: (entries: import('../../tui/App.js').HistoryEntry[]) => void): Promise<void> => {
        type HistoryEntry = import('../../tui/App.js').HistoryEntry;
        type Run = import('../../domain/run.js').Run;

        // Load all runs once (not per-task!) to avoid N×M file reads
        const allRuns: Run[] = await container.runService.listAll();

        // Sort by start time descending and filter to runs with meaningful output
        allRuns.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        const validRuns = allRuns.filter((r) => r.status === 'succeeded' || r.status === 'failed');

        // Progressive loading: first batch = last 3 runs (fast), second = next 7
        const FIRST_BATCH = 3;
        const TOTAL_RUNS = 10;
        const firstRuns = validRuns.slice(0, FIRST_BATCH);
        const restRuns = validRuns.slice(FIRST_BATCH, TOTAL_RUNS);

        const loadRunEvents = async (run: Run): Promise<HistoryEntry[]> => {
          const events = await container.runService.readEventsTail(run.id, 30);
          return events.map((evt) => ({
            timestamp: evt.timestamp,
            agentId: run.agent_id,
            taskId: run.task_id,
            type: evt.type,
            data: evt.data,
          }));
        };

        // First batch — deliver immediately for fast TUI startup
        if (firstRuns.length > 0) {
          const firstEntries = (await Promise.all(firstRuns.map(loadRunEvents))).flat();
          firstEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          onBatch(firstEntries.slice(-200));
        }

        // Second batch — remaining runs loaded in background
        if (restRuns.length > 0) {
          const restEntries = (await Promise.all(restRuns.map(loadRunEvents))).flat();
          restEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          onBatch(restEntries.slice(-200));
        }
      };

      const onCreateTeam = async (input: import('../../domain/team.js').CreateTeamInput) => {
        return container.teamService.create(input);
      };

      const onListTeams = async () => {
        return container.teamService.list();
      };

      const onJoinTeam = async (teamId: string, agentId: string) => {
        return container.teamService.join(teamId, agentId);
      };

      const onLeaveTeam = async (teamId: string, agentId: string) => {
        return container.teamService.leave(teamId, agentId);
      };

      const onDisbandTeam = async (teamId: string) => {
        await container.teamService.disband(teamId);
      };

      const onSetTeamLead = async (teamId: string, agentId: string) => {
        return container.teamService.setLead(teamId, agentId);
      };

      // ── Goal callbacks ──

      const onRefreshGoals = async () => {
        return container.goalService.list();
      };

      const onCreateGoal = async (input: { title: string; description?: string; assignee?: string }) => {
        return container.goalService.create(input);
      };

      const onUpdateGoal = async (id: string, fields: { title?: string; description?: string; assignee?: string }) => {
        return container.goalService.update(id, fields);
      };

      const onUpdateGoalStatus = async (id: string, status: import('../../domain/goal.js').GoalStatus, opts?: { force?: boolean }) => {
        return container.goalService.updateStatus(id, status, opts);
      };

      const onDeleteGoal = async (id: string) => {
        await container.goalService.delete(id);
      };

      const onGetGoalProgress = async (goalId: string) => {
        return container.goalService.getProgressReport(goalId);
      };

      const onStartWatch = async () => {
        await container.orchestrator.startWatch();
      };

      const onStopWatch = async () => {
        await container.orchestrator.stop();
      };

      const currentVersion = program.version() ?? '0.0.0';

      // Fire update check in background — never block TUI render.
      // If cache is warm, result arrives before render. If cold start,
      // App.tsx's onCheckUpdate useEffect will pick it up after 5s.
      const updateCheckPromise = import('../update-check.js')
        .then((m) => m.checkForUpdateSWR(currentVersion))
        .catch(() => null);

      // Auto-start watch mode so the orchestrator is live
      let watchStarted = false;
      let watchError: string | undefined;
      let observerMode = false;
      let diskObserver: import('../serve/disk-observer.js').DiskObserver | undefined;
      try {
        await container.orchestrator.startWatch();
        watchStarted = true;
      } catch (err) {
        // Watch mode may fail if lock is held by another process — enter observer mode
        watchError = err instanceof Error ? err.message : String(err);

        // Observer mode: poll disk for events from the external orchestrator
        const { DiskObserver } = await import('../serve/disk-observer.js');
        diskObserver = new DiskObserver({
          paths: container.paths,
          stateStore: container.stateStore,
        });
        observerMode = true;
        onSubscribeEvents = (handler) => diskObserver!.subscribe(handler);
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
          onToggleAutonomous,
          onRefreshGoals,
          onCreateGoal,
          onUpdateGoal,
          onUpdateGoalStatus,
          onDeleteGoal,
          onGetGoalProgress,
          onCreateTeam,
          onListTeams,
          onJoinTeam,
          onLeaveTeam,
          onDisbandTeam,
          onSetTeamLead,
          onStartWatch,
          onStopWatch,
          initialWatchActive: watchStarted,
          observerMode,
          watchError: observerMode ? undefined : watchError,
          version: currentVersion,
          latestVersion: undefined,
          onCheckUpdate: async () => {
            const info = await updateCheckPromise;
            if (info?.updateAvailable) return info.latest;
            const m = await import('../update-check.js');
            const fresh = await m.checkForUpdateNow(currentVersion);
            return fresh?.updateAvailable ? fresh.latest : undefined;
          },
          onBackgroundInstall: async (version: string) => {
            const m = await import('../update-check.js');
            return m.backgroundInstall(version);
          },
          initialActivityFilter: container.globalConfig.tui.activity_filter,
          onSaveActivityFilter: async (preset) => {
            await container.globalConfigStore.set('activity_filter', preset);
          },
          initialNotifications: container.globalConfig.tui.notifications,
          onSaveNotifications: async (notif) => {
            await container.globalConfigStore.set('notifications', notif);
          },
          initialMaxConcurrent: container.config.scheduling.max_concurrent_agents,
          onSaveMaxConcurrent: async (value) => {
            await container.configStore.set('scheduling.max_concurrent_agents', value);
            container.config.scheduling.max_concurrent_agents = value;
          },
          onCompleteOnboarding: async () => {
            const s = await container.stateStore.read();
            s.onboardingCompleted = true;
            await container.stateStore.write(s);
          },
          defaultAdapter: container.config.defaults.agent.adapter,
        }),
        { incrementalRendering: true, kittyKeyboard: { mode: 'auto', flags: ['disambiguateEscapeCodes'] } },
      );

      await waitUntilExit();

      // Cleanup: stop watch mode or observer on exit
      if (watchStarted) {
        await container.orchestrator.stop().catch(() => {});
      }
      if (diskObserver) {
        diskObserver.stop();
      }

      // Release all remaining EventBus subscriptions.
      // React's useEffect cleanup already removed the TUI wildcard handler during unmount;
      // this is a belt-and-suspenders hygiene call for embedded/test scenarios.
      container.eventBus.clear();
    });
}
