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

## Important Notes

- Always run `orch doctor` first if something seems wrong
- Use `--json` flag for programmatic parsing
- `orch serve --once` is ideal for CI/CD pipelines
- Stall timeout default is 10 minutes — increase for complex tasks via `orch config set defaults.agent.stall_timeout_ms 1200000`
- If tasks are stuck after a crash, the orchestrator auto-cleans stale state on restart (v1.0.6+)
