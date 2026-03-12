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
  feedback?: string;
  shared_context?: Record<string, string>;
  messages?: Array<{
    id: string;
    from: string;
    subject: string;
    body: string;
    sent_at: string;
    reply_to?: string;
  }>;
}

export class LiquidTemplateEngine implements ITemplateEngine {
  private readonly engine: Liquid;
  private readonly renderTimeoutMs: number;

  constructor(options?: { renderTimeoutMs?: number }) {
    this.engine = new Liquid({
      strictFilters: false,
      strictVariables: false,
    });
    this.renderTimeoutMs = options?.renderTimeoutMs ?? 5_000;
  }

  async render(template: string, context: PromptContext): Promise<string> {
    const renderPromise = this.engine.parseAndRender(template, context);

    if (this.renderTimeoutMs <= 0) {
      return renderPromise;
    }

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Template render timed out after ${this.renderTimeoutMs}ms`)),
        this.renderTimeoutMs,
      );
    });

    try {
      return await Promise.race([renderPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }
}

/**
 * Build prompt context from domain objects.
 */
export interface BuildPromptOptions {
  allAgents?: Agent[];
  retryContext?: RetryContext;
  sharedContext?: Record<string, string>;
  feedback?: string;
  messages?: import('../../domain/message.js').Message[];
}

export function buildPromptContext(
  task: Task,
  agent: Agent,
  attempt: number,
  workspacePath: string,
  config: OrchestratorConfig,
  options?: BuildPromptOptions,
): PromptContext {
  const { allAgents, retryContext, sharedContext, feedback, messages: rawMessages } = options ?? {};

  // Map messages to prompt-friendly shape
  const agentById = new Map((allAgents ?? []).map((a) => [a.id, a]));
  const messages = rawMessages?.length
    ? rawMessages.map((m) => ({
        id: m.id,
        from: agentById.get(m.from_agent_id)?.name ?? m.from_agent_id,
        subject: m.subject,
        body: m.body,
        sent_at: m.created_at,
        reply_to: m.reply_to,
      }))
    : undefined;

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
    feedback,
    shared_context: sharedContext && Object.keys(sharedContext).length > 0 ? sharedContext : undefined,
    messages,
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

{% if feedback %}
## Review Feedback
This task was previously completed but **rejected** during review with the following feedback:
> {{ feedback }}

**Important:** Address the feedback above. Focus on what the reviewer asked to change. Do NOT redo work that was already accepted.
{% endif %}

{% if shared_context %}
## Shared Context
Other agents have shared the following information:
{% for entry in shared_context %}- **{{ entry[0] }}**: {{ entry[1] }}
{% endfor %}
You can read and write shared context using:
- \`orch context get <key>\` — read a value
- \`orch context set <key> <value>\` — share a value with other agents
{% endif %}

{% if messages %}
## Inbox ({{ messages.size }} message{% if messages.size != 1 %}s{% endif %})
You have messages from other agents. Read them and respond through your work or by sending messages back.
{% for msg in messages %}
---
**From:** {{ msg.from }}{% if msg.subject != "" %} · **Subject:** {{ msg.subject }}{% endif %}
{{ msg.body }}
{% if msg.reply_to %}*(Reply to: {{ msg.reply_to }})*{% endif %}
---
{% endfor %}
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

**Messaging commands:**
- \`orch msg send <agent-id> "<body>" -s "<subject>"\` — send a direct message
- \`orch msg broadcast "<body>" -s "<subject>"\` — broadcast to all agents
- \`orch msg broadcast "<body>" --team <team-id>\` — broadcast to team members
- \`orch msg inbox\` — list your pending messages

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
