/**
 * Wizard step configurations for TUI forms.
 *
 * Defines multi-step wizards for agent creation, task creation, etc.
 * Steps can be dynamic (options depend on previous answers).
 */

import type { WizardStep } from './components/FormWizard.js';
import type { Agent } from '../domain/agent.js';
import type { Goal } from '../domain/goal.js';
import type { ActivityFilterPreset, NotificationPreferences } from '../domain/global-config.js';
import type { Team } from '../domain/team.js';
import type { CreateTeamInput } from '../domain/team.js';
import { AGENT_SHOP_TEMPLATES, getShopTemplateByKey } from '../domain/agent-shop.js';
import type { AgentShopTemplate } from '../domain/agent-shop.js';

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

const OPENCODE_MODELS = [
  { value: '', label: 'Default', hint: 'use model configured in opencode' },
  { value: 'openrouter/anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', hint: 'fast, balanced' },
  { value: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', hint: 'most capable' },
  { value: 'openrouter/google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Google' },
  { value: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Google, fast' },
  { value: 'openrouter/deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', hint: 'open-source' },
  { value: 'openrouter/deepseek/deepseek-r1:free', label: 'DeepSeek R1', hint: 'reasoning, free' },
  { value: 'opencode/big-pickle', label: 'Big Pickle', hint: 'opencode native' },
];

const SHELL_MODELS = [
  { value: '', label: 'Default', hint: 'use shell adapter default' },
];

// ── Adapter catalog ──

const ADAPTERS = [
  { value: 'claude', label: 'Claude', hint: 'Claude Code CLI' },
  { value: 'opencode', label: 'OpenCode', hint: 'OpenCode — multi-provider' },
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
      const raw = (a.role ?? a.adapter).split('\n')[0]!.trim();
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

function buildTeamOptions(teams?: Team[]) {
  return [
    { value: '', label: 'None', hint: 'no team' },
    ...(teams ?? [])
      .filter((t) => t.status === 'active')
      .map((t) => ({ value: t.id, label: t.name, hint: `${t.members.length} members` })),
  ];
}

// ── Agent Shop ──

/** Single-step wizard for browsing the Agent Shop catalog. */
export function getShopWizardSteps(): WizardStep[] {
  return [
    {
      id: 'shop_template',
      label: 'Agent Shop — choose a template',
      type: 'select',
      options: AGENT_SHOP_TEMPLATES.map((t) => ({
        value: t.key,
        label: t.name,
        hint: t.description,
      })),
    },
  ];
}

/** Clone base wizard steps with defaultValues injected from a shop template. */
export function applyShopTemplate(
  baseSteps: WizardStep[],
  template: AgentShopTemplate,
): WizardStep[] {
  return baseSteps.map((step): WizardStep => {
    switch (step.id) {
      case 'name':
        return { ...step, defaultValue: template.name };
      case 'adapter':
        return { ...step, defaultValue: template.adapter };
      case 'model':
        return { ...step, defaultValue: template.model };
      case 'role':
        return { ...step, defaultValue: '__custom__' };
      case 'role_custom':
        return { ...step, defaultValue: template.role, skip: undefined };
      case 'skills':
        return { ...step, defaultValue: template.skills.join(', ') };
      case 'approval_policy':
        return { ...step, defaultValue: template.approval_policy };
      default:
        return step;
    }
  });
}

// ── Agent creation wizard ──

export function getAgentWizardSteps(agents?: Agent[], teams?: Team[]): WizardStep[] {
  const teamOptions = buildTeamOptions(teams);

  return [
    {
      id: 'name',
      label: 'Agent name',
      type: 'text',
      placeholder: 'e.g. alpha, frontend-bot, reviewer',
      required: true,
      validate: (v) => {
        if (!v.trim()) return 'Name is required';
        if (agents?.some((a) => a.name === v.trim())) return 'Agent with this name already exists';
        return null;
      },
      suggestions: AGENT_SHOP_TEMPLATES.map((t) => ({
        value: t.key,
        label: t.name,
        hint: t.description,
      })),
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
        if (vals.adapter === 'opencode') return OPENCODE_MODELS;
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
      id: 'skills',
      label: 'Skills (comma-separated)',
      type: 'text',
      placeholder: 'e.g. feature-dev:feature-dev, testing-suite:generate-tests',
    },
    {
      id: 'approval_policy',
      label: 'Approval policy',
      type: 'text',
      skip: () => true, // hidden — only populated by shop templates
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
  const skills = vals.skills ? vals.skills.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const approval_policy = (vals.approval_policy as 'auto' | 'suggest' | 'manual' | undefined) || 'auto';
  return {
    name: vals.name!,
    adapter: vals.adapter || 'claude',
    role,
    model: vals.model || undefined,
    approval_policy,
    skills,
    team_id: vals.team || undefined,
  };
}

// ── Team creation wizard ──

export function getTeamWizardSteps(agents: Agent[], teams?: Team[]): WizardStep[] {
  const agentOptions = mapAgentOptions(agents);

  return [
    {
      id: 'name',
      label: 'Team name',
      type: 'text',
      placeholder: 'e.g. frontend, backend, qa',
      required: true,
      validate: (v) => {
        if (!v.trim()) return 'Name is required';
        if (teams?.some((t) => t.name === v.trim())) return 'Team with this name already exists';
        return null;
      },
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
      validate: (v) => !v.trim() ? 'Title is required' : null,
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      options: PRIORITY_OPTIONS,
      defaultValue: '3',
      validate: (v) => {
        const n = Number(v);
        return !Number.isInteger(n) || n < 1 || n > 4 ? 'Priority must be 1-4' : null;
      },
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
      validate: (v) => !v.trim() ? 'Title is required' : null,
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'select',
      options: PRIORITY_OPTIONS,
      defaultValue: String(task.priority),
      validate: (v) => {
        const n = Number(v);
        return !Number.isInteger(n) || n < 1 || n > 4 ? 'Priority must be 1-4' : null;
      },
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

export function getEditAgentWizardSteps(agent: Agent, agents?: Agent[], teams?: Team[]): WizardStep[] {
  // Find current role in presets or mark as custom
  const currentRoleInPresets = ROLE_PRESETS.find((r) => r.value === agent.role);
  const roleDefault = currentRoleInPresets ? agent.role! : (agent.role ? '__custom__' : '');

  const modelOptions =
    agent.adapter === 'opencode' ? OPENCODE_MODELS :
    agent.adapter === 'codex' ? CODEX_MODELS :
    agent.adapter === 'cursor' ? CURSOR_MODELS :
    agent.adapter === 'shell' ? SHELL_MODELS :
    CLAUDE_MODELS;

  const teamOptions = buildTeamOptions(teams);
  const currentTeamId = teams?.find(t => t.members.some(m => m.agent_id === agent.id))?.id;

  return [
    {
      id: 'name',
      label: 'Agent name',
      type: 'text',
      defaultValue: agent.name,
      required: true,
      validate: (v) => {
        if (!v.trim()) return 'Name is required';
        if (agents?.some((a) => a.id !== agent.id && a.name === v.trim())) return 'Agent with this name already exists';
        return null;
      },
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
    {
      id: 'team',
      label: 'Team',
      type: 'select',
      options: teamOptions,
      defaultValue: currentTeamId ?? '',
      skip: () => teamOptions.length <= 1,
    },
  ];
}

// ── Concurrency options ──

const MAX_CONCURRENT_OPTIONS = [
  { value: '1', label: '1 agent', hint: '~0.5 GB RAM, 1 subprocess' },
  { value: '2', label: '2 agents', hint: '~1 GB RAM, 2 subprocesses' },
  { value: '3', label: '3 agents', hint: '~1.5 GB RAM, 3 subprocesses' },
  { value: '4', label: '4 agents', hint: '~2 GB RAM, 4 subprocesses' },
  { value: '6', label: '6 agents', hint: '~3 GB RAM, 6 subprocesses' },
  { value: '8', label: '8 agents', hint: '~4 GB RAM, 8 subprocesses' },
  { value: '10', label: '10 agents', hint: '~5 GB RAM, 10 subprocesses' },
];

// ── Config wizard ──

const ACTIVITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All', hint: 'show everything' },
  { value: 'text', label: 'Text', hint: 'agent output only' },
  { value: 'tools', label: 'Tools', hint: 'tool calls, results, files' },
  { value: 'errors', label: 'Errors', hint: 'errors only' },
  { value: 'events', label: 'Events', hint: 'lifecycle, system events' },
];

// ── Notification toggle options ──

const TOGGLE_OPTIONS = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
];

export function getConfigWizardSteps(
  currentFilter: ActivityFilterPreset,
  currentMaxConcurrent: number,
  currentNotifications?: NotificationPreferences,
): WizardStep[] {
  const notif = currentNotifications ?? { toast: true, bell: false };

  return [
    {
      id: 'activity_filter',
      label: 'Activity filter preset',
      type: 'select',
      options: ACTIVITY_FILTER_OPTIONS,
      defaultValue: currentFilter,
    },
    {
      id: 'max_concurrent',
      label: 'Max concurrent agents',
      type: 'select',
      options: MAX_CONCURRENT_OPTIONS,
      defaultValue: String(currentMaxConcurrent),
    },
    {
      id: 'notifications_toast',
      label: 'Toast notifications',
      type: 'select',
      options: TOGGLE_OPTIONS,
      defaultValue: String(notif.toast),
    },
    {
      id: 'notifications_bell',
      label: 'Bell on completion',
      type: 'select',
      options: TOGGLE_OPTIONS,
      defaultValue: String(notif.bell),
    },
  ];
}

export function editAgentWizardToFields(vals: Record<string, string>) {
  const role = vals.role === '__custom__' ? (vals.role_custom || undefined) : (vals.role || undefined);
  return {
    name: vals.name,
    role,
    model: vals.model || undefined,
    team_id: vals.team || undefined,
  };
}

// ── Goal creation wizard ──

export function getGoalWizardSteps(agents: Agent[]): WizardStep[] {
  const agentOptions = buildAgentOptions(agents, 'Any agent', 'auto-assign to autonomous agents');

  return [
    {
      id: 'title',
      label: 'Goal title',
      type: 'text',
      placeholder: 'What should be achieved?',
      required: true,
      validate: (v) => !v.trim() ? 'Title is required' : null,
    },
    {
      id: 'assignee',
      label: 'Assignee',
      type: 'select',
      options: agentOptions,
      skip: () => agentOptions.length <= 1,
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Detailed goal description, success criteria...',
    },
  ];
}

export function goalWizardToInput(vals: Record<string, string>) {
  return {
    title: vals.title!,
    assignee: vals.assignee || undefined,
    description: vals.description || undefined,
  };
}

export function getEditGoalWizardSteps(goal: Goal, agents: Agent[]): WizardStep[] {
  const agentOptions = buildAgentOptions(agents, 'Any agent', 'auto-assign');

  return [
    {
      id: 'title',
      label: 'Goal title',
      type: 'text',
      defaultValue: goal.title,
      required: true,
      validate: (v) => !v.trim() ? 'Title is required' : null,
    },
    {
      id: 'assignee',
      label: 'Assignee',
      type: 'select',
      options: agentOptions,
      defaultValue: goal.assignee ?? '',
      skip: () => agentOptions.length <= 1,
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      defaultValue: goal.description || '',
      placeholder: 'Detailed goal description...',
    },
  ];
}

export function editGoalWizardToFields(vals: Record<string, string>) {
  return {
    title: vals.title,
    assignee: vals.assignee || undefined,
    description: vals.description ?? '',
  };
}
