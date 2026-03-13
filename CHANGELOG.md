# Changelog

## 0.3.0 (2026-03-13)

### New Features

- **Goal context in agent prompts** — agents now see full goal info (title, description, status, linked tasks, progress report) and can achieve goals via `orch goal status <id> achieved`
- **Autonomous goal mode** — agents in `[auto]` tasks get a structured loop: decompose → execute → track progress → achieve goal
- **Clipboard image paste (Ctrl+V)** — paste images from system clipboard into task creation/edit wizards; cross-platform support (macOS/Linux/Windows)
- **Task attachments** — `orch task add --attach <file>`, stored in `.orchestry/attachments/<taskId>/`, displayed in TUI detail panel with 📎 indicator
- **Goal progress tracking** — `goalId` on tasks, `orch context set <goalId>-progress` for agent progress reports, visible in TUI GoalDetailPanel
- **Scrollable GoalDetailPanel** — virtual scrolling with j/k navigation, section dividers, task summary counts, progress report display
- **Skills display** — agent detail panel shows configured skills list

### Performance

- **3.5× faster per-test** (52→15ms), **60× faster dispatch** (30s→500ms), **2× faster build** (2.7→1.35s), **CLI 1.8×** (75→41ms)
- **state.claimed Array→Set** for O(1) lookups in dispatch hot path
- **Parallel reconcile** — `Promise.all` for task reads in reconciliation phase
- **ScopeIndex pre-computation** — O(1) agent-skill matching instead of O(n) scan
- **isBlocked() O(d×1)** — taskMap lookup instead of O(d×n) array scan
- **Lazy imports** — process-manager in run-store, chalk ansi256() in output.ts
- **Minified CLI bundle** — tsup minify enabled, reduces bundle size
- **Parallel goal context I/O** — `Promise.all` for context/messages/goal fetch in dispatch
- **CachedAgentStore nameCache** — avoid repeated name lookups in retry queue filter
- **Vitest adaptive threads** — dynamic thread count based on CPU cores

### Bug Fixes

- **Tick interval 30s→10s** — faster task dispatch for responsive orchestration
- **GoalDetailPanel useMemo fix** — `tasks ?? []` moved inside memo to prevent new array reference defeating memoization
- **FormWizard paste mock types** — test mocks now return correct `'image'|'text'|'empty'` union instead of boolean
- **Stale closure in clipboard paste** — fixed reference capture bug in handlePasteImage callback

### Architecture

- **TASK_STATUS_COLOR / GOAL_STATUS_COLOR** — canonical status→color maps extracted to `colors.ts` with `Record<Status, string>` type safety
- **SectionDivider reuse** — exported from DetailPanel, replaces duplicate GoalDivider
- **GoalContext in template engine** — `GoalContext` interface, `goal?` field in `PromptContext`, Liquid template section for goals
- **Clipboard service** — `clipboard-service.ts` with platform detection, image extraction, and type-safe API

### Tests

- **987 tests** (up from 851 in 0.2.0)
- New coverage: clipboard paste (8 cases), GoalDetailPanel (13 cases), ScopeIndex (13 cases), attachments, orchestrator perf benchmarks, lazy chalk init

---

## 0.2.0 (2026-03-13)

### New Features

- **`orch update` command** — check for updates and install the latest version from npm (`orch update --check` for check-only mode)
- **Background update notifications** — CLI silently checks npm registry (4h cache) and shows a notification when a newer version is available
- **Lazy command loading** — commands are dynamically imported on demand, reducing CLI startup time ~40%
- **Light/Full container split** — read-only commands (task, agent, status, logs, config, context, msg, goal, team) use a lightweight container without loading adapters, ProcessManager, or LiquidJS
- **`--help` fast path** — `orch --help` and `orch --version` skip container initialization entirely

### Bug Fixes

- **OOM fix (runtime)** — truncate event data before event bus and JSONL writes; replace unbounded `readline` with backpressured Buffer-based stream reader
- **OOM fix (startup)** — replace N×M file reads (277 tasks x 376 runs = 104K reads) with single `listAll()` pass; add 50MB JSONL file size guard
- **cancelTask/forceStopAgent lock bug** — both methods now auto-acquire lock via `withTemporaryLock` when called standalone (previously always threw `LockConflictError` from fresh Orchestrator)
- **task cancel for running tasks** — `orch task cancel` now uses `orchestrator.cancelTask` for `in_progress` tasks (kills agent process, cleans state)
- **State machine violation** — remove `in_progress → done` shortcut, enforce mandatory `review` step
- **Truncated JSON in TUI logs** — add `extractSummaryFromTruncated` regex fallback for truncated event data
- **`[undefined]` in TUI** — fix fallback to `[${type ?? role}]`
- **`$EDITOR` with args** — `code --wait` no longer fails with ENOENT
- **`--since` in logs** — no longer loads entire JSONL into memory
- **NO_COLOR compliance** — respect `NO_COLOR` env var per no-color.org spec
- **Done tasks showing wrong time** — use `updated_at` instead of `created_at`
- **Race condition in TUI** — move `setTaCursorCol` out of `setTaLines` updater
- **Process spawn** — add `proc.unref()` after detached spawn to unblock parent exit
- **`isProcessAlive`** — return true on EPERM (process alive, no permission)
- **Retry backoff** — fix off-by-one using `attempts - 1` for correct backoff start
- **Scope overlap** — fix `patternsOverlap` false negative for sibling paths
- **CJK/emoji titles** — fix `prepareWorktree` empty branch name
- **`sanitizeId`** — reject forbidden characters instead of silently stripping
- **`appendJsonl`** — truncate data to PIPE_BUF (4096) for atomic O_APPEND writes
- **`cancelTask` abort** — call `.abort()` on AbortController before delete
- **`forceTaskToReview`** — now clears `agent.current_task`

### Performance

- **Progressive history loading** — parallel I/O in `onLoadHistory` with batched setState (80ms flush)
- **`readJsonlTail`** — read last N records from JSONL without loading entire file
- **EMFILE protection** — batched `Promise.all` reads in groups of 64
- **Vitest threads pool** — test suite runs ~12% faster

### Architecture

- **`buildLightContainer` / `buildFullContainer`** — split DI container for fast startup
- **`readLines` generator** — Buffer-based with backpressure, replaces `readline.createInterface`
- **`serializeEventData`** — DRY event serialization with 3-layer truncation
- **`resolveFailureStatus`** — extracted from duplicated retry logic
- **`createTokenUsage` factory** — ensures `total = input + output`
- **Atomic cache writes** — update-check uses temp file + rename

### Tests

- **851 tests** (up from 737 in 0.1.0)
- New coverage: process-manager, streamEvents, lazy routing, task cancel, progressive loading, context, token usage, retry status

---

## 0.1.0 (2026-03-12)

Initial release.
