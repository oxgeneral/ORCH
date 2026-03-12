/**
 * Wizard step configurations for TUI forms.
 *
 * Defines multi-step wizards for agent creation, task creation, etc.
 * Steps can be dynamic (options depend on previous answers).
 */

import type { WizardStep } from './components/FormWizard.js';
import type { Agent } from '../domain/agent.js';
import type { ActivityFilterPreset } from '../domain/global-config.js';
import type { Team } from '../domain/team.js';
import type { CreateTeamInput } from '../domain/team.js';

// ── Model catalogs per adapter ──

const CLAUDE_MODELS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', hint: 'most capable' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'fast, balanced' },
  { value: 'claude-haiku-4-6', label: 'Claude Haiku 4.6', hint: 'fastest, cheapest' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', hint: 'extended thinking' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'legacy' },
];

const CODEX_MODELS = [
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'default, balanced' },
  { value: 'gpt-5.4', label: 'GPT-5.4', hint: 'latest' },
  { value: 'gpt-5', label: 'GPT-5', hint: 'capable' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', hint: 'fast' },
  { value: 'o3', label: 'o3', hint: 'reasoning' },
  { value: 'o4-mini', label: 'o4-mini', hint: 'fast reasoning' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini', hint: 'light' },
  { value: 'gpt-5-nano', label: 'GPT-5 Nano', hint: 'cheapest' },
  { value: 'codex-mini-latest', label: 'Codex Mini', hint: 'legacy' },
];

const CURSOR_MODELS = [
  { value: 'auto', label: 'Auto', hint: 'let Cursor decide' },
  { value: 'composer-1.5', label: 'Composer 1.5', hint: 'latest agent' },
  { value: 'composer-1', label: 'Composer 1', hint: 'stable agent' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', hint: 'OpenAI' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'Anthropic' },
];

const SHELL_MODELS = [
  { value: '', label: 'Default', hint: 'use shell adapter default' },
];

// ── Adapter catalog ──

const ADAPTERS = [
  { value: 'claude', label: 'Claude', hint: 'Claude Code CLI' },
  { value: 'codex', label: 'Codex', hint: 'OpenAI Codex CLI' },
  { value: 'cursor', label: 'Cursor', hint: 'Cursor Agent CLI' },
  { value: 'shell', label: 'Shell', hint: 'custom shell command' },
];

// ── Priority options ──

const PRIORITY_OPTIONS = [
  { value: '1', label: 'P1 Critical', hint: 'urgent, do first' },
  { value: '2', label: 'P2 High', hint: 'important' },
  { value: '3', label: 'P3 Medium', hint: 'default priority' },
  { value: '4', label: 'P4 Low', hint: 'nice to have' },
];

// ── Agent options builder ──

const AGENT_HINT_MAX_LEN = 80;

/** Map agents to select options (no sentinel). Shared by buildAgentOptions and team wizard. */
function mapAgentOptions(agents: Agent[]) {
  return agents
    .filter((a) => a.status !== 'disabled')
    .map((a) => {
      const raw = a.role ?? a.adapter;
      const hint = raw.length > AGENT_HINT_MAX_LEN ? raw.slice(0, AGENT_HINT_MAX_LEN - 1) + '\u2026' : raw;
      return { value: a.id, label: a.name, hint };
    });
}

function buildAgentOptions(agents: Agent[], emptyLabel = 'Auto-assign', emptyHint = 'orchestrator picks the best agent') {
  return [
    { value: '', label: emptyLabel, hint: emptyHint },
    ...mapAgentOptions(agents),
  ];
}

// ── Role presets ──

const ROLE_PRESETS = [
  { value: '', label: 'Skip', hint: 'no role description' },
  { value: 'Full-stack developer', label: 'Full-stack developer', hint: 'general purpose' },
  { value: 'Frontend developer', label: 'Frontend developer', hint: 'React, CSS, UI' },
  { value: 'Backend developer', label: 'Backend developer', hint: 'APIs, databases, services' },
  { value: 'DevOps engineer', label: 'DevOps engineer', hint: 'CI/CD, infra, deploys' },
  { value: 'QA / Test engineer', label: 'QA / Test engineer', hint: 'testing, quality' },
  { value: 'Code reviewer', label: 'Code reviewer', hint: 'review PRs, find bugs' },
  { value: 'Technical writer', label: 'Technical writer', hint: 'docs, READMEs' },
  { value: '__custom__', label: 'Custom...', hint: 'type your own' },
];

// ── Agent creation wizard ──

export function getAgentWizardSteps(teams?: Team[]): WizardStep[] {
  const teamOptions = [
    { value: '', label: 'None', hint: 'no team' },
    ...(teams ?? [])
      .filter((t) => t.status === 'active')
      .map((t) => ({ value: t.id, label: t.name, hint: `${t.members.length} members` })),
  ];

  return [
    {
      id: 'name',
      label: 'Agent name',
      type: 'text',
      placeholder: 'e.g. alpha, frontend-bot, reviewer',
      required: true,
    },
    {
      id: 'adapter',
      label: 'Provider',
      type: 'select',
      options: ADAPTERS,
    },
    {
      id: 'model',
      label: 'Model',
      type: 'select',
      getOptions: (vals) => {
        if (vals.adapter === 'codex') return CODEX_MODELS;
        if (vals.adapter === 'cursor') return CURSOR_MODELS;
        if (vals.adapter === 'shell') return SHELL_MODELS;
        return CLAUDE_MODELS;
      },
    },
    {
      id: 'role',
      label: 'Role / specialization',
      type: 'select',
      options: ROLE_PRESETS,
    },
    {
      id: 'role_custom',
      label: 'Describe the role',
      type: 'textarea',
      placeholder: 'e.g. Specialist in React and TypeScript',
      skip: (vals) => vals.role !== '__custom__',
    },
    {
      id: 'team',
      label: 'Join team',
      type: 'select',
      options: teamOptions,
      skip: () => teamOptions.length <= 1, // Skip if no teams exist
    },
  ];
}

/** Convert wizard values → CreateAgentInput-compatible object */
export function agentWizardToInput(vals: Record<string, string>) {
  const role = vals.role === '__custom__' ? (vals.role_custom || undefined) : (vals.role || undefined);
  return {
    name: vals.name!,
    adapter: vals.adapter || 'claude',
    role,
    model: vals.model || undefined,
    approval_policy: 'auto' as const,
    team_id: vals.team || undefined,
  };
}

// ── Team creation wizard ──

export function getTeamWizardSteps(agents: Agent[]): WizardStep[] {
  const agentOptions = mapAgentOptions(agents);

  return [
    {
      id: 'name',
      label: 'Team name',
      type: 'text',
      placeholder: 'e.g. frontend, backend, qa',
      required: true,
    },
    {
      id: 'lead',
      label: 'Team lead',
      type: 'select',
      options: agentOptions,
    },
    {
      id: 'members',
      label: 'Team members',
      type: 'multiselect',
      getOptions: (vals) =>
        agentOptions.filter((a) => a.value !== vals.lead),
      skip: (vals) => !agentOptions.some((a) => a.value !== vals.lead),
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Optional team purpose...',
    },
  ];
}

/** Convert wizard values → CreateTeamInput */
export function teamWizardToInput(vals: Record<string, string>): CreateTeamInput {
  const memberIds = vals.members ? vals.members.split(',').filter(Boolean) : [];
  return {
    name: vals.name!,
    lead_agent_id: vals.lead!,
    member_agent_ids: memberIds.length > 0 ? memberIds : undefined,
    description: vals.description || undefined,
  };
}

// ── Task creation wizard ──

export function getTaskWizardSteps(agents: Agent[]): WizardStep[] {
  const agentOptions = buildAgentOptions(agents);

  return [
    {
      id: 'title',
      label: 'Task title',
      type: 'text',
      placeholder: 'What needs to be done?',
      required: true,
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      options: PRIORITY_OPTIONS,
      defaultValue: '3',
    },
    {
      id: 'assignee',
      label: 'Assignee',
      type: 'select',
      options: agentOptions,
      skip: () => agentOptions.length <= 1, // Skip if no agents to choose from
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Optional details, context, acceptance criteria...',
    },
  ];
}

/** Convert wizard values → CreateTaskInput-compatible object */
export function taskWizardToInput(vals: Record<string, string>) {
  return {
    title: vals.title!,
    priority: vals.priority ? parseInt(vals.priority, 10) : undefined,
    assignee: vals.assignee || undefined,
    description: vals.description || undefined,
  };
}

// ── Edit wizards (pre-filled with current values) ──

import type { Task } from '../domain/task.js';

export function getEditTaskWizardSteps(task: Task, agents: Agent[]): WizardStep[] {
  const agentOptions = buildAgentOptions(agents, 'None / Auto', 'remove assignee');

  return [
    {
      id: 'title',
      label: 'Task title',
      type: 'text',
      defaultValue: task.title,
      required: true,
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      options: PRIORITY_OPTIONS,
      defaultValue: String(task.priority),
    },
    {
      id: 'assignee',
      label: 'Assignee',
      type: 'select',
      options: agentOptions,
      defaultValue: task.assignee ?? '',
      skip: () => agentOptions.length <= 1,
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      defaultValue: task.description || '',
      placeholder: 'Optional details...',
    },
  ];
}

export function editTaskWizardToFields(vals: Record<string, string>) {
  return {
    title: vals.title,
    priority: vals.priority ? parseInt(vals.priority, 10) : undefined,
    assignee: vals.assignee || undefined,
    description: vals.description ?? '',
  };
}

export function getEditAgentWizardSteps(agent: Agent): WizardStep[] {
  // Find current role in presets or mark as custom
  const currentRoleInPresets = ROLE_PRESETS.find((r) => r.value === agent.role);
  const roleDefault = currentRoleInPresets ? agent.role! : (agent.role ? '__custom__' : '');

  const modelOptions =
    agent.adapter === 'codex' ? CODEX_MODELS :
    agent.adapter === 'cursor' ? CURSOR_MODELS :
    agent.adapter === 'shell' ? SHELL_MODELS :
    CLAUDE_MODELS;

  return [
    {
      id: 'name',
      label: 'Agent name',
      type: 'text',
      defaultValue: agent.name,
      required: true,
    },
    {
      id: 'model',
      label: 'Model',
      type: 'select',
      options: modelOptions,
      defaultValue: agent.config.model ?? '',
    },
    {
      id: 'role',
      label: 'Role / specialization',
      type: 'select',
      options: ROLE_PRESETS,
      defaultValue: roleDefault,
    },
    {
      id: 'role_custom',
      label: 'Describe the role',
      type: 'textarea',
      defaultValue: agent.role && !currentRoleInPresets ? agent.role : '',
      placeholder: 'e.g. Specialist in React and TypeScript',
      skip: (vals) => vals.role !== '__custom__',
    },
  ];
}

// ── Config wizard ──

const ACTIVITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All', hint: 'show everything' },
  { value: 'text', label: 'Text', hint: 'agent output only' },
  { value: 'tools', label: 'Tools', hint: 'tool calls, results, files' },
  { value: 'errors', label: 'Errors', hint: 'errors only' },
  { value: 'events', label: 'Events', hint: 'lifecycle, system events' },
];

export function getConfigWizardSteps(currentFilter: ActivityFilterPreset): WizardStep[] {
  return [
    {
      id: 'setting',
      label: 'Setting',
      type: 'select',
      options: [
        { value: 'activity_filter', label: 'Activity filter', hint: `current: ${currentFilter}` },
      ],
    },
    {
      id: 'activity_filter',
      label: 'Activity filter preset',
      type: 'select',
      options: ACTIVITY_FILTER_OPTIONS,
      defaultValue: currentFilter,
      skip: (vals) => vals.setting !== 'activity_filter',
    },
  ];
}

export function editAgentWizardToFields(vals: Record<string, string>) {
  const role = vals.role === '__custom__' ? (vals.role_custom || undefined) : (vals.role || undefined);
  return {
    name: vals.name,
    role,
    model: vals.model || undefined,
  };
}
