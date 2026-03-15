# Changelog

## 1.0.2 (2026-03-15)

### Features

- **3 new org templates** — `sales-machine` (Sales Director, SDR x2, Copywriter, Growth Analyst), `bugfix-dept` (Triager, Fixer x3, QA, Reviewer), `docs-team` (Docs Lead, Writer x2, Editor, Reviewer)

### Fixes

- **README sync** — agent descriptions in README now match actual code for `security-dept`, `test-factory`, `data-lab`, `sales-machine`
- **Org template count test** — tightened from `>= 7` to exact `toBe(10)`

## 1.0.0 (2026-03-14)

First stable release. Production-ready CLI orchestrator for AI agent teams.

### Highlights

- **5 adapter ecosystem** — Claude, OpenCode, Codex, Cursor, Shell — mix any AI providers in one team
- **1493 tests** — comprehensive coverage across all layers
- **Real-time TUI dashboard** — tasks, agents, goals, activity feed, logs with filtering
- **Smart prompt architecture** — system/user split for caching, relevance-based context filtering
- **Zero-config start** — `npm i -g @oxgeneral/orch && orch` auto-initializes

### New in 1.0.0 (since 0.3.4)

#### Features

- **OpenCode adapter** — new `opencode` adapter for multi-provider agent support via OpenCode CLI (OpenRouter, DeepSeek, Gemini, etc.). JSONL event streaming with `--format json`, model pass-through as `provider/model`
- **System/User prompt split** — separate static system prompt (agent identity, rules) from dynamic user prompt (task details) for Claude API prompt caching (~40-60% fewer input tokens on repeat runs)
- **Agent picker [adapter] tags** — assignee lists in TUI now show `[claude]`, `[opencode]`, `[codex]` etc. next to each agent for provider visibility
- **OpenCode model catalog** — TUI wizard offers Default (use opencode config), Claude, Gemini, DeepSeek, and Big Pickle models when creating opencode agents

#### Bug Fixes

- **OpenCode tool display** — tool_call events from opencode now render as `⚙ grep(pattern: "...")` instead of raw JSON in TUI logs
- **step_finish noise** — intermediate `step_finish` lifecycle events no longer pollute activity feed

#### Reverted Optimizations

- **Context value truncation** (500 char cap) — silently lost agent context
- **Agent role truncation** (80 char / first line) — agents couldn't see teammates' capabilities
- **Goal task names cap** (30 entries) — agents lost goal progress visibility
- **Retry output tail reads** (50 lines) — agents lost failure chain context

> Design principle: token optimizations must not silently lose data that agents need. Filtering by relevance is OK; hard truncation is not.

### Full Feature Set (cumulative)

#### Orchestration Engine
- Parallel agent execution with configurable concurrency (`max_concurrent_agents`)
- State machine: `todo → in_progress → review → done` with `retrying` and `failed` branches
- Automatic retry with exponential backoff, stall detection, zombie process cleanup
- Priority-based dispatch (P1-first, goal-linked tasks prioritized)
- Scope-based file conflict prevention (`--scope`, `--depends-on`)
- Task dependencies with topological ordering

#### Adapters
- **Claude** — Claude Code CLI with `--system-prompt` for prompt caching
- **OpenCode** — OpenCode CLI with multi-provider support (OpenRouter, DeepSeek, Gemini)
- **Codex** — OpenAI Codex CLI with stdin prompt delivery
- **Cursor** — Cursor Agent CLI with auto-binary resolution
- **Shell** — arbitrary commands via `bash -lc` with env variable prompt

#### TUI Dashboard (Ink/React)
- 3-tab interface: Tasks, Agents, Goals with detail panels
- Real-time activity feed with type-based filtering (text, tools, errors, events)
- Logs view with agent/type multi-filter, duration-based queries
- Form wizards for agent/task/goal creation with inline validation
- Agent Shop — 15 pre-built agent templates
- Toast notifications, help overlay, keyboard shortcuts
- Clipboard image paste for task attachments

#### Smart Prompts
- LiquidJS template engine with conditional sections
- System/User split for Claude API prompt caching
- Relevance-based context filtering (top 15 of 340+ entries)
- Inter-agent messaging (`orch msg send/broadcast/inbox`)
- Goal context injection with progress tracking
- Autonomous goal mode with structured decomposition loop

#### CLI Commands
- `orch run` / `orch tui` — start orchestration
- `orch task` — add, list, show, edit, cancel, approve, reject
- `orch agent` — add, list, show, edit, disable, shop
- `orch goal` — add, list, show, status, delete
- `orch team` — create, list, show, delete
- `orch msg` — send, broadcast, inbox
- `orch context` — set, get, list, delete (shared key-value store)
- `orch logs` — view run events with filtering
- `orch config` — view/edit orchestrator settings
- `orch doctor` — health check for all adapters
- `orch update` — check and install updates

#### Storage & Performance
- File-based storage (`.orchestry/`) — YAML, JSON, JSONL, no database
- Atomic writes with temp file + rename
- Parallel file reads with EMFILE batching (groups of 64)
- JSONL tail reads for OOM protection
- 3-layer event data truncation pipeline (16KB → 8KB → 4KB → 2KB)
- TUI batched message queue (80ms flush) with LRU caps

### Tests

- **1493 tests** across 83 test files
- Coverage: orchestrator resilience, adapter event parsing, template rendering, TUI components, wizard validation, state machine transitions, storage atomicity, process management

---

## 0.3.4 (2026-03-14)

### New Features

- **Goal-Task Visual Linking** — task rows show `⊕ TITLE` badge linking to parent goal, goal rows display `████░░ done/total` progress bar, `G` toggle groups tasks by goal with section headers
- **Logs view redesign** — separate command bar from filter controls, compact agent filter chips with multi-select popup
- **Logs filter status bar** — active filter summary showing `agent:X type:Y N/M` count at bottom of logs view
- **FormWizard inline validation** — validate functions on wizard steps with 300ms debounce, red border on error, Enter blocking until fixed, required field `*` indicator
- **HelpOverlay** — `?` and `F1` toggle a 3-column help panel (Navigation / Actions / Commands) with amber design
- **Detail Panel Resize** — `+`/`-`/`M` hotkeys to grow/shrink/maximize the detail panel height
- **Toast Notifications** — status banners for task completion: done (green, 4s), failed (red, 8s), review (blue, 6s); configurable bell sound (`\x07`) on failed/review events
- **ErrorHintPanel** — inline error summary in AgentList showing `ERROR_HINTS` message, detail panel shows fix suggestions with `orch doctor` hint
- **Adapter error propagation** — `AdapterErrorKind` propagated through events, `agent.last_error` persisted with kind/message/timestamp for post-mortem analysis
- **Header tab badge flash** — tab pill blinks 3 times on task status events from other tabs (done=green, failed=red, review=blue)
- **Inline Agent Shop suggestions** — agent templates shown as selectable hints in wizard name step, filtered by typed text
- **Task titles in depends field** — DetailPanel shows human-readable task titles instead of raw `tsk_` IDs
- **Compact AgentRow layout** — removed role column (visible via Enter detail), running task and errors shown inline after name, adapter/team as plain text
- **Goal badge before agent** — goal `⊕` badge moved to appear before agent name in TaskRow for better visual grouping
- **Config wizard simplified** — `/config` now shows all settings sequentially without intermediate "pick a setting" step

### Bug Fixes

- **TDZ crash in CLI bundle** — disabled esbuild minify in tsup to prevent temporal dead zone crash on startup
- **goalMap TS2454 error** — moved `goalMap` declaration before `sortedTasks` to fix TypeScript "used before assigned" error
- **GoalDetailPanel key navigation** — tests updated to use `leftArrow` instead of `G` key for goals tab navigation
- **Ink OutputCaches OOM** — patched Ink's internal `OutputCaches` with LRU eviction + memoized hot-path renders to prevent memory leak
- **Wizard suggestion state leak** — reset suggestion state on wizard step navigation to prevent stale suggestions appearing
- **LogsFilterPicker `a` toggle** — simplified toggle logic to remove dead code where both branches were identical
- **Duplicate task footer** — removed sticky "showing N of M tasks" footer (inline "Show all" row remains)

### Tests

- **1386 tests** (up from 1099 in 0.3.3)
- New coverage: Goal-Task visual linking (21 tests), FormWizard inline validation (57 tests), HelpOverlay + command categories (86 tests), toast notifications (15 tests), ErrorHintPanel (14 tests), detail panel resize (13 tests), hidden tasks footer (5 tests), wizard validate functions (34 tests), logs filter status bar (4 tests), onboarding TUI (21 tests), errorKind propagation (9 tests)

---

## 0.3.3 (2026-03-14)

### Bug Fixes

- **OOM crash after ~66 minutes** — TUI crashed with `Ineffective mark-compacts near heap limit` because Ink's `Intl.Segmenter` ran on every render for non-ASCII box-drawing characters (`━`, `─`). All 25+ `.repeat()` calls across 6 components now use cached `heavyRule()`/`lightRule()` builders that allocate each unique length once
- **Unbounded strings in `<Text>`** — `agent.role`, `skills.join()`, `task.description`, `goal.description`, and `goalProgressReport` were passed to Ink without per-line truncation, forcing `Intl.Segmenter` on multi-KB strings every render. Added `capLine()` and `capText()` utilities with safe caps
- **Priority-based dispatch** — `dispatchAll()` sorted tasks by `updated_at` only, making the `priority` field purely cosmetic. Tasks are now dispatched P1-first, with goal-linked tasks prioritized over unlinked at the same priority, and recency as tiebreaker

### New Features

- **Hidden tasks footer** — when task list exceeds 10 items, a sticky footer shows `showing 10 of N tasks · press S to show all` so users don't think tasks disappeared
- **Tab badge counter** — Tasks tab pill shows total count `(N)` when some tasks are hidden
- **Adapter error classification** — `AdapterErrorKind` enum with 7 error categories (`adapter_not_found`, `auth_failed`, `timeout`, `rate_limit`, `process_crash`, `spawn_failed`, `unknown`) and human-readable `ERROR_HINTS` with actionable fix commands
- **Onboarding state machine** — `onboardingCompleted` flag in `OrchestratorState`, `WelcomeScreen`, `OnboardingNudge`, and `OnboardingToast` components for guided first-run experience
- **Command categories** — suggestions panel groups commands into categories; `?` help hint shown for new users

### Tests

- **1099 tests** (up from 1020 in 0.3.2)
- New coverage: priority dispatch ordering (4 tests), adapter error classification (4 adapters), hidden tasks footer/badge (5 tests), onboarding state (unit tests)

---

## 0.3.2 (2026-03-14)

### New Features

- **Agent Shop** — browse and install from 15 pre-built agent templates with detailed role prompts, skills, and recommended models; accessible via TUI (`/agent shop`, `Ctrl+S`/`⌘+S` from agent wizard) and CLI (`orch agent shop`)
- **Agent templates catalog** — Backend Dev, Frontend Dev, QA Engineer, Code Reviewer, Architect, DevOps Engineer, Bug Hunter, Technical Writer, Marketer, Content Creator, Growth Hacker, Security Auditor, Performance Engineer, Data Engineer, Full-Stack Developer
- **Skills step in agent wizard** — new comma-separated skills input when creating agents via TUI
- **macOS shortcut support** — `⌘+V` image paste and `⌘+S` agent shop now work on macOS (previously only `Ctrl+` variants worked); platform-aware hints shown in footer

### Landing Page

- **Full redesign** — 13 sections (was 10), conversion-optimized copy, marketing psychology applied
- **New sections** — Social Proof (adapter cards), Problem-Solution (Before/After), Mid-page CTA, Use Cases (9 cards across 9 personas), FAQ (7 items with accordion)
- **SVG agent topology** — animated particle diagram showing CTO→Backend→QA→Reviewer team coordination
- **Stats bar** — replaced internal metrics (tests, LOC) with user-facing stats (N+ parallel agents, 15 ready-made agents, 1 command to start, 0 cloud dependencies)
- **4-column footer** — Product, Resources, Community links with GitHub/Discord icons

### Bug Fixes

- **FormWizard remount** — wizard defaultValues (name, role, model) were not applied when switching between wizard sessions; fixed by adding React `key` to force remount
- **Shop template approval_policy** — Code Reviewer, Architect, and Security Auditor templates had `suggest` policy silently overwritten to `auto` in TUI flow; now preserved via hidden wizard step
- **Shop picker robustness** — guarded against `process.stdout.rows` being undefined/zero, added raw-mode cleanup on exceptions and SIGINT
- **release.sh** — updated to replace all `vX.Y.Z` occurrences in landing page (was only matching `vX.Y.Z — open source` pattern)

### Tests

- **1020 tests** (up from 1001 in 0.3.1)
- New coverage: Agent Shop catalog validation (15 templates, unique keys/names, role format), wizard prefill injection, skills parsing, approval_policy passthrough

---

## 0.3.1 (2026-03-13)

### New Features

- **`/goal` command group in TUI** — `/goal add` opens wizard, `/goal list`, `/goal show`, `/goal status <active|paused|achieved|abandoned>`, `/goal delete` with soft-delete undo; previously the command was registered but silently did nothing

### Bug Fixes

- **Empty assistant messages in activity feed** — tool_use-only and empty-content assistant messages no longer produce `💬 (assistant message)` noise in the TUI activity feed; `formatAgentOutput` returns `null` summary with lazy detail computation to avoid slicing 100KB+ strings for discarded messages
- **Multiline role text in wizard hints** — agent roles with markdown (e.g. `## WORKFLOW\n...`) now show only the first line in wizard select options instead of breaking layout

### Architecture

- **`GOAL_STATUSES` reuse** — `/goal status` validation uses the canonical constant from `src/domain/goal.ts` instead of a hardcoded array
- **Type-safe status narrowing** — `statusArg: string | undefined` validated before `as GoalStatus` cast, eliminating premature unsafe type assertion

### Tests

- **1001 tests** (up from 987 in 0.3.0)
- New coverage: image paste integration (4 cases), agent hint stripping in wizard (10 cases)

---

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
