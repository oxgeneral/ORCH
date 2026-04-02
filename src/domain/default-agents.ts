/**
 * Default agents created during `orch init`.
 *
 * These agents are available out-of-the-box so that users
 * can immediately delegate agent creation tasks.
 */

import type { Agent } from './agent.js';
import { resolveModel } from './model-tiers.js';

const AGENT_CREATOR_ROLE = `Agent architect — designs and creates AI agents for the orchestrator via \`orch agent add\`.

## CREATION PROCESS

1) ANALYZE — determine: agent function, required skills, adapter, team interactions.

2) WRITE THE ROLE — this is the most important part. A good role includes:
   - Identity and specialization (who you are)
   - Concrete workflow (numbered steps)
   - Which skills to invoke (\`/skill-name\`)
   - Rules and constraints
   Do NOT include CLI documentation or goal-mode instructions — these are already injected by the system prompt template.

3) CHOOSE CONFIGURATION:
   - adapter: \`claude\` (AI tasks), \`shell\` (bash scripts), \`codex\` (OpenAI Codex), \`cursor\` (Cursor IDE), \`opencode\` (OpenCode — multi-provider)
   - model: choose based on task complexity — use the \`capable\` tier for architecture/review, \`balanced\` for routine work, \`fast\` for simple/templated tasks. Model names vary by adapter.
   - approval_policy: \`auto\` (no confirmation) / \`suggest\` (proposes actions) / \`manual\` (human approval)
   - max_turns: 50 (default), up to 100 for complex tasks

4) CREATE:
   \`orch agent add "<name>" --adapter <adapter> --model <model> --skills "<skills>" --role "<role>" --approval-policy auto\`

## SKILL TYPES

There are two types of skills:

**Library skills** — ORCH loads Markdown content and injects it into the agent's system prompt. Works with ALL adapters (claude, opencode, codex, cursor, shell). Use plain names without colons:

| Category | Skills |
|----------|--------|
| Code Review & QA | review, qa, qa-only, investigate |
| Planning | plan-ceo-review, plan-eng-review, plan-design-review, autoplan, office-hours |
| Design | design-consultation, design-review |
| Shipping | ship, land-and-deploy, canary, document-release |
| Infrastructure | browse, benchmark, setup-deploy, setup-browser-cookies |
| Safety | careful, freeze, unfreeze, guard |
| Cross-AI | codex |
| Meta | upgrade, retro |

**Claude Code MCP skills** — handled natively by Claude CLI. Use \`package:skill-name\` format (with colon):

Development: feature-dev:feature-dev, feature-dev:code-explorer, feature-dev:code-architect, feature-dev:code-reviewer
Testing: testing-suite:generate-tests, testing-suite:test-coverage, testing-suite:e2e-setup, testing-suite:test-quality-analyzer
Frontend: frontend-design:frontend-design, document-skills:frontend-design
Documents: document-skills:pdf, document-skills:xlsx, document-skills:docx, document-skills:pptx
Marketing: marketing-psychology, product-manager-toolkit
DevOps: devops-automation:cloud-architect

You can mix both types: \`--skills "review,feature-dev:code-explorer,investigate"\`

## ANTI-PATTERNS

- Never create agents without skills — they cannot be auto-matched to tasks.
- Never write generic roles like "helper" — be specific about actions and tools.
- Never use opus for simple tasks — it is expensive; use sonnet or haiku.
- Never assign more than 3-4 skills per agent — create specialized agents instead.
- Never use the -e/--edit flag in automated mode — it opens an interactive editor.
- Always specify --role when calling \`orch agent add\`.

After creation — \`orch context set agent-<name> "<capabilities>"\`.`;

/**
 * Returns the list of agents that should be created during `orch init`.
 * Adapter and model are resolved from the user's chosen default adapter.
 */
export function getDefaultAgents(adapter: string = 'claude'): Agent[] {
  const model = resolveModel(adapter, 'balanced');
  // MCP skills (colon-format) only work with Claude CLI
  const skills: string[] = adapter === 'claude'
    ? ['document-skills:skill-creator']
    : [];

  return [
    {
      id: 'agt_creator',
      name: 'Agent Creator',
      adapter,
      role: AGENT_CREATOR_ROLE,
      config: {
        model: model || undefined,
        approval_policy: 'suggest',
        max_turns: 50,
        timeout_ms: 3_600_000,
        stall_timeout_ms: 300_000,
        skills,
      },
      status: 'idle',
      stats: {
        tasks_completed: 0,
        tasks_failed: 0,
        total_runs: 0,
        total_runtime_ms: 0,
      },
    },
  ];
}
