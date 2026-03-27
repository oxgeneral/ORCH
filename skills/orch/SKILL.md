---
name: orch
description: "AI agent orchestrator — manage teams of AI agents that work on your codebase in parallel. Use when the user wants to: run multiple agents, coordinate AI work, deploy agent teams, manage tasks/goals/agents, check orchestrator status, or mentions 'orch', 'orchestry', 'agents team', 'agent orchestration'."
allowed-tools: Bash, Read, Glob, Grep, Write, Edit, Agent
argument-hint: "[command or natural language request]"
---

# ORCH — AI Agent Orchestrator

You are the user's assistant for **ORCH** (`@oxgeneral/orch`) — an AI agent runtime that coordinates teams of LLM agents working on a codebase in parallel.

Your role: interpret user intent and execute the right `orch` CLI commands. The user may speak in natural language — translate their intent into concrete actions.

## How to Work

1. **Natural language → CLI commands**: User says "add a task to refactor auth" → you run `orch task add "Refactor auth module" -d "..." --scope "src/auth/**"`
2. **Always use `--json` flag** when you need to parse output programmatically
3. **Chain commands** when the user's request requires multiple steps
4. **Explain what you're doing** briefly before running commands
5. **Show results** in a readable format after commands complete

## Quick Start Flow

If the project is not initialized (no `.orchestry/` directory):
```bash
orch init --name "project-name"
```

If there are no agents:
```bash
orch agent shop  # or suggest pre-built org templates
```

## Complete CLI Reference

### Project Setup

```bash
orch init [--name <name>]          # Initialize .orchestry/ in current directory
orch doctor                        # Check adapters and dependencies
orch update [--check]              # Check/install updates
orch status                        # Show orchestrator overview
```

### Task Management

```bash
# Create tasks
orch task add "<title>" [options]
  -d, --description <desc>         # Task description
  -p, --priority <1-4>             # Priority (1=highest, default: 3)
  -l, --labels <a,b,c>             # Comma-separated labels
  --depends-on <id1,id2>           # Dependency task IDs
  --assignee <agent-id>            # Assign to specific agent
  --scope <patterns>               # File scope globs (e.g. src/auth/**,src/session/**)
  --review-criteria <criteria>     # Auto-review: test_pass,typecheck,lint
  --workspace-mode <mode>          # shared|worktree|isolated
  --goal-id <goalId>               # Link to a goal
  --attach <paths>                 # Attach files (screenshots, docs)
  --max-attempts <n>               # Max retry attempts
  -e, --edit                       # Open $EDITOR for description

# List and view
orch task list [--status <status>] # List tasks (filter: todo,in_progress,review,done,failed,cancelled)
orch task show <id>                # Show task details

# Lifecycle
orch task assign <task-id> <agent-id>  # Assign task to agent
orch task cancel <id>              # Cancel task (stops agent if running)
orch task approve <id>             # Approve task in review → done
orch task reject <id> [-r <reason>] # Reject task → back to todo
orch task retry <id>               # Retry failed task
orch task edit <id>                # Edit in $EDITOR
```

**Task Status Flow:** `todo → in_progress → review → done` with `retrying` and `failed` branches.

### Agent Management

```bash
# Create agents
orch agent add "<name>" --adapter <type> [options]
  --adapter <type>                 # REQUIRED: claude|opencode|codex|cursor|shell
  --role <description>             # Agent role/expertise
  --model <model>                  # Model name
  --effort <level>                 # Reasoning effort: low, medium, high (Claude only)
  --command <cmd>                  # Shell command (for shell adapter)
  --max-turns <n>                  # Max turns per run
  --timeout <ms>                   # Timeout in milliseconds
  --approval-policy <policy>       # auto|suggest|manual
  --workspace-mode <mode>          # shared|worktree|isolated
  --skills <skills>                # Comma-separated skills
  -e, --edit                       # Open $EDITOR for role

# Agent shop — pre-built templates
orch agent shop [--list]           # Browse/install templates

# Manage
orch agent list                    # List all agents
orch agent status <id>             # Show agent details + stats
orch agent edit <id>               # Edit agent
orch agent remove <id>             # Remove agent
orch agent disable <id>            # Disable agent
orch agent enable <id>             # Enable agent
orch agent autonomous <id> [--on|--off]  # Toggle autonomous mode
```

**Available Agent Templates:** backend-dev, frontend-dev, qa-engineer, code-reviewer, architect, devops-engineer, bug-hunter, tech-writer, marketer, content-creator, growth-hacker, security-auditor, performance-engineer, data-engineer, fullstack-dev

### Execution

```bash
orch run <task-id>                 # Run single task
orch run --all                     # Run all todo tasks
orch run --watch                   # Continuous orchestration (tick loop)
orch tui                           # Interactive TUI dashboard
orch serve [options]               # Headless daemon mode
  --once                           # Process and exit (CI/CD mode)
  --tick-interval <ms>             # Override poll interval
  --log-file <path>                # Tee logs to file
  --log-format <json|text>         # Log format (default: json)
  --verbose                        # Include agent:output events
```

### Goals (High-Level Objectives)

```bash
orch goal add "<title>" [options]
  --description <desc>             # Goal description
  --assignee <agentId>             # Assign to agent for decomposition

orch goal list [--status <status>] # List goals
orch goal show <id>                # Show goal + progress report
orch goal status <id> <status>     # Change status: active|paused|achieved|abandoned
orch goal update <id> [options]    # Update title/description/assignee
orch goal delete <id>              # Delete goal
```

### Teams

```bash
orch team create "<name>" --lead <agent-id> [options]
  --members <id1,id2>             # Initial members
  -d, --description <desc>        # Team description
  --no-auto-claim                 # Disable auto-claiming

orch team list                    # List teams
orch team show <id>               # Show team details
orch team join <team-id> <agent-id>    # Add member
orch team leave <team-id> <agent-id>   # Remove member
orch team add-task <team-id> <task-id> # Add task to pool
orch team set-lead <team-id> <agent-id> # Transfer lead
orch team disband <id>            # Disband team
```

### Pre-Built Organizations

```bash
orch org list                     # List available templates
orch org deploy <template> [--goal "<objective>"]
```

**Available Templates:**
- `startup-mvp` — Ship MVP in 48h (CTO + 2 Backend + Frontend + QA + Reviewer)
- `pr-review-corp` — Auto-review every PR (Security + Performance + Style + QA)
- `migration-squad` — JS→TS migration (CTO + 3 Migrators + QA + Reviewer)
- `security-dept` — Multi-layer audit (Lead + Scanner + Secrets + Hunter + Reviewer)
- `test-factory` — Coverage 40%→80% (Lead + 2 Backend + 3 QA + Reviewer)
- `bugfix-dept` — 100 issues→0 (Triager + 3 Fixers + QA + Reviewer)
- `docs-team` — Docs from code (Lead + 2 Writers + Editor + Reviewer)
- `content-agency` — Content factory (Strategist + 2 Writers + Editor + SEO)
- `data-lab` — CSVs→executive report (Lead Analyst + Data Engineer)
- `sales-machine` — Outbound pipeline (Director + 2 SDRs + Copywriter + Growth)

### Inter-Agent Communication

```bash
# Messages
orch msg send <to-agent-id> "<body>" [-s <subject>] [--from <id>] [--ttl <ms>]
orch msg broadcast "<body>" [-s <subject>] [--team <team-id>]
orch msg inbox <agent-id>          # Pending messages
orch msg list [--agent <id>]       # All messages

# Shared Context
orch context set <key> <value> [--ttl <ms>]
orch context get <key>
orch context list
orch context delete <key>
```

### Configuration

```bash
orch config get <key>              # Get config value (dot notation)
orch config set <key> <value>      # Set config value
orch config edit                   # Edit config.yml in $EDITOR

# Global settings (~/.orchestry/global.yml)
orch config global get <key>
orch config global set <key> <value>
orch config global show
```

### Logs

```bash
orch logs [run-id]                 # View run logs
  --agent <agent-id>               # Filter by agent
  --task <task-id>                 # Filter by task
  --follow                         # Live stream
  --since <duration>               # Time filter (5m, 1h, 1d)
```

## Common Workflows

### "Set up a team to work on my project"
1. `orch init` (if needed)
2. `orch org deploy startup-mvp --goal "Build feature X"` OR manually create agents
3. `orch tui` or `orch run --watch` to start

### "Add a task and run it"
1. `orch task add "Fix login bug" -d "The login form crashes on empty email" --scope "src/auth/**" -p 1`
2. `orch run <task-id>`

### "Check what's happening"
1. `orch status` — overview
2. `orch task list --status in_progress` — running tasks
3. `orch logs --follow` — live output

### "Deploy a review team for PRs"
1. `orch org deploy pr-review-corp --goal "Review all open PRs"`
2. Tasks are auto-created and assigned

### "I want to refactor X across the codebase"
1. Create a goal: `orch goal add "Refactor X" --description "..." --assignee <lead-agent>`
2. Lead agent decomposes goal into tasks automatically
3. `orch run --watch` to execute

## Key Concepts

- **Agents** run in isolated git worktrees (no merge conflicts)
- **Tasks** flow through: todo → in_progress → review → done
- **Goals** are decomposed into tasks by a lead agent
- **Teams** coordinate agents with a lead + members
- **Adapters**: claude, opencode, codex, cursor, shell
- **All state** stored in `.orchestry/` (YAML/JSON, no database)
- **IDs** are prefixed: `tsk_`, `agt_`, `run_`, `goal_`, `team_`, `msg_`

## When to Use Goals vs Tasks

### Use a Task when:
- You know **exactly what needs to be done** — one concrete action
- The scope is clear: fix a bug, write a test, update a file, review a PR
- You can describe the result in one sentence
- Examples: "Fix login crash on empty email", "Add unit tests for auth service", "Update README badges"

```bash
orch task add "Fix login crash" -d "Empty email causes TypeError in validate()" --scope "src/auth/**" -p 1
```

### Use a Goal when:
- The objective is **high-level and needs decomposition** — you don't know all the steps upfront
- Multiple tasks will be needed, potentially across different agents/skills
- You want an agent to **autonomously plan and execute** the work
- Examples: "Implement OAuth2", "Migrate from REST to GraphQL", "Improve test coverage to 80%"

```bash
orch goal add "Implement OAuth2 with Google and GitHub" --description "Support social login, add tests, update docs" --assignee <lead-agent>
```

The assigned agent enters **autonomous mode**: it analyzes the codebase, creates tasks, assigns them to appropriate agents, and monitors progress until the goal is achieved.

### Use a Goal for iterative improvement:
- You have a **measurable metric** and want the agent to keep working until it's met
- The agent runs cycles: measure → fix → measure again → repeat
- Examples: "Get test coverage to 80%", "Zero TypeScript errors", "All /simplify reviews clean"

```bash
orch goal add "Reach 80% test coverage" --description "Run coverage, find gaps, write tests, repeat until ≥80%" --assignee <qa-agent>
```

### Rule of thumb
- **1 agent, 1 action** → Task
- **Multiple agents, unclear steps** → Goal
- **Iterative loop until metric is met** → Goal

## Configuration Reference

```yaml
# .orchestry/config.yml
project:
  name: "my-project"
defaults:
  agent:
    adapter: "claude"           # Default adapter
    approval_policy: "auto"     # auto|suggest|manual
    max_turns: 50               # Max LLM turns per run
    timeout_ms: 3600000         # 1 hour timeout
    stall_timeout_ms: 600000    # 10 min stall detection
    workspace_mode: "worktree"  # shared|worktree|isolated
  task:
    max_attempts: 3             # Max retries
    priority: 3                 # Default priority (1-4)
scheduling:
  poll_interval_ms: 10000       # Tick interval (10s)
  max_concurrent_agents: 6      # Parallel agent limit
  retry_base_delay_ms: 10000    # Retry backoff base
  retry_max_delay_ms: 300000    # Max retry delay (5min)
```

## Creating Agents — Sources and Best Practices

### Quick: Use Pre-Built Templates

```bash
orch agent shop              # Interactive picker — 15 templates
orch agent shop --list       # Print all templates non-interactively
orch org deploy <template>   # Deploy a full team with one command
```

### Agent Shop Templates (src/domain/agent-shop.ts)

Each template includes a detailed role prompt, model, skills, and approval policy:

| Template | Role | Model | Skills |
|----------|------|-------|--------|
| `backend-dev` | APIs, services, DB layers | claude-sonnet-4-6 | feature-dev |
| `frontend-dev` | React UI, components, CSS | claude-sonnet-4-6 | feature-dev, frontend-design |
| `qa-engineer` | Tests, coverage analysis | claude-sonnet-4-6 | testing-suite |
| `code-reviewer` | PR review, bugs, security | claude-opus-4-6 | feature-dev:code-reviewer |
| `architect` | System design, architecture | claude-opus-4-6 | feature-dev:code-architect |
| `devops-engineer` | CI/CD, infrastructure | claude-sonnet-4-6 | devops-automation |
| `bug-hunter` | Find bugs, reproduce, fix | claude-sonnet-4-6 | feature-dev |
| `tech-writer` | Docs, READMEs, API docs | claude-sonnet-4-6 | perfect-readme |
| `security-auditor` | Security scanning, vulns | claude-opus-4-6 | testing-suite |
| `performance-engineer` | Optimization, profiling | claude-sonnet-4-6 | testing-suite |
| `data-engineer` | Data pipelines, ETL | claude-sonnet-4-6 | — |
| `fullstack-dev` | End-to-end development | claude-sonnet-4-6 | feature-dev |
| `marketer` | Marketing strategy, copy | claude-sonnet-4-6 | marketing-psychology |
| `content-creator` | Blog posts, social media | claude-sonnet-4-6 | — |
| `growth-hacker` | Growth experiments | claude-sonnet-4-6 | marketing-psychology |

### Org Templates (src/domain/org-shop.ts)

Pre-built teams — deploy with `orch org deploy <key> --goal "..."`:

| Template | Agents | Use Case |
|----------|--------|----------|
| `startup-mvp` | CTO + 2 Backend + Frontend + QA + Reviewer | Ship MVP fast |
| `pr-review-corp` | CTO + Security + Performance + Style + QA | Auto-review PRs |
| `migration-squad` | CTO + 3 Migrators + QA + Reviewer | JS→TS migration |
| `security-dept` | Lead + Scanner + Secrets + Hunter + Reviewer | Security audit |
| `test-factory` | Lead + 2 Backend + 3 QA + Reviewer | Coverage boost |
| `bugfix-dept` | Triager + 3 Fixers + QA + Reviewer | Issue backlog |
| `docs-team` | Lead + 2 Writers + Editor + Reviewer | Documentation |
| `content-agency` | Strategist + 2 Writers + Editor + SEO | Content |
| `data-lab` | Lead Analyst + Data Engineer | Data analysis |
| `sales-machine` | Director + 2 SDRs + Copywriter + Growth | Outbound |

### Custom Agents: Role Prompt Structure

When creating custom agents with `orch agent add`, follow this proven structure from the shop templates:

```
# [Role Name]

[One-line description of what this agent does]

## WORKFLOW
1) READ — understand the task scope
2) EXPLORE — analyze existing code/data with appropriate skills
3) PLAN — outline approach before executing
4) EXECUTE — do the work following conventions
5) VERIFY — self-review, run tests
6) REPORT — summarize what was done, flag risks

## RULES
- [Convention 1]
- [Convention 2]
- [Safety guardrail]
```

### Skills Available for Agents

Assign skills via `--skills` flag or edit agent YAML. You can mix both types: `--skills "review,feature-dev:code-explorer,investigate"`.

#### Library Skills (injected into system prompt — works with ALL adapters)

Content from the skill library is loaded and appended to the agent's system prompt at execution time. Use plain names (no colons):

| Skill | Best For |
|-------|----------|
| `review` | Pre-landing code review with auto-fix, checklists, adversarial review |
| `qa` | Full QA testing + browser testing + bug fixing + health scoring |
| `qa-only` | QA testing without auto-fixes (report only) |
| `ship` | Automated ship workflow: merge, test, coverage audit, PR creation |
| `office-hours` | YC-style product thinking, design docs, premise challenge |
| `investigate` | Systematic debugging with root cause methodology, 3-strike hypothesis |
| `careful` | Safety guardrails for destructive commands |
| `guard` | Full safety mode (careful + freeze combined) |
| `freeze` | Restrict edits to a specific directory |
| `unfreeze` | Clear freeze boundary |
| `design-consultation` | Design system creation, visual language definition |
| `design-review` | Design review with accessibility, responsiveness checks |
| `plan-ceo-review` | CEO-level strategic review of plans |
| `plan-eng-review` | Engineering review of technical plans |
| `plan-design-review` | Design review of plans |
| `autoplan` | Auto-review pipeline with decision principles |
| `land-and-deploy` | Merge PR, wait for CI, verify production health |
| `canary` | Post-deploy canary monitoring |
| `document-release` | Auto-update documentation after ship |
| `retro` | Weekly engineering retrospective with trends |
| `browse` | Headless browser navigation and testing |
| `benchmark` | Performance benchmarking with before/after metrics |
| `codex` | OpenAI Codex cross-review / multi-AI challenge |
| `setup-deploy` | Configure deployment settings |
| `setup-browser-cookies` | Import browser cookies for authenticated QA |
| `upgrade` | Upgrade skills to latest version |

#### Claude Code MCP Skills (native — Claude adapter only)

Handled natively by Claude CLI. Use `package:skill-name` format (with colon):

| Skill | Best For |
|-------|----------|
| `feature-dev:feature-dev` | Guided feature development with architecture focus |
| `feature-dev:code-explorer` | Deep codebase analysis and tracing |
| `feature-dev:code-architect` | Architecture design and blueprints |
| `feature-dev:code-reviewer` | Code review with confidence filtering |
| `testing-suite:generate-tests` | Test generation with edge cases |
| `testing-suite:test-coverage` | Coverage analysis and gap identification |
| `testing-suite:e2e-setup` | End-to-end testing configuration |
| `testing-suite:test-quality-analyzer` | Test suite quality metrics |
| `devops-automation:cloud-architect` | Cloud infrastructure, Terraform |
| `frontend-design:frontend-design` | UI/UX design and implementation |
| `document-skills:frontend-design` | Frontend design (document-skills variant) |
| `product-manager-toolkit` | RICE prioritization, PRD templates |
| `marketing-psychology` | Behavioral science for marketing |

### Tips

- Use `claude-opus-4-6` for strategic/review roles (architect, reviewer, lead) — higher quality reasoning
- Use `claude-sonnet-4-6` for execution roles (developer, QA, writer) — faster, cheaper
- Set `--approval-policy suggest` for strategic agents so humans review decisions
- Set `--approval-policy auto` for execution agents for fully autonomous operation
- Use `--effort low|medium|high` to control reasoning depth (Claude only) — `low` for simple tasks, `medium` for balanced, `high` for complex reasoning
- Use `--workspace-mode shared` for analysis/strategy agents (they read, don't write code)
- Use `--workspace-mode worktree` for coding agents (isolated branches, no conflicts)

## Important Notes

- Always run `orch doctor` first if something seems wrong
- Use `--json` flag for programmatic parsing
- `orch serve --once` is ideal for CI/CD pipelines
- Stall timeout default is 10 minutes — increase for complex tasks via `orch config set defaults.agent.stall_timeout_ms 1200000`
- If tasks are stuck after a crash, the orchestrator auto-cleans stale state on restart (v1.0.6+)
