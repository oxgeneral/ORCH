<p align="center">
  <h1 align="center">ORCH</h1>
  <p align="center">
    <strong>One CLI to orchestrate them all.</strong><br/>
    Manage a team of AI agents — Claude, Codex, Cursor, shell scripts — executing tasks in parallel from your terminal.
  </p>
  <p align="center">
    <a href="#installation"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js >= 20" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
    <a href="#development"><img src="https://img.shields.io/badge/tests-345%20passing-brightgreen" alt="Tests" /></a>
    <a href="#tech-stack"><img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript strict" /></a>
  </p>
</p>

---

## The Problem

You use multiple AI coding assistants — Claude Code, Codex CLI, Cursor, custom scripts. Each runs in its own silo. You switch between terminals, copy-paste context, and manually track who's doing what.

## The Solution

**Agents Organizations** gives you a single command center. Define agents, create tasks, assign work, and run everything in parallel — with retries, workspace isolation, and a real-time dashboard.

```
┌─────────────────────────────────────────────────────┐
│  You                                                │
│   └── orchestry run --all                           │
│         ├── Agent: claude  → "Implement auth"       │
│         ├── Agent: codex   → "Write API tests"     │
│         └── Agent: shell   → "Run migrations"       │
│                                                     │
│  State machine: todo → in_progress → review → done  │
└─────────────────────────────────────────────────────┘
```

## Installation

```bash
# Clone the repository
git clone https://github.com/anthropics/agents-organizations-cli.git
cd agents-organizations-cli

# Install dependencies
npm install

# Build the project
npm run build

# Install globally (optional)
npm install -g .
```

**Requirements:** Node.js >= 20.0.0

## Quick Start

Get running in under 60 seconds:

```bash
# Initialize in your project
orchestry init

# Add agents
orchestry agent add backend --adapter claude --role "Backend developer"
orchestry agent add tester  --adapter shell  --command "npm test"

# Create and run tasks
orchestry task add "Implement authentication" -p 1
orchestry run --all
```

## Features

| Feature | Description |
|---------|-------------|
| **Task Management** | Create, assign, and track tasks via a state machine (`todo → in_progress → review → done`) |
| **Multi-Agent Support** | Configure agents with different adapters: Claude, Codex, Shell, or custom |
| **Parallel Execution** | Run multiple agents simultaneously with automatic dispatching |
| **Retries** | Exponential backoff on failures — agents don't give up easily |
| **Workspace Isolation** | Three modes: `shared`, `worktree`, `isolated` |
| **Interactive Dashboard** | Fullscreen TUI with real-time monitoring (Ink + React) |
| **Watch Mode** | Daemon that continuously monitors and dispatches new tasks |
| **Event Log** | All activity stored in JSON-lines format for full auditability |

## CLI Commands

### Setup & Status

```bash
orchestry init              # Create .orchestry/ in current directory
orchestry status            # Overview of tasks and agents
orchestry doctor            # System diagnostics
```

### Tasks

```bash
orchestry task add "Title" [-d description] [-p priority] [-l labels]
orchestry task list [--status todo|done]
orchestry task show <id>
orchestry task assign <task-id> <agent-id>
orchestry task cancel <task-id>
orchestry task retry <task-id>
```

### Agents

```bash
orchestry agent add <name> --adapter claude [--role "Role"]
orchestry agent add <name> --adapter shell --command "python bot.py"
orchestry agent list
orchestry agent remove <id>
orchestry agent disable/enable <id>
```

### Execution & Logs

```bash
orchestry run <task-id>         # Run a specific task
orchestry run --all             # Run all todo tasks
orchestry run --watch           # Daemon with auto-dispatching
orchestry logs <run-id>         # View logs
orchestry logs --follow         # Real-time stream
```

### Configuration

```bash
orchestry config set defaults.agent.adapter codex
orchestry config get defaults.agent.timeout_ms
orchestry config edit           # Open in $EDITOR
```

### Interactive Mode

```bash
orchestry                       # Open TUI dashboard
orchestry tui                   # Explicitly launch TUI
```

### Global Options

```
--json       JSON output
--quiet      Minimal output
--no-color   No ANSI colors
--ascii      ASCII only (no Unicode)
```

**Aliases:** `orchestry`, `orch`, `ao`

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict) |
| Runtime | Node.js 20+ |
| CLI | Commander.js |
| TUI | Ink + React |
| Templates | LiquidJS |
| Storage | YAML/JSON files (no database required) |
| Tests | Vitest (345 tests) |
| Build | tsup (ESM) |

## Architecture

The project follows **Domain-Driven Design** with clear layer separation:

```
src/
├── bin/cli.ts                  # CLI entry point
├── index.ts                    # Library exports
├── domain/                     # Core models, state machine, transitions
├── application/                # Orchestrator, task/agent/run services, event bus
├── infrastructure/
│   ├── adapters/               # Agent adapters (Claude, Shell, extensible)
│   ├── storage/                # File-based storage (YAML/JSON)
│   ├── process/                # Process management
│   ├── template/               # LiquidJS prompt templating
│   └── workspace/              # Workspace isolation (shared/worktree/isolated)
├── cli/commands/               # CLI command implementations
└── tui/                        # Ink React components (dashboard, wizards)
```

All data lives in the `.orchestry/` directory — no external databases, no cloud dependencies. Everything stays local and version-controllable.

## Development

```bash
npm run dev            # Run via tsx
npm run build          # Build to dist/
npm run build:watch    # Build in watch mode
npm test               # Run all 345 tests
npm run test:watch     # Tests in watch mode
npm run typecheck      # Type checking
npm run clean          # Clean dist/
```

## Documentation

- [Technical Specification](docs/SPEC.md)
- [UI/UX Design](docs/CLI_UI_DESIGN.md)
- [User Stories](docs/USER_STORIES.md)
- [Contributing Guide](CONTRIBUTING.md)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — use it however you want.
