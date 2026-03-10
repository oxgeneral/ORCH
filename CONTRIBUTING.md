# Contributing to Agents Organizations CLI

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)

## Getting Started

```bash
# Clone the repository
git clone <repo-url>
cd AgentsOrchestryCLI

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
```

### Type Checking

```bash
npm run typecheck      # Run tsc --noEmit
```

## Project Structure

```
src/
├── domain/            # Core models and state transitions
├── application/       # Services (task, agent, run)
├── infrastructure/    # Storage adapters (YAML/JSON), templates
├── cli/               # Commander CLI commands
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

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
