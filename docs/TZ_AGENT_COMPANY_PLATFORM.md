# ТЗ: Agent Company Platform

> Отдельный проект на базе ORCH Engine — платформа для создания и управления AI-агентскими организациями через Web UI.

**Статус**: Draft
**Дата**: 2026-03-14
**Зависимость**: ORCH Engine ≥ 1.1.0 (после рефакторинга CliContext → EngineContext)

---

## 1. Видение продукта

### Проблема

ORCH Engine — мощный движок оркестрации AI-агентов, но доступен только через CLI/TUI. Это ограничивает аудиторию:

- **Менеджеры и техлиды** не живут в терминале — им нужен Web UI для мониторинга и управления
- **Новые пользователи** не знают, каких агентов создать и как настроить — им нужны готовые шаблоны
- **Команды** не могут совместно наблюдать за работой агентов — TUI видит только один человек
- **Нетехнические стейкхолдеры** вообще не могут взаимодействовать с системой

### Решение

**Agent Company Platform (ACP)** — Web-приложение, которое:

1. Предоставляет **Web UI** для управления агентами, задачами, командами и целями
2. Предлагает **Organization Templates** — готовые конфигурации агентских команд за один клик
3. Работает на том же `.orchestry/` state — CLI и Web UI полностью совместимы
4. Запускается одной командой: `orch ui` или как standalone сервер

### Целевая аудитория

| Персона | Потребность | Как пользуется |
|---|---|---|
| **Индивидуальный разработчик** | Быстро поднять команду агентов без ручной настройки | Organization Templates + мониторинг |
| **Техлид** | Мониторить прогресс, контролировать бюджеты, approve задачи | Dashboard + Review workflow |
| **Менеджер** | Видеть статус проектов, понимать расходы | Read-only dashboard |
| **Команда** | Совместный мониторинг работы агентов | Shared Web UI + WebSocket live updates |

---

## 2. Архитектура

### Общая схема

```
┌──────────────────────────────────────────────┐
│                 Web Frontend                  │
│            React + TailwindCSS               │
│   Dashboard │ Tasks │ Agents │ Teams │ Goals │
│   Activity Feed │ Org Templates │ Settings   │
└──────────────────┬───────────────────────────┘
                   │ HTTP REST + WebSocket
┌──────────────────▼───────────────────────────┐
│                 Web Backend                   │
│              Fastify + WS                    │
│                                               │
│   REST API        WebSocket Hub    Template   │
│   /api/tasks      live events      Registry   │
│   /api/agents     run logs                    │
│   /api/teams      activity feed              │
│   /api/goals                                  │
│   /api/orgs                                   │
└──────────────────┬───────────────────────────┘
                   │ programmatic import
┌──────────────────▼───────────────────────────┐
│              @oxgeneral/orch (Engine)         │
│                                               │
│   Container    Services    EventBus           │
│   Orchestrator Adapters    Stores             │
│   State Machine            Templates          │
└──────────────────────────────────────────────┘
                   │
            .orchestry/ (filesystem)
```

### Принципы

1. **Engine as dependency** — ACP импортирует `@oxgeneral/orch` как npm-пакет. Не форк, не копия.
2. **Shared state** — Web UI и CLI работают с одним `.orchestry/`. Изменение в CLI мгновенно видно в Web.
3. **Event-driven** — `EventBus.onAny()` → WebSocket broadcast. Никакого polling.
4. **Stateless backend** — сервер не хранит своё состояние. Всё в `.orchestry/` через engine stores.
5. **Local-first** — по умолчанию `localhost:3847`. Опционально — открыть в сеть (с auth).

---

## 3. Структура проекта

```
agent-company-platform/
├── package.json
├── tsconfig.json
├── src/
│   ├── server/                    # Fastify backend
│   │   ├── app.ts                 # Fastify instance, plugin registration
│   │   ├── engine-bridge.ts       # Container pool, engine lifecycle
│   │   ├── ws-hub.ts              # WebSocket broadcast hub
│   │   ├── routes/
│   │   │   ├── tasks.ts           # CRUD + status transitions
│   │   │   ├── agents.ts          # CRUD + enable/disable
│   │   │   ├── teams.ts           # CRUD + join/leave
│   │   │   ├── goals.ts           # CRUD + progress
│   │   │   ├── messages.ts        # Send, broadcast, list
│   │   │   ├── runs.ts            # List, events stream (SSE)
│   │   │   ├── context.ts         # Key-value CRUD
│   │   │   ├── orchestrator.ts    # Start/stop watch, run task, status
│   │   │   ├── orgs.ts            # Organization templates CRUD
│   │   │   └── stats.ts           # Aggregated statistics
│   │   └── middleware/
│   │       ├── auth.ts            # Optional token auth
│   │       └── error-handler.ts   # OrchestryError → HTTP status mapping
│   ├── templates/                 # Organization templates (YAML)
│   │   ├── startup-mvp.yml
│   │   ├── pr-review-pipeline.yml
│   │   ├── migration-squad.yml
│   │   ├── content-factory.yml
│   │   ├── security-audit.yml
│   │   ├── test-coverage-blitz.yml
│   │   ├── monorepo-squad.yml
│   │   ├── bugfix-triage.yml
│   │   └── analytics-pipeline.yml
│   └── web/                       # React SPA
│       ├── App.tsx
│       ├── main.tsx
│       ├── hooks/
│       │   ├── useEngine.ts       # REST client
│       │   ├── useWebSocket.ts    # WS connection + reconnect
│       │   └── useEventStream.ts  # SSE for run logs
│       ├── pages/
│       │   ├── Dashboard.tsx      # Overview: active agents, task board, activity
│       │   ├── Tasks.tsx          # Kanban board + table view
│       │   ├── Agents.tsx         # Agent cards + detail panels
│       │   ├── Teams.tsx          # Team topology + management
│       │   ├── Goals.tsx          # Goal tree + progress
│       │   ├── Runs.tsx           # Run history + live log viewer
│       │   ├── OrgTemplates.tsx   # Template gallery + deploy wizard
│       │   └── Settings.tsx       # Config editor, adapter status
│       ├── components/
│       │   ├── TaskBoard.tsx      # Kanban columns: todo → in_progress → review → done
│       │   ├── AgentCard.tsx      # Status, current task, stats
│       │   ├── TeamTopology.tsx   # SVG/Canvas org chart
│       │   ├── ActivityFeed.tsx   # Real-time event stream
│       │   ├── RunLogViewer.tsx   # Live JSONL viewer with syntax highlighting
│       │   ├── ReviewPanel.tsx    # Approve/reject with feedback
│       │   ├── OrgDeployWizard.tsx # Step-by-step org template deployment
│       │   ├── StatCards.tsx      # KPI cards (tasks done, agents active, etc.)
│       │   └── BudgetGauge.tsx    # Token/cost visualization (EP-31)
│       └── lib/
│           ├── api.ts             # Typed fetch wrapper
│           └── ws.ts              # WebSocket client with auto-reconnect
├── test/
└── vite.config.ts
```

---

## 4. Модуль: Engine Bridge

Ключевой модуль, связывающий Web backend с ORCH Engine.

### 4.1 Container Lifecycle

```typescript
// src/server/engine-bridge.ts

import { buildFullContainer, buildLightContainer, type Container, type LightContainer } from '@oxgeneral/orch';

interface EngineBridge {
  // Инициализация — вызывается при старте сервера
  init(projectRoot: string): Promise<void>;

  // Доступ к контейнерам
  getContainer(): Container;
  getLightContainer(): LightContainer;

  // Управление оркестратором
  startOrchestrator(): Promise<void>;   // startWatch()
  stopOrchestrator(): Promise<void>;    // stop()
  isOrchestratorRunning(): boolean;

  // Graceful shutdown
  destroy(): Promise<void>;
}
```

### 4.2 WebSocket Hub

```typescript
// src/server/ws-hub.ts

// Подписывается на EventBus.onAny() и бродкастит всем WS-клиентам.
// Каждый клиент может подписаться на фильтр:
//   { types: ['task:*', 'agent:*'] }        — по типу
//   { agents: ['agt_abc'] }                  — по агенту
//   { tasks: ['tsk_xyz'] }                   — по задаче
//   { runs: ['run_123'] }                    — по run (live logs)

interface WsMessage {
  type: 'event' | 'subscribe' | 'unsubscribe' | 'ping';
  payload: unknown;
}
```

### 4.3 Error Mapping

```
OrchestryError           → HTTP status
─────────────────────────────────────
TaskNotFoundError        → 404
AgentNotFoundError       → 404
GoalNotFoundError        → 404
TeamNotFoundError        → 404
MessageNotFoundError     → 404
InvalidTransitionError   → 409 Conflict
TaskAlreadyRunningError  → 409 Conflict
LockConflictError        → 423 Locked
InvalidArgumentsError    → 400
NotInitializedError      → 503 Service Unavailable
AgentAdapterError        → 502 Bad Gateway
WorkspaceError           → 500
```

---

## 5. Модуль: REST API

### 5.1 Endpoints

```
Tasks
  GET    /api/tasks                    → list (filter: status, goalId, assignee)
  POST   /api/tasks                    → create (CreateTaskInput)
  GET    /api/tasks/:id                → get
  PATCH  /api/tasks/:id                → update (title, description, priority, labels)
  DELETE /api/tasks/:id                → delete
  POST   /api/tasks/:id/assign         → assign { agentId }
  POST   /api/tasks/:id/transition     → updateStatus { status }
  POST   /api/tasks/:id/cancel         → cancel
  POST   /api/tasks/:id/retry          → retry (failed → todo)
  POST   /api/tasks/:id/review         → approve/reject { action: 'approve'|'reject', feedback? }

Agents
  GET    /api/agents                   → list
  POST   /api/agents                   → create (CreateAgentInput)
  GET    /api/agents/:id               → get
  PATCH  /api/agents/:id               → update
  DELETE /api/agents/:id               → remove
  POST   /api/agents/:id/disable       → disable
  POST   /api/agents/:id/enable        → enable
  POST   /api/agents/:id/autonomous    → setAutonomous { enabled }

Teams
  GET    /api/teams                    → list
  POST   /api/teams                    → create (CreateTeamInput)
  GET    /api/teams/:id                → get
  POST   /api/teams/:id/join           → join { agentId }
  POST   /api/teams/:id/leave          → leave { agentId }
  POST   /api/teams/:id/lead           → setLead { agentId }
  POST   /api/teams/:id/tasks          → addTask { taskId }
  DELETE /api/teams/:id/tasks/:taskId  → removeTask
  DELETE /api/teams/:id                → disband

Goals
  GET    /api/goals                    → list (filter: status)
  POST   /api/goals                    → create (CreateGoalInput)
  GET    /api/goals/:id                → get
  PATCH  /api/goals/:id                → update
  DELETE /api/goals/:id                → delete
  POST   /api/goals/:id/transition     → updateStatus { status }
  GET    /api/goals/:id/tasks          → listTasksForGoal
  GET    /api/goals/:id/progress       → getProgressReport

Messages
  GET    /api/messages                 → listAll
  POST   /api/messages                 → send (CreateMessageInput)
  GET    /api/messages/agent/:id       → listForAgent
  GET    /api/messages/agent/:id/pending → listPendingForAgent

Runs
  GET    /api/runs                     → listAll
  GET    /api/runs/:id                 → get
  GET    /api/runs/:id/events          → readEvents (query: tail=N)
  GET    /api/runs/:id/stream          → SSE stream (live events via streamEvents)
  GET    /api/runs/task/:taskId        → listForTask
  GET    /api/runs/agent/:agentId      → listForAgent

Context
  GET    /api/context                  → list
  GET    /api/context/:key             → get
  PUT    /api/context/:key             → set { value, ttl_ms? }
  DELETE /api/context/:key             → delete

Orchestrator
  GET    /api/orchestrator/status      → { running, pid, stats, state }
  POST   /api/orchestrator/start       → startWatch
  POST   /api/orchestrator/stop        → stop
  POST   /api/orchestrator/run-task    → runTask { taskId }
  POST   /api/orchestrator/run-all     → runAll

Organization Templates
  GET    /api/orgs/templates           → list available templates
  GET    /api/orgs/templates/:name     → get template details
  POST   /api/orgs/deploy              → deploy template { name, overrides? }
  POST   /api/orgs/export              → export current setup as template

Config
  GET    /api/config                   → read
  PATCH  /api/config                   → update (partial OrchestratorConfig)

Stats
  GET    /api/stats                    → aggregated statistics
  GET    /api/stats/agents             → per-agent token/cost breakdown
  GET    /api/stats/timeline           → task completion over time

Health
  GET    /api/health                   → { status, engine_version, adapters[] }
```

### 5.2 WebSocket Protocol

```
Client → Server:
  { type: "subscribe", payload: { types?: string[], agents?: string[], tasks?: string[], runs?: string[] } }
  { type: "unsubscribe" }
  { type: "ping" }

Server → Client:
  { type: "event", payload: OrchestratorEvent }
  { type: "pong" }
  { type: "error", payload: { message: string } }
```

---

## 6. Модуль: Organization Templates

### 6.1 Формат шаблона

```yaml
# templates/startup-mvp.yml
name: Startup MVP Sprint
description: |
  Полная команда для быстрого прототипирования:
  CTO декомпозирует цель, Backend и Frontend реализуют,
  QA тестирует, Reviewer проверяет качество.
tags: [startup, fullstack, mvp]
min_agents: 5
estimated_time: "2-4 hours for small MVP"

team:
  name: platform
  description: "Core platform team"

agents:
  - name: cto
    adapter: claude
    role: >
      Senior tech lead and architect.
      Decomposes high-level goals into concrete, actionable tasks.
      Reviews architecture decisions. Resolves inter-agent conflicts.
    config:
      approval_policy: auto
      max_turns: 30
    is_lead: true

  - name: backend-a
    adapter: claude
    role: >
      Backend engineer specializing in APIs, databases, and business logic.
      Implements server-side features with tests.
    config:
      approval_policy: suggest
      workspace_mode: worktree

  - name: backend-b
    adapter: codex
    role: >
      Backend engineer. Implements server-side features in parallel with backend-a.
      Focuses on different modules to avoid scope overlap.
    config:
      approval_policy: suggest
      workspace_mode: worktree

  - name: frontend
    adapter: cursor
    role: >
      Frontend engineer. Builds UI components, pages, and routing.
      Implements responsive design and accessibility.
    config:
      approval_policy: suggest
      workspace_mode: worktree

  - name: qa
    adapter: codex
    role: >
      QA engineer. Writes unit and integration tests.
      Validates API contracts, runs coverage analysis.
    config:
      approval_policy: auto
      workspace_mode: worktree

  - name: reviewer
    adapter: claude
    role: >
      Code reviewer. Reviews every completed task for:
      correctness, security, performance, code style, test coverage.
      Rejects with specific, actionable feedback.
    config:
      approval_policy: auto
      max_turns: 20

goals:
  - title: "Build and ship the MVP"
    description: "Implement the core product features, tests, and documentation"
    assignee: cto

initial_context:
  tech_stack: "Determined during planning phase"
  coding_standards: "TypeScript strict mode, ESLint, Prettier"
```

### 6.2 Каталог шаблонов (v1)

| ID | Название | Агенты | Описание |
|---|---|---|---|
| `startup-mvp` | Startup MVP Sprint | CTO, Backend×2, Frontend, QA, Reviewer | Полный стек для быстрого прототипирования |
| `pr-review-pipeline` | PR Review Pipeline | Security, Performance, Style, QA, CTO | Автоматизированный review всех PR |
| `migration-squad` | Migration Squad | CTO, Migrator×3, QA, Reviewer | JS→TS, фреймворк-миграции |
| `content-factory` | Content Factory | Strategist, Writer×2, Editor, SEO | Производство контента |
| `security-audit` | Security Audit | Shell(Semgrep), Shell(Trivy), Shell(Gitleaks), Hunter, Reviewer | Многоуровневый аудит безопасности |
| `test-coverage-blitz` | Test Coverage Blitz | Shell(c8), Backend×2, QA×2, Reviewer | Быстрое увеличение покрытия тестами |
| `monorepo-squad` | Monorepo Squad | CTO, Backend, Frontend, Infra, QA, Reviewer | Разработка в монорепозитории |
| `bugfix-triage` | Bugfix Triage | Triager, Fixer×3, QA, Reviewer | Массовый разбор бэклога багов |
| `analytics-pipeline` | Analytics Pipeline | Shell(pandas), Shell(duckdb), Shell(matplotlib), Writer | Обработка данных и генерация отчётов |

### 6.3 Deploy Flow

```
1. Пользователь выбирает шаблон в UI (OrgDeployWizard)
2. Показывается preview: какие агенты, команды, цели будут созданы
3. Пользователь может:
   - Изменить имена агентов
   - Выбрать адаптеры (claude/codex/cursor для каждого)
   - Задать начальную цель (overrides goals[0].description)
   - Включить/выключить опциональных агентов
4. POST /api/orgs/deploy → сервер выполняет:
   a. Для каждого agent: agentService.create()
   b. teamService.create() с lead
   c. Для каждого member: teamService.join()
   d. Для каждого goal: goalService.create()
   e. Для каждого context: contextStore.set()
5. Возврат: { agents: [...], team, goals: [...] }
6. UI предлагает: "Start orchestration?" → POST /api/orchestrator/start
```

---

## 7. Модуль: Web Frontend

### 7.1 Стек

- **React 19** + TypeScript
- **TailwindCSS v4** — стилизация
- **Vite** — сборка
- **React Router** — навигация
- **TanStack Query** — серверный стейт, кэширование, оптимистичные обновления
- **Recharts** — графики (token usage, task timeline)
- **@xyflow/react** — org chart визуализация (team topology)

### 7.2 Страницы

#### Dashboard (главная)

```
┌─────────────────────────────────────────────────────┐
│  ORCH                            [Start] [Stop] ⚙  │
├──────────┬──────────┬──────────┬───────────────────┤
│ Tasks: 12│ Active: 3│ Done: 7  │ Failed: 2         │
├──────────┴──────────┴──────────┴───────────────────┤
│                                                     │
│  ┌─ Task Board (Kanban) ─────────────────────────┐ │
│  │ TODO     │ PROGRESS │ REVIEW  │ DONE          │ │
│  │ ┌─────┐  │ ┌─────┐  │ ┌─────┐│ ┌─────┐       │ │
│  │ │tsk_1│  │ │tsk_3│  │ │tsk_5││ │tsk_7│       │ │
│  │ └─────┘  │ └─────┘  │ └─────┘│ └─────┘       │ │
│  └──────────┴──────────┴────────┴────────────────┘ │
│                                                     │
│  ┌─ Activity Feed ───────┬─ Agents ──────────────┐ │
│  │ 12:34 backend-a done  │ backend-a  ● running  │ │
│  │ 12:33 qa started      │ qa         ● running  │ │
│  │ 12:30 reviewer idle   │ reviewer   ○ idle     │ │
│  └───────────────────────┴───────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

#### Tasks — Kanban + Table view

- Drag-and-drop (только разрешённые переходы state machine)
- Фильтры: status, assignee, priority, goal, label
- Detail panel: описание, proof, run history, review actions
- Approve/Reject с feedback

#### Agents — Card grid

- Карточка агента: имя, адаптер, статус, текущая задача, stats
- Detail: config, run history, token usage chart
- Actions: enable/disable, set autonomous, edit config

#### Teams — Topology view

- Interactive org chart (@xyflow/react)
- Lead → members связи
- Task pool management
- Messaging: отправить direct/broadcast

#### Goals — Tree + Progress

- Цель → связанные задачи (progress bar)
- Status transitions (active/paused/achieved/abandoned)
- Auto-generated progress report из context store

#### Runs — Log viewer

- Таблица: run ID, task, agent, status, duration, tokens
- Live log viewer: SSE stream с syntax highlighting
- Error details с hint из `ERROR_HINTS`

#### Org Templates — Gallery

- Карточки шаблонов с описанием, кол-вом агентов, тегами
- Deploy wizard (step-by-step)
- "Export current setup" — сохранить текущую конфигурацию как шаблон

#### Settings

- Config editor (OrchestratorConfig)
- Adapter status (doctor check)
- Auth token management (если включен)

### 7.3 Real-time обновления

```
Frontend                    Backend                    Engine
   │                           │                          │
   │── WS connect ────────────►│                          │
   │── subscribe {types:*} ───►│                          │
   │                           │◄── eventBus.onAny() ────│
   │◄── event: task:created ──│                          │
   │   [TanStack Query         │                          │
   │    invalidates cache,     │                          │
   │    UI updates]            │                          │
```

---

## 8. Модуль: Budget & Cost Tracking

> Зависимость: EP-31 из USER_STORIES.md должен быть реализован в engine.

### 8.1 Данные (engine level)

```typescript
// Новые поля в Agent
interface AgentBudget {
  monthly_limit_usd?: number;
  current_month_usd: number;
  month_reset_at: string;        // ISO, 1-е число следующего месяца
}

// Новые поля в Run
interface TokenUsage {
  input: number;
  output: number;
  total: number;
  estimated_cost_usd?: number;   // рассчитывается по model pricing
}
```

### 8.2 UI компоненты

- **BudgetGauge** — circular progress (текущие расходы / лимит)
- **CostTable** — per-agent breakdown (tokens, estimated USD)
- **CostTimeline** — Recharts line chart (расходы по дням)
- **BudgetAlert** — toast при 80% бюджета (через WS event)

---

## 9. Интеграция с CLI

### 9.1 Запуск через CLI

```bash
# Встроенная команда в ORCH CLI
orch ui                          # localhost:3847
orch ui --port 8080              # custom port
orch ui --host 0.0.0.0           # открыть в сеть
orch ui --auth-token <token>     # защита токеном

# Или standalone
npx @oxgeneral/agent-company     # если установлен отдельно
```

### 9.2 Совместная работа CLI + Web

```
Terminal A:  orch run --all --watch     (оркестратор работает)
Browser:     http://localhost:3847      (Web UI мониторит)
Terminal B:  orch task add "..."        (CLI добавляет задачи)

Все три видят одно и то же состояние в реальном времени.
```

### 9.3 Organization Templates в CLI

```bash
# Шаблоны доступны и из CLI
orch org list                           # показать все шаблоны
orch org info startup-mvp               # детали шаблона
orch org deploy startup-mvp             # развернуть шаблон
orch org deploy startup-mvp --goal "Build auth system"   # с целью
orch org export my-setup                # экспортировать текущую конфигурацию
```

---

## 10. Безопасность

### 10.1 Auth (опционально)

- По умолчанию: без auth (localhost only)
- При `--host 0.0.0.0`: требуется `--auth-token`
- Token передаётся в `Authorization: Bearer <token>`
- WebSocket: token в query `?token=<token>`

### 10.2 Ограничения

- Web UI **не выполняет** shell-команды напрямую — только через engine adapters
- File-based storage ограничен `.orchestry/` — нет доступа к произвольным файлам
- Rate limiting на API endpoints (100 req/s default)

---

## 11. Технические требования

### 11.1 Runtime

- Node.js ≥ 20
- ORCH Engine ≥ 1.1.0 (с EngineContext)
- Современные браузеры (Chrome 90+, Firefox 90+, Safari 15+)

### 11.2 Performance

- Время старта сервера: < 2 секунды
- Первый paint Web UI: < 1 секунда
- WebSocket latency: < 100ms от engine event до UI update
- API response time: < 50ms для CRUD операций
- Поддержка: до 50 одновременных WS-клиентов

### 11.3 Package

```json
{
  "name": "@oxgeneral/agent-company",
  "description": "Web UI and Organization Templates for ORCH Engine",
  "peerDependencies": {
    "@oxgeneral/orch": ">=1.1.0"
  }
}
```

---

## 12. User Stories

### EP-ACP-1. Web Server

| ID | User Story |
|---|---|
| ACP-1.1 | Как разработчик, я хочу запустить Web UI командой `orch ui`, чтобы видеть дашборд в браузере |
| ACP-1.2 | Как разработчик, я хочу чтобы Web UI работал с тем же `.orchestry/` что и CLI, чтобы не дублировать state |
| ACP-1.3 | Как разработчик, я хочу получать live-обновления через WebSocket, чтобы видеть изменения в реальном времени |
| ACP-1.4 | Как техлид, я хочу защитить Web UI токеном при открытии в сеть, чтобы предотвратить несанкционированный доступ |
| ACP-1.5 | Как разработчик, я хочу чтобы ошибки engine маппились в HTTP-статусы, чтобы API был предсказуемым |

### EP-ACP-2. Dashboard

| ID | User Story |
|---|---|
| ACP-2.1 | Как менеджер, я хочу видеть обзор: кол-во задач по статусам, активные агенты, прогресс целей |
| ACP-2.2 | Как техлид, я хочу видеть Kanban-доску задач с drag-and-drop, чтобы управлять workflow визуально |
| ACP-2.3 | Как менеджер, я хочу видеть activity feed в реальном времени, чтобы следить за событиями |
| ACP-2.4 | Как техлид, я хочу approve/reject задачи из Web UI, чтобы управлять review без CLI |

### EP-ACP-3. Agent & Team Management

| ID | User Story |
|---|---|
| ACP-3.1 | Как техлид, я хочу видеть карточки агентов с статусом и статистикой |
| ACP-3.2 | Как техлид, я хочу видеть org chart команды с interactive topology |
| ACP-3.3 | Как техлид, я хочу отправлять сообщения агентам из Web UI |
| ACP-3.4 | Как техлид, я хочу управлять командами (create/join/leave/disband) из Web UI |

### EP-ACP-4. Organization Templates

| ID | User Story |
|---|---|
| ACP-4.1 | Как разработчик, я хочу видеть галерею готовых шаблонов организаций, чтобы быстро начать |
| ACP-4.2 | Как разработчик, я хочу развернуть шаблон за один клик через wizard, чтобы не настраивать агентов вручную |
| ACP-4.3 | Как разработчик, я хочу кастомизировать шаблон перед деплоем (адаптеры, имена, цели) |
| ACP-4.4 | Как разработчик, я хочу экспортировать текущую конфигурацию как шаблон, чтобы переиспользовать |
| ACP-4.5 | Как разработчик, я хочу использовать шаблоны из CLI (`orch org deploy`), чтобы не переключаться в браузер |

### EP-ACP-5. Run Logs & Monitoring

| ID | User Story |
|---|---|
| ACP-5.1 | Как разработчик, я хочу видеть live-лог текущего run с syntax highlighting |
| ACP-5.2 | Как техлид, я хочу видеть историю всех runs с фильтрами по agent/task/status |
| ACP-5.3 | Как техлид, я хочу видеть статистику токенов и расходов по агентам и задачам |

---

## 13. Фазы реализации

### Phase 1: Foundation (1 неделя)

- Engine Bridge (container lifecycle, WS hub)
- REST API (tasks, agents, teams CRUD)
- Минимальный frontend: Dashboard + Task list
- `orch ui` команда в CLI

### Phase 2: Real-time + Review (1 неделя)

- WebSocket live events
- Activity feed
- Review panel (approve/reject)
- Run log viewer (SSE stream)

### Phase 3: Organization Templates (1 неделя)

- Template format + registry
- 9 шаблонов v1
- Deploy wizard (Web + CLI)
- Export current setup

### Phase 4: Rich UI (1 неделя)

- Kanban drag-and-drop
- Team topology (interactive org chart)
- Agent detail panels
- Goal tree + progress

### Phase 5: Budget & Polish (1 неделя)

- Budget tracking UI (зависит от EP-31 в engine)
- Stats & analytics page
- Settings page
- Auth middleware
- Mobile responsive

---

## 14. Acceptance Criteria

1. **`orch ui` запускается** и открывает дашборд в браузере
2. **Все engine CRUD** доступны через REST API и отражаются в Web UI
3. **Live updates** — изменение в CLI мгновенно видно в Web UI (< 100ms)
4. **Organization Templates** — можно развернуть шаблон через wizard за < 30 секунд
5. **Review workflow** — approve/reject из Web UI корректно переводит задачи по state machine
6. **Run logs** — live streaming без задержки
7. **CLI + Web совместимость** — оба интерфейса работают с одним `.orchestry/` без конфликтов
8. **Zero new dependencies for engine** — ACP это отдельный пакет, engine не знает о нём

---

## 15. Что НЕ входит в v1

- Multi-project (multi-tenant) — EP-33, отложено
- Cloud deployment — только localhost
- User management / RBAC — только token auth
- Billing integration — только отображение estimated cost
- Mobile app — только responsive web
- Plugin system для шаблонов — пока hardcoded в пакете
