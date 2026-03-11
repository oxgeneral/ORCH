/**
 * Template engine for prompt construction.
 *
 * Uses LiquidJS for Liquid-compatible templating with
 * task, agent, project, and run context variables.
 */

import { Liquid } from 'liquidjs';
import type { Agent } from '../../domain/agent.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import type { Task } from '../../domain/task.js';

export interface ITemplateEngine {
  render(template: string, context: PromptContext): Promise<string>;
}

export interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  adapter: string;
}

export interface RetryContext {
  previous_error: string;
  previous_output: string;
}

export interface PromptContext {
  project: {
    name: string;
    description?: string;
  };
  task: {
    id: string;
    title: string;
    description: string;
    priority: number;
    labels: string[];
    scope?: string[];
  };
  agent: {
    name: string;
    role?: string;
  };
  agents: AgentInfo[];
  attempt: number | null;
  workspace_path: string;
  retry?: RetryContext;
  shared_context?: Record<string, string>;
}

export class LiquidTemplateEngine implements ITemplateEngine {
  private readonly engine: Liquid;

  constructor() {
    this.engine = new Liquid({
      strictFilters: false,
      strictVariables: false,
    });
  }

  async render(template: string, context: PromptContext): Promise<string> {
    return this.engine.parseAndRender(template, context);
  }
}

/**
 * Build prompt context from domain objects.
 */
export function buildPromptContext(
  task: Task,
  agent: Agent,
  attempt: number,
  workspacePath: string,
  config: OrchestratorConfig,
  allAgents?: Agent[],
  retryContext?: RetryContext,
  sharedContext?: Record<string, string>,
): PromptContext {
  return {
    project: {
      name: config.project.name,
      description: config.project.description,
    },
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      labels: task.labels,
      scope: task.scope,
    },
    agent: {
      name: agent.name,
      role: agent.role,
    },
    agents: (allAgents ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      adapter: a.adapter,
    })),
    attempt: attempt > 1 ? attempt : null,
    workspace_path: workspacePath,
    retry: attempt > 1 ? retryContext : undefined,
    shared_context: sharedContext && Object.keys(sharedContext).length > 0 ? sharedContext : undefined,
  };
}

/** Default prompt template */
export const DEFAULT_PROMPT_TEMPLATE = `You are {{ agent.name }}{% if agent.role %} ({{ agent.role }}){% endif %}.

## Task: {{ task.title }}
{{ task.description }}

Priority: {{ task.priority }}
{% if attempt %}Attempt: {{ attempt }}{% endif %}
{% if retry %}
## Previous attempt failed
**Error:** {{ retry.previous_error }}
{% if retry.previous_output != "" %}
**Last output:**
\`\`\`
{{ retry.previous_output }}
\`\`\`
{% endif %}
**Important:** The previous approach failed. Analyze the error above and try a different strategy. Do NOT repeat the same steps that led to the failure.
{% endif %}

## Context
Project: {{ project.name }}
Working directory: {{ workspace_path }}

## Team
You are part of a multi-agent team. Available agents:
{% for a in agents %}- **{{ a.name }}** ({{ a.adapter }}){% if a.role %} — {{ a.role }}{% endif %} · ID: \`{{ a.id }}\`
{% endfor %}

{% if shared_context %}
## Shared Context
Other agents have shared the following information:
{% for entry in shared_context %}- **{{ entry[0] }}**: {{ entry[1] }}
{% endfor %}
You can read and write shared context using:
- \`orch context get <key>\` — read a value
- \`orch context set <key> <value>\` — share a value with other agents
{% endif %}

## Orchestrator CLI
You can manage tasks and coordinate with other agents using the \`orch\` CLI:

**Task commands:**
- \`orch task add "<title>" -d "<description>" -p <1-4> --assignee <agent-id>\` — create and assign a new task
- \`orch task add "<title>" -d "<description>" -p <1-4>\` — create a task in the pool (auto-assigned)
- \`orch task add "<title>" -d "<description>" --scope "src/auth/**" --depends-on <task-id>\` — create a scoped task with dependency
- \`orch task list\` — list all tasks and their statuses
- \`orch task list --status todo\` — filter by status (todo, in_progress, done, failed)

**Agent commands:**
- \`orch agent list\` — list all agents and their statuses

**Context commands (share data with other agents):**
- \`orch context set <key> <value>\` — store a shared context entry
- \`orch context get <key>\` — retrieve a shared context entry
- \`orch context list\` — list all shared context entries

Use these commands to decompose complex work into subtasks and delegate to specialized agents.

## Rules
- Do NOT ask clarifying questions. You are running autonomously without human input.
- Make reasonable assumptions and proceed with the best approach.
- If critical information is missing, document your assumptions and continue.
- When a task is too large or spans multiple domains, break it into subtasks using \`orch task add\`.
- When creating subtasks, use \`--scope\` to declare which files each task will touch, and \`--depends-on\` to order dependent work.
`;
