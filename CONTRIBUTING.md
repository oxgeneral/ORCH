# Contributing to ORCH

Thank you for your interest in contributing to ORCH! Whether you're fixing a bug, adding a feature, writing docs, or building a new adapter — this guide will get you started quickly.

> :star: If ORCH saves you time, please [star the repo](https://github.com/oxgeneral/ORCH/stargazers) to help others discover it.

> **New here?** Look for issues labeled [`good first issue`](https://github.com/oxgeneral/ORCH/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — they're scoped, well-documented, and ready for a PR.

---

## Quick Start (5 minutes)

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/ORCH.git
cd ORCH

# 2. Install dependencies
npm install

# 3. Run in dev mode (no build needed)
npm run dev

# 4. Run tests — all 1953 should pass
npm test

# 5. Type-check
npm run typecheck
```

**Prerequisites:** Node.js >= 20, npm (comes with Node).

---

## Development Workflow

### Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Run via tsx (no build step) |
| `npm run build` | Production build (ESM + DTS via tsup) |
| `npm test` | Run all tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` — strict mode |
| `npm run coverage` | Tests with coverage report |

### Branch Naming

```
feat/your-feature       # New feature
fix/brief-description   # Bug fix
docs/what-you-changed   # Documentation
refactor/what-changed   # Refactoring (no behavior change)
```

---

## Architecture Overview

ORCH follows **layered DDD** — each layer only depends on layers above it:

```
Domain (models, state machine, errors)          ← pure logic, zero I/O
  ↓
Application (services, orchestrator, event bus)  ← business workflows
  ↓
Infrastructure (adapters, storage, processes)    ← file I/O, spawning
  ↓
CLI (Commander.js) / TUI (Ink + React)           ← user interface
```

**Key principle:** Domain and Application layers have zero dependencies on Infrastructure or CLI. The `@oxgeneral/orch` npm package exports the full engine API — it's a runtime, not just a CLI.

### Directory Structure

```
src/
├── domain/            # Models, state machine, errors
│   ├── task.ts        # Task model
│   ├── agent.ts       # Agent model
│   ├── transitions.ts # State machine: todo → in_progress → review → done
│   └── errors.ts      # OrchestryError base class
├── application/       # Services + orchestrator engine
│   ├── orchestrator.ts  # Tick loop: reconcile → dispatch → collect
│   └── *-service.ts     # Task, agent, run services
├── infrastructure/
│   ├── adapters/      # Claude, OpenCode, Codex, Cursor, Shell
│   ├── storage/       # YAML/JSON/JSONL file stores
│   ├── process/       # PID management, graceful kill
│   ├── template/      # LiquidJS prompt templates
│   └── workspace/     # Git worktree isolation
├── cli/               # Commander.js commands
└── tui/               # Ink + React terminal dashboard
```

---

## Code Style

### TypeScript

- **Strict mode** — `noUncheckedIndexedAccess: true`
- **No `any`** — use `unknown` or proper generics. `as any` is not accepted.
- **No `@ts-ignore`** — fix the type instead.
- **ESM** — all local imports use `.js` extension:
  ```typescript
  // ✅ Correct
  import { TaskStore } from './storage/task-store.js';

  // ❌ Wrong — missing .js
  import { TaskStore } from './storage/task-store';
  ```

### Naming Conventions

| What | Convention | Example |
|------|-----------|---------|
| Variables, functions | camelCase | `getTaskById` |
| Types, classes | PascalCase | `TaskService` |
| Files | kebab-case | `task-service.ts` |
| IDs | Prefixed nanoid | `tsk_`, `agt_`, `run_`, `goal_`, `team_`, `msg_` |

### Error Handling

- Domain errors extend `OrchestryError` with `exitCode` and optional `hint`
- **No `console.log`** in production code — use `eventBus.emit()`
- Always handle error paths — no silent catches

### Performance

- Use `Promise.all()` for parallel file I/O — never sequential loops for reads
- Atomic writes: write to temp file, then `rename()` — never write directly
- Cap data structures: LRU for maps, truncation for strings (2KB)

---

## Adding a New Adapter

Adapters connect ORCH to external AI tools. Each adapter implements the `IAgentAdapter` interface.

### Step 1: Create the adapter file

```
src/infrastructure/adapters/your-tool.ts
```

### Step 2: Implement the interface

```typescript
import type {
  IAgentAdapter,
  AdapterTestResult,
  ExecuteParams,
  AgentEvent,
  ExecuteHandle,
} from './interface.js';
import type { IProcessManager } from '../process/process-manager.js';

export class YourToolAdapter implements IAgentAdapter {
  readonly kind = 'your-tool';  // This is the adapter name agents use

  constructor(private readonly processManager: IProcessManager) {}

  async test(): Promise<AdapterTestResult> {
    // Check if the tool CLI is installed and return its version
    try {
      // ... check tool availability
      return { ok: true, version: '1.0.0' };
    } catch {
      return { ok: false, error: 'your-tool CLI not found' };
    }
  }

  execute(params: ExecuteParams): ExecuteHandle {
    // Spawn the tool process
    const { process: proc, pid } = this.processManager.spawn(
      'your-tool',
      ['--prompt', params.prompt],
      { cwd: params.workspace, env: { ...process.env, ...params.env } },
    );

    // Return pid + async generator that yields AgentEvent objects
    async function* streamEvents(): AsyncGenerator<AgentEvent> {
      // ... yield events as the tool produces output
      yield {
        type: 'output',
        timestamp: new Date().toISOString(),
        data: 'Tool output here',
      };
      yield {
        type: 'done',
        timestamp: new Date().toISOString(),
        data: 'Completed',
      };
    }

    return { pid, events: streamEvents() };
  }

  async stop(pid: number): Promise<void> {
    await this.processManager.kill(pid);
  }
}
```

### Step 3: Register in the container

In `src/container.ts`, import and register your adapter:

```typescript
import { YourToolAdapter } from './infrastructure/adapters/your-tool.js';

// Inside buildContainer():
adapterRegistry.register(new YourToolAdapter(processManager));
```

### Step 4: Add tests

Create `test/unit/infrastructure/adapters/your-tool.test.ts` with:
- `test()` returns `ok: true` when CLI is available
- `test()` returns `ok: false` gracefully when CLI is missing
- `execute()` yields correct event sequence
- `stop()` kills the process

### Step 5: Update docs

- Add the adapter to the adapters list in `readme.md`
- Update the test count badge if tests changed significantly

---

## Test Guidelines

### Structure

Tests mirror `src/` under `test/unit/`:

```
src/domain/task.ts          →  test/unit/domain/task.test.ts
src/application/run-service.ts  →  test/unit/application/run-service.test.ts
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('YourModule', () => {
  it('should do one specific thing', () => {
    // Arrange
    // Act
    // Assert — one assertion per test
  });
});
```

**Rules:**
- One test = one assertion (as much as possible)
- **Deterministic** — no `Date.now()`, no `Math.random()`, no real file I/O
- Use mock factories from `test/unit/application/helpers.ts`:
  - `makeTask()`, `makeAgent()`, `makeRun()` for domain objects
  - `buildDeps()` for full orchestrator dependency injection
- Use CLI test helpers from `test/unit/cli/helpers.ts`
- File naming: `*.test.ts` or `*.test.tsx`

### Running Tests

```bash
npm test                           # All tests
npm test -- test/unit/domain/      # Directory
npm test -- --grep "state machine" # By pattern
npm run coverage                   # With coverage report
```

**Known flaky test:** `lock-concurrency` — can be ignored if it fails intermittently.

---

## PR Checklist

Before opening a PR, verify:

- [ ] **Tests pass:** `npm test` — all green
- [ ] **Types check:** `npm run typecheck` — zero errors
- [ ] **Build works:** `npm run build` — no warnings
- [ ] **No `any`** or `@ts-ignore` in your code
- [ ] **No `console.log`** — use `eventBus.emit()` for logging
- [ ] **ESM imports** use `.js` extension
- [ ] **New code has tests** — aim for edge cases, not just happy path
- [ ] **Atomic file writes** — temp file + rename pattern
- [ ] **Commit message** describes _why_, not just _what_

### PR Format

```
## Summary
- What changed and why (1-3 bullets)

## Test Plan
- How to verify the changes
- Which tests cover it
```

---

## Reporting Bugs

[Open an issue](https://github.com/oxgeneral/ORCH/issues/new) with:
- **Steps to reproduce** — exact commands you ran
- **Expected vs actual** behavior
- **Environment** — OS, Node version (`node -v`), ORCH version (`orch --version`)
- **Logs** — relevant output from `orch logs <run-id>` or terminal

---

## Requesting Features

[Open a Discussion](https://github.com/oxgeneral/ORCH/discussions) in the "Feature Requests" category:
- **Problem** — what workflow is painful today?
- **Proposed solution** — how should it work?
- **Alternatives considered** — what else did you try?

---

## Releasing

See [docs/RELEASING.md](docs/RELEASING.md) for the full process. Quick version:

```bash
./scripts/release.sh patch|minor|major
git push && git push --tags
```

GitHub Actions automatically publishes to npm.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

<p align="center">
  <strong>Every contribution matters.</strong><br/>
  <sub>Bug reports, docs fixes, new adapters, test improvements — all welcome.</sub>
</p>

<p align="center">
  <a href="https://github.com/oxgeneral/ORCH/stargazers">If ORCH saves you time, a GitHub star helps others find it</a>
</p>
