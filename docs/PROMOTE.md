# ORCH — Launch Promotion Playbook

> **Goal**: Publish to all channels in under 30 minutes.
> **Test count**: 1647 (verified green) · **Stars**: 9/10 — 1 star away from milestone!
> **Repo**: https://github.com/oxgeneral/ORCH

---

## Timing Guide

| Day | Time (ET) | Channel |
|-----|-----------|---------|
| Tue–Thu | 9–11am | HackerNews Show HN |
| Tue–Thu | 9–11am | **GitHub Discussions** (anthropic-sdk-typescript) ⭐ |
| Tue–Thu | 10am–12pm | Reddit r/devops, r/programming |
| Tue–Thu | 9am–1pm | Twitter/X thread |
| **Any weekday** | **9am–3pm** | **Reddit r/ClaudeAI** ⭐ 612k members |
| **Any day (weekends best)** | **—** | **Reddit r/LocalLLaMA** ⭐ 2.4M members |
| Any | — | Awesome lists (async submissions) |

**Best days**: Tuesday and Wednesday for HN/GitHub. Any day for Reddit.
**Avoid**: Friday PM, Monday morning for HN.

---

## Channel 1 — HackerNews Show HN

**URL**: https://news.ycombinator.com/submit

**Title** (copy exactly):
```
Show HN: ORCH – CLI orchestrator for Claude, Codex, Cursor agent teams (1647 tests, TypeScript)
```

**Body** (paste in the "text" field — HN supports plain text only, no markdown):

```
Hi HN,

I built ORCH after spending too many evenings tab-switching between three terminals — Claude implementing auth, Codex writing tests, a shell script running migrations — manually routing context between them like a human message bus.

The problem in one sentence: when you run 3+ AI agents simultaneously, you become the task router, the state tracker, and the crash handler. That's not engineering.

What ORCH does: It's a CLI orchestrator that runs Claude Code, OpenAI Codex, Cursor, and shell scripts as a typed task queue with a validated state machine:

  todo → in_progress → review → done
                     ↘ retrying → in_progress
                     ↘ failed

Add agents once:

  $ orch agent add "Backend" --adapter claude --role "Senior TypeScript developer"
  $ orch agent add "QA" --adapter claude --role "Test engineer, writes Vitest coverage"

Then dispatch everything:

  $ orch run --all

  14:32  ▶ Backend   → "Implement OAuth2 flow"
  14:32  ▶ QA        → "Write auth integration tests"
  14:35  ✓ QA        DONE  (3m 12s · 4,200 tokens)
  14:38  ✓ Backend   DONE  (6m 44s · 8,100 tokens)

Parallel execution, automatic retries, stall detection — no babysitting.

Key design decisions:
- File-only state: .orchestry/ directory, YAML + JSONL. No database, no Docker, no cloud.
- Reactive dispatch: new tasks dispatch in <500ms (not on the next 30s poll cycle)
- Autonomous mode: set a Goal, ORCH generates tasks for idle agents automatically
- Inter-agent messaging: orch msg send <agent-id> "context here" — agents share findings mid-run
- Teams API: group agents into squads with shared task pools and auto-claiming
- Context store: orch context set key "value" — agents write results others can read

Autonomous goal mode — the real unlock:

  $ orch goal set 'Build auth system' && orch run --all

ORCH reads the goal, breaks it into tasks, and assigns them to idle agents automatically. No task list to write. Agents claim work, share context, and report back. You watch the TUI — or don't. This is the closest I've gotten to "describe what you want, walk away".

Quick start (30 seconds):

  $ npm install -g @oxgeneral/orch --registry=https://npm.pkg.github.com
  $ cd ~/your-project && orch init && orch

TUI launches with Tasks/Agents/Goals tabs. Create tasks from the dashboard — no CLI memorization needed.

1647 passing tests (Vitest), strict TypeScript, MIT license.
Adapters: Claude Code, OpenAI Codex, Cursor, any shell command.

Repo: https://github.com/oxgeneral/ORCH

Happy to answer questions about the architecture — especially the state machine design and how autonomous goal mode works.
```

**How to respond to comments:**
- Questions about why not LangChain/AutoGen → "ORCH is process-level, not framework-level. It orchestrates external processes (CLI tools) not in-process agent loops."
- Questions about database → "File-only is intentional. YAML is human-readable, git-trackable, and requires zero setup."
- Questions about scale → "Not designed for high-throughput pipelines. Sweet spot: 3–15 agents doing code tasks, research, writing."
- Questions about auth/security → "Agents run with your local credentials. No credentials leave your machine."

---

## Channel 2 — Reddit r/LocalLLaMA ⭐ LOCAL-FIRST AUDIENCE

**URL**: https://www.reddit.com/r/LocalLLaMA/submit
**Flair**: Projects (or Tools)
**Best time**: Tue–Thu 10am–2pm ET

**Title** (copy exactly):
```
I built a CLI orchestrator that treats ollama/llama.cpp as first-class agents — fully local, MIT, no cloud
```

**Body** (markdown):

```markdown
Been running local LLM workflows with ollama for a while and hit the same wall everyone does: once you have more than 2 models running tasks in parallel, you end up being the human message bus — manually routing context, restarting crashed sessions, tracking which model is doing what.

So I built **ORCH** — a CLI orchestrator that manages AI agents (including local LLMs via ollama/llama.cpp) as a typed task queue.

**The local-first angle:**

The `shell` adapter lets you wrap any CLI command as an agent. That includes ollama:

```bash
# Register your local llama3 instance as an agent
orch agent add "LocalCoder" \
  --adapter shell \
  --role "You are a senior TypeScript developer. Implement the task described."

# Register a local phi-4 for writing/docs
orch agent add "LocalWriter" \
  --adapter shell \
  --role "You write clear documentation and summaries."

# Queue tasks
orch task add "Refactor auth module" --assignee LocalCoder
orch task add "Write API docs"       --assignee LocalWriter

# Dispatch in parallel
orch run --all
```

Both agents run simultaneously. ORCH handles retries, stall detection (no output for N seconds → retry or escalate), and dependency ordering between tasks.

**Why this fits local-first workflows:**

- **Zero cloud** — all state lives in `.orchestry/` as YAML + JSONL files. No database, no Docker, no API calls back home. Works air-gapped once installed.
- **File-only state** — you can inspect, edit, and `git add` everything in `.orchestry/`. Full auditability.
- **Shell adapter = any model** — if it runs in a terminal, ORCH can orchestrate it. ollama, llama.cpp server, llm CLI, LocalAI — anything that reads stdin/args and writes stdout.
- **MIT license** — fork it, embed it, do whatever.

**State machine (validated transitions):**

```
todo → in_progress → review → done
                   ↘ retrying → in_progress
                   ↘ failed
```

Tasks can't silently skip `review`. Prevents the "agent marked done but didn't actually finish" problem.

**Autonomous mode** — set a high-level goal, ORCH decomposes it into tasks and assigns them to idle agents:

```bash
orch goal add "Refactor the entire auth module to use JWT RS256"
orch run --all
# → ORCH generates subtasks, assigns to available agents, monitors progress
```

**Honest tradeoffs:**
- Not a model runner — ORCH orchestrates *processes*, not in-process inference. You still run ollama/llama.cpp separately.
- Single-machine only (no distributed exec)
- Sweet spot: 3–15 agents doing dev/writing/research tasks

**Stack**: TypeScript, Node 20+, 1647 passing tests, strict mode, MIT.

**Install**:
```bash
npm install -g @oxgeneral/orch --registry=https://npm.pkg.github.com
cd your-project && orch init && orch
```

TUI dashboard opens immediately — no config files to write.

**Repo**: https://github.com/oxgeneral/ORCH

Happy to answer questions about the shell adapter implementation or how to wire in custom ollama models. What local models are you using for agentic tasks?
```

**How to respond to comments:**
- "But I can just use a bash script" → "You can — ORCH is for when you need dependency ordering, automatic retries, stall detection, inter-agent messaging, and a TUI without writing all that yourself."
- "Does it work with LocalAI?" → "Yes — any process that reads stdin/args and writes stdout works with the shell adapter."
- "Why TypeScript, not Python?" → "Personal choice — the project runs as a CLI tool, not a library. Node 20 ships everywhere and has excellent async primitives."

---

## Channel 2b — Reddit r/ClaudeAI ⭐ CLAUDE CODE USERS

**URL**: https://www.reddit.com/r/ClaudeAI/submit
**Flair**: Built with Claude
**Best time**: Tue–Thu 9am–11am ET (612k members, very active)

**Title** (copy exactly):
```
I built a CLI to orchestrate multiple Claude Code instances in parallel — state machine, auto-retry, TUI dashboard (MIT)
```

**Body** (markdown):

```markdown
If you're running Claude Code for serious dev work, you've probably hit this: you open a second terminal to run Claude on tests while the first handles implementation, then a third for docs, and suddenly *you* are the task router, crash handler, and context copier between sessions.

I got tired of this and built **ORCH** — a CLI orchestrator specifically designed for managing multiple Claude Code agents from a single terminal.

**What it does:**

```bash
# Register Claude agents with distinct roles
orch agent add "Backend" \
  --adapter claude \
  --model claude-sonnet-4-6 \
  --role "Senior TypeScript developer. Implement features, write clean code."

orch agent add "QA" \
  --adapter claude \
  --model claude-haiku-4-5-20251001 \
  --role "Test engineer. Write Vitest tests, verify edge cases."

# Queue tasks with dependency ordering
orch task add "Implement OAuth2 flow"    --assignee Backend
orch task add "Write OAuth2 tests"       --assignee QA --depends-on <task-id>

# Dispatch everything
orch run --all
```

QA automatically waits for Backend. No manual coordination.

**Claude-specific features:**

- **Native `--adapter claude`** — spawns `claude` CLI as a managed subprocess, streams all output as typed events
- **Per-agent model selection** — opus for complex, haiku for fast/simple, sonnet for everything else
- **Stall detection** — if Claude goes silent for N seconds, ORCH retries automatically (no more zombie sessions)
- **Token tracking** — cost tracked per run, per agent, per task
- **Inter-agent messaging** — share context between Claude instances mid-run:
  ```bash
  orch msg send <agent-id> "auth module uses JWT RS256, keys in src/auth/keys.ts"
  ```

**Autonomous mode:**

```bash
orch goal add "Build a complete OAuth2 system with tests and docs"
orch run --all
# → ORCH generates subtasks, assigns to idle Claude agents, monitors progress
```

**Architecture decisions:**

- Validated state machine: `todo → in_progress → review → done` — Claude can't skip review
- File-only state: `.orchestry/` YAML+JSONL — zero infrastructure, git-trackable
- Reactive dispatch: new tasks reach Claude in <500ms
- 1647 passing tests, MIT license

**Install**:
```bash
npm install -g @oxgeneral/orch --registry=https://npm.pkg.github.com
cd your-project && orch init && orch
```

**Repo**: https://github.com/oxgeneral/ORCH

If you're using Claude Code for complex projects and spending time manually coordinating multiple sessions — this is what ORCH was built for.
```

**How to respond to comments:**
- "Why not just use Claude Projects / MCP?" → "Claude Projects is for context within a single session. ORCH runs *multiple Claude Code processes* in parallel with independent roles, task queues, and automated retry — different abstraction layer."
- "Does it work with the Claude API directly?" → "Currently via Claude CLI. Direct API adapter is planned — PRs welcome."
- "Cost?" → "ORCH is free/MIT. You pay standard Anthropic rates. Token usage tracked per task."

---

## Channel 3 — Reddit r/devops

**URL**: https://www.reddit.com/r/devops/submit

**Title**:
```
I got tired of tab-switching between Claude, Codex, and shell scripts — so I built a CLI orchestrator
```

**Body** (markdown):

```markdown
For the past few months I've been running 3–4 AI agents simultaneously on my projects. The workflow quickly becomes: open terminal 1 (Claude implementing a feature), open terminal 2 (Codex writing tests), check terminal 3 (shell script running migrations), manually copy context between them, handle crashes, retry failed runs.

You become the message bus. It's terrible.

So I built **ORCH** — a CLI orchestrator that manages AI agents as a typed task queue.

**What it does:**

```bash
$ orch agent add "Backend" --adapter claude --role "Senior TypeScript developer"
$ orch agent add "QA" --adapter claude --role "Test engineer, writes Vitest coverage"

$ orch task add "Implement OAuth2 flow" --assignee Backend
$ orch task add "Write OAuth2 tests" --assignee QA --depends-on <task-id>

$ orch run --all
# Both agents run in parallel. QA waits for Backend to finish (dependency).
# Automatic retries on failure. Stall detection after 5 minutes of no output.
```

**Design decisions that might interest r/devops:**

- **File-only state**: everything in `.orchestry/` — YAML for tasks/agents, JSONL for event logs. No database, no Docker, no cloud. Git-trackable.
- **Validated state machine**: `todo → in_progress → review → done`. Invalid transitions throw. Prevents silent state corruption.
- **Scope overlap detection**: if two tasks touch the same files (`src/auth/**`), ORCH queues the second one instead of running both simultaneously.
- **Reactive dispatch**: new tasks dispatch in <500ms via event subscription, not on the next 30s poll cycle.
- **Autonomous mode**: set a high-level Goal, ORCH generates tasks for idle agents and monitors progress.

**Honest tradeoffs:**
- Not for high-throughput pipelines (use Temporal/Prefect for that)
- File locking limits to one orchestrator process per project
- No distributed execution — single machine only

**Stack**: TypeScript, Node 20+, 1647 tests (Vitest), MIT license.

Repo: https://github.com/oxgeneral/ORCH

Happy to answer questions about the architecture.
```

**How to respond to comments:**
- Compare to Jenkins/GitLab CI → "ORCH is for interactive development workflows, not CI. It runs during your dev session, not in a pipeline."
- Ask for Kubernetes/distributed → "Out of scope intentionally. Single-machine, single-developer tool."
- Ask about cost → "Zero infrastructure cost. Agents use your existing API keys."

---

## Channel 3 — Reddit r/programming

**URL**: https://www.reddit.com/r/programming/submit

**Title**:
```
Building a TypeScript CLI orchestrator for AI agents: state machine, event bus, and reactive dispatch
```

**Body** (markdown):

```markdown
I built a CLI tool to orchestrate teams of AI agents (Claude, Codex, Cursor, shell scripts). Here are the interesting engineering decisions I made along the way.

**Repo**: https://github.com/oxgeneral/ORCH · 1647 tests · MIT

---

### 1. Formal state machine with transition validation

Tasks flow through: `todo → in_progress → review → done`, with `retrying` and `failed` branches. All transitions go through `canTransition()`:

```typescript
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo:        ['in_progress', 'cancelled'],
  in_progress: ['review', 'retrying', 'failed', 'cancelled'],
  review:      ['done', 'in_progress', 'failed'],
  retrying:    ['in_progress', 'failed'],
  done:        [],
  failed:      ['todo'],
  cancelled:   ['todo'],
};
```

`in_progress` can't go directly to `done` — it must pass through `review`. This was an intentional design to force human-or-agent review before completion.

### 2. Typed event bus (31 event types)

Instead of callbacks or untyped emitters:

```typescript
eventBus.emit('task:created', { task });
eventBus.emit('agent:completed', { agentId, taskId, runId });
eventBus.on('orchestrator:error', ({ error, context, fatal }) => { ... });
```

All 31 event types are exhaustively typed. The orchestrator subscribes to `task:created` for reactive dispatch (new tasks start in <500ms, not on the next 30s polling cycle).

### 3. Promise-chain mutex for state serialization

The orchestrator's tick loop, cancel, and stop all contend for the same in-memory state. A promise-chain mutex serializes access:

```typescript
private stateMutex: Promise<void> = Promise.resolve();

private withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = this.stateMutex.then(fn);
  this.stateMutex = next.then(() => {}, () => {});
  return next;
}
```

No libraries. Three lines. Works because JS is single-threaded — no actual thread contention, just async ordering.

### 4. File-only state with atomic writes

All state lives in `.orchestry/` — YAML files for entities, JSONL for event logs. Writes use temp-file + rename for atomicity:

```typescript
async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = path + '.tmp.' + nanoid(6);
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, path);
}
```

JSONL event logs use `O_APPEND` for atomic line appends. For large files, a reverse-chunk reader (`readJsonlTail`) reads the last N lines without loading the whole file.

### 5. AsyncGenerator adapter interface

Each agent adapter (Claude, Codex, Cursor, shell) implements:

```typescript
interface IAgentAdapter {
  execute(params: AdapterParams): Promise<{
    pid: number;
    events: AsyncGenerator<AgentEvent>;
  }>;
}
```

The orchestrator consumes events via `for await`. This naturally handles backpressure — if the orchestrator is busy, the generator just waits.

### 6. Scope overlap detection

If two tasks declare overlapping file scopes, the second one is queued instead of running concurrently:

```typescript
// task A: scope = ['src/auth/**']
// task B: scope = ['src/auth/login.ts']
// → B is blocked until A completes
```

Uses a trie-like pre-computation (`ScopeIndex`) for O(1) overlap checks during dispatch.

---

**Results**: 1647 tests (Vitest), strict TypeScript with `noUncheckedIndexedAccess`, builds in ~1.5s.

The most interesting part to build was the reactive dispatch — switching from polling to event-driven cut average task start latency from 30s to <500ms.

Happy to discuss any of the design decisions.
```

**How to respond to comments:**
- Compare to XState → "XState is great but adds a dependency and abstracts away the transition table. For 7 states I preferred explicit maps."
- Ask about SQLite → "Considered it. YAML+JSONL wins for zero-setup, git-trackable state, and human-readable debugging."
- Ask about the mutex → "It works because Node.js is single-threaded. The mutex serializes async operations, not CPU threads."

---

## Channel 4 — Twitter/X Thread

**Post these 6 tweets as a thread** (reply to each previous tweet):

**Tweet 1** (hook):
```
I was managing 3 AI agents by hand:
- Claude in terminal 1 (implementing)
- Codex in terminal 2 (testing)
- Shell script in terminal 3 (migrating)

Manually routing context between them like a human message bus.

So I built ORCH — a CLI to orchestrate AI agent teams.

🧵
```

**Tweet 2** (quick setup):
```
Setup takes 30 seconds:

$ npm install -g @oxgeneral/orch
$ cd your-project && orch init
$ orch  # opens TUI dashboard

Tasks/Agents/Goals tabs. Create tasks from the UI or CLI.

No YAML config files to write. No cloud setup. No Docker.
```

**Tweet 3** (parallel dispatch demo):
```
Dispatch multiple agents in parallel:

$ orch run --all

14:32  ▶ Backend → "Implement OAuth2 flow"
14:32  ▶ QA      → "Write auth integration tests"
14:35  ✓ QA       DONE  (3m 12s · 4,200 tokens)
14:38  ✓ Backend  DONE  (6m 44s · 8,100 tokens)

Automatic retries. Stall detection. Scope overlap protection.
```

**Tweet 4** (autonomous mode):
```
Set a high-level Goal, let ORCH manage the rest:

$ orch goal add "Add dark mode to the dashboard"

ORCH creates tasks for idle agents automatically.
Agents share context mid-run:

$ orch msg send <agent-id> "use CSS variables, see design system"

No more tab-switching.
```

**Tweet 5** (architecture):
```
Under the hood:

→ Validated state machine (todo→review→done, no shortcuts)
→ 31-event typed bus (reactive dispatch in <500ms)
→ File-only state (.orchestry/ YAML+JSONL, zero infra)
→ Promise-chain mutex (3 lines, no library)
→ AsyncGenerator adapters (Claude, Codex, Cursor, shell)

1647 tests. Strict TypeScript. MIT.
```

**Tweet 6** (CTA):
```
GitHub: https://github.com/oxgeneral/ORCH

npm: @oxgeneral/orch

Adapters: Claude Code, OpenAI Codex, Cursor IDE, any shell command.

If you're running more than 2 AI agents in parallel and spending time routing context between them — this is for you.

⭐ if useful
```

---

## Channel 5 — GitHub Discussions ⭐ HIGHEST-IMPACT

> **IMPORTANT**: This is the highest-impact channel for reaching Claude/Anthropic developers directly.
> Post to the Anthropic TypeScript SDK discussions — the exact audience that builds with Claude.
> **Best time**: Tuesday–Thursday, 9–11am ET.

**URL**: https://github.com/anthropics/anthropic-sdk-typescript/discussions/new?category=show-and-tell

**Title** (copy exactly):
```
ORCH — CLI orchestrator for Claude agent teams (parallel dispatch, state machine, 1647 tests)
```

**Body** (markdown — GitHub Discussions supports full markdown):

```markdown
Hi Anthropic SDK community,

I built **ORCH** — a CLI tool for orchestrating teams of Claude agents from a single terminal. If you're running multiple Claude Code sessions in parallel for different tasks, this is for you.

## The problem it solves

When you have 3+ Claude agents working simultaneously:
- You manually route context between terminals
- You restart crashed sessions by hand
- You track which agent is doing what in your head
- You copy-paste output from one agent to the next

You become the scheduler. That's not engineering.

## What ORCH does

ORCH manages Claude Code (and other agents) as a **typed task queue with a validated state machine**:

```
todo → in_progress → review → done
                   ↘ retrying → in_progress
                   ↘ failed
```

```bash
# Add Claude agents once
$ orch agent add "Backend" --adapter claude --role "Senior TypeScript developer"
$ orch agent add "QA"      --adapter claude --role "Test engineer, writes Vitest"

# Queue tasks with dependencies
$ orch task add "Implement OAuth2 flow" --assignee Backend
$ orch task add "Write OAuth2 tests"    --assignee QA --depends-on <task-id>

# Dispatch everything
$ orch run --all
# → Both agents run in parallel. QA waits for Backend (dependency graph).
# → Automatic retries on failure. Stall detection after silence.
# → Token usage tracked per run.
```

## Claude-specific features

Since you're here: ORCH has a **native Claude adapter** (`--adapter claude`) that:
- Spawns `claude` CLI as a managed process with your system prompt as `--role`
- Streams all Claude output as typed events (`AgentEvent`)
- Detects stalls (no output for N seconds) and can retry or escalate
- Supports `--model` flag to switch between sonnet/haiku/opus per agent

**Autonomous mode** — set a high-level Goal, ORCH generates tasks for idle Claude agents automatically and monitors progress.

**Inter-agent messaging** — Claude agents can share context mid-run:
```bash
$ orch msg send <agent-id> "auth module uses JWT RS256, check src/auth/keys.ts"
```

## Architecture (for the curious)

- **File-only state**: `.orchestry/` — YAML for tasks/agents, JSONL for event logs. Zero infra, git-trackable.
- **Reactive dispatch**: new tasks reach Claude in <500ms via event bus, not polling
- **Scope overlap detection**: if two tasks touch the same files, ORCH queues the second one
- **Promise-chain mutex**: 3 lines, no library, serializes async state mutations
- **AsyncGenerator adapter interface**: each agent type (claude, codex, cursor, shell) implements `execute()` → `AsyncGenerator<AgentEvent>`

## Quick start

```bash
$ npm install -g @oxgeneral/orch --registry=https://npm.pkg.github.com
$ cd your-project && orch init && orch
```

TUI dashboard opens immediately — Tasks/Agents/Goals tabs. No config files to write.

## Stats

- **1647 passing tests** (Vitest, strict TypeScript)
- **5 adapters**: claude, opencode, codex, cursor, shell
- **MIT license**
- **Repo**: https://github.com/oxgeneral/ORCH

If you're using Claude Code for development tasks and want to coordinate multiple instances without tab-switching — this is exactly what ORCH is built for.

Happy to answer questions about the Claude adapter implementation or the state machine design.
```

**Notes on this channel:**
- Anthropic SDK discussions reach the most engaged Claude developers — engineers already building Claude-powered tools
- The "show-and-tell" or "general" category is best; avoid "Q&A" unless asking something
- Mention the `--adapter claude` native integration prominently — this audience cares
- Link to the Claude adapter source: `src/infrastructure/adapters/claude.ts`
- Respond to every comment within 6 hours — this community is technically sophisticated

**How to respond to comments:**
- "How does it compare to Claude's built-in tools?" → "ORCH is process-level: it manages multiple Claude CLI instances as separate agents with distinct roles and task queues. Claude's built-in tools are single-session."
- "Does it work with the Claude API directly?" → "Currently via Claude CLI. A direct API adapter (`--adapter claude-api`) is a planned feature — PRs welcome."
- "What about rate limits?" → "Each Claude agent runs as its own process with its own session. Rate limiting is handled by the Claude CLI itself."

---

## Channel 6 — Awesome Lists Submissions

Submit to these lists via GitHub issues or PRs. Check each list's `CONTRIBUTING.md` first.

### Priority 1 (highest traffic)

| List | URL | Submit via |
|------|-----|------------|
| awesome-cli-apps | https://github.com/agarrharr/awesome-cli-apps | PR — add under "Productivity" or "Development" |
| awesome-nodejs | https://github.com/sindresorhus/awesome-nodejs | PR — add under "Command-line apps" |
| awesome-typescript | https://github.com/dzharii/awesome-typescript | PR — add under "Tools" |

### Priority 2

| List | URL | Submit via |
|------|-----|------------|
| awesome-ai-tools | https://github.com/mahseema/awesome-ai-tools | PR — add under "Developer Tools" |
| awesome-claude | Search GitHub for "awesome-claude" lists | PR |
| awesome-llm-apps | Search GitHub | PR |

### Suggested entry text (copy-paste for PRs):

```markdown
- [ORCH](https://github.com/oxgeneral/ORCH) - CLI orchestrator for AI agent teams. Manages Claude, Codex, Cursor, and shell agents as a typed task queue with state machine, reactive dispatch, and file-only state. 1647 tests, TypeScript, MIT.
```

---

## Channel 7 — Dev.to / Hashnode

**Blog post is already published**: `docs/blog/orchestrating-ai-agents.md`

**✅ PUBLISHED on Dev.to** (2026-03-13)

**To publish on Hashnode** (pending):

**To publish on Hashnode:**
1. Go to https://hashnode.com/post/new
2. Same content, same tags
3. Set publication to your blog or Hashnode's community

**Title**: "Orchestrating a Team of AI Agents from a Single CLI"

---

## Channel 8 — Discord/Slack Communities

**Стратегия**: Discord сообщества AI-разработчиков — высоко целевая аудитория. Ключ — не спамить, а постить в правильные каналы с техническим сообщением. Сначала изучи последние 20 сообщений в канале, чтобы понять тон и формат.

**Общие правила:**
- Всегда читай pinned messages и channel description перед постингом
- Не перекрещивай один и тот же пост в разных каналах одного сервера
- Отвечай на все вопросы и реакции в течение 24 часов
- Не проси звёзды/upvotes явно — пусть содержание говорит само за себя

---

### Community 1 — Latent Space Discord (~30k AI engineers)

**Сервер**: Latent Space (latent.space community)
**Канал**: `#show-and-tell`
**Лучшее время**: Вторник–четверг, 10am–2pm PT (пик активности US West Coast)
**Аудитория**: ML engineers, AI researchers, builders — самая техническая аудитория из всех

**Message template:**

```
Built a CLI orchestrator for running Claude, Codex, Cursor, and shell scripts in parallel.

Core idea: stop being the human message bus between your AI agents. ORCH manages a typed task queue with a validated state machine (todo → in_progress → review → done), reactive dispatch (<500ms on task creation), and file-only state (.orchestry/ YAML+JSONL — no database, no cloud).

Architecture highlights:
- AsyncGenerator adapter interface for each agent type
- Promise-chain mutex for state serialization (3 lines, no library)
- Scope overlap detection prevents concurrent edits to same files
- 1647 passing tests (Vitest), strict TypeScript

$ orch agent add "Backend" --adapter claude --role "Senior TypeScript dev"
$ orch run --all  # parallel dispatch, auto-retry, stall detection

https://github.com/oxgeneral/ORCH

Happy to discuss the state machine design or reactive dispatch implementation.
```

**Ответы на вопросы:**
- "Why not LangChain/AutoGen?" → "ORCH is process-level orchestration — it spawns CLI processes. LangChain/AutoGen are in-process agent loops. Different abstraction level."
- "How does it handle Claude's rate limits?" → "Each adapter handles its own rate limiting. ORCH just sees process exit codes and event streams."

---

### Community 2 — AI Engineer Discord

**Сервер**: AI Engineer (ai.engineer community)
**Канал**: `#projects`
**Лучшее время**: Вторник–среда, 9am–12pm ET
**Аудитория**: Software engineers building AI-powered products — практики, не исследователи

**Message template:**

```
Sharing ORCH — a CLI tool I built for orchestrating teams of AI agents.

Problem: running Claude + Codex + shell scripts in parallel means you're manually routing context, handling retries, and tracking state across terminals. You become the scheduler.

Solution: a typed task queue with a validated state machine and file-only state.

Key features:
- Parallel agent dispatch with dependency resolution
- Autonomous mode: set a Goal, agents generate and claim tasks automatically
- Inter-agent messaging: agents share context mid-run via orch msg send
- Teams API: group agents with shared task pools
- Reactive dispatch: <500ms from task creation to agent start

Stack: TypeScript, Node 20+, 1647 tests, MIT

$ npm install -g @oxgeneral/orch --registry=https://npm.pkg.github.com
$ orch init && orch  # TUI dashboard launches immediately

https://github.com/oxgeneral/ORCH
```

---

### Community 3 — Hugging Face Discord

**Сервер**: Hugging Face
**Канал**: `#projects`
**Лучшее время**: Понедельник–среда, 11am–3pm ET
**Аудитория**: ML practitioners, model builders — больше Python/research, но активные builders

**Message template:**

```
Built a CLI orchestrator for AI agent teams — sharing in case it's useful.

ORCH manages Claude Code, OpenAI Codex, Cursor, and shell commands as a typed task queue. Each agent is a process; ORCH handles dispatch, retries, state tracking, and inter-agent communication.

What makes it different from agent frameworks:
- Process-level orchestration (not in-process) — works with any CLI-based agent
- File-only state: .orchestry/ YAML + JSONL, zero infrastructure
- Validated state machine: prevents invalid transitions, forces review before done
- 1647 tests, TypeScript strict mode, MIT license

Quick demo:
$ orch task add "Fine-tune eval pipeline" --assignee data-agent
$ orch task add "Write test report" --assignee writer-agent --depends-on <id>
$ orch run --all

Repo: https://github.com/oxgeneral/ORCH

Open to feedback on the architecture — especially around the adapter interface design.
```

---

### Community 4 — DAIR.AI Discord

**Сервер**: DAIR.AI (Democratizing AI Research)
**Канал**: `#general`
**Лучшее время**: Любой будний день, 12pm–4pm ET
**Аудитория**: AI researchers and practitioners focused on practical AI applications

**Message template:**

```
Releasing ORCH — a CLI orchestrator for running multiple AI agents in parallel.

The core insight: when you have 3+ AI agents (Claude, Codex, custom tools), you spend significant time manually routing tasks, handling failures, and tracking state. ORCH automates this with:

- A validated state machine (prevents silent state corruption)
- Reactive task dispatch (<500ms latency vs 30s polling)
- Autonomous mode: set a high-level Goal, ORCH decomposes it into agent tasks
- File-only storage — git-trackable, zero infrastructure, easy to inspect/debug

Architecture is fully open: TypeScript, 1647 tests, MIT license.

For anyone running multi-agent workflows for research tasks (literature review, code generation, evaluation pipelines) — might be worth a look.

https://github.com/oxgeneral/ORCH
```

---

### Community 5 — r/LocalLLaMA Discord

**Сервер**: r/LocalLLaMA (localllama.com community)
**Канал**: `#projects-showcase` (или `#tools` если projects-showcase недоступен)
**Лучшее время**: Пятница–воскресенье, 2pm–8pm ET (community наиболее активна в выходные)
**Аудитория**: Local LLM enthusiasts, tinkerers — ценят open source, отсутствие cloud-зависимостей

**Message template:**

```
ORCH — a CLI orchestrator for AI agent teams, fully local, no cloud required.

Built for running multiple agents in parallel: Claude Code, Codex, Cursor, or any shell command. The shell adapter means you can wire in local models (ollama, llama.cpp wrappers) as agents too.

Why it fits local-first workflows:
- Zero cloud infrastructure — all state in .orchestry/ YAML+JSONL files
- No API calls except to your configured agents
- Works offline once installed
- File-only state means you can inspect, edit, and version-control everything

What it does:
$ orch agent add "LocalLlama" --adapter shell --role "..."
$ orch run --all  # dispatches all pending tasks to available agents

Autonomous mode, inter-agent messaging, TUI dashboard included.

1647 tests, TypeScript, MIT: https://github.com/oxgeneral/ORCH
```

**Дополнительно для этой аудитории**: Упомяни что shell adapter позволяет использовать любую LLM через CLI-обёртку (ollama run llama3, etc.).

---

## Channel 9 — Reddit r/LocalLLaMA ⭐ FINAL PUSH — 2.4M MEMBERS

**URL**: https://www.reddit.com/r/LocalLLaMA/submit
**Flair**: Projects (or Tools)
**Best time**: Any day works — weekends see highest engagement. Avoid Monday morning.
**Audience**: Local LLM enthusiasts who value open source, zero-cloud, full data control.

**Title** (copy exactly):
```
I built a CLI to run ollama/llama.cpp as parallel agents — state machine, no cloud, MIT
```

**Body** (markdown):

```markdown
Been running local LLM workflows with ollama for months and kept hitting the same wall: once you have 2+ models running tasks simultaneously, you end up being the human message bus — manually routing context, restarting crashed sessions, tracking which model is doing what.

I built **ORCH** — a CLI orchestrator that manages local LLM agents (via the `shell` adapter) as a typed task queue with a validated state machine.

## The local-first angle

The `shell` adapter wraps any CLI command as an agent. That includes ollama:

```bash
# Register your local llama3 as a coding agent
orch agent add "LocalCoder" \
  --adapter shell \
  --role "Senior TypeScript developer. Implement the task described."

# Register phi-4 for writing/docs
orch agent add "LocalWriter" \
  --adapter shell \
  --role "Technical writer. Write clear, concise documentation."

# Queue tasks
orch task add "Refactor auth module" --assignee LocalCoder
orch task add "Write API docs"       --assignee LocalWriter

# Dispatch in parallel — both models run simultaneously
orch run --all
```

ORCH handles retries, stall detection (no output for N seconds → retry or escalate), and dependency ordering.

## Why it fits local-first workflows

- **Zero cloud** — all state lives in `.orchestry/` as YAML + JSONL files. No database, no Docker, no API calls home. Works air-gapped.
- **Shell adapter = any model** — if it runs in a terminal, ORCH can orchestrate it: `ollama run llama3`, `llama.cpp` server, `llm` CLI, LocalAI, anything that reads stdin/args and writes stdout.
- **File-only state** — inspect, edit, and `git add` everything in `.orchestry/`. Full auditability, no black boxes.
- **MIT license** — fork it, embed it, modify it freely.

## State machine (validated transitions)

```
todo → in_progress → review → done
                   ↘ retrying → in_progress
                   ↘ failed
```

Tasks can't silently skip `review`. Prevents the "model marked done but didn't actually finish" problem.

## Autonomous mode

Set a high-level goal, ORCH decomposes it into tasks and assigns to idle agents:

```bash
orch goal add "Refactor the entire auth module to use JWT RS256"
orch run --all
# → generates subtasks, assigns to available agents, monitors progress
```

## Honest tradeoffs

- Not a model runner — ORCH orchestrates *processes*, not in-process inference. You still run ollama/llama.cpp separately.
- Single-machine only (no distributed exec)
- Sweet spot: 3–15 agents doing dev/writing/research tasks

## Stack

TypeScript, Node 20+, **1647 passing tests**, strict mode, MIT.

```bash
npm install -g @oxgeneral/orch
cd your-project && orch init && orch
# TUI dashboard opens — no config files to write
```

**Repo**: https://github.com/oxgeneral/ORCH

What local models are you using for agentic tasks? Happy to answer questions about wiring in custom ollama models via the shell adapter.
```

**How to respond to comments:**
- "But I can just use a bash script" → "You can — ORCH is for when you need dependency ordering, automatic retries, stall detection, inter-agent messaging, and a TUI without writing all that yourself."
- "Does it work with LocalAI / llm CLI?" → "Yes — any process that reads stdin/args and writes stdout works with the shell adapter."
- "Why TypeScript, not Python?" → "The project runs as a CLI tool, not a library. Node 20 ships everywhere and has excellent async primitives."
- "Air-gapped?" → "Yes — once npm-installed, ORCH makes zero external calls. All state is local YAML+JSONL."

---

## Channel 10 — Reddit r/ClaudeAI ⭐ FINAL PUSH — 612K MEMBERS

**URL**: https://www.reddit.com/r/ClaudeAI/submit
**Flair**: Built with Claude
**Best time**: Any weekday 9am–3pm ET (peak US activity). Avoid weekends.
**Audience**: Claude power users, developers running Claude Code for serious projects.

**Title** (copy exactly):
```
I built a CLI to orchestrate multiple Claude Code instances in parallel — state machine, 1647 tests, MIT
```

**Body** (markdown):

```markdown
If you're using Claude Code for serious dev work, you've probably hit this wall: you open a second terminal to run Claude on tests while the first handles implementation, then a third for docs — and suddenly *you* are the task router, crash handler, and context copier between sessions.

I got tired of it and built **ORCH** — a CLI orchestrator built specifically for managing multiple Claude Code agents from one terminal.

## What it does

```bash
# Register Claude agents with distinct roles
orch agent add "Backend" \
  --adapter claude \
  --model claude-sonnet-4-6 \
  --role "Senior TypeScript developer. Implement features, write clean code."

orch agent add "QA" \
  --adapter claude \
  --model claude-haiku-4-5-20251001 \
  --role "Test engineer. Write Vitest tests, verify edge cases, find regressions."

# Queue tasks with dependency ordering
orch task add "Implement OAuth2 flow"    --assignee Backend
orch task add "Write OAuth2 tests"       --assignee QA --depends-on <task-id>

# Dispatch everything in parallel
orch run --all
# → QA waits automatically for Backend. No manual coordination.
# → Stall detection: if Claude goes silent for N seconds, ORCH retries.
# → Token usage tracked per run, per agent, per task.
```

## Claude-specific features

- **Native `--adapter claude`** — spawns `claude` CLI as a managed subprocess, streams all output as typed events
- **Per-agent model selection** — opus for complex architecture tasks, haiku for fast/simple, sonnet for everything else
- **Stall detection** — if Claude goes silent for N seconds, ORCH retries automatically (no more zombie sessions)
- **Token tracking** — cost tracked per run, per agent, per task
- **Inter-agent messaging** — share context between Claude instances mid-run:
  ```bash
  orch msg send <agent-id> "auth module uses JWT RS256, keys in src/auth/keys.ts"
  ```

## State machine — the key design decision

All task transitions are validated:

```
todo → in_progress → review → done
                   ↘ retrying → in_progress
                   ↘ failed
```

Claude agents **cannot skip `review`** — prevents the "marked done but didn't actually finish" problem that plagues long-running sessions.

**1647 passing tests** on this state machine + orchestrator logic. Every edge case (zombie processes, concurrent stalls, dependency resolution) covered.

## Autonomous mode

Set a high-level Goal, ORCH generates tasks and assigns them to idle Claude agents automatically:

```bash
orch goal add "Build a complete OAuth2 system with tests and docs"
orch run --all
# → ORCH decomposes the goal, assigns to Backend/QA/Docs agents, monitors progress
```

Set it before bed, review pull requests in the morning.

## Architecture

- **File-only state**: `.orchestry/` YAML+JSONL — zero infrastructure, git-trackable, fully inspectable
- **Reactive dispatch**: new tasks reach Claude in <500ms (event-driven, not polling)
- **Scope overlap detection**: if two tasks touch the same files, ORCH queues the second one to prevent conflicts
- **5 adapters**: claude, opencode, codex, cursor, shell

## Install (30 seconds)

```bash
npm install -g @oxgeneral/orch
cd your-project && orch init && orch
```

TUI dashboard opens immediately — Tasks/Agents/Goals tabs. No YAML config files to write.

**Repo**: https://github.com/oxgeneral/ORCH · 1647 tests · MIT

If you're using Claude Code for complex projects and spending time manually coordinating multiple sessions — this is exactly what ORCH is built for.
```

**How to respond to comments:**
- "Why not just use Claude Projects / MCP?" → "Claude Projects is for context within a single session. ORCH runs *multiple Claude Code processes* in parallel with independent roles, task queues, and automated retry — different abstraction layer."
- "Does it work with the Claude API directly?" → "Currently via Claude CLI. Direct API adapter is planned — PRs welcome."
- "Cost?" → "ORCH is free/MIT. You pay standard Anthropic rates. Token usage tracked per task so you can see exactly what each agent costs."
- "How is it different from a bash script?" → "Dependency resolution, stall detection, validated state machine, inter-agent messaging, TUI dashboard, autonomous goal decomposition — all without writing it yourself."

---

## Author Checklist (30-minute run)

```
[ ] 1. HackerNews — paste title + body, submit (2 min)
[ ] 2. GitHub Discussions (anthropic-sdk-typescript) — paste body (3 min) ⭐ HIGHEST-IMPACT
[ ] 3. Reddit r/devops — paste title + body (2 min)
[ ] 4. Reddit r/programming — paste title + body (2 min)
[ ] 5. Twitter — post tweet 1, reply with 2→3→4→5→6 (5 min)
[x] 6. Dev.to — PUBLISHED (2026-03-13)
[ ] 7. Hashnode — same post (3 min)
[ ] 8. awesome-cli-apps PR — one-line entry (5 min)
[ ] 9. Reddit r/LocalLLaMA (Channel 9) — any day, weekends best (2 min) ⭐ 2.4M members
[ ] 10. Reddit r/ClaudeAI (Channel 10) — any weekday 9am–3pm ET (2 min) ⭐ 612k members
[ ] 11. awesome-nodejs PR — one-line entry (5 min)
[ ] Total: ~37 minutes
```

---

## What to Do After Posting

### First hour
- Monitor HN "new" page for your post — comment within 10 minutes of going live
- Reply to every comment within 30 minutes (upvotes correlate with early engagement)
- Don't delete and resubmit — it's against HN rules and gets flagged

### First day
- Thank everyone who stars on GitHub (watch notifications)
- Respond to issues/questions within 24 hours
- Share the HN link on Twitter if it gets traction (5+ points)

### What NOT to do
- Don't ask for upvotes explicitly (HN bans this)
- Don't post the same content to multiple subreddits on the same day
- Don't spam Discord/Slack channels — join conversations organically first

---

## Package Info

```
npm name:    @oxgeneral/orch
registry:    https://npm.pkg.github.com
license:     MIT
tests:       1647 (Vitest, all green)
typescript:  strict + noUncheckedIndexedAccess
node:        20+
```
