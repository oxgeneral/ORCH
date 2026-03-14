/**
 * Template engine for prompt construction.
 *
 * Uses LiquidJS for Liquid-compatible templating with
 * task, agent, project, and run context variables.
 */

import type { Liquid } from 'liquidjs';
import type { Agent } from '../../domain/agent.js';
import type { GoalStatus } from '../../domain/goal.js';
import type { OrchestratorConfig } from '../../domain/config.js';
import { AUTONOMOUS_LABEL, type Task } from '../../domain/task.js';

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

export interface GoalContext {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  task_names: string[];
  progress?: string;
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
    is_autonomous: boolean;
    goal_id?: string;
  };
  agent: {
    id: string;
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
  goal?: GoalContext;
}

export class LiquidTemplateEngine implements ITemplateEngine {
  private engine: Liquid | undefined;
  private readonly renderTimeoutMs: number;

  constructor(options?: { renderTimeoutMs?: number }) {
    this.renderTimeoutMs = options?.renderTimeoutMs ?? 5_000;
  }

  private async getEngine(): Promise<Liquid> {
    if (!this.engine) {
      const { Liquid } = await import('liquidjs');
      this.engine = new Liquid({
        strictFilters: false,
        strictVariables: false,
      });
    }
    return this.engine;
  }

  async render(template: string, context: PromptContext): Promise<string> {
    const engine = await this.getEngine();
    const renderPromise = engine.parseAndRender(template, context);

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
 * Truncate agent role to its first line (max 80 chars) for compact team listing.
 * The current agent's full role is already rendered in the prompt header.
 */
function truncateRole(role: string | undefined): string | undefined {
  if (!role) return role;
  const firstLine = role.split('\n')[0]!.trim();
  return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
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
  goal?: GoalContext;
}

export function buildPromptContext(
  task: Task,
  agent: Agent,
  attempt: number,
  workspacePath: string,
  config: OrchestratorConfig,
  options?: BuildPromptOptions,
): PromptContext {
  const { allAgents, retryContext, sharedContext, feedback, messages: rawMessages, goal } = options ?? {};

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
      is_autonomous: task.labels?.includes(AUTONOMOUS_LABEL) ?? false,
      goal_id: task.goalId,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
    agents: (allAgents ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.id === agent.id ? undefined : truncateRole(a.role),
      adapter: a.adapter,
    })),
    attempt: attempt > 1 ? attempt : null,
    workspace_path: workspacePath,
    retry: attempt > 1 ? retryContext : undefined,
    feedback,
    shared_context: sharedContext && Object.keys(sharedContext).length > 0 ? sharedContext : undefined,
    messages,
    goal,
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
Use \`orch agent list\` to check current agent statuses. Find teammates by name/role — do NOT hardcode agent IDs.

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
{% endif %}

{% if messages %}
## Inbox ({{ messages.size }} message{% if messages.size != 1 %}s{% endif %})
{% for msg in messages %}
---
**From:** {{ msg.from }}{% if msg.subject != "" %} · **Subject:** {{ msg.subject }}{% endif %}
{{ msg.body }}
{% if msg.reply_to %}*(Reply to: {{ msg.reply_to }})*{% endif %}
---
{% endfor %}
{% endif %}

## Orchestrator CLI
Manage tasks and coordinate with other agents using \`orch\`:

**Tasks:**
- \`orch task add "<title>" -d "<description>" -p <1-4> --assignee <agent-id>\` — create and assign a task
- \`orch task add "<title>" -d "<description>" --scope "src/path/**" --depends-on <task-id>\` — scoped task with dependency
- \`orch task list [--status todo|in_progress|done|failed]\` — list tasks

**Messaging:**
- \`orch msg send <agent-id> "<body>" -s "<subject>"\` — direct message
- \`orch msg broadcast "<body>" -s "<subject>"\` — broadcast to all
- \`orch msg inbox {{ agent.id }}\` — your pending messages

**Shared context:**
- \`orch context set <key> <value>\` / \`orch context get <key>\` / \`orch context list\`

{% if goal %}
## Goal: {{ goal.title }}
**Status:** {{ goal.status }} · **ID:** \`{{ goal.id }}\`
{% if goal.description != "" %}
{{ goal.description }}
{% endif %}
{% if goal.task_names.size > 0 %}
**Linked tasks ({{ goal.task_names.size }}):**
{% for name in goal.task_names %}- {{ name }}
{% endfor %}
Use \`orch task list --goal-id {{ goal.id }}\` and \`orch task show <id>\` to inspect details.
{% endif %}
{% if goal.progress %}
**Latest progress report:**
{{ goal.progress }}
{% endif %}
{% endif %}

{% if task.is_autonomous %}
## Autonomous Goal Mode
This is an autonomous task driven by a goal. Work in a continuous loop until the goal is achieved:

1. **Understand the goal** — read the Goal section above.
2. **Decompose** — break the goal into concrete subtasks via \`orch task add\`. {% if task.goal_id %}Pass \`--goal-id {{ task.goal_id }}\` so subtasks are linked to this goal. {% endif %}Assign yourself for your specialty, delegate other work to appropriate teammates by role.
3. **Execute** — follow your standard workflow for each subtask.
4. **Track progress** — after each iteration: \`orch context set {{ task.goal_id | default: "<goal>" }}-progress "<summary of what's done and what remains>"\`.
5. **Be proactive** — do NOT wait for tasks from others. Create your own subtasks and keep working.
6. **Do NOT finish** the [auto] task until the goal is achieved — keep creating subtasks.
7. **When done** — mark the goal as achieved: \`orch goal status {{ task.goal_id | default: "<goal-id>" }} achieved\`.

**Deep inspection:** Use \`orch goal show {{ task.goal_id | default: "<goal-id>" }}\` to see full goal details at any time.
{% endif %}

## Rules
- Do NOT ask clarifying questions. You are running autonomously without human input.
- Make reasonable assumptions and proceed with the best approach.
- If critical information is missing, document your assumptions and continue.
- When a task is too large or spans multiple domains, break it into subtasks using \`orch task add\`.
- When creating subtasks, use \`--scope\` to declare which files each task will touch, and \`--depends-on\` to order dependent work.
`;
