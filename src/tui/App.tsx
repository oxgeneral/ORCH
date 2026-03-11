/**
 * TUI App — "Command & Control" dashboard.
 *
 * Borderless design with horizontal rules, animated spinners,
 * stats ribbon, detail panel, tab-based views, and task actions.
 *
 * Hotkeys: T/A/L switch views, ↑↓/jk navigate, Enter details, R run, Esc back, Q quit (Esc never quits)
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { Task, TaskStatus } from '../domain/task.js';
import type { Agent, AgentStatus } from '../domain/agent.js';
import type { OrchestratorState } from '../domain/state.js';
import type { OrchestratorEvent } from '../domain/events.js';
import { formatDurationSince, formatTokens } from '../cli/output.js';
import { tuiColors, HEAVY_RULE, LIGHT_RULE } from './colors.js';
import { TaskRow, STATUS_ORDER } from './components/TaskList.js';
import { AgentRow, AGENT_STATUS_ORDER } from './components/AgentList.js';
import { DetailPanel } from './components/DetailPanel.js';
import { Header } from './components/Header.js';
import type { HeaderStats, HeaderTokens } from './components/Header.js';
import type { ViewId } from './components/TabBar.js';
import { resolveCompletion, resolveSuggestions, CommandHistory, COMMAND_REGISTRY } from './commandBar.js';
import type { Suggestion } from './commandBar.js';
import { CommandBar } from './components/CommandBar.js';
import { FormWizard } from './components/FormWizard.js';
import type { WizardStep } from './components/FormWizard.js';
import { Spinner } from './components/Spinner.js';
import {
  getAgentWizardSteps, agentWizardToInput,
  getTaskWizardSteps, taskWizardToInput,
  getEditTaskWizardSteps, editTaskWizardToFields,
  getEditAgentWizardSteps, editAgentWizardToFields,
} from './wizardConfigs.js';

/** Max tasks visible in collapsed mode; press S to show all */
const TASK_LIST_LIMIT = 10;

/** Statuses that allow R (run) action */
const RUNNABLE: Set<TaskStatus> = new Set(['todo', 'failed', 'cancelled']);

/** History entry returned by onLoadHistory */
export interface HistoryEntry {
  timestamp: string;
  agentId: string;
  taskId: string;
  type: 'agent_output' | 'file_changed' | 'tool_call' | 'error' | 'done' | 'command_run';
  data: unknown;
}

export interface AppProps {
  projectName: string;
  tasks: Task[];
  agents?: Agent[];
  state: OrchestratorState;
  onRunTask?: (taskId: string) => Promise<void>;
  onCreateTask?: (title: string, opts?: { priority?: number; description?: string }) => Promise<Task>;
  onCancelTask?: (taskId: string) => Promise<void>;
  onRetryTask?: (taskId: string) => Promise<void>;
  onAssignTask?: (taskId: string, agentId: string) => Promise<void>;
  onRunAll?: () => Promise<void>;
  onDisableAgent?: (agentId: string) => Promise<void>;
  onEnableAgent?: (agentId: string) => Promise<void>;
  onSubscribeEvents?: (handler: (event: OrchestratorEvent) => void) => (() => void);
  // Live refresh callbacks
  onRefreshTasks?: () => Promise<Task[]>;
  onRefreshAgents?: () => Promise<Agent[]>;
  onRefreshState?: () => Promise<OrchestratorState>;
  // History (loaded from disk on startup)
  onLoadHistory?: () => Promise<HistoryEntry[]>;
  // New actions
  onAddAgent?: (name: string, adapter?: string, opts?: { model?: string; role?: string; approval_policy?: string }) => Promise<Agent>;
  onDeleteAgent?: (agentId: string) => Promise<void>;
  onApproveTask?: (taskId: string) => Promise<void>;
  onRejectTask?: (taskId: string, feedback?: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, fields: { title?: string; description?: string; priority?: number }) => Promise<Task>;
  onUpdateAgent?: (agentId: string, fields: { name?: string; role?: string; model?: string; approval_policy?: string }) => Promise<Agent>;
  onForceStopAgent?: (agentId: string) => Promise<void>;
  onStartWatch?: () => Promise<void>;
  onStopWatch?: () => Promise<void>;
}

type InputMode = 'none' | 'new_task' | 'command' | 'wizard';

/** Active wizard configuration */
interface WizardConfig {
  title: string;
  steps: WizardStep[];
  kind: 'agent' | 'task' | 'edit_task' | 'edit_agent';
  /** Target ID for edit wizards */
  targetId?: string;
}

/** Message types for semantic styling */
type MsgType = 'system' | 'lifecycle' | 'output' | 'tool' | 'result' | 'error' | 'file' | 'info';

/** Status message shown in the ACTIVITY feed area */
interface StatusMessage {
  text: string;
  color: string;
  time: string;
  /** Epoch ms for relative time display */
  ts: number;
  agentId?: string;
  taskId?: string;
  /** Full untruncated data for detail view */
  detail?: string;
  /** Semantic type for styling */
  msgType?: MsgType;
}

/** Rotating palette for agent identification */
const AGENT_COLORS = [
  '#5faf87', // green
  '#5fafd7', // blue
  '#af87ff', // purple
  '#d7af00', // yellow
  '#5fd7d7', // cyan
  '#d787af', // pink
  '#afaf5f', // olive
  '#d7875f', // orange
] as const;

/** Get a stable color for an agent based on its index */
function getAgentColor(agentId: string, agents: Agent[]): string {
  const idx = agents.findIndex((a) => a.id === agentId);
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0]!;
}

/** Icons for message types */
const MSG_ICONS: Record<MsgType, string> = {
  system: '\u2666',    // ◆
  lifecycle: '\u25B6',  // ▶
  output: '\u2502',     // │
  tool: '\u2699',       // ⚙
  result: '\u2190',     // ←
  error: '\u2715',      // ✕
  file: '\u270E',       // ✎
  info: '\u2502',       // │
};

export function App({
  projectName, tasks: initialTasks, agents: initialAgents = [], state: initialState,
  onRunTask, onCreateTask, onCancelTask, onRetryTask, onAssignTask,
  onRunAll, onDisableAgent, onEnableAgent, onSubscribeEvents,
  onRefreshTasks, onRefreshAgents, onRefreshState, onLoadHistory,
  onAddAgent, onDeleteAgent, onApproveTask, onRejectTask, onDeleteTask,
  onUpdateTask, onUpdateAgent, onForceStopAgent,
  onStartWatch, onStopWatch,
}: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Track terminal size with resize listener
  const [termSize, setTermSize] = useState({ w: stdout?.columns ?? 80, h: stdout?.rows ?? 24 });
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTermSize({ w: stdout.columns, h: stdout.rows });
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);
  const W = termSize.w;
  const H = termSize.h;

  // ── Live data state (refreshed from disk on events) ──
  const [liveTasks, setLiveTasks] = useState<Task[]>(initialTasks);
  const [liveAgents, setLiveAgents] = useState<Agent[]>(initialAgents);
  const [liveState, setLiveState] = useState<OrchestratorState>(initialState);
  const [watchActive, setWatchActive] = useState(!!initialState.pid);

  // View state
  const [activeView, setActiveView] = useState<ViewId>('tasks');
  const [taskSelectedIndex, setTaskSelectedIndex] = useState(0);
  const [agentSelectedIndex, setAgentSelectedIndex] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [messages, setMessages] = useState<StatusMessage[]>([]);

  // Input mode state
  const [inputMode, setInputMode] = useState<InputMode>('none');
  const [inputValue, setInputValue] = useState('');
  const [wizardConfig, setWizardConfig] = useState<WizardConfig | null>(null);

  // Logs view: agent filter (0 = all, 1-9 = agent by index), type filter, selection, scroll
  const [logFilter, setLogFilter] = useState(0);
  const ALL_MSG_TYPES: MsgType[] = ['system', 'lifecycle', 'output', 'tool', 'result', 'error', 'file', 'info'];
  const [logTypeFilter, setLogTypeFilter] = useState<Set<MsgType>>(() => new Set(ALL_MSG_TYPES));
  const [logSelectedIndex, setLogSelectedIndex] = useState(-1); // -1 = follow tail (no selection)
  const [logScrollOffset, setLogScrollOffset] = useState(0);

  // Command bar: history, scroll offsets, suggestion selection
  const cmdHistory = React.useRef(new CommandHistory()).current;
  const [taskScrollOffset, setTaskScrollOffset] = useState(0);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [agentScrollOffset, setAgentScrollOffset] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);

  // Refresh helpers — re-read from disk for consistent state
  const refreshAll = useCallback(async () => {
    const [t, a, s] = await Promise.all([
      onRefreshTasks?.() ?? Promise.resolve(liveTasks),
      onRefreshAgents?.() ?? Promise.resolve(liveAgents),
      onRefreshState?.() ?? Promise.resolve(liveState),
    ]);
    setLiveTasks(t);
    setLiveAgents(a);
    setLiveState(s);
    setWatchActive(!!s.pid);
  }, [onRefreshTasks, onRefreshAgents, onRefreshState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sorted data
  const sortedTasks = useMemo(
    () => [...liveTasks].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)),
    [liveTasks],
  );

  const sortedAgents = useMemo(
    () => [...liveAgents].sort((a, b) => (AGENT_STATUS_ORDER[a.status] ?? 9) - (AGENT_STATUS_ORDER[b.status] ?? 9)),
    [liveAgents],
  );

  // Limit visible tasks to TASK_LIST_LIMIT unless "Show All" is toggled
  const visibleTasks = showAllTasks ? sortedTasks : sortedTasks.slice(0, TASK_LIST_LIMIT);
  const hiddenTaskCount = sortedTasks.length - visibleTasks.length;

  const selectedTask = sortedTasks[taskSelectedIndex] as Task | undefined;
  const selectedAgent = sortedAgents[agentSelectedIndex] as Agent | undefined;

  // Build task ID → title map for agent view
  const taskTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of liveTasks) map.set(t.id, t.title);
    return map;
  }, [liveTasks]);

  // Build agent ID → name map for task view
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of liveAgents) map.set(a.id, a.name);
    return map;
  }, [liveAgents]);

  // Build runId → agentId and runId → taskId maps from state.running
  // Use refs so dynamic .set() calls from events persist across re-renders
  const runIdToAgentId = useRef(new Map<string, string>());
  const runIdToTaskId = useRef(new Map<string, string>());
  // Seed from liveState.running on every change (additive — don't clear old entries)
  useEffect(() => {
    for (const [taskId, entry] of Object.entries(liveState.running)) {
      runIdToAgentId.current.set(entry.run_id, entry.agent_id);
      runIdToTaskId.current.set(entry.run_id, taskId);
    }
  }, [liveState.running]);

  const addMessage = useCallback((text: string, color: string, opts?: { agentId?: string; taskId?: string; detail?: string; msgType?: MsgType }) => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    setMessages((prev) => [...prev.slice(-200), { text, color, time, ts: now.getTime(), ...opts }]);
  }, []);

  // Load history from disk on mount
  useEffect(() => {
    if (!onLoadHistory) return;
    onLoadHistory().then((entries) => {
      if (entries.length === 0) return;
      const histMsgs: StatusMessage[] = entries.map((entry) => {
        const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        const raw = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data);
        let text: string;
        let color: string = tuiColors.silver;
        let msgType: MsgType = 'output';

        if (entry.type === 'error') {
          text = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data);
          text = text.slice(0, 200);
          color = tuiColors.red;
          msgType = 'error';
        } else if (entry.type === 'file_changed') {
          text = String(entry.data);
          color = tuiColors.purple;
          msgType = 'file';
        } else if (entry.type === 'done') {
          text = 'Completed';
          color = tuiColors.green;
          msgType = 'lifecycle';
        } else if (entry.type === 'tool_call') {
          const d = entry.data as Record<string, unknown> | undefined;
          text = `\u2699 ${d?.name ?? 'tool'}()`;
          color = tuiColors.cyan;
          msgType = 'tool';
        } else {
          const { summary } = formatAgentOutput(raw);
          text = summary;
          // Reclassify by content prefix (same logic as live formatEvent)
          if (text.startsWith('\u2699')) { msgType = 'tool'; color = tuiColors.cyan; }
          else if (text.startsWith('\u2190')) { msgType = 'result'; color = tuiColors.dim; }
          else if (text.startsWith('\u2713')) { msgType = 'lifecycle'; color = tuiColors.green; }
          else if (text.startsWith('\u23F3')) { msgType = 'info'; }
        }

        return { text, color, time, ts: new Date(entry.timestamp).getTime(), agentId: entry.agentId, taskId: entry.taskId, msgType };
      });
      setMessages((prev) => [...histMsgs.slice(-150), ...prev]);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wizard launchers
  const launchAgentWizard = useCallback(() => {
    setWizardConfig({
      title: 'NEW AGENT',
      steps: getAgentWizardSteps(),
      kind: 'agent',
    });
    setInputMode('wizard');
  }, []);

  const launchTaskWizard = useCallback(() => {
    setWizardConfig({
      title: 'NEW TASK',
      steps: getTaskWizardSteps(liveAgents),
      kind: 'task',
    });
    setInputMode('wizard');
  }, [liveAgents]);

  const launchEditTaskWizard = useCallback((task: Task) => {
    setWizardConfig({
      title: 'EDIT TASK',
      steps: getEditTaskWizardSteps(task, liveAgents),
      kind: 'edit_task',
      targetId: task.id,
    });
    setInputMode('wizard');
  }, [liveAgents]);

  const launchEditAgentWizard = useCallback((agent: Agent) => {
    setWizardConfig({
      title: 'EDIT AGENT',
      steps: getEditAgentWizardSteps(agent),
      kind: 'edit_agent',
      targetId: agent.id,
    });
    setInputMode('wizard');
  }, []);

  const handleWizardComplete = useCallback((values: Record<string, string>) => {
    setInputMode('none');
    const kind = wizardConfig?.kind;
    const targetId = wizardConfig?.targetId;
    setWizardConfig(null);

    if (kind === 'agent' && onAddAgent) {
      const input = agentWizardToInput(values);
      addMessage(`Creating agent "${input.name}"...`, tuiColors.amber);
      onAddAgent(input.name, input.adapter, {
        model: input.model,
        role: input.role,
        approval_policy: input.approval_policy,
      }).then(
        (agent) => {
          addMessage(`\u2713 Created agent "${agent.name}" (${agent.id}, ${agent.adapter})`, tuiColors.green);
          refreshAll();
        },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
    } else if (kind === 'task' && onCreateTask) {
      const input = taskWizardToInput(values);
      addMessage(`Creating "${input.title}"...`, tuiColors.amber);
      onCreateTask(input.title, {
        priority: input.priority,
        description: input.description,
      }).then(
        (task) => {
          addMessage(`\u2713 Created "${task.title}" (${task.id})`, tuiColors.green);
          if (input.assignee && onAssignTask) {
            onAssignTask(task.id, input.assignee).catch(() => {});
          }
          refreshAll();
        },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
    } else if (kind === 'edit_task' && targetId && onUpdateTask) {
      const fields = editTaskWizardToFields(values);
      addMessage(`Updating task...`, tuiColors.amber);
      onUpdateTask(targetId, fields).then(
        (task) => {
          addMessage(`\u2713 Updated "${task.title}"`, tuiColors.green);
          // Re-assign if changed
          if (fields.assignee && onAssignTask) {
            onAssignTask(targetId, fields.assignee).catch(() => {});
          }
          refreshAll();
        },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
    } else if (kind === 'edit_agent' && targetId && onUpdateAgent) {
      const fields = editAgentWizardToFields(values);
      addMessage(`Updating agent...`, tuiColors.amber);
      onUpdateAgent(targetId, fields).then(
        (agent) => {
          addMessage(`\u2713 Updated agent "${agent.name}"`, tuiColors.green);
          refreshAll();
        },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
    }
  }, [wizardConfig, onAddAgent, onCreateTask, onAssignTask, onUpdateTask, onUpdateAgent, addMessage, refreshAll]);

  const handleWizardCancel = useCallback(() => {
    setInputMode('none');
    setWizardConfig(null);
  }, []);

  // Live event subscription — update activity feed AND refresh data
  useEffect(() => {
    if (!onSubscribeEvents) return;
    // Debounce refresh to avoid hammering disk on rapid events
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshAll().catch(() => {});
      }, 150);
    };

    const unsubscribe = onSubscribeEvents((event) => {
      // Track runId → agentId/taskId BEFORE formatting so output events resolve correctly
      if (event.type === 'agent:started') {
        runIdToAgentId.current.set(event.runId, event.agentId);
        runIdToTaskId.current.set(event.runId, event.taskId);
      }
      formatEvent(event, addMessage, runIdToAgentId.current, runIdToTaskId.current);
      // Refresh on state-changing events
      if (event.type === 'task:status_changed' ||
          event.type === 'task:created' ||
          event.type === 'task:assigned' ||
          event.type === 'agent:started' ||
          event.type === 'agent:completed' ||
          event.type === 'run:retry') {
        scheduleRefresh();
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [onSubscribeEvents, addMessage, refreshAll]);

  // Layout (computed before useInput — mainH needed for scroll)
  const mode = watchActive ? 'watching' : 'idle';
  const uptime = liveState.started_at ? formatDurationSince(liveState.started_at) : undefined;
  const totalTokens = liveState.stats.total_tokens.total;

  // Header stats aggregate
  const headerStats: HeaderStats = {
    running: liveTasks.filter((t) => t.status === 'in_progress').length,
    retrying: liveTasks.filter((t) => t.status === 'retrying').length,
    review: liveTasks.filter((t) => t.status === 'review').length,
    todo: liveTasks.filter((t) => t.status === 'todo').length,
    done: liveTasks.filter((t) => t.status === 'done').length,
    failed: liveTasks.filter((t) => t.status === 'failed').length,
    cancelled: liveTasks.filter((t) => t.status === 'cancelled').length,
  };
  const runningCount = headerStats.running;
  const headerTokens: HeaderTokens = {
    input: liveState.stats.total_tokens.input ?? 0,
    output: liveState.stats.total_tokens.output ?? 0,
    total: totalTokens,
  };

  // Fixed rows: Header(5) + gap(1) + SectionLabel(1) + gap(1) + CommandBar(1) = 9
  const fixedRows = 9;
  const contentH = Math.max(4, H - fixedRows);
  // Adaptive split: task/agent list takes only what it needs, rest goes to feed/logs
  const listItemCount = activeView === 'tasks' ? liveTasks.length + 1 : // +1 for "+ add" row
    activeView === 'agents' ? liveAgents.length + 1 : 0;
  const minListH = Math.min(listItemCount + 1, Math.ceil(contentH * 0.5)); // cap at 50%
  const mainH = activeView === 'logs' ? contentH : Math.max(2, Math.min(minListH, contentH - 4));
  const feedH = Math.max(1, contentH - mainH);
  const ruleW = Math.max(10, W - 2);

  // Suggestions for command mode
  const suggestions = useMemo(
    () => inputMode === 'command' ? resolveSuggestions(inputValue) : [],
    [inputMode, inputValue],
  );

  // Clamp scroll offsets when data changes
  useEffect(() => {
    setTaskScrollOffset((o) => Math.min(o, Math.max(0, visibleTasks.length - mainH)));
  }, [visibleTasks.length, mainH]);
  useEffect(() => {
    setAgentScrollOffset((o) => Math.min(o, Math.max(0, sortedAgents.length - mainH)));
  }, [sortedAgents.length, mainH]);

  // Command dispatcher for "/" command bar
  const executeCommand = useCallback((raw: string) => {
    const stripped = raw.trim().replace(/^\//, ''); // strip leading /
    const parts = stripped.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (!cmd) return;

    const errMsg = (err: unknown) => err instanceof Error ? err.message : String(err);

    switch (cmd) {
      // ── Legacy shortcuts (backward compat) ──
      case 'cancel': {
        if (!selectedTask) { addMessage('No task selected', tuiColors.yellow); return; }
        if (!onCancelTask) return;
        addMessage(`Cancelling "${selectedTask.title}"...`, tuiColors.amber);
        onCancelTask(selectedTask.id).then(
          () => { addMessage(`\u2713 Cancelled "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }
      case 'retry': {
        if (!selectedTask) { addMessage('No task selected', tuiColors.yellow); return; }
        if (!onRetryTask) return;
        addMessage(`Retrying "${selectedTask.title}"...`, tuiColors.amber);
        onRetryTask(selectedTask.id).then(
          () => { addMessage(`\u2713 Retried "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }
      case 'assign': {
        if (!selectedTask) { addMessage('No task selected', tuiColors.yellow); return; }
        if (!onAssignTask || !parts[1]) { addMessage('Usage: assign <agent>', tuiColors.yellow); return; }
        addMessage(`Assigning "${selectedTask.title}" to ${parts[1]}...`, tuiColors.amber);
        onAssignTask(selectedTask.id, parts[1]).then(
          () => { addMessage(`\u2713 Assigned "${selectedTask.title}" to ${parts[1]}`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }

      // ── /task group ──
      case 'task': {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'add') {
          const title = parts.slice(2).join(' ');
          if (!title) { launchTaskWizard(); return; }
          if (!onCreateTask) { addMessage('Create not available', tuiColors.yellow); return; }
          addMessage(`Creating "${title}"...`, tuiColors.amber);
          onCreateTask(title).then(
            (task) => { addMessage(`\u2713 Created "${task.title}" (${task.id})`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'list') {
          const lines = sortedTasks.map((t) => `  ${t.id}  ${t.status.padEnd(11)} ${t.title}`);
          if (lines.length === 0) addMessage('No tasks', tuiColors.dim);
          else for (const line of lines) addMessage(line, tuiColors.cyan);
        } else if (sub === 'show') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          addMessage(`${t.id}  ${t.status}  P${t.priority}  "${t.title}"`, tuiColors.cyan);
          if (t.assignee) addMessage(`  agent: ${t.assignee}`, tuiColors.dim);
          if (t.description) addMessage(`  ${t.description.slice(0, 100)}`, tuiColors.dim);
        } else if (sub === 'cancel') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (!onCancelTask) return;
          addMessage(`Cancelling "${t.title}"...`, tuiColors.amber);
          onCancelTask(t.id).then(
            () => { addMessage(`\u2713 Cancelled "${t.title}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'retry') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (!onRetryTask) return;
          addMessage(`Retrying "${t.title}"...`, tuiColors.amber);
          onRetryTask(t.id).then(
            () => { addMessage(`\u2713 Retried "${t.title}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'assign') {
          const foundByParts2 = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : undefined;
          const t = foundByParts2 ?? selectedTask;
          const agentArg = foundByParts2 ? parts[3] : parts[2];
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (!agentArg) { addMessage('Usage: /task assign [id] <agent>', tuiColors.yellow); return; }
          if (!onAssignTask) return;
          addMessage(`Assigning "${t.title}" to ${agentArg}...`, tuiColors.amber);
          onAssignTask(t.id, agentArg).then(
            () => { addMessage(`\u2713 Assigned "${t.title}" to ${agentArg}`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'approve') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (t.status !== 'review') { addMessage(`Cannot approve \u2014 status is ${t.status}`, tuiColors.yellow); return; }
          if (!onApproveTask) return;
          addMessage(`Approving "${t.title}"...`, tuiColors.amber);
          onApproveTask(t.id).then(
            () => { addMessage(`\u2713 Approved "${t.title}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'reject') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (t.status !== 'review') { addMessage(`Cannot reject \u2014 status is ${t.status}`, tuiColors.yellow); return; }
          if (!onRejectTask) return;
          const feedback = parts.slice(parts[2] && sortedTasks.find((x) => x.id === parts[2]) ? 3 : 2).join(' ').trim() || undefined;
          addMessage(`Rejecting "${t.title}"${feedback ? ' with feedback' : ''}...`, tuiColors.amber);
          onRejectTask(t.id, feedback).then(
            () => { addMessage(`\u2713 Rejected "${t.title}" \u2192 todo`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'delete') {
          const t = parts[2] ? sortedTasks.find((x) => x.id === parts[2]) : selectedTask;
          if (!t) { addMessage('No task selected or id given', tuiColors.yellow); return; }
          if (t.status === 'in_progress') { addMessage(`Cannot delete \u2014 task is running`, tuiColors.yellow); return; }
          if (!onDeleteTask) return;
          addMessage(`Deleting "${t.title}"...`, tuiColors.amber);
          onDeleteTask(t.id).then(
            () => { addMessage(`\u2713 Deleted "${t.title}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else {
          addMessage('Usage: /task add|list|show|cancel|retry|assign|approve|reject|delete', tuiColors.yellow);
        }
        return;
      }

      // ── /agent group ──
      case 'agent': {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'add') {
          const name = parts[2];
          if (!name) { launchAgentWizard(); return; }
          if (!onAddAgent) { addMessage('Agent creation not available', tuiColors.yellow); return; }
          const adapter = parts[3];
          addMessage(`Creating agent "${name}"...`, tuiColors.amber);
          onAddAgent(name, adapter).then(
            (agent) => { addMessage(`\u2713 Created agent "${agent.name}" (${agent.id}, ${agent.adapter})`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'list') {
          const lines = sortedAgents.map((a) => `  ${a.id}  ${a.status.padEnd(8)} ${a.name} (${a.adapter})`);
          if (lines.length === 0) addMessage('No agents', tuiColors.dim);
          else for (const line of lines) addMessage(line, tuiColors.cyan);
        } else if (sub === 'disable') {
          const a = parts[2] ? sortedAgents.find((x) => x.id === parts[2] || x.name === parts[2]) : selectedAgent;
          if (!a) { addMessage('No agent selected or id given', tuiColors.yellow); return; }
          if (!onDisableAgent) return;
          addMessage(`Disabling ${a.name}...`, tuiColors.amber);
          onDisableAgent(a.id).then(
            () => { addMessage(`\u2713 Disabled ${a.name}`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'enable') {
          const a = parts[2] ? sortedAgents.find((x) => x.id === parts[2] || x.name === parts[2]) : selectedAgent;
          if (!a) { addMessage('No agent selected or id given', tuiColors.yellow); return; }
          if (!onEnableAgent) return;
          addMessage(`Enabling ${a.name}...`, tuiColors.amber);
          onEnableAgent(a.id).then(
            () => { addMessage(`\u2713 Enabled ${a.name}`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else if (sub === 'delete' || sub === 'remove') {
          const a = parts[2] ? sortedAgents.find((x) => x.id === parts[2] || x.name === parts[2]) : selectedAgent;
          if (!a) { addMessage('No agent selected or id given', tuiColors.yellow); return; }
          if (a.status === 'running') { addMessage('Cannot delete — agent is running', tuiColors.yellow); return; }
          if (!onDeleteAgent) { addMessage('Agent deletion not available', tuiColors.yellow); return; }
          addMessage(`Deleting agent "${a.name}"...`, tuiColors.amber);
          onDeleteAgent(a.id).then(
            () => { addMessage(`\u2713 Deleted agent "${a.name}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
          );
        } else {
          addMessage('Usage: /agent add|list|disable|enable|delete', tuiColors.yellow);
        }
        return;
      }

      // ── /run, /run-all ──
      case 'run': {
        const idArg = parts[1] ?? selectedTask?.id;
        if (!idArg) { addMessage('No task selected or id given', tuiColors.yellow); return; }
        if (!onRunTask) { addMessage('Run not available', tuiColors.yellow); return; }
        const t = sortedTasks.find((x) => x.id === idArg);
        if (t && !RUNNABLE.has(t.status)) { addMessage(`Cannot run \u2014 status is ${t.status}`, tuiColors.yellow); return; }
        addMessage(`Running ${idArg}...`, tuiColors.amber);
        onRunTask(idArg).then(
          () => { addMessage(`\u2713 Dispatched ${idArg}`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }
      case 'run-all': {
        if (!onRunAll) { addMessage('Run-all not available', tuiColors.yellow); return; }
        addMessage('Running all todo tasks...', tuiColors.amber);
        onRunAll().then(
          () => { addMessage('\u2713 Dispatched all todo tasks', tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }

      // ── /watch, /pause ──
      case 'watch': {
        if (watchActive) { addMessage('Watch mode already active', tuiColors.yellow); return; }
        if (!onStartWatch) { addMessage('Watch not available', tuiColors.yellow); return; }
        addMessage('Starting watch mode...', tuiColors.amber);
        onStartWatch().then(
          () => { setWatchActive(true); addMessage('\u2713 Watch mode started', tuiColors.green); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }
      case 'pause': {
        if (!watchActive) { addMessage('Watch mode not active', tuiColors.yellow); return; }
        if (!onStopWatch) { addMessage('Pause not available', tuiColors.yellow); return; }
        addMessage('Pausing watch mode...', tuiColors.amber);
        onStopWatch().then(
          () => { setWatchActive(false); addMessage('\u2713 Watch mode paused', tuiColors.green); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }

      // ── /status ──
      case 'status': {
        const running = liveTasks.filter((t) => t.status === 'in_progress').length;
        addMessage(`${mode}  ${running} running  ${liveTasks.length} tasks  ${sortedAgents.length} agents`, tuiColors.cyan);
        return;
      }

      // ── /help ──
      case 'help': {
        for (const [verb, spec] of Object.entries(COMMAND_REGISTRY)) {
          const subs = spec.sub ? ' ' + spec.sub.join('|') : spec.args ? ' ' + spec.args : '';
          addMessage(`  /${verb}${subs}  \u2014 ${spec.help}`, tuiColors.silver);
        }
        return;
      }

      // ── /quit ──
      case 'quit': {
        exit();
        return;
      }

      // ── /disable, /enable (agent shortcuts) ──
      case 'disable': {
        if (!selectedAgent) { addMessage('No agent selected', tuiColors.yellow); return; }
        if (!onDisableAgent) return;
        addMessage(`Disabling ${selectedAgent.name}...`, tuiColors.amber);
        onDisableAgent(selectedAgent.id).then(
          () => { addMessage(`\u2713 Disabled ${selectedAgent.name}`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }
      case 'enable': {
        if (!selectedAgent) { addMessage('No agent selected', tuiColors.yellow); return; }
        if (!onEnableAgent) return;
        addMessage(`Enabling ${selectedAgent.name}...`, tuiColors.amber);
        onEnableAgent(selectedAgent.id).then(
          () => { addMessage(`\u2713 Enabled ${selectedAgent.name}`, tuiColors.green); refreshAll(); },
          (err) => addMessage(`Failed: ${errMsg(err)}`, tuiColors.red),
        );
        return;
      }

      default:
        addMessage(`Unknown: ${cmd}. Type /help for commands`, tuiColors.yellow);
    }
  }, [selectedTask, selectedAgent, sortedTasks, sortedAgents, liveTasks, mode, watchActive,
      onCancelTask, onRetryTask, onAssignTask, onRunAll, onRunTask, onCreateTask,
      onDisableAgent, onEnableAgent, onAddAgent, onApproveTask, onRejectTask, onDeleteTask,
      onStartWatch, onStopWatch, addMessage, exit, refreshAll, launchTaskWizard, launchAgentWizard]);

  useInput((input, key) => {
    // ── Input mode: all keys go to the text buffer ──
    if (inputMode !== 'none') {
      if (key.escape) {
        setInputMode('none');
        setInputValue('');
        cmdHistory.reset();
        return;
      }
      if (key.return) {
        const value = inputValue.trim();
        if (!value) return;

        if (inputMode === 'new_task') {
          if (!onCreateTask) return;
          setInputMode('none');
          setInputValue('');
          addMessage(`Creating "${value}"...`, tuiColors.amber);
          onCreateTask(value).then(
            (task) => {
              addMessage(`\u2713 Created "${task.title}" (${task.id})`, tuiColors.green);
              refreshAll();
            },
            (err) => addMessage(`Failed to create: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
          );
        } else if (inputMode === 'command') {
          // If a suggestion is highlighted, use it instead of raw input
          let cmdToRun = value;
          if (suggestions.length > 0 && suggestions[suggestionIndex]) {
            const sel = suggestions[suggestionIndex];
            const cmdPart = sel.cmd.replace(/\s+\[.*\]$/, '');
            // Only use suggestion if input is a prefix (user hasn't typed something different)
            if (cmdPart.startsWith(value) || value === '/') {
              cmdToRun = cmdPart;
            }
            // If the suggestion has subcommands and no subcommand is chosen yet,
            // fill input and show sub-suggestions instead of executing
            if (sel.subs && !cmdPart.includes(' ')) {
              setInputValue(cmdPart + ' ');
              setSuggestionIndex(0);
              return;
            }
          }
          setInputMode('none');
          setInputValue('');
          setSuggestionIndex(0);
          cmdHistory.push(cmdToRun);
          executeCommand(cmdToRun);
        }
        return;
      }
      // Tab: fill from suggestion or ghost completion (command mode only)
      if (key.tab && inputMode === 'command') {
        if (suggestions.length > 0) {
          const sel = suggestions[suggestionIndex];
          if (sel) {
            // Extract just the command part (without args placeholder)
            const cmdPart = sel.cmd.replace(/\s+\[.*\]$/, '');
            setInputValue(cmdPart + (sel.subs ? ' ' : ''));
            setSuggestionIndex(0);
          }
        } else {
          const suffix = resolveCompletion(inputValue);
          if (suffix) setInputValue((v) => v + suffix);
        }
        return;
      }
      // ↑↓: navigate suggestions when visible, otherwise history
      if (key.upArrow && inputMode === 'command') {
        if (suggestions.length > 0) {
          setSuggestionIndex((i) => Math.max(0, i - 1));
        } else {
          const prev = cmdHistory.prev();
          if (prev !== null) setInputValue(prev);
        }
        return;
      }
      if (key.downArrow && inputMode === 'command') {
        if (suggestions.length > 0) {
          setSuggestionIndex((i) => Math.min(suggestions.length - 1, i + 1));
        } else {
          const next = cmdHistory.next();
          setInputValue(next ?? '');
        }
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        setSuggestionIndex(0);
        return;
      }
      // Accumulate printable characters (ignore control keys)
      if (input && !key.ctrl && !key.meta) {
        setInputValue((v) => v + input);
        setSuggestionIndex(0);
      }
      return;
    }

    // ── Normal mode ──

    // Quit
    if (input.toLowerCase() === 'q') {
      exit();
      return;
    }

    // Escape: close detail panel or deselect (never quit — use Q to quit)
    if (key.escape) {
      if (detailOpen) {
        setDetailOpen(false);
        return;
      }
      if (activeView === 'logs' && logSelectedIndex >= 0) {
        // Return to tail mode
        setLogSelectedIndex(-1);
        setLogScrollOffset(0);
        return;
      }
      return;
    }

    // /: command bar (from any view, when not in detail)
    if (input === '/' && !detailOpen) {
      setInputMode('command');
      setInputValue('/');
      setSuggestionIndex(0);
      return;
    }

    // 0-9: agent filter in Logs view (US-9.9)
    if (activeView === 'logs' && !detailOpen && input >= '0' && input <= '9') {
      setLogFilter(parseInt(input, 10));
      return;
    }

    // F: cycle type filter in Logs view
    if ((input === 'f' || input === 'F') && activeView === 'logs' && !detailOpen) {
      setLogTypeFilter((prev) => {
        const presets: Array<{ label: string; types: MsgType[] }> = [
          { label: 'all', types: ALL_MSG_TYPES },
          { label: 'text', types: ['output'] },
          { label: 'tools', types: ['tool', 'result', 'file'] },
          { label: 'errors', types: ['error'] },
          { label: 'events', types: ['lifecycle', 'system'] },
        ];
        // Find current preset index
        const curIdx = presets.findIndex((p) => p.types.length === prev.size && p.types.every((t) => prev.has(t)));
        const nextIdx = (curIdx + 1) % presets.length;
        return new Set(presets[nextIdx]!.types);
      });
      return;
    }

    // N: new task wizard (only in tasks view, not in detail mode)
    if ((input === 'n' || input === 'N') && activeView === 'tasks' && !detailOpen && onCreateTask) {
      launchTaskWizard();
      return;
    }

    // N: new agent wizard (only in agents view, not in detail mode)
    if ((input === 'n' || input === 'N') && activeView === 'agents' && !detailOpen && onAddAgent) {
      launchAgentWizard();
      return;
    }

    // A: approve selected task in review (tasks view only, before view switch)
    if ((input === 'a' || input === 'A') && activeView === 'tasks' && selectedTask?.status === 'review' && onApproveTask) {
      addMessage(`Approving "${selectedTask.title}"...`, tuiColors.amber);
      onApproveTask(selectedTask.id).then(
        () => { addMessage(`\u2713 Approved "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // X: reject selected task in review (tasks view only)
    if ((input === 'x' || input === 'X') && activeView === 'tasks' && selectedTask?.status === 'review' && onRejectTask) {
      addMessage(`Rejecting "${selectedTask.title}"...`, tuiColors.amber);
      onRejectTask(selectedTask.id).then(
        () => { addMessage(`\u2713 Rejected "${selectedTask.title}" \u2192 todo`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // C: cancel selected task (running or non-terminal)
    if ((input === 'c' || input === 'C') && activeView === 'tasks' && selectedTask && onCancelTask) {
      if (selectedTask.status === 'done' || selectedTask.status === 'failed' || selectedTask.status === 'cancelled') {
        addMessage(`Cannot cancel — status is ${selectedTask.status}`, tuiColors.yellow);
        return;
      }
      addMessage(`Cancelling "${selectedTask.title}"...`, tuiColors.amber);
      onCancelTask(selectedTask.id).then(
        () => { addMessage(`\u2713 Cancelled "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // E: edit selected task or agent
    if ((input === 'e' || input === 'E') && activeView === 'tasks' && selectedTask && onUpdateTask) {
      launchEditTaskWizard(selectedTask);
      return;
    }
    if ((input === 'e' || input === 'E') && activeView === 'agents' && selectedAgent && onUpdateAgent) {
      launchEditAgentWizard(selectedAgent);
      return;
    }

    // S: toggle "Show All" tasks in tasks view
    if ((input === 's' || input === 'S') && activeView === 'tasks') {
      setShowAllTasks((v) => !v);
      setTaskSelectedIndex(0);
      setTaskScrollOffset(0);
      return;
    }

    // S: force-stop a running agent (kill process + clean state)
    if ((input === 's' || input === 'S') && activeView === 'agents' && selectedAgent && onForceStopAgent) {
      const isActuallyRunning = Object.values(liveState.running).some((e) => e.agent_id === selectedAgent.id);
      if (!isActuallyRunning && selectedAgent.status !== 'running') {
        addMessage(`Agent "${selectedAgent.name}" is not running`, tuiColors.yellow);
        return;
      }
      addMessage(`Force-stopping agent "${selectedAgent.name}"...`, tuiColors.amber);
      onForceStopAgent(selectedAgent.id).then(
        () => { addMessage(`\u2713 Stopped agent "${selectedAgent.name}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // D: delete selected task (not running) or agent (not running)
    if ((input === 'd' || input === 'D') && activeView === 'tasks' && selectedTask && selectedTask.status !== 'in_progress' && onDeleteTask) {
      addMessage(`Deleting "${selectedTask.title}"...`, tuiColors.amber);
      onDeleteTask(selectedTask.id).then(
        () => { addMessage(`\u2713 Deleted "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }
    if ((input === 'd' || input === 'D') && activeView === 'agents' && selectedAgent && onDeleteAgent) {
      const isActuallyRunning = Object.values(liveState.running).some((e) => e.agent_id === selectedAgent.id);
      if (isActuallyRunning) {
        // Force-stop first, then delete
        if (onForceStopAgent) {
          addMessage(`Stopping & deleting agent "${selectedAgent.name}"...`, tuiColors.amber);
          onForceStopAgent(selectedAgent.id).then(
            () => onDeleteAgent(selectedAgent.id),
          ).then(
            () => { addMessage(`\u2713 Deleted agent "${selectedAgent.name}"`, tuiColors.green); refreshAll(); },
            (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
          );
        } else {
          addMessage(`Cannot delete \u2014 agent "${selectedAgent.name}" is running. Press S to stop first.`, tuiColors.yellow);
        }
        return;
      }
      addMessage(`Deleting agent "${selectedAgent.name}"...`, tuiColors.amber);
      onDeleteAgent(selectedAgent.id).then(
        () => { addMessage(`\u2713 Deleted agent "${selectedAgent.name}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // View switching: T/A/L keys (only when detail panel is closed)
    if (!detailOpen) {
      if (input === 't' || input === 'T') { setActiveView('tasks'); return; }
      if (input === 'a' || input === 'A') { setActiveView('agents'); return; }
      if (input === 'l' || input === 'L') { setActiveView('logs'); return; }
    }

    // Tab / ←→: cycle views (when not in detail)
    if (!detailOpen) {
      const viewOrder: ViewId[] = ['tasks', 'agents', 'logs'];
      const idx = viewOrder.indexOf(activeView);
      if (key.tab || key.rightArrow) {
        setActiveView(viewOrder[(idx + 1) % viewOrder.length]!);
        return;
      }
      if (key.leftArrow) {
        setActiveView(viewOrder[(idx + viewOrder.length - 1) % viewOrder.length]!);
        return;
      }
    }

    // Enter: toggle detail panel OR open add input
    if (key.return) {
      // Enter on "Show All" row → toggle show all
      const showAllRowIdx = hiddenTaskCount > 0 ? visibleTasks.length : -1;
      if (activeView === 'tasks' && taskSelectedIndex === showAllRowIdx) {
        setShowAllTasks((v) => !v);
        setTaskSelectedIndex(0);
        setTaskScrollOffset(0);
        return;
      }
      // Enter on "+ add task..." row → open task wizard
      const addRowIdx = visibleTasks.length + (hiddenTaskCount > 0 ? 1 : 0);
      if (activeView === 'tasks' && taskSelectedIndex === addRowIdx && onCreateTask) {
        launchTaskWizard();
        return;
      }
      // Enter on "+ add agent..." row → open agent wizard
      if (activeView === 'agents' && agentSelectedIndex === sortedAgents.length && onAddAgent) {
        launchAgentWizard();
        return;
      }
      if (activeView === 'tasks' && selectedTask) {
        setDetailOpen((prev) => !prev);
        return;
      }
      if (activeView === 'agents' && selectedAgent) {
        setDetailOpen((prev) => !prev);
        return;
      }
      if (activeView === 'logs' && logSelectedIndex >= 0) {
        setDetailOpen((prev) => !prev);
        return;
      }
    }

    // R: run selected task (only in tasks view)
    if ((input === 'r' || input === 'R') && activeView === 'tasks' && selectedTask && onRunTask) {
      if (!RUNNABLE.has(selectedTask.status)) {
        addMessage(`Cannot run "${selectedTask.title}" \u2014 status is ${selectedTask.status}`, tuiColors.yellow);
        return;
      }
      addMessage(`Running "${selectedTask.title}"...`, tuiColors.green);
      onRunTask(selectedTask.id).then(
        () => { addMessage(`Dispatched "${selectedTask.title}"`, tuiColors.green); refreshAll(); },
        (err) => addMessage(`Failed to run: ${err instanceof Error ? err.message : String(err)}`, tuiColors.red),
      );
      return;
    }

    // Navigation with scroll offset (functional updaters to avoid stale closures)
    if (key.upArrow || input === 'k') {
      if (activeView === 'tasks') {
        setTaskSelectedIndex((i) => {
          const next = Math.max(0, i - 1);
          setTaskScrollOffset((o) => (next < o ? next : o));
          return next;
        });
      } else if (activeView === 'agents') {
        setAgentSelectedIndex((i) => {
          const next = Math.max(0, i - 1);
          setAgentScrollOffset((o) => (next < o ? next : o));
          return next;
        });
      } else if (activeView === 'logs') {
        setLogSelectedIndex((i) => {
          // If at tail (-1), jump to last message
          if (i === -1) {
            const last = messages.length - 1;
            setLogScrollOffset(Math.max(0, last - mainH + 2));
            return Math.max(0, last);
          }
          const next = Math.max(0, i - 1);
          setLogScrollOffset((o) => (next < o ? next : o));
          return next;
        });
      }
    }
    if (key.downArrow || input === 'j') {
      if (activeView === 'tasks') {
        const maxIdx = visibleTasks.length + (onCreateTask ? 1 : 0) + (hiddenTaskCount > 0 ? 1 : 0) - 1; // +1 for add row, +1 for show-all row
        setTaskSelectedIndex((i) => {
          const next = Math.min(Math.max(0, maxIdx), i + 1);
          setTaskScrollOffset((o) => (next >= o + mainH ? next - mainH + 1 : o));
          return next;
        });
      } else if (activeView === 'agents') {
        const maxIdx = sortedAgents.length + (onAddAgent ? 1 : 0) - 1; // +1 for add row
        setAgentSelectedIndex((i) => {
          const next = Math.min(Math.max(0, maxIdx), i + 1);
          setAgentScrollOffset((o) => (next >= o + mainH ? next - mainH + 1 : o));
          return next;
        });
      } else if (activeView === 'logs') {
        setLogSelectedIndex((i) => {
          if (i === -1) return -1; // already at tail
          const maxIdx = messages.length - 1;
          if (i >= maxIdx) { // past end → return to tail mode
            setLogScrollOffset(0);
            return -1;
          }
          const next = i + 1;
          setLogScrollOffset((o) => (next >= o + mainH - 1 ? next - mainH + 2 : o));
          return next;
        });
      }
    }
  });

  const inInput = inputMode !== 'none';
  const selectedLog = logSelectedIndex >= 0 ? messages[logSelectedIndex] : undefined;
  const showTaskDetail = !inInput && detailOpen && activeView === 'tasks' && selectedTask;
  const showAgentDetail = !inInput && detailOpen && activeView === 'agents' && selectedAgent;
  const showLogDetail = !inInput && detailOpen && activeView === 'logs' && selectedLog;
  const canRun = !inInput && activeView === 'tasks' && selectedTask && RUNNABLE.has(selectedTask.status) && !!onRunTask;
  const canNew = !inInput && !detailOpen && (
    (activeView === 'tasks' && !!onCreateTask) ||
    (activeView === 'agents' && !!onAddAgent)
  );
  const canApprove = !inInput && activeView === 'tasks' && selectedTask?.status === 'review' && !!onApproveTask;
  const canReject = !inInput && activeView === 'tasks' && selectedTask?.status === 'review' && !!onRejectTask;
  const agentActuallyRunning = selectedAgent ? Object.values(liveState.running).some((e) => e.agent_id === selectedAgent.id) : false;
  const canDelete = !inInput && (
    (activeView === 'tasks' && selectedTask && selectedTask.status !== 'in_progress' && !!onDeleteTask) ||
    (activeView === 'agents' && selectedAgent && !!onDeleteAgent)
  );
  const canEdit = !inInput && !detailOpen && (
    (activeView === 'tasks' && !!selectedTask && !!onUpdateTask) ||
    (activeView === 'agents' && !!selectedAgent && !!onUpdateAgent)
  );
  const canForceStop = !inInput && activeView === 'agents' && selectedAgent &&
    (agentActuallyRunning || selectedAgent.status === 'running') && !!onForceStopAgent;

  const showSuggestions = inputMode === 'command' && suggestions.length > 0;

  return (
    <Box flexDirection="column" width={W} height={H}>
      {/* Header: brand + tabs + status + stats ribbon */}
      <Header
        projectName={projectName}
        activeView={activeView}
        mode={mode}
        stats={headerStats}
        tokens={headerTokens}
        uptime={uptime}
        width={W}
      />

      {/* Breathing room after header */}
      <Box height={1} />

      {/* Main content area */}
      {activeView === 'tasks' && (
        <TasksContent
          tasks={visibleTasks}
          selectedIndex={taskSelectedIndex}
          scrollOffset={taskScrollOffset}
          height={mainH}
          width={ruleW}
          showAddRow={!!onCreateTask}
          agentNameMap={agentNameMap}
          hiddenCount={hiddenTaskCount}
        />
      )}
      {activeView === 'agents' && (
        <AgentsContent
          agents={sortedAgents}
          selectedIndex={agentSelectedIndex}
          scrollOffset={agentScrollOffset}
          height={mainH}
          width={ruleW}
          state={liveState}
          taskTitleMap={taskTitleMap}
          showAddRow={!!onAddAgent}
        />
      )}
      {activeView === 'logs' && (
        <LogsContent
          messages={messages}
          height={mainH}
          agents={sortedAgents}
          logFilter={logFilter}
          logTypeFilter={logTypeFilter}
          selectedIndex={logSelectedIndex}
          scrollOffset={logScrollOffset}
          agentNameMap={agentNameMap}
          taskTitleMap={taskTitleMap}
          width={ruleW}
        />
      )}

      {/* Breathing room before bottom panel */}
      <Box height={1} />

      {/* Bottom panel: WIZARD or SUGGESTIONS or NEW TASK or DETAIL or ACTIVITY */}
      {inputMode === 'wizard' && wizardConfig ? (
        <FormWizard
          title={wizardConfig.title}
          steps={wizardConfig.steps}
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
          width={ruleW}
          height={feedH}
        />
      ) : showSuggestions ? (
        <>
          <SectionLabel label="COMMANDS" width={ruleW} />
          <SuggestionsPanel
            suggestions={suggestions}
            selectedIndex={suggestionIndex}
            height={Math.min(suggestions.length, feedH)}
            width={ruleW}
          />
        </>
      ) : inputMode === 'new_task' ? (
        <>
          <InputSectionLabel mode={inputMode} width={ruleW} />
          <InputPanel mode={inputMode} value={inputValue} width={ruleW} />
        </>
      ) : showTaskDetail ? (
        <>
          <DetailSectionLabel task={selectedTask} width={ruleW} />
          <DetailPanel task={selectedTask} height={feedH} width={ruleW}
            taskLogs={messages.filter((m) => m.taskId === selectedTask.id)}
            agentNameMap={agentNameMap} />
        </>
      ) : showAgentDetail ? (
        <>
          <AgentDetailSectionLabel agent={selectedAgent} width={ruleW} />
          <AgentDetailPanel agent={selectedAgent} height={feedH} state={liveState} taskTitleMap={taskTitleMap} />
        </>
      ) : showLogDetail ? (
        <>
          <SectionLabel label="LOG" width={ruleW} />
          <LogDetailPanel message={selectedLog} height={feedH} width={ruleW} agents={sortedAgents} agentNameMap={agentNameMap} taskTitleMap={taskTitleMap} />
        </>
      ) : messages.length > 0 && activeView !== 'logs' ? (
        <>
          <SectionLabel label="ACTIVITY" width={ruleW} />
          <ActivityFeed messages={messages} height={Math.max(1, feedH - 1)} hasTasks={sortedTasks.length > 0}
            agents={sortedAgents} agentNameMap={agentNameMap} />
        </>
      ) : null}

      {/* Spacer pushes CommandBar to bottom */}
      <Box flexGrow={1} />

      {/* Command bar */}
      <CommandBar
        mode={inputMode === 'command' ? 'command' : 'navigate'}
        value={inputMode === 'command' ? inputValue : ''}
        completion={inputMode === 'command' ? resolveCompletion(inputValue) : null}
        activeView={activeView}
        canRun={!!canRun}
        canNew={!!canNew}
        canApprove={!!canApprove}
        canReject={!!canReject}
        canCancel={activeView === 'tasks' && !!selectedTask && selectedTask.status === 'in_progress' && !!onCancelTask}
        canDelete={!!canDelete}
        canEdit={!!canEdit}
        canForceStop={!!canForceStop}
        canToggleShowAll={activeView === 'tasks' && sortedTasks.length > TASK_LIST_LIMIT}
        showAllActive={showAllTasks}
        hasDetail={!!(showTaskDetail || showAgentDetail)}
        itemCount={activeView === 'tasks' ? liveTasks.length : activeView === 'agents' ? liveAgents.length : messages.length}
        itemLabel={activeView === 'tasks' ? 'tasks' : activeView === 'agents' ? 'agents' : 'events'}
        width={W}
        hasSuggestions={showSuggestions}
      />
    </Box>
  );
}

/* ── Helpers ──────────────────────────────────────────── */

/* ── Suggestions Panel ────────────────────────────────── */

function SuggestionsPanel({ suggestions, selectedIndex, height, width }: {
  suggestions: Suggestion[];
  selectedIndex: number;
  height: number;
  width: number;
}) {
  // Scroll suggestions if they exceed height
  const maxVisible = height;
  let scrollStart = 0;
  if (selectedIndex >= maxVisible) {
    scrollStart = selectedIndex - maxVisible + 1;
  }
  const visible = suggestions.slice(scrollStart, scrollStart + maxVisible);

  return (
    <Box flexDirection="column" paddingX={2}>
      {visible.map((sug, i) => {
        const realIndex = i + scrollStart;
        const isSelected = realIndex === selectedIndex;
        const marker = isSelected ? '\u25B6' : ' ';
        // Pad command to fixed width for alignment
        const cmdPad = Math.min(20, Math.max(14, ...suggestions.map((s) => s.cmd.length + 1)));
        const cmdText = sug.cmd.padEnd(cmdPad);
        const subsText = sug.subs ? `  ${sug.subs}` : '';
        const maxDescLen = Math.max(4, width - cmdPad - subsText.length - 8);
        const desc = sug.desc.length > maxDescLen ? sug.desc.slice(0, maxDescLen - 1) + '\u2026' : sug.desc;

        return (
          <Text key={realIndex} wrap="truncate">
            <Text color={isSelected ? tuiColors.amber : tuiColors.ghost}>{`  ${marker} `}</Text>
            <Text color={isSelected ? tuiColors.white : tuiColors.silver} bold={isSelected}>{cmdText}</Text>
            <Text color={tuiColors.dim}>{desc}</Text>
            {subsText && <Text color={tuiColors.ghost}>{subsText}</Text>}
          </Text>
        );
      })}
    </Box>
  );
}

/* ── Tasks Content ───────────────────────────────────── */

function TasksContent({ tasks, selectedIndex, scrollOffset = 0, height, width, showAddRow, agentNameMap, hiddenCount = 0 }: {
  tasks: Task[];
  selectedIndex: number;
  scrollOffset?: number;
  height: number;
  width: number;
  showAddRow?: boolean;
  agentNameMap?: Map<string, string>;
  hiddenCount?: number;
}) {
  const hasShowAll = hiddenCount > 0;
  // Virtual indices: tasks[0..n-1], show-all row (optional), add row (optional)
  const showAllIndex = hasShowAll ? tasks.length : -1;
  const addRowIndex = tasks.length + (hasShowAll ? 1 : 0);
  const totalItems = tasks.length + (hasShowAll ? 1 : 0) + (showAddRow ? 1 : 0);

  const visible = tasks.slice(scrollOffset, scrollOffset + height);
  // Show special rows if they fall within visible window
  const showAllVisible = hasShowAll && showAllIndex >= scrollOffset && showAllIndex < scrollOffset + height;
  const addRowVisible = showAddRow && addRowIndex >= scrollOffset && addRowIndex < scrollOffset + height;

  if (totalItems === 0 || (tasks.length === 0 && !showAddRow)) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text> </Text>
        <Text color={tuiColors.dim}>  No tasks yet. Press <Text color={tuiColors.gray} bold>Enter</Text> to create one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((task, i) => (
        <Box key={task.id} paddingX={2}>
          <TaskRow task={task} selected={i + scrollOffset === selectedIndex} width={width - 2} agentNameMap={agentNameMap} />
        </Box>
      ))}
      {showAllVisible && (
        <Box key="__show_all__" paddingX={2}>
          <Text color={selectedIndex === showAllIndex ? tuiColors.amber : tuiColors.ghost}>
            {selectedIndex === showAllIndex ? '  \u25B8 ' : '    '}
            <Text color={selectedIndex === showAllIndex ? tuiColors.amber : tuiColors.dim}>
              {'\u25BC'} Show all ({hiddenCount} more) — press <Text bold color={tuiColors.gray}>S</Text>
            </Text>
          </Text>
        </Box>
      )}
      {addRowVisible && (
        <Box key="__add__" paddingX={2}>
          <Text color={selectedIndex === addRowIndex ? tuiColors.amber : tuiColors.ghost}>
            {selectedIndex === addRowIndex ? '  \u25B8 ' : '    '}
            <Text color={selectedIndex === addRowIndex ? tuiColors.amber : tuiColors.dim}>+ add task...</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

/* ── Agents Content ──────────────────────────────────── */

function AgentsContent({ agents, selectedIndex, scrollOffset = 0, height, width, state, taskTitleMap, showAddRow }: {
  agents: Agent[];
  selectedIndex: number;
  scrollOffset?: number;
  height: number;
  width: number;
  state: OrchestratorState;
  taskTitleMap: Map<string, string>;
  showAddRow?: boolean;
}) {
  // Build running entry lookup by agent ID
  const runningByAgent = new Map<string, typeof state.running[string]>();
  for (const entry of Object.values(state.running)) {
    runningByAgent.set(entry.agent_id, entry);
  }

  const addRowIndex = agents.length;
  const visible = agents.slice(scrollOffset, scrollOffset + height);
  const addRowVisible = showAddRow && addRowIndex >= scrollOffset && addRowIndex < scrollOffset + height;

  if (agents.length === 0 && !showAddRow) {
    return (
      <Box flexDirection="column" paddingX={2}>
        <Text> </Text>
        <Text color={tuiColors.dim}>  No agents yet. Press <Text color={tuiColors.gray} bold>Enter</Text> to create one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {visible.map((agent, i) => (
        <Box key={agent.id} paddingX={2}>
          <AgentRow
            agent={agent}
            selected={i + scrollOffset === selectedIndex}
            width={width - 2}
            runningEntry={runningByAgent.get(agent.id)}
            currentTaskTitle={agent.current_task ? taskTitleMap.get(agent.current_task) : undefined}
          />
        </Box>
      ))}
      {addRowVisible && (
        <Box key="__add__" paddingX={2}>
          <Text color={selectedIndex === addRowIndex ? tuiColors.amber : tuiColors.ghost}>
            {selectedIndex === addRowIndex ? '  \u25B8 ' : '    '}
            <Text color={selectedIndex === addRowIndex ? tuiColors.amber : tuiColors.dim}>+ add agent...</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}

/* ── Log Helpers ──────────────────────────────────────── */

/** Format epoch ms as relative time string: "now", "3s", "1m", "5m", "1h", "3h" */
function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < 3_000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  return `${Math.floor(diff / 3_600_000)}h`;
}

/** Build a sparkline string from message timestamps (last N buckets) */
const SPARK_CHARS = ' ▁▂▃▄▅▆▇█';
function buildSparkline(messages: StatusMessage[], buckets: number, bucketMs: number, now: number): string {
  const counts = new Array(buckets).fill(0) as number[];
  const windowStart = now - buckets * bucketMs;
  for (const m of messages) {
    if (m.ts < windowStart) continue;
    const idx = Math.min(buckets - 1, Math.floor((m.ts - windowStart) / bucketMs));
    counts[idx]!++;
  }
  const max = Math.max(1, ...counts);
  return counts.map((c) => SPARK_CHARS[Math.round((c / max) * 8)]!).join('');
}

/** Get background color for message type (for highlighted rows) */
function getMsgBg(msgType: MsgType): string | undefined {
  switch (msgType) {
    case 'error': return tuiColors.errorBg;
    case 'tool': return tuiColors.toolBg;
    case 'lifecycle': return tuiColors.successBg;
    default: return undefined;
  }
}

/* ── Logs Content ────────────────────────────────────── */

function LogsContent({ messages, height, agents, logFilter, logTypeFilter, selectedIndex, scrollOffset, agentNameMap, taskTitleMap, width }: {
  messages: StatusMessage[];
  height: number;
  agents: Agent[];
  logFilter: number;
  logTypeFilter: Set<MsgType>;
  selectedIndex: number; // -1 = tail mode
  scrollOffset: number;
  agentNameMap: Map<string, string>;
  taskTitleMap: Map<string, string>;
  width: number;
}) {
  // Live clock for relative timestamps (ticks every 5s)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Filter messages by agent and type
  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (logFilter !== 0) {
        const agent = agents[logFilter - 1];
        if (agent && m.agentId !== agent.id) return false;
      }
      const mt = (m.msgType ?? 'info') as MsgType;
      return logTypeFilter.has(mt);
    });
  }, [messages, agents, logFilter, logTypeFilter]);

  // Count messages per type (for filter badges)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of messages) {
      const mt = m.msgType ?? 'info';
      counts[mt] = (counts[mt] ?? 0) + 1;
    }
    return counts;
  }, [messages]);

  // Count messages per agent (for filter badges)
  const agentMsgCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (m.agentId) counts.set(m.agentId, (counts.get(m.agentId) ?? 0) + 1);
    }
    return counts;
  }, [messages]);

  // Sparkline data: 30 buckets × 10s each = last 5 minutes
  const sparkline = useMemo(() => buildSparkline(filteredMessages, 30, 10_000, now), [filteredMessages, now]);

  const typeFilterLabel = logTypeFilter.size >= 8 ? 'all'
    : logTypeFilter.size === 1 && logTypeFilter.has('output') ? 'text'
    : logTypeFilter.size === 1 && logTypeFilter.has('error') ? 'errors'
    : logTypeFilter.has('tool') && !logTypeFilter.has('output') ? 'tools'
    : logTypeFilter.has('lifecycle') && !logTypeFilter.has('output') ? 'events'
    : `${logTypeFilter.size} types`;

  const viewH = height - 3; // -3 for filter bar + sparkline bar + gap
  const visible = selectedIndex === -1
    ? filteredMessages.slice(-viewH)
    : filteredMessages.slice(scrollOffset, scrollOffset + viewH);

  const highlightIdx = selectedIndex === -1 ? -1 : selectedIndex - scrollOffset;

  const agentColW = Math.min(10, Math.max(6, ...agents.map((a) => a.name.length)));

  // Detect session boundaries: gap > 30s between same-agent messages
  const isSessionStart = (i: number): boolean => {
    if (i === 0) return true;
    const curr = visible[i]!;
    const prev = visible[i - 1]!;
    if (curr.agentId !== prev.agentId) return true;
    if (!curr.agentId) return false;
    return (curr.ts - prev.ts) > 30_000;
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* ── Filter bar: agent chips + type filter + mode + count ── */}
      <Box gap={1}>
        {/* ALL chip */}
        {logFilter === 0 ? (
          <Text backgroundColor={tuiColors.infoBg} color={tuiColors.silver} bold>{' 0 ALL '}</Text>
        ) : (
          <Text color={tuiColors.ghost}>{' 0·all'}</Text>
        )}
        {/* Per-agent chips with message counts */}
        {agents.slice(0, 9).map((a, i) => {
          const ac = getAgentColor(a.id, agents);
          const active = logFilter === i + 1;
          const count = agentMsgCounts.get(a.id) ?? 0;
          if (active) {
            return (
              <Text key={a.id} backgroundColor={tuiColors.successBg} color={ac} bold>
                {' '}{i + 1} {a.name.toUpperCase()}{count > 0 ? ` ${count}` : ''}{' '}
              </Text>
            );
          }
          return (
            <Text key={a.id} color={tuiColors.ghost}>
              {i + 1}·{a.name}{count > 0 ? <Text color={tuiColors.dim}> {count}</Text> : ''}
            </Text>
          );
        })}
        <Text color={tuiColors.ghost}>│</Text>
        {/* Type filter chip with count */}
        {typeFilterLabel === 'all' ? (
          <Text color={tuiColors.dim}><Text bold color={tuiColors.gray}>F</Text> {typeFilterLabel} <Text color={tuiColors.ghost}>{filteredMessages.length}</Text></Text>
        ) : (
          <Text backgroundColor={tuiColors.warnBg} color={tuiColors.amber} bold>{' F '}{typeFilterLabel.toUpperCase()} {filteredMessages.length}{' '}</Text>
        )}
        <Text color={tuiColors.ghost}>│</Text>
        {/* Live/browse mode with animated indicator */}
        {selectedIndex === -1 ? (
          <Box>
            <Text backgroundColor={tuiColors.successBg} color={tuiColors.green}>{' '}</Text>
            <Text backgroundColor={tuiColors.successBg} color={tuiColors.green}><Spinner color={tuiColors.green} /></Text>
            <Text backgroundColor={tuiColors.successBg} color={tuiColors.green}>{' LIVE '}</Text>
          </Box>
        ) : (
          <Text backgroundColor={tuiColors.warnBg} color={tuiColors.amber}>
            {' ↑↓ '}{selectedIndex + 1}/{filteredMessages.length}{' '}
          </Text>
        )}
      </Box>

      {/* ── Sparkline activity bar ── */}
      <Box>
        <Text color={tuiColors.ghost}> activity </Text>
        <Text color={tuiColors.amberDim}>{sparkline}</Text>
        <Text color={tuiColors.ghost}> 5m</Text>
      </Box>

      {/* ── Messages ── */}
      {visible.length === 0 ? (
        <Box flexDirection="column" paddingX={2} paddingTop={1}>
          <Text color={tuiColors.dim}>
            {messages.length === 0
              ? '    ╭──────────────────────────╮'
              : 'No events for current filter.'}
          </Text>
          {messages.length === 0 && (
            <>
              <Text color={tuiColors.dim}>{'    │                          │'}</Text>
              <Text color={tuiColors.dim}>{'    │  '}<Text color={tuiColors.ghost}>◇</Text><Text color={tuiColors.gray}> Waiting for activity  </Text>{'│'}</Text>
              <Text color={tuiColors.dim}>{'    │  '}<Text color={tuiColors.ghost}>│</Text><Text color={tuiColors.dim}>  Run tasks or start   </Text>{'│'}</Text>
              <Text color={tuiColors.dim}>{'    │  '}<Text color={tuiColors.ghost}>│</Text><Text color={tuiColors.dim}>  the orchestrator     </Text>{'│'}</Text>
              <Text color={tuiColors.dim}>{'    │  '}<Text color={tuiColors.ghost}>◇</Text><Text color={tuiColors.dim}>                      </Text>{'│'}</Text>
              <Text color={tuiColors.dim}>{'    ╰──────────────────────────╯'}</Text>
            </>
          )}
        </Box>
      ) : (
        visible.map((msg, i) => {
          const isSelected = i === highlightIdx;
          const msgType = msg.msgType ?? 'info';
          const icon = MSG_ICONS[msgType] ?? '│';
          const agentName = msg.agentId ? (agentNameMap.get(msg.agentId) ?? msg.agentId.slice(0, 8)) : undefined;
          const agentColor = msg.agentId ? getAgentColor(msg.agentId, agents) : undefined;

          // Session and continuation detection
          const sessionStart = isSessionStart(i);
          const prevMsg = i > 0 ? visible[i - 1] : undefined;
          const isContinuation = prevMsg?.agentId === msg.agentId && !!msg.agentId;
          const showAgentBadge = !isContinuation && !!agentName;
          const showConnector = isContinuation && !!agentName;

          // Type-specific text colors
          let textColor = msg.color;
          if (msgType === 'output') textColor = tuiColors.white;
          else if (msgType === 'tool') textColor = tuiColors.cyan;
          else if (msgType === 'result') textColor = tuiColors.dim;
          else if (msgType === 'file') textColor = tuiColors.purple;
          else if (msgType === 'error') textColor = tuiColors.red;
          else if (msgType === 'lifecycle') textColor = tuiColors.green;
          else if (msgType === 'system') textColor = tuiColors.dim;

          // Background highlight for errors and selected items
          const rowBg = isSelected ? tuiColors.infoBg : (msgType === 'error' ? tuiColors.errorBg : undefined);

          // Task context
          const taskTitle = msg.taskId ? taskTitleMap.get(msg.taskId) : undefined;

          // Relative timestamp
          const relTs = relativeTime(msg.ts, now);

          return (
            <Box key={i} backgroundColor={rowBg}>
              {/* Left border — agent color accent for sessions */}
              <Text color={agentColor ?? tuiColors.ghost}>
                {sessionStart && showAgentBadge ? '┌' : showConnector ? '│' : ' '}
              </Text>

              {/* Selection indicator */}
              <Text color={isSelected ? tuiColors.amber : undefined}>
                {isSelected ? '▸' : ' '}
              </Text>

              {/* Relative timestamp */}
              <Box width={5}>
                <Text color={relTs === 'now' ? tuiColors.green : isSelected ? tuiColors.silver : tuiColors.ghost}>
                  {relTs.padStart(4)}
                </Text>
              </Box>

              {/* Agent badge or continuation line */}
              <Box width={agentColW + 1}>
                {showAgentBadge ? (
                  <Text color={agentColor} bold>
                    {' '}{agentName!.slice(0, agentColW).padEnd(agentColW)}
                  </Text>
                ) : showConnector ? (
                  <Text color={agentColor ?? tuiColors.ghost}>
                    {' '}{'·'.padEnd(agentColW)}
                  </Text>
                ) : (
                  <Text color={tuiColors.ghost}>
                    {' '}{' '.padEnd(agentColW)}
                  </Text>
                )}
              </Box>

              {/* Type icon */}
              <Text color={msgType === 'error' ? tuiColors.red : agentColor ?? tuiColors.dim}>
                {' '}{icon}{' '}
              </Text>

              {/* Message text */}
              <Text
                color={isSelected ? tuiColors.white : textColor}
                bold={isSelected || msgType === 'lifecycle'}
                wrap="truncate"
              >
                {msg.text}
              </Text>

              {/* Task context badge (if room) */}
              {taskTitle && width > 80 && (
                <Text color={tuiColors.ghost}>
                  {' '}
                  <Text color={tuiColors.dim} backgroundColor={tuiColors.void}>{` #${taskTitle.slice(0, 20)} `}</Text>
                </Text>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}

/* ── Activity Feed ────────────────────────────────────── */

function ActivityFeed({ messages, height, hasTasks, agents, agentNameMap }: {
  messages: StatusMessage[];
  height: number;
  hasTasks: boolean;
  agents: Agent[];
  agentNameMap: Map<string, string>;
}) {
  // Live clock for relative timestamps (ticks every 5s)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  const visible = messages.slice(-height);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map((msg, i) => {
        const agentName = msg.agentId ? (agentNameMap.get(msg.agentId) ?? msg.agentId.slice(0, 8)) : undefined;
        const agentColor = msg.agentId ? getAgentColor(msg.agentId, agents) : undefined;
        const msgType = msg.msgType ?? 'info';
        const icon = MSG_ICONS[msgType] ?? '│';

        // Type-specific text colors
        let textColor = msg.color;
        if (msgType === 'output') textColor = tuiColors.white;
        else if (msgType === 'tool') textColor = tuiColors.cyan;
        else if (msgType === 'result') textColor = tuiColors.dim;
        else if (msgType === 'file') textColor = tuiColors.purple;
        else if (msgType === 'error') textColor = tuiColors.red;
        else if (msgType === 'lifecycle') textColor = tuiColors.green;
        else if (msgType === 'system') textColor = tuiColors.dim;

        // Continuation: same agent as previous
        const prevMsg = i > 0 ? visible[i - 1] : undefined;
        const isContinuation = prevMsg?.agentId === msg.agentId && !!msg.agentId;

        // Background for errors
        const rowBg = msgType === 'error' ? tuiColors.errorBg : undefined;
        const relTs = relativeTime(msg.ts, now);

        return (
          <Box key={i} backgroundColor={rowBg}>
            {/* Left border accent */}
            <Text color={agentColor ?? tuiColors.ghost}>
              {!isContinuation && agentName ? '┌' : isContinuation ? '│' : ' '}
            </Text>
            {/* Relative timestamp */}
            <Box width={5}>
              <Text color={relTs === 'now' ? tuiColors.green : tuiColors.ghost}>
                {relTs.padStart(4)}
              </Text>
            </Box>
            <Box width={9}>
              {agentName && !isContinuation ? (
                <Text color={agentColor} bold>{' '}{agentName.slice(0, 8)}</Text>
              ) : agentName && isContinuation ? (
                <Text color={agentColor ?? tuiColors.ghost}>{' ·'}</Text>
              ) : (
                <Text color={tuiColors.ghost}>{' '}</Text>
              )}
            </Box>
            <Text color={msgType === 'error' ? tuiColors.red : agentColor ?? tuiColors.dim}>{icon} </Text>
            <Text color={textColor} bold={msgType === 'lifecycle'} wrap="truncate">{msg.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

/* ── Log Detail Panel ────────────────────────────────── */

function LogDetailPanel({ message, height, width, agents, agentNameMap, taskTitleMap }: {
  message: StatusMessage;
  height: number;
  width: number;
  agents: Agent[];
  agentNameMap: Map<string, string>;
  taskTitleMap: Map<string, string>;
}) {
  const content = message.detail ?? message.text;
  const msgType = message.msgType ?? 'info';
  const agentName = message.agentId ? (agentNameMap.get(message.agentId) ?? message.agentId.slice(0, 8)) : undefined;
  const agentColor = message.agentId ? getAgentColor(message.agentId, agents) : tuiColors.dim;
  const taskTitle = message.taskId ? taskTitleMap.get(message.taskId) : undefined;

  // Try to pretty-print JSON
  let display: string;
  let isJson = false;
  try {
    const parsed = JSON.parse(content);
    display = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch {
    display = content;
  }
  const maxW = Math.max(4, width - 6);
  const bodyHeight = Math.max(1, height - 4); // reserve space for header
  const lines = display.split('\n').slice(0, bodyHeight);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header with metadata badges */}
      <Box>
        <Text color={tuiColors.ghost}>╭{'─'.repeat(maxW + 2)}╮</Text>
      </Box>
      <Box>
        <Text color={tuiColors.ghost}>│ </Text>
        <Text color={tuiColors.dim}>{message.time}</Text>
        <Text color={tuiColors.ghost}> │ </Text>
        {agentName && <Text color={agentColor} bold>{agentName}</Text>}
        {agentName && <Text color={tuiColors.ghost}> │ </Text>}
        <Text color={MSG_ICONS[msgType] ? (msgType === 'error' ? tuiColors.red : tuiColors.dim) : tuiColors.dim}>
          {MSG_ICONS[msgType] ?? '│'} {msgType}
        </Text>
        {taskTitle && (
          <>
            <Text color={tuiColors.ghost}> │ </Text>
            <Text color={tuiColors.dim}>#{taskTitle.slice(0, 30)}</Text>
          </>
        )}
      </Box>
      <Box>
        <Text color={tuiColors.ghost}>│ </Text>
        <Text color={message.color} bold wrap="truncate">{message.text.slice(0, maxW)}</Text>
      </Box>
      <Box>
        <Text color={tuiColors.ghost}>├{'─'.repeat(maxW + 2)}┤</Text>
      </Box>

      {/* Body content with line numbers for JSON */}
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={tuiColors.ghost}>│ </Text>
          {isJson && (
            <Text color={tuiColors.ghost}>{String(i + 1).padStart(3)} </Text>
          )}
          <Text
            wrap="truncate"
            color={
              isJson && line.includes('"') ? tuiColors.cyan
                : isJson && /^\s*[}\]]/.test(line) ? tuiColors.ghost
                : line.startsWith('error') || line.startsWith('Error') ? tuiColors.red
                : tuiColors.silver
            }
          >
            {line.slice(0, isJson ? maxW - 4 : maxW)}
          </Text>
        </Box>
      ))}

      <Box>
        <Text color={tuiColors.ghost}>╰{'─'.repeat(maxW + 2)}╯</Text>
      </Box>
    </Box>
  );
}

/* ── Section Labels ───────────────────────────────────── */

function SectionLabel({ label, width }: { label: string; width: number }) {
  // Chip-style section label: ━━━━[ LABEL ]━━━━━━━━━━━━━━━━━━━━━━━
  const chipText = ` ${label} `;
  const leftRuleLen = 3;
  const rightRuleLen = Math.max(0, width - leftRuleLen - chipText.length - 2);
  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(leftRuleLen)}</Text>
      <Text backgroundColor="#1a1a22" color={tuiColors.dim} bold>{chipText}</Text>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(rightRuleLen)}</Text>
    </Box>
  );
}

function DetailSectionLabel({ task, width }: { task: Task; width: number }) {
  const chipText = ' DETAIL ';
  const maxTitleLen = width - chipText.length - 10;
  const titleTrunc = task.title.length > maxTitleLen
    ? task.title.slice(0, maxTitleLen - 3) + '...'
    : task.title;
  const rightRuleLen = Math.max(0, width - 3 - chipText.length - titleTrunc.length - 4);
  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(3)}</Text>
      <Text backgroundColor="#2d1f0a" color={tuiColors.amber} bold>{chipText}</Text>
      <Text color={tuiColors.ghost}>{HEAVY_RULE} </Text>
      <Text color={tuiColors.white} bold>{titleTrunc}</Text>
      <Text color={tuiColors.ghost}> {HEAVY_RULE.repeat(Math.max(0, rightRuleLen))}</Text>
    </Box>
  );
}

function AgentDetailSectionLabel({ agent, width }: { agent: Agent; width: number }) {
  const chipText = ' AGENT ';
  const maxNameLen = width - chipText.length - 10;
  const nameTrunc = agent.name.length > maxNameLen
    ? agent.name.slice(0, maxNameLen - 3) + '...'
    : agent.name;
  const rightRuleLen = Math.max(0, width - 3 - chipText.length - nameTrunc.length - 4);
  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(3)}</Text>
      <Text backgroundColor="#0f2d1f" color={tuiColors.green} bold>{chipText}</Text>
      <Text color={tuiColors.ghost}>{HEAVY_RULE} </Text>
      <Text color={tuiColors.green} bold>{nameTrunc}</Text>
      <Text color={tuiColors.ghost}> {HEAVY_RULE.repeat(Math.max(0, rightRuleLen))}</Text>
    </Box>
  );
}

/* ── Agent Detail Panel ──────────────────────────────── */

function AgentDetailPanel({ agent, height, state, taskTitleMap }: {
  agent: Agent;
  height: number;
  state: OrchestratorState;
  taskTitleMap: Map<string, string>;
}) {
  const statusColor = STATUS_DETAIL_COLOR[agent.status] ?? tuiColors.dim;
  const runningEntry = Object.values(state.running).find((e) => e.agent_id === agent.id);
  const taskTitle = agent.current_task ? taskTitleMap.get(agent.current_task) : undefined;

  const col1Width = 24;

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Row 1: status + adapter */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  status   </Text>
          <Text color={statusColor}>{agent.status}</Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  adapter   </Text>
          <Text color={tuiColors.cyan}>{agent.adapter}</Text>
        </Box>
      </Box>

      {/* Row 2: model + task */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  model     </Text>
          <Text>{agent.config.model ?? '\u2014'}</Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  task      </Text>
          <Text color={taskTitle ? tuiColors.white : tuiColors.dim}>
            {taskTitle ?? '\u2014'}
          </Text>
        </Box>
      </Box>

      {/* Row 3: stats */}
      <Box>
        <Box width={col1Width}>
          <Text color={tuiColors.dim}>  runs      </Text>
          <Text>{agent.stats.total_runs}</Text>
        </Box>
        <Box>
          <Text color={tuiColors.dim}>  done/fail </Text>
          <Text color={tuiColors.green}>{agent.stats.tasks_completed}</Text>
          <Text color={tuiColors.dim}>/</Text>
          <Text color={agent.stats.tasks_failed > 0 ? tuiColors.red : tuiColors.dim}>{agent.stats.tasks_failed}</Text>
        </Box>
      </Box>

      {/* Blank separator */}
      <Text> </Text>

      {/* Role description */}
      {agent.role ? (
        <Text color={tuiColors.silver} wrap="truncate">{'  '}{agent.role}</Text>
      ) : (
        <Text color={tuiColors.dim}>  No role description.</Text>
      )}

    </Box>
  );
}

const STATUS_DETAIL_COLOR: Record<string, string> = {
  idle: tuiColors.dim,
  running: tuiColors.green,
  error: tuiColors.red,
  disabled: tuiColors.ghost,
};

/* ── Input Panel ─────────────────────────────────────── */

const CURSOR_CHAR = '\u2588'; // █

function InputSectionLabel({ mode, width }: { mode: InputMode; width: number }) {
  const label = mode === 'command' ? 'COMMAND' : 'NEW TASK';
  const chipText = ` ${label} `;
  const rightRuleLen = Math.max(0, width - 3 - chipText.length - 2);
  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(3)}</Text>
      <Text backgroundColor="#2d1f0a" color={tuiColors.amber} bold>{chipText}</Text>
      <Text color={tuiColors.ghost}>{HEAVY_RULE.repeat(rightRuleLen)}</Text>
    </Box>
  );
}

function InputPanel({ mode, value, width }: { mode: InputMode; value: string; width: number }) {
  const prefix = mode === 'command' ? '/' : '\u25B8';
  const maxLen = Math.max(10, width - 8); // padding + cursor prefix
  const displayValue = value.length > maxLen ? value.slice(-maxLen) : value;

  return (
    <Box paddingX={2}>
      <Text color={tuiColors.amber}>{prefix} </Text>
      <Text color={tuiColors.white}>{displayValue}</Text>
      <Text color={tuiColors.amber}>{CURSOR_CHAR}</Text>
    </Box>
  );
}

/* ── Stats Ribbons ───────────────────────────────────── */

function TaskStatsRibbon({ tasks, totalTokens, width }: {
  tasks: Task[];
  totalTokens: number;
  width: number;
}) {
  const groups: Array<{ statuses: TaskStatus[]; label: string; color: string; bold?: boolean }> = [
    { statuses: ['in_progress'], label: 'running', color: tuiColors.green, bold: true },
    { statuses: ['retrying'], label: 'retrying', color: tuiColors.yellow },
    { statuses: ['review'], label: 'review', color: tuiColors.blue },
    { statuses: ['todo'], label: 'todo', color: tuiColors.dim },
    { statuses: ['done'], label: 'done', color: tuiColors.green },
    { statuses: ['failed'], label: 'failed', color: tuiColors.red },
  ];

  const counts = groups
    .map((g) => ({ ...g, count: tasks.filter((t) => g.statuses.includes(t.status)).length }))
    .filter((g) => g.count > 0);

  return <StatsRibbonBase counts={counts} emptyText="no tasks" tokenCount={totalTokens} width={width} />;
}

function AgentStatsRibbon({ agents, totalTokens, width }: {
  agents: Agent[];
  totalTokens: number;
  width: number;
}) {
  const groups: Array<{ statuses: AgentStatus[]; label: string; color: string; bold?: boolean }> = [
    { statuses: ['running'], label: 'running', color: tuiColors.green, bold: true },
    { statuses: ['idle'], label: 'idle', color: tuiColors.dim },
    { statuses: ['error'], label: 'error', color: tuiColors.red },
    { statuses: ['disabled'], label: 'disabled', color: tuiColors.ghost },
  ];

  const counts = groups
    .map((g) => ({ ...g, count: agents.filter((a) => (g.statuses as string[]).includes(a.status)).length }))
    .filter((g) => g.count > 0);

  return <StatsRibbonBase counts={counts} emptyText="no agents" tokenCount={totalTokens} width={width} />;
}

function LogsStatsRibbon({ eventCount, totalTokens, width }: {
  eventCount: number;
  totalTokens: number;
  width: number;
}) {
  const counts = eventCount > 0
    ? [{ label: 'events', color: tuiColors.dim, count: eventCount }]
    : [];

  return <StatsRibbonBase counts={counts} emptyText="no events" tokenCount={totalTokens} width={width} />;
}

/* ── Event Formatter (US-9.8) ─────────────────────────── */

/** Format tool input into a concise hint (e.g. Read → file basename, Bash → command) */
function formatToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inp = input as Record<string, unknown>;

  // File-based tools: show basename
  if (inp.file_path && typeof inp.file_path === 'string') {
    const parts = inp.file_path.split('/');
    return parts.slice(-2).join('/');
  }
  // Bash: show command snippet
  if (inp.command && typeof inp.command === 'string') {
    return (inp.command as string).slice(0, 60);
  }
  // Grep/search: show pattern
  if (inp.pattern && typeof inp.pattern === 'string') {
    return `"${(inp.pattern as string).slice(0, 40)}"`;
  }
  // Glob: show pattern
  if (inp.glob && typeof inp.glob === 'string') {
    return (inp.glob as string).slice(0, 40);
  }
  // Generic: compact JSON
  const s = JSON.stringify(inp);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

/** Extract readable text from content array (Claude API format) */
function extractTextFromContent(content: unknown, maxLen = 200): string | null {
  if (typeof content === 'string') return content.slice(0, maxLen);
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  let totalLen = 0;
  for (const block of content) {
    if (totalLen >= maxLen) break;
    if (block?.type === 'text' && typeof block.text === 'string') {
      // Only take the first meaningful line, skip file dumps
      const firstLine = block.text.split('\n').find((l: string) => l.trim().length > 0) ?? '';
      parts.push(firstLine.slice(0, maxLen - totalLen));
      totalLen += firstLine.length;
    } else if (block?.type === 'tool_use') {
      const hint = formatToolInput(block.name ?? 'tool', block.input);
      const s = `\u2699 ${block.name ?? 'tool'}(${hint})`;
      parts.push(s);
      totalLen += s.length;
    } else if (block?.type === 'tool_result') {
      // Don't inline tool result content — just mark it
      parts.push(`\u2190 (result)`);
      totalLen += 10;
    } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
      const s = block.thinking.slice(0, 60).split('\n')[0] ?? '';
      parts.push(`\u{1F4AD} ${s}`);
      totalLen += s.length + 3;
    }
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Extract a short description of tool_result content (for user messages) */
function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') {
    const lines = content.split('\n').length;
    const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? '';
    if (lines > 3) return `${firstLine.slice(0, 80)}... (${lines} lines)`;
    return firstLine.slice(0, 120);
  }
  if (!Array.isArray(content)) return '(result)';
  // Content array with tool_result blocks
  const summaries: string[] = [];
  for (const block of content) {
    if (block?.type === 'tool_result') {
      const toolId = block.tool_use_id ? block.tool_use_id.slice(0, 8) : '';
      const isError = block.is_error;
      const inner = typeof block.content === 'string' ? block.content : '';
      const lines = inner.split('\n').length;
      if (isError) {
        summaries.push(`\u2715 error: ${inner.slice(0, 60)}`);
      } else if (lines > 3) {
        summaries.push(`\u2713 ${lines} lines`);
      } else {
        summaries.push(`\u2713 ${inner.slice(0, 80)}`);
      }
    } else if (block?.type === 'text' && typeof block.text === 'string') {
      summaries.push(block.text.split('\n')[0]?.slice(0, 80) ?? '');
    }
  }
  return summaries.join(' ') || '(result)';
}

/** Extract human-readable text from agent output data (which may be raw JSON from Claude CLI) */
function formatAgentOutput(raw: string): { summary: string; detail: string } {
  const detail = raw;

  // Skip bracket-tags like [init], [hook_started], [hook_response]
  if (/^\[[\w_]+\]$/.test(raw.trim())) {
    return { summary: raw.trim(), detail };
  }

  try {
    const parsed = JSON.parse(raw);

    // Claude API message: {"type":"message","role":"assistant","content":[...]}
    if (parsed.type === 'message' && parsed.role === 'assistant') {
      const text = extractTextFromContent(parsed.content);
      if (text) return { summary: text.slice(0, 200), detail };
      return { summary: '\u{1F4AC} (assistant message)', detail };
    }

    // Claude stream: {"type":"assistant","message":{"content":[...]}}
    if (parsed.type === 'assistant' || parsed.role === 'assistant') {
      const content = parsed.message?.content ?? parsed.content;
      const text = extractTextFromContent(content);
      if (text) return { summary: text.slice(0, 200), detail };
      return { summary: '\u{1F4AC} (assistant)', detail };
    }

    // User message (tool results flowing back)
    if (parsed.type === 'user' || parsed.role === 'user') {
      const content = parsed.message?.content ?? parsed.content;
      const summary = summarizeToolResult(content);
      return { summary: `\u2190 ${summary.slice(0, 180)}`, detail };
    }

    // Tool use block
    if (parsed.type === 'tool_use') {
      const name = parsed.name ?? 'tool';
      const hint = formatToolInput(name, parsed.input);
      return { summary: `\u2699 ${name}(${hint})`, detail };
    }

    // Tool result block
    if (parsed.type === 'tool_result') {
      const summary = summarizeToolResult(parsed.content);
      return { summary: `\u2190 ${summary.slice(0, 180)}`, detail };
    }

    // Result / done
    if (parsed.type === 'result') {
      const text = typeof parsed.result === 'string' ? parsed.result : null;
      return { summary: text ? `\u2713 ${text.slice(0, 180)}` : '\u2713 Agent finished', detail };
    }

    // Rate limit event
    if (parsed.type === 'rate_limit_event') {
      return { summary: `\u23F3 Rate limited (${parsed.rate_limit_info?.rateLimitType ?? 'unknown'})`, detail };
    }

    // System event with subtype (task_progress, task_notification, etc.)
    if (parsed.subtype) {
      // For task_progress/task_notification with nested message content
      if (parsed.message) {
        const content = parsed.message.content ?? parsed.message;
        const text = extractTextFromContent(content);
        if (text) return { summary: text.slice(0, 200), detail };
      }
      return { summary: `[${parsed.subtype}]`, detail };
    }

    // Generic: try content field
    if (parsed.content) {
      const text = extractTextFromContent(parsed.content);
      if (text) return { summary: text.slice(0, 200), detail };
    }

    // Fallback: show type or truncate
    if (parsed.type) return { summary: `[${parsed.type}]`, detail };
    return { summary: raw.slice(0, 150), detail };
  } catch {
    // Plain text (non-JSON)
    return { summary: raw.slice(0, 200), detail };
  }
}

function formatEvent(
  event: OrchestratorEvent,
  addMsg: (text: string, color: string, opts?: { agentId?: string; taskId?: string; detail?: string; msgType?: MsgType }) => void,
  runIdToAgentId?: Map<string, string>,
  runIdToTaskId?: Map<string, string>,
): void {
  const resolveTask = (runId: string) => runIdToTaskId?.get(runId);

  switch (event.type) {
    case 'agent:started':
      addMsg(`Started task`, tuiColors.green,
        { agentId: event.agentId, taskId: event.taskId, msgType: 'lifecycle' });
      break;
    case 'agent:output': {
      const { summary, detail } = formatAgentOutput(event.data);
      let msgType: MsgType = 'output';
      if (summary.startsWith('\u2699')) msgType = 'tool';
      else if (summary.startsWith('\u2190')) msgType = 'result';
      else if (summary.startsWith('\u2713')) msgType = 'lifecycle';
      else if (summary.startsWith('\u23F3')) msgType = 'info';
      addMsg(summary, tuiColors.silver,
        { agentId: event.agentId, taskId: resolveTask(event.runId), detail, msgType });
      break;
    }
    case 'agent:file_changed':
      addMsg(`${event.path}`, tuiColors.purple,
        { agentId: event.agentId, taskId: resolveTask(event.runId), msgType: 'file' });
      break;
    case 'agent:completed':
      addMsg(
        event.success ? 'Completed successfully' : 'Failed',
        event.success ? tuiColors.green : tuiColors.red,
        { agentId: event.agentId, taskId: resolveTask(event.runId), msgType: 'lifecycle' },
      );
      break;
    case 'agent:error':
      addMsg(`${event.error.slice(0, 150)}`, tuiColors.red,
        { agentId: event.agentId, taskId: resolveTask(event.runId), detail: event.error, msgType: 'error' });
      break;
    case 'task:status_changed':
      addMsg(`${event.from} \u2192 ${event.to}`, tuiColors.cyan,
        { taskId: event.taskId, msgType: 'system' });
      break;
    case 'task:assigned':
      addMsg(`Assigned \u2192 ${event.agentId}`, tuiColors.cyan,
        { taskId: event.taskId, msgType: 'system' });
      break;
    case 'task:created':
      addMsg(`Created: ${event.task.title}`, tuiColors.amber,
        { taskId: event.task.id, msgType: 'system' });
      break;
    case 'run:retry':
      addMsg(`Retry #${event.attempt} (${Math.round(event.delay_ms / 1000)}s delay)`, tuiColors.yellow,
        { agentId: runIdToAgentId?.get(event.runId), taskId: resolveTask(event.runId), msgType: 'lifecycle' });
      break;
    case 'orchestrator:tick':
      if (event.running > 0 || event.queued > 0) {
        addMsg(`${event.running} running \u00B7 ${event.queued} queued`, tuiColors.ghost, { msgType: 'system' });
      }
      break;
    case 'orchestrator:stall_detected':
      addMsg(`Stall detected`, tuiColors.yellow,
        { agentId: runIdToAgentId?.get(event.runId), taskId: resolveTask(event.runId), msgType: 'error' });
      break;
  }
}

/* ── Stats Ribbons ───────────────────────────────────── */

function StatsRibbonBase({ counts, emptyText, tokenCount, width }: {
  counts: Array<{ label: string; color: string; count: number; bold?: boolean }>;
  emptyText: string;
  tokenCount: number;
  width: number;
}) {
  const tokenText = tokenCount > 0 ? `${formatTokens(tokenCount)} tk` : '';
  const statsContentLen = counts.reduce((a, c) => a + `${c.count} ${c.label}`.length + 2, 0);
  const fillLen = Math.max(1, width - 6 - statsContentLen - tokenText.length - 4);

  return (
    <Box paddingX={1}>
      <Text color={tuiColors.ghost}>{LIGHT_RULE}{LIGHT_RULE} </Text>
      {counts.map((c, i) => (
        <React.Fragment key={c.label}>
          {i > 0 && <Text>  </Text>}
          <Text color={c.color} bold={c.bold}>{c.count}</Text>
          <Text color={tuiColors.dim}> {c.label}</Text>
        </React.Fragment>
      ))}
      {counts.length === 0 && <Text color={tuiColors.dim}>{emptyText}</Text>}
      <Text color={tuiColors.ghost}> {LIGHT_RULE.repeat(Math.max(0, fillLen))} </Text>
      {tokenCount > 0 && <Text color={tuiColors.cyan}>{tokenText}</Text>}
      <Text color={tuiColors.ghost}> {LIGHT_RULE}{LIGHT_RULE}</Text>
    </Box>
  );
}
