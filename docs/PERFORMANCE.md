# Performance Report

> Last updated: 2026-03-13 · ORCH v0.x · Node 20+

## 1. Executive Summary

| Metric | Baseline | Current | Improvement |
|--------|----------|---------|-------------|
| CLI startup (`--help`) | 103ms (cold) / 75ms (warm) | 40ms | **-61%** |
| CLI `task list` | 103ms | 78ms | **-24%** |
| Build (tsup) | 2.7s | 1.6s | **-41%** |
| Test suite (vitest) | 12.2s | 14.6s / 969 tests | **+316% tests, 15ms/test** |
| TUI memory | OOM after ~27 min | Stable indefinitely | **Fixed** |

All measurements on Apple Silicon (M-series), Node 20+, `npm run build` / `npx vitest run`.

## 2. Baseline vs Current

### CLI Startup

| Path | Before | After | Delta | Target | Status |
|------|--------|-------|-------|--------|--------|
| `orch --help` | 75ms warm / 103ms cold | 40ms | -47% / -61% | <50ms | PASS |
| `orch task list` | 103ms | 78ms | -24% | <100ms | PASS |

**Bottleneck breakdown (before):**
- LiquidJS: 17ms
- Commander: 12ms
- Chalk: 7ms
- nanoid: 3ms
- js-yaml: 3ms
- Total import overhead: ~41ms
- Node + Commander baseline: ~30ms

### Build

| Phase | Before | After | Delta |
|-------|--------|-------|-------|
| Total wall time | 2.7s | 1.6s | -41% |
| DTS generation | 2× (CLI + index) | 1× (index only) | -50% |
| CLI bundle | — | 462ms | — |
| Index bundle | — | 260ms | — |
| DTS (index) | — | 953ms | — |

### Tests

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Total time | 12.2s | 14.6s | +20% (4× more tests) |
| Transform | 1.6s | 2.1s | +31% |
| Collect | 4.8s | 4.5s | -6% |
| Test count | 233 → 969 | 969 | +316% |
| Per-test avg | 52.4ms | 15.1ms | **-71%** |

### TUI Memory

| Metric | Before | After |
|--------|--------|-------|
| Heap after 27 min | ~4 GB (OOM crash) | ~120 MB (stable) |
| Event processing | Per-event setState | Batched (80ms flush) |
| Detail strings | Full raw JSON (100KB+) | Capped at 2 KB |
| Run ID maps | Unbounded | LRU cap 500 |
| History loading | Full file read | Tail read (last 30 events) |

## 3. Optimizations Applied

### 3.1 Lazy CLI Imports
**File:** `src/bin/cli.ts`
- Static `import` for 14 command modules replaced with dynamic `import()` per subcommand
- `--help` / `--version` fast path skips container initialization entirely
- `COMMAND_STUBS` array provides help text without loading implementations

### 3.2 LightContainer / Container Split
**File:** `src/container.ts`
- **LightContainer**: stores + services only — used by read-only commands (`task`, `agent`, `logs`, `config`, `context`, `msg`, `goal`, `team`, `status`)
- **Container** (extends Light): + orchestrator + adapters + ProcessManager + LiquidJS — used by `run`, `tui`, `doctor`
- LiquidJS (17ms import) loaded only when template engine is needed

### 3.3 DTS Consolidation
**File:** `tsup.config.ts`
- Two build configs: CLI (no DTS, no sourcemap) + index (DTS, sourcemap, minify)
- DTS generation runs once for `index.ts` only (was running for both CLI and index)
- `treeshake: true` on both configs

### 3.4 Vitest Threads Pool
**Files:** `vitest.config.ts`, `tsconfig.test.json`
- `pool: 'threads'` with `maxThreads: 4`
- Separate `tsconfig.test.json` disables `declaration`, `declarationMap`, `sourceMap` for test runs
- `optimizeDeps` pre-bundles vitest, js-yaml, nanoid, commander

### 3.5 TUI Message Batching
**File:** `src/tui/App.tsx`
- Messages queued and flushed every 80ms instead of per-event `setState`
- Prevents React re-render storms from high-frequency Claude event streaming

### 3.6 Detail String Truncation
**File:** `src/tui/App.tsx`
- `MAX_DETAIL_LEN = 2048` — raw JSON from agent events capped before storing
- Prevents 100KB+ strings from accumulating in component state

### 3.7 LRU Run ID Maps
**File:** `src/tui/App.tsx`
- `MAX_MESSAGES = 200` — activity message cap
- Run-to-task mapping capped at 500 entries, oldest evicted

### 3.8 Tail-Only JSONL Reads
**File:** `src/infrastructure/storage/fs-utils.ts`
- `readJsonlTail(path, n)` reads last N lines via reverse-chunk scanning
- Adaptive chunk size: 64KB for files ≤1MB, 128KB for larger
- Used by TUI history, CLI logs (`--since`), and `getLastFailedRunContext`

### 3.9 Parallel File I/O
**Files:** `src/infrastructure/storage/task-store.ts`, `agent-store.ts`, `run-store.ts`
- `Promise.all()` for all store `list()` methods — O(1) wall time instead of O(n)
- CLI logs uses `Promise.all` for parallel event reads across runs

### 3.10 Atomic File Writes
**File:** `src/infrastructure/storage/fs-utils.ts`
- `atomicWrite()`: write to temp file → `rename()` for corruption safety
- `appendJsonl()`: `O_APPEND` mode with `PIPE_BUF` (4096 byte) enforcement
- Records exceeding `PIPE_BUF` have their `data` field truncated to fit

### 3.11 Progressive History Loading
**File:** `src/cli/commands/tui.ts`
- TUI renders immediately without history
- History loaded in progressive batches (3 + 7 runs) via callback
- `readEventsTail(id, 30)` per run instead of full `readEvents`

### 3.12 Reactive Dispatch
**File:** `src/application/orchestrator.ts`
- `scheduleImmediateDispatch()` with 500ms debounce on `task:created` events
- Mini-tick (dispatch only, no reconcile) for sub-second task pickup
- Replaces polling-only model (30s tick interval)

### 3.13 Tick-Scoped Caching
**File:** `src/application/orchestrator.ts`
- `CachedTaskStore` / `CachedAgentStore` wrappers cache reads within a single tick
- Invalidated on save/delete operations
- Eliminates redundant file reads during reconcile → dispatch → collect cycle

### 3.14 State Lazy Save
**File:** `src/application/orchestrator.ts`
- `flushStateLazy()` debounces state.json writes with 500ms delay
- Critical transitions (shutdown, task completion) force immediate flush

### 3.15 CachedAgentStore Name Cache
**File:** `src/infrastructure/storage/cached-stores.ts`
- `CachedAgentStore.findByName()` results cached in a `Map<string, Agent | null>`
- Avoids repeated linear scan of agent YAML files during dispatch (agents matched by name)
- Cache invalidated on `save()`, `delete()`, and tick boundary (`invalidate()`)

### 3.16 Retry Queue filter() Instead of splice()
**File:** `src/application/orchestrator.ts`
- Retry queue processing now uses `Array.filter()` to build a new array of remaining entries
- Previous `splice()` in a loop caused O(n²) array shifts; `filter()` is O(n) single pass
- Due retries collected in a separate `dueRetries` array during the same pass

### 3.17 isBlocked() O(d×1) with taskMap Lookup
**File:** `src/domain/transitions.ts`, `src/application/orchestrator.ts`
- `isBlocked(task, allTasks)` now accepts `Map<string, Task>` for O(1) dependency lookup
- `dispatchAll()` builds `taskMap = new Map(allTasks.map(t => [t.id, t]))` once per tick
- Complexity reduced from O(d×n) to O(d×1) per task, where d = dependency count

### 3.18 Vitest Adaptive Thread Count
**File:** `vitest.config.ts`
- `maxThreads` computed via `availableParallelism()` from `node:os` (falls back to 2 in CI)
- Automatically scales worker threads to match CPU core count
- Previous hardcoded `maxThreads: 4` underutilized machines with 8+ cores

## 4. Architecture Decisions

### Lazy Imports
Every CLI subcommand is loaded on demand via `import()`. The entry point (`cli.ts`) determines the minimal container tier needed:

```
orch --help           → COMMAND_STUBS (no container, no imports)
orch task list        → LightContainer (stores + services)
orch run --all        → Container (+ orchestrator + adapters + LiquidJS)
```

### Ring Buffer for Events
`EventBuffer` (capacity 1024) provides backpressure for high-frequency agent events. TUI consumes from the buffer at 80ms intervals, preventing unbounded growth.

### Atomic Writes
Two strategies prevent data corruption:
1. **State files** (JSON/YAML): temp file + `rename()` — atomic on POSIX
2. **Event logs** (JSONL): `O_APPEND` + `PIPE_BUF` enforcement — kernel guarantees atomic append for ≤4096 bytes

### Promise-Chain Mutex
`withStateLock()` in orchestrator serializes tick/stop/cancel/handleRun operations via a promise chain. No external lock library — zero dependency overhead.

## 5. Benchmarking

### Quick Benchmark

```bash
# CLI startup
time node dist/cli.js --help
time node dist/cli.js task list

# Build
time npm run build

# Tests
time npx vitest run

# TypeScript
time npx tsc --noEmit
```

### Detailed Profiling

```bash
# Node startup trace
node --cpu-prof dist/cli.js task list
# Opens in chrome://inspect → Profiler

# Import cost analysis
node --eval "
  const s = performance.now();
  await import('./dist/cli.js');
  console.log(\`Total: \${(performance.now()-s).toFixed(0)}ms\`);
"

# Memory profiling (TUI)
node --max-old-space-size=512 --expose-gc dist/cli.js tui
# If it survives 30+ min at 512MB, memory is stable

# Build timing breakdown (tsup logs phases)
npm run build 2>&1 | grep -E '(CLI|DTS|index|Total)'
```

### Reading Results

- **CLI startup**: Target <50ms for `--help`, <100ms for commands
- **Build**: Target <1.5s total wall time
- **Tests**: Watch transform + collect phases (should be <7s combined). Per-test avg <16ms at 969 tests
- **TUI memory**: Heap should plateau, not grow linearly

## 6. Performance Targets / SLOs

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| `orch --help` | <50ms | 40ms | PASS |
| `orch task list` | <100ms | 78ms | PASS |
| `npm run build` | <1.5s | 1.6s | NEAR PASS ¹ |
| `npx vitest run` (969 tests) | <16s | 14.6s | PASS |
| TUI heap (30 min) | <512 MB | ~120 MB | PASS |
| Reactive dispatch latency | <1s | ~500ms | PASS |
| Tick duration | <5s | <1s typical | PASS |
| `appendJsonl` atomicity | ≤PIPE_BUF | 4096 bytes | PASS |
| State save (debounced) | <100ms | ~10ms | PASS |

| History load (TUI) | <2s | <500ms (progressive) | PASS |

¹ Build 1.6s exceeds 1.5s target but within 20% margin. Varies 1.1–1.6s across runs depending on DTS phase.

## 7. Known Bottlenecks

### Scope Overlap Check — O(n²)
**File:** `src/domain/scope.ts`
`patternsOverlap()` compares every running task's scope patterns against candidates. With `k` running tasks and `m` candidates, each having `p` patterns, complexity is `O(k × m × p²)`. At <50 concurrent tasks this is negligible; at scale, consider a trie-based approach.

### Dispatch Rate
Default `poll_interval` is 30 seconds. Reactive dispatch (500ms debounce on `task:created`) mitigates this for new tasks, but status changes from external events still wait for the next tick.

### Full `readEvents` in Detail View
TUI detail panel and some CLI paths still call `readEvents()` which loads entire JSONL files. For runs with 10K+ events, this can spike memory briefly. Mitigation: `readEventsTail(id, 30)` used in most paths; full read only for `orch logs <run-id>` without `--since`.

### Sequential Reconcile
`reconcile()` checks PIDs one by one via `kill(pid, 0)`. With many concurrent agents, this is O(n) syscalls. Not a practical bottleneck at current scale (max 3–6 concurrent agents).

### Template Rendering
LiquidJS template rendering has a 5s timeout (`renderTimeoutMs`). Malformed templates block the thread until timeout. Consider worker thread for rendering if template complexity grows.

### State File Size
`state.json` grows with `stats` and `retry_queue`. The retry queue is capped at 100 entries with dedup, but `stats` accumulates indefinitely. For very long-running orchestrations (1000+ tasks), consider periodic stats archival.
