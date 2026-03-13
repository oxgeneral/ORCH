# Contributing to ORCH

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/oxgeneral/ORCH.git
cd ORCH

# Install dependencies
npm install

# Run in development mode
npm run dev
```

## Development Workflow

### Build

```bash
npm run build          # Production build (tsup)
npm run build:watch    # Watch mode
npm run clean          # Remove dist/
```

### Tests

We use [Vitest](https://vitest.dev/) for testing.

```bash
npm test               # Run all tests once
npm run test:watch     # Watch mode
npm run coverage       # Run tests with coverage
```

### Type Checking

```bash
npm run typecheck      # Run tsc --noEmit
```

## Project Structure

```
src/
├── domain/            # Core models and state transitions
│   ├── task.ts        # Task model
│   ├── agent.ts       # Agent model
│   ├── run.ts         # Run model
│   ├── goal.ts        # Goal model
│   ├── team.ts        # Team model
│   ├── message.ts     # Message model
│   ├── config.ts      # Project config
│   ├── global-config.ts   # Global CLI config
│   ├── default-agents.ts  # Default agents (e.g. Agent Creator)
│   ├── state.ts       # Orchestrator state
│   ├── scope.ts       # File scope matching
│   ├── transitions.ts # State machine transitions
│   ├── events.ts      # Event type definitions
│   └── errors.ts      # Domain error types
├── application/       # Services (task, agent, run, orchestrator)
├── infrastructure/    # Storage adapters (YAML/JSON/JSONL), templates
│   ├── adapters/      # Claude, Codex, Cursor, Shell (pluggable)
│   ├── storage/       # File-based persistence
│   ├── process/       # PID management, graceful kill
│   └── workspace/     # Isolation modes (shared/worktree/isolated)
├── cli/               # Commander.js commands
└── tui/               # Ink/React terminal UI
test/
├── unit/              # Unit tests
└── integration/       # Integration tests
```

## Code Style

- **Language**: TypeScript (strict mode)
- **Module system**: ESM (`"type": "module"`)
- **Naming**: camelCase for variables/functions, PascalCase for types/classes, kebab-case for file names
- **Imports**: Use explicit `.js` extensions for local imports (ESM requirement)
- **No `any`**: Avoid `any` types — use `unknown` or proper generics instead

## Pull Request Process

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature
   ```

2. Make your changes and ensure:
   - All tests pass: `npm test`
   - No type errors: `npm run typecheck`
   - Build succeeds: `npm run build`

3. Write clear, concise commit messages describing _why_, not just _what_.

4. Open a PR against `main` with:
   - A short descriptive title
   - Summary of changes
   - How to test the changes

5. Address any review feedback promptly.

## Adding Tests

- Place unit tests in `test/unit/` mirroring the `src/` structure
- Use descriptive `describe` and `it` blocks
- Test files should be named `*.test.ts` or `*.test.tsx`

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md) for the full release process. Quick version:

```bash
./scripts/release.sh patch
git push && git push --tags
```

GitHub Actions will automatically publish to npm.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
