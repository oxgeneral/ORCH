/**
 * Wizard step configurations for TUI forms.
 *
 * Defines multi-step wizards for agent creation, task creation, etc.
 * Steps can be dynamic (options depend on previous answers).
 */

import type { WizardStep } from './components/FormWizard.js';
import type { Agent } from '../domain/agent.js';

// ── Model catalogs per adapter ──

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', hint: 'fast, balanced' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', hint: 'most capable' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', hint: 'fastest, cheapest' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5', hint: 'extended thinking' },
];

const SHELL_MODELS = [
  { value: '', label: 'Default', hint: 'use shell adapter default' },
];

// ── Adapter catalog ──

const ADAPTERS = [
  { value: 'claude', label: 'Claude', hint: 'Claude Code CLI' },
  { value: 'shell', label: 'Shell', hint: 'custom shell command' },
];

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

export function getAgentWizardSteps(): WizardStep[] {
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
  };
}

// ── Task creation wizard ──

export function getTaskWizardSteps(agents: Agent[]): WizardStep[] {
  const agentOptions = [
    { value: '', label: 'Auto-assign', hint: 'orchestrator picks the best agent' },
    ...agents
      .filter((a) => a.status !== 'disabled')
      .map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.role ?? a.adapter,
      })),
  ];

  const priorityOptions = [
    { value: '1', label: 'P1 Critical', hint: 'urgent, do first' },
    { value: '2', label: 'P2 High', hint: 'important' },
    { value: '3', label: 'P3 Medium', hint: 'default priority' },
    { value: '4', label: 'P4 Low', hint: 'nice to have' },
  ];

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
      options: priorityOptions,
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
  const agentOptions = [
    { value: '', label: 'None / Auto', hint: 'remove assignee' },
    ...agents
      .filter((a) => a.status !== 'disabled')
      .map((a) => ({
        value: a.id,
        label: a.name,
        hint: a.role ?? a.adapter,
      })),
  ];

  const priorityOptions = [
    { value: '1', label: 'P1 Critical', hint: 'urgent, do first' },
    { value: '2', label: 'P2 High', hint: 'important' },
    { value: '3', label: 'P3 Medium', hint: 'default priority' },
    { value: '4', label: 'P4 Low', hint: 'nice to have' },
  ];

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
      options: priorityOptions,
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

  const modelOptions = agent.adapter === 'shell' ? SHELL_MODELS : CLAUDE_MODELS;

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

export function editAgentWizardToFields(vals: Record<string, string>) {
  const role = vals.role === '__custom__' ? (vals.role_custom || undefined) : (vals.role || undefined);
  return {
    name: vals.name,
    role,
    model: vals.model || undefined,
  };
}
