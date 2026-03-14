# Landing Page Draft — Zero-Human Companies

> Текстовый wireframe: полный copy для каждой секции index.html
> Секции в порядке scroll. Принципы: AIDA, Activation Energy, Loss Aversion, Unity, Contrast, Zero-Price.

---

## META

```
<title>ORCH — Open-Source Orchestration for Zero-Human Companies, Processes and Departments</title>
<meta description>Deploy AI departments — engineering, editorial, sales, analytics — from your terminal. State machine governance, inter-agent messaging, git isolation. Free forever. MIT.</meta>
<og:title>ORCH — Zero Employees. Full Departments. One npm install.</og:title>
<og:description>Open-source orchestration for zero-human companies. Deploy engineering, editorial, sales, or analytics departments — set goals, ship results while you sleep. MIT. Zero cloud.</og:description>
```

---

## NAV

```
ORCH        Departments    How it works    FAQ    Compare    npm    [GitHub →]
```

---

## HERO

**Badge**: `Open source · MIT · v1.0.0`

**H1**: Launch zero-human *companies, processes and departments*

**Sub**: Engineering, editorial, sales, analytics — deploy entire AI departments that set goals, execute in parallel, communicate, retry on failure, and deliver results. From your terminal. Free forever.

**CTA**: [Deploy your first department]  [See it in action ↓]

**Meta bar**: `10 department templates · 15 AI employees · 0 humans required · 30s to launch`

**Terminal (right side)**:

```
$ orch org deploy startup-mvp --goal "Build auth module"

  ✓ Deployed team "platform" — 5 agents
  ✓ CTO decomposed goal → 6 tasks

$ orch run --all --watch

  ● Running — 5 agents dispatched

    CTO         decomposing goal        [strategy]
    Backend A   implementing OAuth2     [feature/oauth]
    Backend B   JWT token service       [feature/jwt]
    QA          waiting for completions
    Reviewer    waiting for reviews

    ✉ Backend A → QA "Auth module ready for testing"
    ✓ tsk_a1b — review complete — merging [feature/oauth] → main
```

---

## STATS BAR

```
10             15               0                30s
department     AI employees     humans required  to launch
templates
```

---

## SOCIAL PROOF — Adapters

**Label**: Your tools become your employees

**Grid** (5 cards):

| Claude | OpenCode | Codex | Cursor | Shell |
|--------|----------|-------|--------|-------|
| Anthropic | Multi-provider | OpenAI | Cursor CLI | **Any CLI Tool** |
| CTO, Writer, Analyst | Backend, Frontend | Backend, QA | Frontend | Sales, Analytics, DevOps, Security — **any role** |


**Credibility bar**: `MIT licensed · 97 source files · 100% TypeScript · Zero runtime deps`

---

## PROBLEM-SOLUTION

**Label**: The management problem

**H2**: One agent is a tool. A department is a *company*.

### Grid (5 pairs)

**Without ORCH → With ORCH**

1. **Manual agent juggling → CTO routes work automatically**
  - "You copy-paste between AI tools. Context lost. Three terminals open. You're the router."
  - "Your CTO agent decomposes goals into tasks, assigns to the right department, and tracks completion."
  - Tags: `you are the bottleneck` → `CEO, not router`
2. **Agents in silos → Departments that communicate**
  - "Each agent works alone. No shared context. Backend finishes — you manually tell QA to start."
  - "Backend finishes → sends message to QA → QA starts automatically. Shared context store keeps everyone aligned."
  - Tags: `isolated agents` → `connected departments`
3. **Zero governance → State machine process**
  - "No review process. No state tracking. Agent output goes straight to main. Hope it works."
  - "Every task: todo → in_progress → review → done. Nothing merges without your approval. Failed runs auto-retry."
  - Tags: `yolo deployment` → `governed process`
4. **One agent at a time → Full parallel department**
  - "You wait for Claude to finish before starting Codex. Serial execution. Wasted hours."
  - "5 agents in parallel, each on its own git branch. Worktree isolation — zero file conflicts."
  - Tags: `serial bottleneck` → `parallel departments`
5. **Surprise API bills → Token visibility per agent**
  - "End of month: $180 bill. No idea which agent, which task, which run cost what."
  - "Real-time token tracking per agent, per run, per task. You see exactly where money goes."
  - Tags: `billing surprise` → `cost transparency`

**CTA**: Your agents deserve departments, not terminals →

---

## TERMINAL DEMO

**Label**: See for yourself

**H2**: From zero to AI company in *30 seconds*

```
$ npm install -g @oxgeneral/orch
  ✓ orchestry installed

$ cd ~/my-project && orch
  ✓ Initialized .orchestry/
  → Launching command center...

$ orch org deploy startup-mvp --goal "Implement user auth"
  ✓ Deployed team "platform"
  ✓ CTO (claude) — decomposing goal...
  ✓ CTO created 6 tasks:
      1. Database schema for users     → Backend B
      2. OAuth2 flow                   → Backend A
      3. JWT token service             → Backend B
      4. Role-based middleware          → Backend A
      5. Auth integration tests         → QA
      6. Security review               → Reviewer

$ orch run --all --watch
  ● Running — 5 agents active · worktree isolation · auto merge-back

    Backend A: implementing OAuth2     [feature/oauth]
    Backend B: JWT token service       [feature/jwt]
    QA:        waiting...
    Reviewer:  waiting...

  ✉ Backend B → QA "JWT service ready, test the /auth/token endpoint"
  ✓ Backend B  DONE (12m · 4,200 tokens · $0.63)
  ✓ Backend A  DONE (19m · 8,100 tokens · $1.22)
  ✓ QA         DONE (6m · 2,800 tokens · $0.42)
  ✓ Reviewer   DONE — all tasks in review

$ orch task review --approve-all
  ✓ 6 tasks approved · merging → main
  ✓ Total: $4.20 · 6 PRs · 0 humans
```

---

## SCREENSHOT / VIDEO

**H2**: Your AI company *command center*

**Sub**: Real-time TUI dashboard — departments working, agents reporting, PRs landing. Tasks, agents, goals — all managed from one terminal.

[Video: demo.mp4 / screenshot-tui.png]

---

## MID-PAGE CTA

**Text**: **Ready to launch your AI company?** One command to install. One command to deploy.

**CTA**: [Deploy your first AI team]

---

## BEYOND ENGINEERING

**Label**: Not just code

**H2**: Any process. Any department. *Zero humans.*

**Sub**: The shell adapter runs any CLI tool. That means ORCH orchestrates any workflow — not just engineering. If it runs in a terminal, it's an employee.

**Grid** (4 columns, visual cards):

| Engineering | Editorial | Sales & Outreach | Analytics |
|-------------|-----------|------------------|-----------|
| CTO decomposes goals | Strategist plans content calendar | Researcher finds leads | Shell (pandas) cleans data |
| Backend x2 writes code in parallel | Writer x2 drafts articles | Copywriter writes sequences | Shell (duckdb) computes KPIs |
| QA runs tests automatically | Editor reviews and polishes | Shell sends personalized emails | Shell (matplotlib) generates charts |
| Reviewer checks quality | SEO optimizes for search | QA validates deliverability | Analyst writes executive narrative |
| **State machine: todo → review → done** | **Same governance** | **Same governance** | **Same governance** |

**Key message**: `orch org deploy content-agency --goal "Write 10 blog posts about AI agents"`
Same state machine. Same retry. Same messaging. Same review gate. Different department.

---

## FEATURES

**H2**: Built for *companies*, not demos

**Count**: 12 features · 4 departments

### Feature Category 1: STRATEGY (new, accent border)

**Icon**: crosshair
**Label**: STRATEGY · NEW
**Title**: You're the CEO. AI is the Team.
**Desc**: Set a goal — your CTO agent decomposes it into tasks, assigns to departments, and tracks progress. You set direction. AI executes.
**Items**:

- **Goals & Autonomous Decomposition** — define a goal, CTO generates tasks, departments execute
- **Reactive Dispatch** — sub-second task pickup, events trigger agents immediately
- **Smart Retries** — exponential backoff, stall detection, zombie cleanup

### Feature Category 2: DEPARTMENTS (new, accent border)

**Icon**: org chart
**Label**: DEPARTMENTS · NEW
**Title**: Real Org Chart. Not Just Agent Names.
**Desc**: CTO, Backend, QA, Reviewer — organized in teams with leads, shared task pools, and messaging. Like a real company org chart.
**Items**:

- **Teams with Leads** — CTO routes work, resolves conflicts, coordinates departments
- **Inter-Department Messaging** — direct messages, broadcasts, shared context store
- **Pre-Built Companies** — `orch org deploy startup-mvp` — full department in 30 seconds

### Feature Category 3: GOVERNANCE

**Icon**: shield
**Label**: GOVERNANCE
**Title**: Nothing Ships Without Your Approval.
**Desc**: Every task flows through the state machine. Every agent isolated on its own branch. Every change reviewed before merge. You're the final gate.
**Items**:

- **State Machine** — `todo` → `in_progress` → `review` → `done` — every transition validated
- **Worktree Isolation** — each agent gets its own git branch, parallel without conflicts
- **Auto Merge-Back** — approved tasks merge to main automatically, no manual git

### Feature Category 4: OPERATIONS

**Icon**: terminal
**Label**: OPERATIONS
**Title**: Zero Infrastructure. Just `npm install`.
**Desc**: No database. No cloud. No Docker. No signup. State in `.orchestry/` — YAML, JSON, JSONL. Git clone and your whole company runs.
**Items**:

- **TUI Command Center** — live tasks, agent activity, token usage, keyboard-driven
- **Reject & Rework** — reject with feedback, agent retries with your notes
- **Token Tracking** — per agent, per run, per task — know exactly where money goes

---

## TEAMS SECTION

**Label**: Only in ORCH

**H2**: Agent *departments*, not just execution

**Sub**: Keep using Claude and Cursor — now they're organized into departments. CTO routes work, Backend builds, QA tests, Reviewer checks. They message each other, share context, and self-coordinate.

**Topology SVG**: CTO (lead, gold) → Backend (blue) / QA (green) / Reviewer (purple). Animated message dots flowing between nodes.

**Feature list**:

- **Department leads** — CTO agent routes work and resolves conflicts
- **Direct messaging** — Backend tells QA "auth module ready for testing"
- **Team broadcasts** — "API v2 spec is ready" → all departments
- **Mailbox delivery** — messages land in agent prompts at dispatch time
- **Shared context** — key-value store: tech stack, conventions, decisions
- **Auto work distribution** — idle agents claim tasks from department pool

**Terminal demo**:

```
# Create a department with a lead
$ orch team create platform --lead cto
  ✓ Created department "platform" → team_k2m

# Add an employee
$ orch team join team_k2m backend-a
  ✓ Agent backend-a joined department platform

# Direct message between departments
$ orch msg send qa "OAuth2 module ready for testing"
  ✓ Message sent → qa

# Broadcast to all departments
$ orch msg broadcast "API v2 spec is ready" --team team_k2m
  ✓ Broadcast sent to 4 agent(s)

# Share company context
$ orch context set db_schema "users(id,email,role)"
  → Shared with all agents
```

---

## WORKFLOW

**Label**: How it works

**H2**: Four steps to your AI *company*

### Step 01: Install

One package. Zero dependencies. Ready in 10 seconds.
`npm i -g @oxgeneral/orch`

### Step 02: Deploy

Choose a pre-built company or create your own. CTO, backend, QA, reviewer — deployed with one command.
`orch org deploy startup-mvp`

### Step 03: Set a goal

Tell your CTO what to build. It decomposes into tasks and assigns to departments.
`orch goal add "Build auth module"`

### Step 04: Review & ship

Approve, reject with feedback, or let agents iterate. Approved tasks merge to main automatically.
`orch run --all --watch`

---

## USE CASES

**Label**: What founders build with ORCH

**H2**: Zero-human departments *in action*

### Engineering

1. **Startup** — `Overnight MVP Sprint` — Ship an MVP in 48 hours. $4-8 in tokens. `orch org deploy startup-mvp`
2. **Sprint** — `Weekend Sprint Offload` — 18 tasks Friday → 60% done Monday. `orch org deploy sprint-team`
3. **Migration** — `JS → TypeScript at Scale` — Parallel migration, main stays green. `orch org deploy migration-squad`
4. **DevOps** — `24/7 PR Review` — Every PR reviewed in under 10 minutes. `orch org deploy pr-review-corp`
5. **Security** — `Multi-Layer Audit` — Semgrep + Trivy + Gitleaks + AI hunter. `orch org deploy security-dept`
6. **QA** — `Coverage Blitz` — 40% to 80% overnight. `orch org deploy test-factory`

### Non-Engineering

7. **Editorial** — `Content Factory` — Strategist plans, Writers draft, Editor polishes, SEO optimizes. 10 posts/week, zero writers on payroll. `orch org deploy content-agency`
8. **Analytics** — `Executive Reports` — Drop CSVs → pandas + duckdb + matplotlib → narrative report by morning. `orch org deploy data-lab`
9. **Sales** — `Outreach Machine` — Research leads, write sequences, send via email tool, validate deliverability. Pipeline fills while you sleep. `orch org deploy sales-machine`

---

## FAQ

**Label**: Frequently asked

**H2**: *Questions*

### Q: Do I need a team to use ORCH?

No. **Solo founders are the primary users.** You + 2 agents is already a zero-human company. ORCH gives you auto-retry, state machine, dashboard, and token tracking even with one agent. Start solo, scale to departments.

### Q: Will agents mess up my codebase?

Every agent works in an isolated git worktree on its own branch. `main` is never touched until you review and approve. Mandatory review step. Scope overlap detection. By design, agents cannot conflict with each other.

### Q: Does my code leave my machine?

Only when talking to AI APIs (same as using Claude directly). ORCH itself stores everything locally in `.orchestry/` — no telemetry, no cloud, no external state.

### Q: How is this different from Paperclip?

Paperclip needs PostgreSQL, a web server, and onboarding. ORCH needs `npm install`. Same vision — zero-human companies — but ORCH is terminal-first, file-based, zero infrastructure, free forever.

### Q: Is this only for engineering?

No. The shell adapter runs any CLI tool — which means ORCH orchestrates any process. Engineering, editorial, sales, analytics, security. If it runs in a terminal, it's an employee. Deploy `content-agency`, `data-lab`, or `sales-machine` — same governance, same retry, same messaging.

### Q: How is this different from running Claude/Cursor directly?

Running agents directly = you're the router. ORCH = you're the CEO. State machine tracking, inter-department messaging, shared context, auto-retry, worktree isolation, merge-back, goals, departments. You set direction. AI does the work.

### Q: What AI tools does it support?

Five adapters: Claude, OpenCode (Gemini, DeepSeek via OpenRouter), Codex, Cursor, and Shell (any CLI). If it takes a prompt and returns output, ORCH can employ it.

### Q: What happens when an agent fails?

ORCH retries with exponential backoff. If stalled, the process is killed and re-queued. Failed runs preserve full event logs for debugging. No state is lost. No manual intervention needed.

---

## CTA / INSTALL

**Label**: Launch your AI company

**H2**: Start shipping with your AI *department*

**Sub**: One command to install. One command to deploy.

```
$ npm install -g @oxgeneral/orch     [click to copy]
              then
$ orch org deploy startup-mvp        [click to copy]
```

**Links**: [Star on GitHub]  [View on npm]  [Read the docs]

**Trust**: `MIT licensed · 15 AI employees · 0 cloud deps · 30s to launch`

---

## FOOTER

**Brand**: ORCH — Open-source orchestration for zero-human companies, processes and departments. Built with TypeScript. Runs on macOS, Linux, and Windows.

**Product**: Departments, How it works, Install
**Resources**: Documentation, Changelog, npm, Report a Bug
**Community**: GitHub, Discussions, Contributing, MIT License

**Bottom**: (c) 2026 ORCH — Open Source, MIT License | v1.0.0 — Built with TypeScript

---

## STRUCTURED DATA (JSON-LD updates)

```json
{
  "name": "ORCH",
  "description": "Open-source orchestration for zero-human companies, processes and departments. Deploy AI departments — engineering, editorial, sales, analytics — from your terminal with state machine governance, git isolation, and inter-agent messaging.",
  "applicationSubCategory": "AI Company Runtime",
  "featureList": [
    "Zero-human company orchestration",
    "AI department deployment (org templates)",
    "State machine task governance",
    "Git worktree isolation per agent",
    "Inter-department messaging and broadcasts",
    "Goal decomposition into tasks",
    "Team-based agent coordination with leads",
    "Autonomous task generation",
    "TUI command center with real-time monitoring",
    "Zero cloud dependencies"
  ]
}
```

---

## COPY CHANGELOG (vs current)


| Element        | Was                                                      | Now                                                     | Why                                      |
| -------------- | -------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| Title          | "Turn Your AI Tools Into a Coordinated Engineering Team" | "Open-Source Orchestration for Zero-Human Companies"    | Category creation > feature description  |
| H1             | "Turn Claude, Cursor, and Codex into one team"           | "Launch a zero-human engineering company"               | Vision > tool description                |
| Sub            | "each on its own git branch, with automatic retries"     | "CTO, backend, QA, reviewer — an entire AI department"  | Concrete departments > abstract features |
| Stats          | "10s / 5 / 15 / 0 cloud"                                 | "6 departments / 15 employees / 0 humans / 30s"         | Company framing > tool metrics           |
| Adapters label | "Plug into the tools you already use"                    | "Your AI tools become your employees"                   | Employment metaphor                      |
| PS heading     | "One agent is a toy. A team is a force."                 | "One agent is a tool. A department is a company."       | Company framing                          |
| PS CTA         | "Your agents deserve a runtime, not a babysitter"        | "Your agents deserve departments, not terminals"        | Department framing                       |
| Feature 1      | "Agents That Talk to Each Other"                         | "You're the CEO. AI is the Team."                       | Identity transformation                  |
| Feature 2      | "Set a Goal, Go to Sleep"                                | "Real Org Chart. Not Just Agent Names."                 | Concrete structure                       |
| Feature 3      | "Nothing Touches Main Until You Approve"                 | "Nothing Ships Without Your Approval."                  | CEO language                             |
| Feature 4      | "Zero Infrastructure. Just Files."                       | "Zero Infrastructure. Just npm install."                | Activation energy                        |
| Teams sub      | "Keep using Claude and Cursor. Now they work together."  | "Now they're organized into departments."               | Org structure                            |
| Workflow       | "Four steps to orchestration"                            | "Four steps to your AI company"                         | Company framing                          |
| CTA H2         | "Start shipping with your AI team"                       | "Start shipping with your AI department"                | Scale up                                 |
| Footer         | "The open-source runtime for AI agent teams"             | "Open-source orchestration for zero-human companies"    | Category ownership                       |
| FAQ top        | "Do I need a team?"                                      | "Do I need a team?" → "Solo founders are primary users" | Reframe identity                         |
| Install CTA    | `orch`                                                   | `orch org deploy startup-mvp`                           | Show the vision, not the tool            |


