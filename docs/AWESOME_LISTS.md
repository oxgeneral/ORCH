# Awesome Lists — PR Descriptions for ORCH

Ready-to-use PR descriptions for submitting ORCH to curated awesome lists.
Copy the content for each list and open a pull request.

---

## 1. agarrharr/awesome-cli-apps

**Repository:** https://github.com/agarrharr/awesome-cli-apps
**Section:** Development > DevOps
**Status:** Submit now (20+ stars achievable)

### PR Title

```
Add ORCH — CLI orchestrator for AI agent teams
```

### PR Description

```markdown
## Description

Adds ORCH to the Development > DevOps section.

**Entry:**

- [ORCH](https://github.com/oxgeneral/ORCH) - Orchestrator for AI agent teams (Claude, Codex, Cursor). Parallel task dispatch, state machine, and autonomous mode. TypeScript, MIT.

## Why it fits

ORCH is a CLI tool that orchestrates multiple AI agents (Claude Code, OpenAI Codex, Cursor, shell scripts) as a typed task queue with a validated state machine. It fits the DevOps category because it automates and coordinates multi-agent AI workflows from the command line:

- `orch run --all` dispatches tasks to agents in parallel
- `orch task add` / `orch agent list` / `orch goal set` are the primary commands
- File-only state storage in `.orchestry/` — no Docker, no database
- 987 passing tests, strict TypeScript, MIT license

## Checklist

- [x] The project is open-source (MIT license)
- [x] The project is free to use
- [x] The entry is added in alphabetical order within the section
- [x] The entry follows the existing format: `- [Name](url) - Description.`
- [x] The description is concise and ends with a period
- [x] The project has been around for at least 30 days
```

---

## 2. e2b-dev/awesome-ai-agents

**Repository:** https://github.com/e2b-dev/awesome-ai-agents
**Section:** Open-source > Multi-agent
**Google Form:** https://forms.gle/UXQFCogLYrPFvfoUA
**Status:** High priority — also submit via Google Form as backup

### PR Title

```
Add ORCH — CLI orchestrator for AI agent teams
```

### PR Description

```markdown
## Description

Adds ORCH to the Open-source > Multi-agent section.

**Entry:**

- [ORCH](https://github.com/oxgeneral/ORCH) — CLI orchestrator for AI agent teams (Claude, Codex, Cursor). Parallel task dispatch, state machine, autonomous mode. TypeScript, MIT.

## Why it fits

ORCH is an open-source multi-agent orchestration system designed for developers who run 3+ AI agents simultaneously. It solves the "human message bus" problem — manually routing context between Claude, Codex, Cursor, and shell scripts.

**Key capabilities:**
- Parallel task dispatch across multiple AI providers
- Validated state machine: `todo → in_progress → review → done` with retries and stall detection
- Autonomous mode: set a Goal and ORCH auto-generates tasks for idle agents
- Inter-agent messaging: agents share findings mid-run via `orch msg send`
- Teams API: group agents into squads with shared task pools
- Adapters: Claude Code, OpenAI Codex, Cursor IDE, any shell command

**Project stats:** 987 passing tests, strict TypeScript, MIT license, Node 20+.

## Checklist

- [x] Open-source project (MIT)
- [x] Entry added in alphabetical order within the section
- [x] The project is actively maintained
- [x] Entry format matches existing entries in the list
```

---

## 3. e2b-dev/awesome-sdks-for-ai-agents

**Repository:** https://github.com/e2b-dev/awesome-sdks-for-ai-agents
**Section:** Infrastructure tooling
**Status:** Medium priority

### PR Title

```
Add ORCH — CLI orchestrator for AI agent teams
```

### PR Description

```markdown
## Description

Adds ORCH to the Infrastructure tooling section.

**Entry:**

- [ORCH](https://github.com/oxgeneral/ORCH) — CLI orchestrator for AI agent teams. Parallel task dispatch, state machine, YAML-based agent config, autonomous mode. TypeScript, MIT.

## Why it fits

ORCH is infrastructure tooling for teams running multiple AI agents. It provides the coordination layer between AI providers (Claude, Codex, Cursor) and development workflows:

**Infrastructure capabilities:**
- **Task queue** with validated state machine and automatic retries
- **Process management** — spawns, monitors, and reaps agent processes
- **File-based state** in `.orchestry/` (YAML + JSONL) — no database required
- **Adapter interface** (`IAgentAdapter`) for plugging in any AI provider
- **Context store** — agents write shared results via `orch context set`
- **Workspace management** — git worktrees for isolated agent execution
- **Event bus** — 31 typed events for observability and coordination

**Quick start:**
```bash
npm install -g @oxgeneral/orch
cd ~/your-project && orch
```

987 passing tests, strict TypeScript, MIT license.

## Checklist

- [x] Open-source project (MIT)
- [x] Entry added in the correct section
- [x] Actively maintained with regular commits
- [x] Entry format matches existing entries
```

---

## 4. kaushikb11/awesome-llm-agents

**Repository:** https://github.com/kaushikb11/awesome-llm-agents
**Section:** Frameworks
**Status:** Medium priority — use multi-line format with bullets

### PR Title

```
Add ORCH — CLI orchestrator for LLM agent teams
```

### PR Description

```markdown
## Description

Adds ORCH to the Frameworks section.

**Entry (multi-line format):**

### [ORCH](https://github.com/oxgeneral/ORCH)

A CLI orchestrator for LLM agent teams (Claude Code, OpenAI Codex, Cursor IDE). Built for developers who run multiple AI agents simultaneously and need coordination, parallelism, and fault tolerance.

- **Multi-agent dispatch** — run Claude, Codex, Cursor, and shell scripts in parallel from one CLI
- **State machine** — tasks flow through `todo → in_progress → review → done` with retries and stall detection
- **Autonomous mode** — set a Goal and ORCH auto-generates tasks for idle agents
- **Inter-agent messaging** — agents share context mid-run via built-in message bus
- **File-only storage** — `.orchestry/` directory with YAML + JSONL, no database required

TypeScript, MIT license, 987 passing tests, Node 20+.

## Why it fits

ORCH fills the gap between single-agent tools (Claude Code, Codex) and heavy orchestration frameworks (LangChain, AutoGen). It's a lightweight CLI-first solution for developers who need to coordinate 3–10 LLM agents on real software engineering tasks without spinning up infrastructure.

## Checklist

- [x] Open-source project (MIT)
- [x] Actively maintained
- [x] Entry format matches existing framework entries (multi-line with heading + bullets)
- [x] Adds genuine value to the list — no direct duplicates
```

---

## Submission Order

| Priority | List | Stars | Action |
|----------|------|-------|--------|
| 1 | agarrharr/awesome-cli-apps | 19k | Open PR now |
| 2 | e2b-dev/awesome-ai-agents | 26.4k | Open PR + submit Google Form |
| 3 | e2b-dev/awesome-sdks-for-ai-agents | 1.1k | Open PR |
| 4 | kaushikb11/awesome-llm-agents | 1.4k | Open PR |
| — | sindresorhus/awesome-nodejs | 65.3k | Wait for 100+ GitHub stars |

## Tips

- Submit PRs one at a time — wait for feedback before opening the next
- Check each repo's `CONTRIBUTING.md` before submitting
- If a PR template exists in the repo, use it and add the entry text inside
- Most lists require alphabetical order within section — double-check placement
- Use the GitHub web editor to make a clean single-commit PR
