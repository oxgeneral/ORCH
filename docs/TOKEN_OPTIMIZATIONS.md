# Token Consumption Optimizations

> Last updated: 2026-03-14 · ORCH v0.3.4

This document describes all optimizations that reduce API token consumption when orchestrating AI agents (Claude, Codex, Cursor, OpenCode, etc.). Token usage is the primary cost driver — every character in prompts and agent output costs money.

## Executive Summary

| Optimization | Impact | Where |
|-------------|--------|-------|
| System/User prompt split + caching | **~40-60% fewer input tokens** on repeat runs | template-engine.ts, claude.ts |
| Context relevance filtering | **~70% fewer context tokens** (top 15 entries by score) | template-engine.ts |
| Event data truncation pipeline | **3-layer cap**: 16KB → 8KB → 4KB | process-manager.ts, orchestrator.ts |
| JSONL PIPE_BUF enforcement | **4KB max** per event record | fs-utils.ts |
| Conditional prompt sections | **~40% template** skipped for fresh tasks | template-engine.ts |

**Combined effect**: significant reduction in average prompt size compared to naive "send everything" approach.

> **Design principle**: optimizations must not silently lose data that agents need. Filtering by relevance is OK; hard truncation of values is not. See [Reverted Optimizations](#reverted-optimizations) for details.

---

## 1. Prompt Architecture: System/User Split

**Files**: `src/infrastructure/template/template-engine.ts:336-451`, `src/application/orchestrator.ts:793-862`, `src/infrastructure/adapters/claude.ts`

### Problem
Sending the full prompt (agent identity + rules + CLI reference + task details) as a single block prevents Claude API from caching the static portions. Every run re-sends identical instructions.

### Solution
Prompts are split into two templates:

| Template | Content | Changes between runs? |
|----------|---------|----------------------|
| `DEFAULT_SYSTEM_TEMPLATE` | Agent identity, CLI commands reference, autonomous mode rules | **No** (static per agent) |
| `DEFAULT_USER_TEMPLATE` | Task details, retry context, team list, shared context, messages, goal | **Yes** (dynamic per task) |

```
┌─────────────────────────┐
│   SYSTEM PROMPT         │ ← Cached by Claude API (prompt caching)
│   - Agent identity      │    Sent once, reused across runs
│   - CLI reference       │
│   - Autonomous rules    │
│   - General rules       │
├─────────────────────────┤
│   USER PROMPT           │ ← Changes every run
│   - Task title/desc     │
│   - Retry context       │
│   - Team listing        │
│   - Shared context      │
│   - Inbox messages      │
│   - Goal details        │
└─────────────────────────┘
```

### Implementation
- **Claude adapter**: receives `systemPrompt` and `prompt` as separate parameters, passes `--system-prompt` flag to Claude CLI. The Claude API caches the system prompt between runs.
- **Other adapters** (Codex, Cursor, Shell, OpenCode): combine via `buildFullPrompt()` since they lack native system prompt support.
- **Legacy mode**: if user configured a single `prompt.template` in config, falls back to combined mode for backward compatibility.

### Token Savings
The system template is ~800 tokens. With prompt caching, this is charged at ~10% cost after the first run. For a typical orchestration session with 50+ runs, this saves **~36,000 input tokens** (800 × 50 × 0.9).

---

## 2. Shared Context Filtering

**File**: `src/infrastructure/template/template-engine.ts:119-210`

### Problem
The orchestrator accumulates hundreds of shared context entries over time (`.orchestry/context/` can grow to 340+ entries, 1.3 MB). Injecting all of them into every agent prompt wastes tokens on irrelevant information.

### Solution
`filterRelevantContext()` scores each context entry by relevance to the current agent/task and returns only the top entries. Values are passed through without truncation to preserve full information for agents.

### Scoring Algorithm

| Priority | Criterion | Score | Example |
|----------|-----------|-------|---------|
| 1 | Goal ID match | +10 | Key starts with agent's goal ID |
| 2 | Agent name mention | +8 | Key or value contains "Backend A" |
| 3 | Scope path match | +6 | Key/value mentions `src/application/` (task scope) |
| 4 | Role-prefix match | +4 | Key starts with `backend-` for Backend agents |
| 5 | Generic project tag | +1 | Keys like `bug-*`, `perf-*`, `stability-*` |

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_CONTEXT_ENTRIES` | 15 | Max entries injected per prompt |

### How It Works

1. All context entries scored against current agent's name, role, goal, and task scope
2. Entries sorted by score descending
3. Top 15 entries selected (all with score > 0, padded with score-0 if under 15)
4. Values passed through as-is (no truncation — agents get full data)

### Token Savings
With 340 context entries averaging 400 chars each: naive approach = ~136,000 chars (~34K tokens). Filtered: 15 entries (most relevant) ≈ 6,000 chars (~1.5K tokens). **~96% reduction** through filtering alone.

---

## 3. Three-Layer Event Data Truncation

**Files**: `src/infrastructure/process/process-manager.ts:84-93`, `src/application/orchestrator.ts:41-44, 1012-1046, 1507-1515`

### Problem
Agent adapters emit events with raw data (JSON objects, code blocks, error traces). Single events can exceed 100KB. These events are stored in JSONL logs and may be re-read for retry context.

### Solution: Progressive Truncation Pipeline

```
Agent stdout → capLine(16KB) → serializeEventData(8KB) → EventBus(4KB) → TUI(2KB)
```

| Layer | Constant | Value | Purpose |
|-------|----------|-------|---------|
| 1. Process Manager | `MAX_LINE_LEN` | 16,384 bytes | Cap raw stdout lines |
| 2. JSONL Serializer | `MAX_EVENT_DATA_LEN` | 8,192 bytes | Truncate before disk write |
| 3. Event Bus | `MAX_BUS_DATA_LEN` | 4,096 bytes | Cap for in-memory TUI consumption |
| 4. TUI Display | `MAX_DETAIL_LEN` | 2,048 bytes | Cap for React component state |

### Implementation Details
- `serializeEventData()` converts event to JSON string, then truncates with `…` suffix
- Parsed object set to `undefined` after serialization for early GC
- `capLine()` uses O(n) concat-free line splitting (no `readline.createInterface`)

### Token Savings
Primary impact on retry context and logs — prevents multi-KB events from inflating prompts.

---

## 4. JSONL Atomic Append with Size Enforcement

**File**: `src/infrastructure/storage/fs-utils.ts:84-128`

### Problem
Event records exceeding POSIX `PIPE_BUF` (4096 bytes) lose atomicity guarantees on concurrent writes, and large records waste storage that feeds into retry context.

### Solution
`appendJsonl()` enforces PIPE_BUF limit:
```typescript
const PIPE_BUF = 4096;
// If record exceeds PIPE_BUF, truncate data field to fit
```

When a serialized JSONL record exceeds 4096 bytes, the `data` field is truncated to fit within the atomic write boundary. This adds `…` suffix to indicate truncation.

---

## 5. Conditional Prompt Sections

**File**: `src/infrastructure/template/template-engine.ts:381-451`

### Design
The user prompt template uses Liquid conditionals to omit empty sections entirely:

```liquid
{% if attempt %}Attempt: {{ attempt }}{% endif %}
{% if retry %}## Previous attempt failed ...{% endif %}
{% if feedback %}## Review Feedback ...{% endif %}
{% if shared_context %}## Shared Context ...{% endif %}
{% if messages %}## Inbox ...{% endif %}
{% if goal %}## Goal ...{% endif %}
```

### Token Savings
A fresh task with no retry, no feedback, no messages, and no goal skips ~40% of the template. Only task details, project context, and team listing are rendered.

---

## 6. Role Keywords Extraction

**File**: `src/infrastructure/template/template-engine.ts:214-240`

### Purpose
`extractRoleKeywords()` maps agent names/roles to short keyword sets for efficient context filtering:

| Agent Name | Keywords |
|-----------|----------|
| "Backend A" | `["backend"]` |
| "QA B" | `["qa"]` |
| "Front-End" | `["front-end", "frontend", "tui"]` |
| "Marketer" | `["marketer", "marketing", "cmo"]` |

These keywords enable `filterRelevantContext()` to match context entries by role prefix (`backend-*`, `qa-*`) without expensive substring searches through full role descriptions.

---

## 7. Parallel Data Fetching

**File**: `src/application/orchestrator.ts:811-821`

### Optimization
Context, messages, and goal data fetched in parallel before prompt construction:
```typescript
const [sharedContext, pendingMessages, goalRaw] = await Promise.all([
  contextStore?.getAll(),
  messageService?.drainMailbox(agent.id, task.id),
  goalStore?.get(goalId),
]);
```

While not directly reducing tokens, this minimizes wall-clock time spent building prompts, reducing agent idle time (which accumulates connection tokens on streaming APIs).

---

## Reverted Optimizations

The following optimizations were added and subsequently **reverted** because they silently lost data that agents needed, reducing quality of agent work:

| Optimization | What it did | Why reverted |
|-------------|-------------|--------------|
| Context value truncation | Capped each value to 500 chars | Agents lost critical context details (e.g., full error messages, instructions) |
| Agent role truncation | First line only, max 80 chars | Agents couldn't see teammates' full capabilities and workflows |
| Goal task names capping | Max 30 task names | Agents lost visibility into full goal progress |
| Retry output tail reads | Max 50 lines from failed runs | Agents lost earlier output that explained the failure chain |

**Lesson learned**: Token optimization must not trade agent effectiveness for cost savings. Filtering irrelevant data (by score/relevance) is safe; hard-truncating relevant data is not. Any future data-limiting optimization should be proposed and approved explicitly, not applied silently.

---

## Summary: Token Budget Per Prompt

| Section | Naive (chars) | Optimized (chars) | Savings |
|---------|--------------|-------------------|---------|
| System prompt (cached) | 3,200 | 3,200 (at ~10% cost) | ~90% effective |
| Task details | 500 | 500 | 0% (always needed) |
| Team listing (16 agents) | 8,000 | 8,000 | 0% (full roles preserved) |
| Shared context (340 entries) | 136,000 | ~6,000 | ~96% (filtered by relevance) |
| Retry context | Variable | Variable | 0% (full output preserved) |
| Goal (200 tasks) | 10,000 | 10,000 | 0% (all task names preserved) |
| Messages | Variable | Variable | 0% |
| **Total (worst case)** | **~657,700** | **~27,700** | **~96%** |

> Note: The bulk of savings comes from context relevance filtering (§2) and prompt caching (§1). These are lossless optimizations — agents receive all data they need.

---

## Configuration Reference

All token-related settings in `.orchestry.yml`:

```yaml
prompt:
  # Custom system template (static, cached by Claude API)
  system_template: "..."

  # Custom user template (dynamic per task)
  user_template: "..."

  # Legacy: single combined template (disables caching)
  # template: "..."
```

### Hardcoded Constants

| Constant | Value | File | Tuning |
|----------|-------|------|--------|
| `MAX_CONTEXT_ENTRIES` | 15 | template-engine.ts | Change source to increase/decrease |
| `MAX_EVENT_DATA_LEN` | 8,192 | orchestrator.ts | Change source |
| `MAX_BUS_DATA_LEN` | 4,096 | orchestrator.ts | Change source |
| `MAX_LINE_LEN` | 16,384 | process-manager.ts | Change source |
| `MAX_DETAIL_LEN` | 2,048 | App.tsx | Change source |
| `PIPE_BUF` | 4,096 | fs-utils.ts | POSIX limit, do not change |

---

## Future Optimizations (Roadmap)

1. **Semantic context compression** — summarize shared context entries instead of truncating
2. **Adaptive context window** — adjust `MAX_CONTEXT_ENTRIES` based on model's context window size
3. **Token counting** — pre-count tokens before sending, warn when approaching model limits
4. **Differential prompts** — for retry runs, send only the diff from previous prompt
5. **Message deduplication** — deduplicate inbox messages that repeat across retry attempts
6. **Team listing pruning** — only list agents relevant to current task's domain (e.g., skip marketing agents for backend tasks)
