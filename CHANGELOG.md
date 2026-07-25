# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## 1.0.30 (2026-07-25)

### Bug Fixes

- **Readable Codex activity text** — Codex agent messages, commands, file changes, tool calls, and web searches are normalized before reaching the TUI, while provider lifecycle and reasoning noise is omitted.
- **Concise provider errors** — nested JSON error envelopes are reduced to their human-facing message, repeated `turn.failed` copies are suppressed per run, and recoverable model-metadata fallback notices no longer appear as failures.
- **Historical run compatibility** — existing Codex JSONL history receives the same text, tool, lifecycle, warning, and error formatting as newly streamed events.

### Release Infrastructure

- **GitHub-only tagged releases** — pushing a `v*` tag validates, builds, tests, and creates a GitHub Release without publishing a package to npm.
- **Isolated PTY configuration** — real terminal tests use a temporary global TUI config and never overwrite `~/.orchestry/global.yml`.

### Tests

- Added a real pseudo-terminal E2E that launches the built CLI and verifies `ALL → TEXT → TOOLS → ERRORS`, visible Codex content, lifecycle filtering, readable errors, deduplication, and clean shutdown.
- Stabilized the concurrent disk-observer assertion.
- Full suite: 2044 passed, 2 skipped.

## 1.0.29 (2026-07-25)

### New Features

- **Global TUI color palettes** — choose Amber, Ocean, Forest, or Violet through `/config palette`. The selected palette is applied across the dashboard and saved in the global `~/.orchestry/config.yml`.
- **Independent TUI settings** — `/config` settings now open individually instead of forcing users through a multi-step setup wizard. Palette, activity filter, concurrency, toast, and bell preferences can be changed separately.
- **Live model catalogs for every adapter** — agent create/edit wizards load models from the installed Claude, Codex, Cursor, OpenCode, Pi, Grok, and Antigravity CLIs; Shell exposes an explicit no-model default.
- **Searchable model selection** — the model field filters large live catalogs while still accepting custom provider/model IDs.

### Bug Fixes

- **Existing agent provider changes** — switching an agent to another adapter clears the previous adapter's model before showing the new catalog.
- **Live wizard refresh** — model suggestions update even when discovery finishes after the agent wizard is already open.
- **Edited agent refresh** — agent cards now detect adapter/model changes even though agent records do not carry `updated_at`.
- **Agent Shop compatibility** — templates choose a model that is actually present in the selected adapter's live catalog and otherwise fall back safely.
- **English command categories** — removed the remaining Russian management, monitoring, and settings headings from TUI command help.

### Refactoring

- **Palette context** — palette-aware components consume one shared context instead of threading palette props through the component tree.
- **Model discovery command path** — shared CLI execution, stdout/stderr selection, default insertion, and parser dispatch are centralized without changing adapter fallback behavior.
- **Wizard model fallback** — simplified adapter lookup while preserving a neutral fallback for custom adapters.

### Tests

- Added runtime parser, streamed-catalog, open-wizard refresh, searchable selection, existing-agent default, and timestamp-less agent refresh regression coverage.
- Verified all eight adapter model screens in real PTY TUI sessions.
- Full suite: 2034 passed, 2 skipped.

## 1.0.28 (2026-07-22)

### Bug Fixes

- **Cursor print-mode prompt transport** ([#14](https://github.com/oxgeneral/ORCH/issues/14)) — Cursor now receives the assembled ORCH prompt as its required positional argument, trusts fresh ORCH worktrees non-interactively, and no longer opens stdin for a prompt the CLI will not read.
- **Cursor token usage compatibility** — result events from current Cursor releases use camelCase usage fields; the shared extractor now accepts both camelCase and the existing snake_case provider schema.
- **Adapter stderr diagnostics** — shared streaming adapters continuously drain stderr, retain a bounded 4 KB tail, and include it in spawn/non-zero-exit errors. Process lifecycle listeners are installed eagerly so immediate CLI failures cannot be missed before event collection starts.

### Tests

- Added regression coverage for Cursor argument construction, positional system/user prompts, ignored stdin, stderr propagation, immediate process exits, and bounded stderr capture.

### Refactoring

- Simplified shared token-usage alias lookup without changing snake_case or camelCase compatibility.

## 1.0.27 (2026-07-04)

### New Features

- **Editable agent provider in TUI** — the agent edit flow now includes a `Provider` selector, so existing agents can move between adapters without recreating them.
- **Adapter-aware edit options** — model choices refresh from the selected provider, and reasoning effort is shown only for adapters that support it.

### Bug Fixes

- **Agent edit persistence** — adapter changes now flow through the TUI update handler into `AgentService.update`, with validation for empty adapter values.
- **Model and effort clearing** — edit submissions can clear stale model or reasoning-effort values when switching to adapters where those fields should no longer apply.

### Refactoring

- **Agent update adapter handling** — adapter normalization now trims once before validation and persistence.

### Tests

- Added AgentService coverage for adapter updates, adapter validation, and clearing model values.
- Extended TUI wizard coverage for editing adapter/model/effort combinations.

## 1.0.26 (2026-07-04)

### New Features

- **Grok adapter** — first-class `grok` adapter backed by the Grok CLI. Supports headless execution, model selection, reasoning effort, max turns, system prompt override, tool/error event mapping, streaming text aggregation, `doctor`, `init`, TUI wizard, model tiers, docs, landing assets, and smoke/e2e coverage.
- **Antigravity adapter** — first-class `antigravity` adapter backed by Google Antigravity CLI (`agy`). Supports headless prompt execution, model selection, permission bypass for autonomous runs, stdout streaming, `doctor`, `init`, TUI wizard, model tiers, docs, landing assets, and smoke/e2e coverage.
- **Runtime model discovery in TUI** — model choices now load from adapter CLIs where available (`grok models`, `agy models`, `opencode models`, `pi --list-models`) with curated fallbacks for unavailable or non-listing CLIs. Agent creation, edit flows, and Agent Shop templates all use the same model catalog path.

### Bug Fixes

- **Targeted `orch run <task-id>` no longer dispatches unrelated todo tasks** — running a specific task now keeps ownership of that request instead of reactive-dispatching other queued tasks after the requested task completes.

### Refactoring

- **Model catalog source of truth** — moved TUI model fallback options out of wizard config into `src/infrastructure/models/model-discovery.ts`, so adapter model lists are centralized and guarded by `AdapterKind`.
- **Adapter type safety** — model option lookup now uses the existing `isAdapterKind` guard instead of string casts.

### Tests

- Added unit coverage for Grok and Antigravity adapters.
- Added integration coverage for the new adapters.
- Added model discovery parser and TUI wizard catalog tests.
- Extended model tier, onboarding, and smoke coverage for `grok` and `antigravity`.

## 1.0.25 (2026-06-28)

### Bug Fixes

- **TUI task wizard: reliable textarea confirmation fallback** ([#13](https://github.com/oxgeneral/ORCH/issues/13)) — `Tab` now confirms every `FormWizard` step, including multiline `Description` fields. This keeps `Enter` available for textarea newlines while giving Windows, WSL, CMD, PowerShell, Git Bash, and terminals without reliable `Ctrl+Enter` support a deterministic way to finish the step.
- **Wizard hints updated for the new shortcut** — text/select/multiselect steps now show `Enter/Tab confirm`; textarea steps show `⌘+Enter/Tab confirm` on macOS and `Ctrl+Enter/Tab confirm` elsewhere.

### Tests

- Added component coverage for `Tab` confirmation in text, textarea, required textarea, and multiselect steps.
- Added App-level coverage for creating a task with a textarea description confirmed by `Tab`.
- Verified the fix manually in a real terminal PTY: task creation persisted the description after `Tab` confirmation.

## 1.0.24 (2026-05-19)

### New Features

- **Canonical `AgentEvent.data` contract** — documented per-type data shapes in `src/infrastructure/adapters/interface.ts`. Each adapter now has a single target shape for `output` (`{text}`), `tool_call` (`{name,input}`), `command` (`{command,result}`), `file_change` (`{paths}`), `error` (`{message}`) and `done` (`{result}`). Downstream consumers (TUI, `orch logs`, `serve` daemon) can render events without knowing adapter internals. Legacy adapters (claude/cursor/codex) still emit their native shapes during the migration window — the TUI renderer is defensive.

### Bug Fixes

- **Pi adapter: per-character text_delta flood** — pi RPC emits one `text_delta` per LLM stream chunk (often per-character). The adapter was forwarding each as its own `output` event, drowning the activity feed with character-level fragments. Now deltas aggregate into adapter-local state and the assembled text is flushed once on `text_end` as a single canonical `output` event.
- **Pi adapter: `[agent_start]` / `[turn_start]` placeholders in logs** — unknown pi RPC event types fell through a `default` case that emitted them as raw `output` events. The TUI renderer then displayed them as `[type_name]` placeholders. Unknown types are now dropped at the adapter boundary; adding a new known type is the right way to surface a new event.
- **Pi adapter: `tool_execution_update` noise** — pi emits one of these per chunk of streaming tool output (e.g. live bash stdout). No other adapter surfaces intermediate tool progress in its event stream. These are now dropped to keep the canonical contract uniform.
- **Pi adapter: `finalText` buffer never reset after `text_end`** — `state.finalText` was set to the assembled text after `text_end` but never cleared. A follow-up assistant turn in the same pi session would build on top of the previous message, double-emitting text and growing the buffer unboundedly across turns. Buffer now resets to `''` after each `text_end`.
- **Pi adapter: API error inside `agent_end.messages[]` ignored** (partial) — error event payloads now use canonical `{message, raw}` shape and are classified via `classifyAdapterError`. (Surfacing pi's `errorMessage` field nested inside the assistant message remains a follow-up.)

### Performance

- **`firstLineTrunc` fast path** — single-line input (the common case for agent events) short-circuits to a single `slice(0, n)`, skipping `split('\n')` + `find` + closure allocation. The slow path uses `/\S/.test(l)` instead of `l.trim().length > 0` to avoid allocating a trimmed copy just to test non-empty.
- **`summarizeToolResult` single split** — was splitting `content` twice (once for `lines.length`, once for `find`); now reuses one array.

### Refactoring

- **`extractToolResultText` delegates to `extractTextFromContent`** — pi tool results (`{content: [{type:'text', text}, …]}`) and pi message content (`{content: [{text}, …]}`) differ only by the outer `content` wrap. Collapsed 16 lines of duplicated walk-and-join logic to a single line that unwraps and delegates.
- **`firstLineTrunc` helper extracted in `App.tsx`** — replaces five copies of `s.split('\n')[0]?.slice(0, N) ?? s.slice(0, N)` (including a dead `??` fallback and incorrect handling of leading blank lines) across the new canonical-shape branches in `formatAgentOutput`.
- **Summary icons aligned with `MSG_ICONS`** — error glyph in canonical branch corrected from `✗` (U+2717) to `MSG_ICONS.error` (`✕`, U+2715); path glyph uses `MSG_ICONS.file` for consistency.

### Tests

- **Pi adapter contract tests updated** — `aggregates text_delta updates and emits one canonical output on text_end` replaces the old per-delta assertion. New test `drops tool_execution_update progress events (noise)` locks in the noise-drop behavior.
- **`pi-adapter.e2e.test.ts`** — feeds `text_delta` + `text_delta` + `text_end` sequence to exercise the aggregation path end-to-end through the Orchestrator.

## 1.0.23 (2026-05-19)

### New Features

- **Pi RPC adapter** ([#12](https://github.com/oxgeneral/ORCH/pull/12)) — sixth first-class adapter. Wraps `pi --mode rpc` (`@mariozechner/pi-coding-agent`) and exposes its JSONL event stream through the orchestrator's `AgentEvent` contract. Supports Pi's full provider matrix (OpenRouter, Anthropic, OpenAI Codex, Gemini, …) via the `--model "<provider>/<model>"` convention. Registered in `init` adapter detection, `doctor`, agent shop, TUI wizard models (`PI_MODELS`), and `EFFORT_ADAPTERS`. Agents-tab onboarding tip now lists all six adapters; a regression test asserts it stays in sync with `SUPPORTED_ADAPTERS`.

### Bug Fixes

- **Pi stream: abort/kill cleanup** — when the generator exits without a terminal `done` event (abort signal or stream error) the adapter now schedules `processManager.killWithGrace(pid, 1000)` from the `finally` block. The long-lived pi process is no longer pinned alive by dangling `'close'` / `'error'` listeners.
- **Pi stream: unhandled error before first line** — the stdout `for await` is wrapped in `try/catch`. Stream errors arriving before the first JSONL line (ECONNRESET, EPIPE, immediate crashes) are now classified via `classifyAdapterError` and yielded as an `error` `AgentEvent` instead of escaping as an unhandled rejection.
- **Pi stream: silent stderr** — `proc.stderr.resume()` (which drained but dropped data) is replaced by `createStderrTailCapture()`, retaining the last 4 KB of stderr. Auth and extension-load failures now surface in the error message on non-zero exit.
- **Dead branch in `extractPassiveUpdate`** — both arms of `state.finalText ? null : null` returned `null`; simplified to a single `return tokens ? { tokens } : null`. The unused `ParseState` argument is dropped.
- **`Buffer<ArrayBufferLike>` generic** — replaced with plain `Buffer | null` so the line reader compiles cleanly on the `^20.17.0` floor of `@types/node` (the generic only landed in `@types/node` 22+).
- **`as any` in test mock** — `pi-adapter.test.ts` casts the mock child process through `unknown as ChildProcess`. CLAUDE.md forbids `as any`.

### Performance

- **`readPiRpcLines`: O(n²) → O(n)** — replaced per-chunk `Buffer.concat([pending, buf])` (which copied the full accumulator each time) with the `chunks[] + totalLen + offset` pattern already used by `readLines()` in `process-manager.ts`. Concat once per chunk arrival, scan with an offset, subarray the remainder.
- **`createStderrTailCapture`: drop array-shift on overflow** — keeps a single backing `Buffer` and slices via `Buffer.from(buf.subarray(buf.length - LIMIT))` when oversized. `Buffer.from` materializes an exactly-sized copy so a single 64 KB stderr burst no longer pins the larger `ArrayBuffer` alive until GC.
- **Token alias lookup collapsed** — the eight `??` chains for `cacheRead`/`cache_read_input_tokens`/etc. became a single `PI_TOKEN_ALIASES` map with one `pick(keys)` helper. Same wire-compatibility, far fewer lines.

### Refactoring

- **`src/tui/onboarding-config.ts`** — extracted `ONBOARDING_GOALS`, `ONBOARDING_TASKS`, `ONBOARDING_AGENTS` out of `App.tsx`. The app and the regression test both import from the new module; `App.tsx` no longer needs to export internal constants for test access.

### Tests

- 260 new tests (1694 → 1954):
  - `test/unit/infrastructure/pi-adapter.test.ts` (20 tests) — adapter contract: arg list, prompt JSONL write, parsing of every Pi RPC event type (`extension_ui_request`, `message_update.text_delta`, `tool_execution_start`, `tool_execution_end` for `bash`/`write`/`edit`, large `agent_end`, `response` failure), stderr tail surfacing, abort-signal kill.
  - `test/integration/pi-adapter.e2e.test.ts` — full lifecycle through the real Orchestrator with a mocked spawn: dispatch → JSONL stream → state machine transitions `todo → in_progress → review → done` → tokens persisted on the Run → process termination via `killWithGrace`.
  - `test/integration/pi-tui.e2e.test.tsx` — same lifecycle through the Ink/React TUI via `ink-testing-library`: pi agent + adapter chip on the Agents tab, activity feed shows `text_delta` / `tool_call` / `file_changed` / done.
  - `test/unit/tui/onboarding-agents.test.ts` — invariant that every `SUPPORTED_ADAPTERS` entry appears in the Agents-tab onboarding description.
  - Parametrized rows for `pi` in `agent-factory.test.ts` (model resolution + MCP-skill filtering), `commands-init.test.ts` (`getDefaultAgents('pi')`), and `wizard-effort.test.ts` (`EFFORT_ADAPTERS` membership).

## 1.0.22 (2026-04-10)

### Refactoring

- **Unified text input system** — replaced three separate text input implementations (FormWizard text-step, InputPanel, command-bar) with a shared architecture inspired by Claude Code:
  - `text-cursor.ts` — immutable `Cursor` class with NFC normalization and `Intl.Segmenter`-based grapheme navigation (CJK, emoji, Cyrillic, combining marks)
  - `hooks/useTextInput.ts` — keyboard logic hook with undo stack (Ctrl+Z / Cmd+Z), kill ring (Ctrl+K/U/W/Y), word navigation (Option+Left/Right), and all terminal editing shortcuts
  - `components/TextInput.tsx` — display component with sliding viewport that keeps cursor visible on text overflow

### Bug Fixes

- **Cursor jumping on keyboard language switch** — NFC normalization in Cursor constructor prevents position drift when IME sends NFD-encoded characters during layout switching
- **Text overflow at screen edge** — single-line text inputs now use a sliding viewport instead of truncating from the end, keeping the cursor always visible
- **Undo stack over-drain** — debounced undo snapshots captured current state, causing Ctrl+Z to pop identical text with no visible effect; fixed by skipping one matching snapshot before applying undo
- **React anti-pattern in textarea** — `setTaCursorCol` was called inside a `setTaLines` updater function; moved out to prevent potential double-fire in concurrent mode
- **Timer leak on unmount** — undo debounce timer is now cleared via `useEffect` cleanup when the component unmounts mid-debounce

### Performance

- **Zero-cost cursor navigation** — arrow keys, Home/End, word navigation reuse existing grapheme segments via `Cursor._withPos()` factory instead of re-running `Intl.Segmenter` on unchanged text
- **Single-pass insert** — `Cursor.insert()` uses `graphemeSegments()` once instead of `graphemeLength()` + constructor re-segmentation
- **Render-path optimization** — `TextInput` reads `cursor.beforeSegs` / `cursor.afterSegs` directly, avoiding join + re-segmentation on every render

### New Features

- **Editing shortcuts** — Ctrl+A/E (start/end), Ctrl+K/U/W (kill operations), Ctrl+Y (yank), Ctrl+Z / Cmd+Z (undo), Cmd+Backspace (kill to start), Ctrl+B/F (left/right), Ctrl+D (delete forward), Ctrl+H (backspace), Home/End keys

### Tests

- 96 new tests (1829 → 1923):
  - `text-cursor.test.ts` (61 tests) — grapheme segmentation, NFC normalization, CJK/emoji/Cyrillic handling, cursor navigation, editing, kill operations, display width
  - `text-input.test.tsx` (33 tests) — E2E via ink-testing-library: FormWizard text-step input/submit, cursor navigation, backspace, all Ctrl shortcuts, Cyrillic/emoji/CJK input, undo, step transitions, validation

## 1.0.21 (2026-04-09)

### Bug Fixes

- **Parallel runs race condition** ([#8](https://github.com/oxgeneral/ORCH/issues/8)) — when multiple agents completed in parallel via `orch serve`, successful runs were falsely marked as `failed`. Root cause: reconcile detected dead PIDs before `handleRunSuccess` acquired the mutex, treating clean exits as crashes. Fix: `activeCollectors` guard prevents reconcile from interfering with tasks that have an active event collector. Also fixes orphaned runs stuck in `status: running` when the running entry was already cleaned up
- **Assignee name resolution** ([#7](https://github.com/oxgeneral/ORCH/issues/7)) — tasks assigned by agent name (e.g. `--assignee "Sam Altman"`) instead of agent ID were silently accepted but never dispatched. `TaskService.resolveAssignee()` now normalizes agent names to IDs at creation and assignment time, with clear error messages for unknown agents. `findBestAgent()` also matches by name as a fallback for legacy data

### Tests

- 15 new tests: activeCollectors guard (reconcile skip, crash detection, cleanup, orphaned run finalization), assignee name→ID resolution (create, assign, unknown name/ID, backward compatibility, findBestAgent name fallback)

## 1.0.20 (2026-04-03)

### Bug Fixes

- **Goal completion deadlock** — agents could not mark their own goal as `achieved` because the agent's running `[auto]` task blocked the pending-tasks guard. Autonomous tasks are now excluded from the check since they are the mechanism for achieving the goal, not a blocker
- **`paused → achieved` transition** — goals in `paused` state can now be directly marked as `achieved` without requiring a resume first. State machine updated: `paused → active | achieved | abandoned`
- **TUI force-complete** — pressing `C` on a goal in TUI now uses `force: true` to cancel cancellable pending tasks, with an informative status message. Previously it would silently fail if any non-terminal tasks existed

### Tests

- 4 new tests: autonomous task exclusion from pending check, non-auto task still blocks, `paused → achieved` with side effects, `paused → achieved` with force + pending tasks

## 1.0.19 (2026-04-02)

### Bug Fixes

- **Retry dispatch race condition** — fixed a race where a task could be re-dispatched from the retry queue after it had already succeeded. `dispatchTask()` now checks `isDispatchable(task.status)` before spawning, retry queue processing validates task status before dispatch, and `_handleRunFailure` skips if the running entry was already cleaned up by the success handler. This prevents zombie processes, false `tasks_failed` stats, and orphaned `preparing` runs
- **GitHub star count on landing page** — navbar and CTA now show live star count fetched from GitHub API

### Tests

- 5 new tests covering retry race condition guards (dispatch of done/cancelled/failed tasks, retry queue skip, failure handler race)

## 1.0.18 (2026-04-02)

### Features

- **Adapter-agnostic onboarding** ([#6](https://github.com/oxgeneral/ORCH/issues/6)) — `orch init` now auto-detects installed AI adapters (claude, opencode, codex, cursor) and lets you choose a default. Agent shop templates use semantic tiers (`balanced`, `capable`, `fast`) instead of hardcoded Claude model names, so agents are created with the correct model for your chosen adapter. Pass `--adapter <name>` to skip detection
- **Goal completion guard** — goals can no longer be marked `achieved` while linked tasks are still pending (`todo`, `in_progress`, `retrying`, `review`). Agents calling `orch goal status <id> achieved` will see a clear error listing the blocking tasks. Use `--force` to cancel pending tasks and force the transition (skips `in_progress` tasks with live processes)

### Fixes

- **MCP skills filtered for non-Claude adapters** — agent shop templates and TUI wizard now strip MCP skills (colon-format like `testing-suite:generate-tests`) when the default adapter is not Claude, since MCP skills only work with the Claude CLI
- **Cursor agent probe false-positive** — `orch init` adapter detection no longer probes the generic `agent` binary (too common on systems), only `cursor-agent`
- **TUI refresh after status change** — fixed a race condition where `entityListChanged()` compared tasks by `updated_at` timestamp, causing refresh no-ops when initial and updated tasks had identical timestamps

### Tests

- 32 new tests: goal pending-tasks validation (10), model tier resolution (8), agent factory (5), adapter-agnostic init (4), MCP skill filtering (3), TUI refresh fix (2)

## 1.0.16 (2026-03-29)

### Bug Fixes

- **TUI: external tasks and goals now appear immediately** — when tasks or goals are created by external processes (`orch task add`, `orch goal add`, Claude Code `/orch` skill), the TUI now picks them up within 5 seconds. Previously, in watch mode the TUI only refreshed on in-process EventBus events, so externally created entities were invisible until the orchestrator dispatched them
- **Proof detection for Claude agents** — Claude adapter emits `tool_use` events (Write, Edit, MultiEdit, NotebookEdit) but no `file_change` events. The orchestrator now extracts file paths from tool_call data and populates `proof.files_changed`, fixing empty proof for all Claude-backed agents. Also emits real-time `agent:file_changed` events for TUI visibility
- **Orphaned preparing runs** — runs stuck in `preparing` status (caused by a crash between `runService.create()` and `runService.start()`) are now detected and cancelled at startup. Previously these ghost runs stayed in `preparing` forever and appeared in `orch logs` as unfinished
- **`orch logs --since` without filter** — `orch logs --since 3h` now works without requiring `--task`, `--agent`, or a run ID. Shows all recent runs within the time window with a truncation notice when >20 runs match
- **Per-agent stall timeout** — reconcile now uses the agent's `config.stall_timeout_ms` when set, falling back to the global default. Previously all agents were killed at the global 10-minute mark regardless of per-agent configuration

### Improvements

- **Parallel agent pre-fetch in reconcile** — agent data is now fetched in parallel alongside task data during the reconcile phase, avoiding sequential reads
- **No-op render guard** — periodic disk poll now skips React state updates when entity data hasn't changed, preventing unnecessary re-renders every 5 seconds in idle state

### Tests

- 14 new tests covering all four bug fixes: proof detection from tool_call events (3), orphaned preparing runs cleanup (3), `orch logs --since` all-runs mode (6), per-agent stall timeout (2)
- Shared `cleanupOrch` helper extracted to `test/unit/application/helpers.ts` (was duplicated 6×)
- Added missing `listAll` to `createMockRunStore` mock

## 1.0.14 (2026-03-27)

### Features

- **Reasoning effort setting** — new `effort` field for agents (`low`, `medium`, `high`) controls how deeply the model reasons. Available via CLI (`--effort`), TUI wizard (step after model selection with descriptions), and programmatic API. Currently supported by the Claude adapter only
- **TUI effort step** — interactive wizard shows the effort selector right after model choice, with hints for each level. Automatically skipped for adapters that don't support it

### Fixes

- **Claude CLI flag name** — fixed `--reasoning-effort` → `--effort` to match the actual Claude CLI flag. Previously caused agents with effort set to crash with exit code 1
- **Codex effort removed** — Codex CLI does not support `--reasoning-effort`; removed the flag to prevent spawn failures

### Docs

- **ORCH skill updated** — added `--effort` to CLI reference, usage tips for effort levels, and new "When to Use Goals vs Tasks" section with concrete criteria and examples (single action → Task, multi-step decomposition → Goal, iterative metric-driven improvement → Goal)

### Tests

- 23 new tests covering effort across all layers: domain model, agent service (create/update), Claude adapter (`--effort` flag), TUI wizard (step visibility, skip logic, input mapping, edit pre-fill)

## 1.0.13 (2026-03-24)

### Features

- **TUI Observer Mode** — when another process holds the orchestrator lock (`orch run --watch`, `orch serve`, or the `orch` skill in Claude Code), the TUI now enters **OBSERVING** mode instead of showing a dead IDLE screen. The new `DiskObserver` polls `state.json` and tails run JSONL files to deliver the same real-time activity stream as the in-process orchestrator
- **Full cross-process event visibility** — observer mode shows agent output, file changes, errors, tool calls, lifecycle events (started/completed), task status transitions, and orchestrator ticks — identical to the native TUI experience
- **OBSERVING header badge** — amber `● OBSERVING` chip replaces the red error message, clearly indicating the TUI is connected to an external orchestrator

### Fixes

- **DiskObserver JSONL tailing silent failure** — `state.running` keys are taskIds, not runIds. DiskObserver was using keys as JSONL file paths, causing ENOENT on every read (silently caught). Observer mode showed only tick events. Fixed to use `entry.run_id`

### Improvements

- **Byte-offset JSONL tailing** — DiskObserver tracks per-run byte offsets with partial-line buffering, reading only new bytes each tick. Handles mid-line splits across poll boundaries correctly
- **Concurrent poll guard** — prevents race conditions when a poll tick takes longer than the poll interval
- **Stale-refresh dedup** — periodic state refresh in observer mode skips if an event-driven refresh already ran recently, avoiding redundant disk reads
- **Remainder cap** — partial JSONL line buffer is capped at 64KB to prevent unbounded memory growth on stalled writes

### Tests

- 15 new tests: 11 unit tests for DiskObserver (event translation, byte offsets, partial lines, error handling, unsubscribe), 4 integration tests (full lifecycle, failed runs, concurrent runs, orchestrator restart detection)
- Battle test script simulating real cross-process orchestration with 5 runs and 44 events

## 1.0.11 (2026-03-23)

### Features

- **Background auto-install** — when a new version is detected, ORCH automatically downloads and installs it via `npm install -g` in the background. No restart is forced — the user continues working undisturbed
- **TUI restart prompt** — header chip changes from `UPDATE 1.0.11` to `v1.0.11 INSTALLED — RESTART TO APPLY` after background install completes
- **CLI auto-install** — after printing update notification, CLI commands trigger background install so the next launch uses the new version
- **Serve auto-install** — headless daemon auto-installs and logs `update:installed` event for operators

### Improvements

- **Install dedup** — marker file (`~/.orchestry/update-installed.json`) prevents re-installing the same version within the 4-hour check cycle
- **Reliable install completion** — removed `child.unref()` from install process so short-lived CLI commands don't exit before npm finishes

## 1.0.10 (2026-03-23)

### Fixes

- **Worktree collision on retry** — `prepareWorktree()` is now idempotent: reuses existing worktree directory on retry, falls back to `git worktree add` without `-b` when branch already exists, runs `git worktree prune` only on the fallback path. Eliminates `git worktree add failed with code 255` errors
- **proof.files_changed always empty for Claude adapter** — added `getChangedFiles()` to WorkspaceManager that uses `git merge-base` + `git diff --name-only` as fallback when the adapter doesn't emit `file_change` events. Works with any trunk branch name (no hardcoded `main`)
- **`orch run --watch` exits after first tick** — added missing `await orchestrator.waitForStop()` so the process stays alive for continuous orchestration
- **`--verbose` flag missing on `orch run`** — added `--verbose` option; agent output is suppressed by default in watch mode (consistent with `orch serve`)
- **Auto-goal creation spam** — autonomous agents are now forbidden from creating new goals via system prompt constraints; 30-second cooldown between auto-seed tasks per agent prevents rapid re-seeding
- **`task:cascade_failed` event not handled** — added to TUI activity feed (red error message) and structured logger (warn-level entry)

### Improvements

- **WorkspaceManager refactored** — `spawnAndWait()` and `spawnAndCapture()` helpers replace all inline promise-wrapping; `requireGitRepo()` and `cleanup()` simplified; `prepareIsolated()` uses absolute path instead of cwd-relative `'.'`
- **Cascade-fail cache consistency** — both call sites (dispatch + collect) now invalidate task cache before cascade to ensure fresh data

## 1.0.9 (2026-03-22)

### Fixes

- **WorkspaceError retry** — workspace errors no longer force-fail tasks on first attempt. Now respects `max_attempts` with exponential backoff via retry queue, matching the behavior of agent execution failures
- **Cascade-fail dependent tasks** — when a task permanently fails (max_attempts exhausted), all direct and transitive dependents are automatically failed with `task:cascade_failed` event. Prevents dependent tasks from hanging as TODO forever
- **Update notifications — cold start** — `checkForUpdateSWR()` now awaits the npm fetch on first run (up to 5s) instead of returning null. Users see the update notification on their very first command, not the second
- **Update notifications — TUI re-check** — if initial update check returned null, TUI retries after 5 seconds via `onCheckUpdate` callback and updates the header chip dynamically
- **Update notifications — orch serve** — added background update check at startup with structured logger output (`update:available` warning), so server operators see updates in JSON/text logs
- **Postinstall test** — fixed test referencing `postinstall.js` instead of `postinstall.cjs`

### Improvements

- **Cascade-fail algorithm** — uses reverse-dependency index (`Map<parentId, Task[]>`) for O(1) lookup per BFS node instead of O(n) linear scan; parallel `Promise.all` saves instead of sequential; no in-memory mutation of shared task objects
- **CLAUDE.md** — added Skill Library and Serve Mode architecture sections

## 1.0.8 (2026-03-22)

### Features

- **Skill Library** — 26 expert methodology skills adapted from gstack, stored as Markdown files in `skills/library/`. Skills are automatically loaded and injected into agent system prompts at dispatch time. Works with all adapters (claude, opencode, codex, cursor, shell)
- **Two skill types** — library skills (plain names like `review`, `investigate`) inject content into prompts; MCP skills (colon-separated like `feature-dev:code-explorer`) are handled natively by Claude CLI
- **SkillLoader** — new infrastructure component with process-lifetime cache, parallel reads via `Promise.all`, path traversal prevention, and lazy async directory resolution

### Skills Catalog

| Category | Skills |
|----------|--------|
| Code Review & QA | `review`, `qa`, `qa-only`, `investigate`, `careful`, `guard` |
| Planning | `plan-ceo-review`, `plan-eng-review`, `plan-design-review`, `autoplan`, `office-hours` |
| Design | `design-consultation`, `design-review` |
| Shipping | `ship`, `land-and-deploy`, `canary`, `document-release` |
| Infrastructure | `browse`, `benchmark`, `setup-deploy`, `setup-browser-cookies` |
| Safety | `careful`, `freeze`, `unfreeze`, `guard` |
| Cross-AI | `codex` |
| Meta | `upgrade`, `retro` |

### Improvements

- **Agent Shop upgraded** — all 15 agent templates now include library skills with updated role prompts referencing skill methodologies (review, investigate, benchmark, ship, etc.)
- **Agent Creator updated** — knows full skill catalog with library vs MCP distinction, guides auto-created agents to use appropriate skills
- **`/orch` skill documentation** — expanded with complete Skill Library section listing all 26 library skills and 13 MCP skills
- **Programmatic API** — `ISkillLoader` and `SkillLoader` exported from `@oxgeneral/orch` for library consumers

### Tests

- 21 new tests: SkillLoader unit tests (14), orchestrator skill injection (13), agent shop skill validation (8)

## 1.0.7 (2026-03-21)

### Features

- **Claude Code `/orch` skill** — after `npm install`, the `/orch` slash command is automatically registered in Claude Code. Describe what you need in natural language and Claude translates it into the right `orch` CLI commands
- **Postinstall auto-registration** — skill file is copied to `~/.claude/skills/orch/` during install with change detection (only writes when content differs)

### Improvements

- **Postinstall script** — renamed to `.cjs` for ESM package compatibility, hoisted requires to module scope, removed TOCTOU patterns

## 1.0.6 (2026-03-20)

### Fixes

- **Worktree branch cleanup** — `git branch -D` now runs on worktree cleanup, preventing `code 255` errors on task retry (BUG-1)
- **Stale claimed recovery** — `state.claimed` is cleared on orchestrator restart so tasks are no longer stuck after crash (BUG-2, BUG-7)
- **Stall timeout default** — increased from 5 min to 10 min to reduce false failures on complex prompts (BUG-3)
- **`orch serve` logging** — fixed premature logger unsubscribe that caused silence after first tick; added `waitForStop()` lifecycle method (BUG-4)
- **Worktree error handling** — `prepareWorktree()` now throws `WorkspaceError` so tasks are properly force-failed instead of silently stuck (BUG-5)
- **Stale lock detection** — lock file mtime is touched every tick; `acquireLock()` treats untouched locks (>60s) as stale even if PID is recycled (BUG-6)

### Performance

- **Parallel cleanup** — `git branch -D` and `fs.rm` now run concurrently via `Promise.all` during worktree cleanup
- **Lock heartbeat** — `touchLock()` uses `Date.now() / 1000` instead of `new Date()` to avoid per-tick heap allocation

## 1.0.5 (2026-03-17)

### Features

- **`orch serve` — headless daemon mode** — run the orchestrator as a background process for 24/7 operation on servers. Compatible with pm2 and systemd
  - Structured JSON logging to stdout (machine-parseable for Datadog, Grafana Loki, `jq`)
  - `--log-format text` for human-readable output
  - `--once` mode for CI/CD — process all todo tasks and exit (exit 0 = all done, exit 1 = failures)
  - `--log-file <path>` — tee logs to file in addition to stdout
  - `--verbose` — include high-frequency `agent:output` events (off by default)
  - `--tick-interval <ms>` — override polling interval
  - Heap memory monitoring in tick events for 24/7 stability tracking
  - Idle tick throttling — logs every 6th idle tick to reduce noise
  - Graceful shutdown on SIGINT/SIGTERM — waits for running agents, saves state, releases lock
  - Lock conflict detection — clear error when another orchestrator is already running

### Architecture

- `StructuredLogger` class (`src/cli/serve/structured-logger.ts`) — transforms `OrchestratorEvent` union into flat JSON/text log records
- `runOnce()` function (`src/cli/serve/once-runner.ts`) — polls for task completion with orchestrator shutdown safety
- `startWatch()` now accepts `{ skipAutonomousSeeding }` option — keeps CLI concerns out of the orchestrator

## 1.0.4 (2026-03-15)

### Fixes

- **Restart safety** — orphaned tasks on restart are now cancelled instead of retried, preventing agents from re-executing already committed work
- **FTUE parent leak** — `orch` in a new folder no longer picks up a parent directory's `.orchestry/` project
- **Activity feed** — history now loads correctly on startup (sort by recency, filter cancelled runs, log errors instead of silently swallowing)

## 1.0.3 (2026-03-15)

### Features

- **Reasoning & cache token tracking** — `TokenUsage` now tracks `reasoning`, `cache_read`, `cache_write` separately. Reasoning included in total; cache tokens are informational (subset of input). TUI shows 🧠 when reasoning > 0
- **Daemon mode architecture** — design doc for sub-10ms CLI responses via persistent background process

### Performance

- **IndexManager** — extracted generic `IndexManager<T>` with `_index.json` cache for all stores (TaskStore, AgentStore, ContextStore, GoalStore, MessageStore). List operations read one file instead of N
- **Parallel container init** — `requireInit()` + `configStore.read()` run in parallel during CLI startup
- **Buffered CLI output** — `printTable`/`printKeyValue` buffer into single `process.stdout.write` call
- **Orchestrator tick** — parallel reconcile checks, `findProjectRoot` caching, lazy globalConfig + editor loading
- **Lazy requireInit** — removed redundant `requireInit()` calls in read-only commands

### Fixes

- **IndexManager mutex** — promise-chain mutex prevents TOCTOU race on concurrent index reads/writes
- **Re-entrant deadlock** — `rebuildIndex` no longer deadlocks when called within an existing lock
- **Token simplification** — use `createTokenUsage` single source of truth, `TokenUsage` type instead of inline duplicates, `useMemo` for TUI header tokens

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
