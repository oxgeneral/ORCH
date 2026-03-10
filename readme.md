# Agents Organizations

A lightweight CLI orchestrator for AI agents. Manages a team of agents (Claude Code, Codex, Cursor, shell scripts, etc.) executing tasks in parallel.

## Features

- **Task Management** — create, assign, and track tasks via a state machine (`todo → in_progress → review → done`)
- **Agent Management** — configure multiple agents with different adapters and roles
- **Parallel Execution** — run multiple agents simultaneously with automatic dispatching
- **Retries** — exponential backoff strategy on failures
- **Workspace Isolation** — three modes: `shared`, `worktree`, `isolated`
- **Interactive Dashboard** — fullscreen TUI with real-time monitoring
- **Watch Mode** — daemon that continuously monitors and dispatches tasks
- **Event Log** — stored in JSON-lines format

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict) |
| Runtime | Node.js 20+ |
| CLI | Commander.js |
| TUI | Ink + React |
| Templates | LiquidJS |
| Storage | YAML/JSON files |
| Tests | Vitest |
| Build | tsup |

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd AgentsOrchestryCLI

# Install dependencies
npm install

# Build the project
npm run build

# Install globally (optional)
npm install -g .
```

**Requirements:** Node.js >= 20.0.0

## Quick Start

```bash
# Initialize in a project
orchestry init

# Add an agent
orchestry agent add backend --adapter claude --role "Backend developer"

# Add a task
orchestry task add "Implement authentication" -p 1

# Assign and run
orchestry task assign <task-id> <agent-id>
orchestry run <task-id>

# Or run everything
orchestry run --all
```

## CLI Commands

### Initialization and Status

```bash
orchestry init          # Create .orchestry/ in the current directory
orchestry status        # Overview of tasks and agents
orchestry doctor        # System diagnostics
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

### Execution and Logs

```bash
orchestry run <task-id>       # Run a specific task
orchestry run --all           # Run all todo tasks
orchestry run --watch         # Daemon with auto-dispatching
orchestry logs <run-id>       # View logs
orchestry logs --follow       # Real-time stream
```

### Configuration

```bash
orchestry config set defaults.agent.adapter codex
orchestry config get defaults.agent.timeout_ms
orchestry config edit         # Open in $EDITOR
```

### Interactive Mode

```bash
orchestry                     # Open TUI dashboard
orchestry tui                 # Explicitly launch TUI
```

### Global Options

```
--json       JSON output
--quiet      Minimal output
--no-color   No ANSI colors
--ascii      ASCII only (no Unicode)
```

**Aliases:** `orchestry`, `orch`, `ao`

## Project Structure

```
src/
├── bin/cli.ts              # CLI entry point
├── index.ts                # Library exports
├── cli/commands/           # Command implementations
├── tui/                    # Ink React components
├── domain/                 # Domain models (DDD)
├── application/            # Business logic (services)
└── infrastructure/         # Infrastructure
    ├── adapters/           # Agent adapters (Claude, Shell)
    ├── storage/            # File storage
    ├── process/            # Process management
    ├── template/           # Prompt templating engine
    └── workspace/          # Workspace isolation
```

## Architecture

The project follows **Domain-Driven Design** principles with clear layer separation:

- **Domain** — types, entities, task transition state machine
- **Application** — orchestrator, task/agent/run services, event bus
- **Infrastructure** — agent adapters, file storage, process management

All data is stored in the `.orchestry/` directory — no external databases required.

## Development

```bash
npm run dev            # Run via tsx
npm run build          # Build to dist/
npm run build:watch    # Build in watch mode
npm run test           # Run tests
npm run test:watch     # Tests in watch mode
npm run typecheck      # Type checking
npm run clean          # Clean dist/
```

## Documentation

- [Technical Specification](docs/SPEC.md)
- [API Reference](docs/API.md)
- [UI/UX Design](docs/CLI_UI_DESIGN.md)
- [User Stories](docs/USER_STORIES.md)

## License

MIT
