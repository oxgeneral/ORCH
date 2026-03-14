# AgentsOrchestry CLI — Техническое задание

## 1. Концепция

**AgentsOrchestry** — легковесный CLI-оркестратор AI-агентов, работающий в терминале.
Запускается мгновенно, живёт в контексте текущей директории (как Claude Code), управляет командой агентов через задачи (как Paperclip), без внешних серверов и баз данных.

### Ключевая идея

```
Директория проекта = весь контекст.
CLI = единая точка управления агентами.
Задачи = единица работы.
```

### Что это НЕ является

- Не веб-приложение и не сервер
- Не фреймворк для создания агентов
- Не чат-бот
- Не workflow builder с визуальным редактором

### Короткие aliases

Основная команда: `orchestry`. Рекомендуемые сокращения (через симлинк или alias в package.json bin):

- `orch` — основной короткий alias
- `ao` — минимальный alias

---

## 2. Принципы проектирования

| Принцип | Описание |
|---------|----------|
| **Directory-scoped** | Всё состояние хранится в `.orchestry/` внутри проекта |
| **Zero config startup** | `orchestry` — и ты в деле. Конфигурация опциональна |
| **Lightweight** | Быстрый запуск (<500ms), минимум зависимостей |
| **Agent-agnostic** | Адаптеры для Claude Code, Codex, Cursor, любых CLI-агентов |
| **Offline-first** | Работает без внешних сервисов (трекеры, БД) |
| **Observable** | Каждое действие агента логируется и доступно для ревью |

---

## 3. Стек технологий

| Компонент | Технология | Обоснование |
|-----------|------------|-------------|
| Язык | **TypeScript** | Типизация, быстрая разработка, экосистема CLI-инструментов |
| Runtime | **Node.js 20+** (или **Bun**) | Широкая совместимость, встроенный `child_process` |
| CLI framework | **Commander.js** + **Ink** (React для терминала) | Commander для команд, Ink для интерактивного TUI |
| Хранилище | **JSON/YAML файлы** в `.orchestry/` | Никаких БД, всё в git |
| Process management | **Node.js child_process** | Запуск и мониторинг агентов как подпроцессов |
| IPC | **JSON-lines через stdout/stderr** | Универсальный протокол (как в Symphony) |

---

## 4. Архитектура

### 4.1. Высокоуровневая схема

```
┌─────────────────────────────────────────────────────┐
│                   CLI Interface                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │ Commands │  │ TUI/REPL │  │ Status Dashboard   │ │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘ │
│       └──────────────┼─────────────────┘             │
│                      ▼                               │
│              ┌───────────────┐                       │
│              │  Orchestrator │ ← state machine       │
│              └───────┬───────┘                       │
│         ┌────────────┼────────────┐                  │
│         ▼            ▼            ▼                  │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐          │
│  │Task Manager│ │Agent Pool│ │Event Bus │          │
│  └─────┬──────┘ └────┬─────┘ └────┬─────┘          │
│        │              │            │                 │
│        ▼              ▼            ▼                 │
│  .orchestry/     Adapters      Logs/Events          │
│  ├─ tasks/       ├─ claude                           │
│  ├─ agents/      ├─ codex                            │
│  ├─ runs/        ├─ cursor                           │
│  ├─ config.yml   ├─ shell                            │
│  └─ state.json   └─ custom                           │
└─────────────────────────────────────────────────────┘
```

### 4.2. Модули системы

```
src/
├── domain/                        # Доменные модели и бизнес-правила
│   ├── task.ts                    # Task, TaskStatus, TaskProof
│   ├── agent.ts                   # Agent, AgentStatus, AgentStats
│   ├── run.ts                     # Run, RunStatus
│   ├── goal.ts                    # Goal, GoalStatus
│   ├── team.ts                    # Team, TeamMember, TeamConfig
│   ├── message.ts                 # Message, MessageStatus
│   ├── events.ts                  # OrchestratorEvent (31 тип событий)
│   ├── errors.ts                  # Доменные ошибки (NotInitializedError и др.)
│   ├── transitions.ts             # State machine: VALID_TRANSITIONS
│   ├── state.ts                   # OrchestratorState (running, claimed, retry_queue, stats)
│   ├── scope.ts                   # Scope overlap detection
│   ├── config.ts                  # Конфигурация оркестратора (poll_interval, timeouts)
│   ├── global-config.ts           # Глобальная конфигурация (~/.orch/)
│   └── default-agents.ts          # Агенты по умолчанию (Agent Creator)
│
├── application/                   # Сервисный слой (бизнес-логика)
│   ├── orchestrator.ts            # Главный оркестратор (tick, dispatch, reconcile)
│   ├── task-service.ts            # CRUD задач + валидация + depends_on
│   ├── agent-service.ts           # Управление агентами + skills matching
│   ├── run-service.ts             # Управление запусками + event streaming
│   ├── goal-service.ts            # Цели + autonomous mode toggle
│   ├── team-service.ts            # Команды + task pool + lead
│   ├── message-service.ts         # Сообщения + broadcast + inbox
│   ├── review-runner.ts           # Авто-ревью задач
│   ├── doctor-service.ts          # Диагностика (orch doctor)
│   └── event-bus.ts               # Шина событий (pub/sub, wildcard, maxListeners)
│
├── infrastructure/                # Инфраструктурный слой
│   ├── adapters/                  # Адаптеры агентов
│   │   ├── interface.ts           # AgentAdapter интерфейс
│   │   ├── registry.ts            # Реестр адаптеров
│   │   ├── claude.ts              # Claude Code adapter
│   │   ├── codex.ts               # Codex CLI adapter
│   │   ├── cursor.ts              # Cursor adapter
│   │   ├── shell.ts               # Shell-скрипт adapter
│   │   ├── event-buffer.ts        # Ring buffer для event streaming
│   │   └── utils.ts               # Shared: extractTokens, createStreamingEvents
│   ├── storage/                   # Файловое хранилище (YAML/JSON/JSONL)
│   │   ├── interfaces.ts          # Store интерфейсы
│   │   ├── fs-utils.ts            # Атомарные записи, readJsonlTail, parseJsonlLines
│   │   ├── paths.ts               # Пути .orch/ директории
│   │   ├── lock.ts                # File lock (atomic rename, O_EXCL)
│   │   ├── task-store.ts          # Хранилище задач (YAML)
│   │   ├── agent-store.ts         # Хранилище агентов (YAML)
│   │   ├── run-store.ts           # Хранилище запусков (JSON + JSONL events)
│   │   ├── state-store.ts         # Состояние оркестратора (JSON)
│   │   ├── goal-store.ts          # Хранилище целей (YAML)
│   │   ├── team-store.ts          # Хранилище команд (YAML)
│   │   ├── message-store.ts       # Хранилище сообщений (YAML)
│   │   ├── context-store.ts       # Shared context (JSON, TTL)
│   │   ├── config-store.ts        # Конфигурация проекта (YAML)
│   │   ├── global-config-store.ts # Глобальная конфигурация (~/.orch/)
│   │   └── cached-stores.ts       # Tick-scoped кеширование (CachedTaskStore/AgentStore)
│   ├── process/
│   │   └── process-manager.ts     # Управление подпроцессами (spawn, kill, grace)
│   ├── template/
│   │   └── template-engine.ts     # LiquidJS шаблонизатор промптов (с timeout)
│   ├── clipboard-service.ts       # Clipboard integration (detect type, get image; macOS/Linux/Windows)
│   └── workspace/
│       ├── interface.ts           # WorkspaceManager интерфейс
│       ├── workspace-manager.ts   # Git worktree / isolated / shared
│       └── merge-strategy.ts      # Стратегии merge (auto, manual)
│
├── cli/                           # CLI-команды (Commander.js)
│   ├── commands/                  # Определение команд
│   │   ├── init.ts                # orch init
│   │   ├── task.ts                # orch task [add|list|show|edit|assign]
│   │   ├── agent.ts               # orch agent [add|list|edit|remove]
│   │   ├── run.ts                 # orch run [task-id|--all]
│   │   ├── status.ts              # orch status
│   │   ├── logs.ts                # orch logs [--follow|--since]
│   │   ├── config.ts              # orch config [set|get|edit]
│   │   ├── doctor.ts              # orch doctor
│   │   ├── goal.ts                # orch goal [add|list|status|delete]
│   │   ├── team.ts                # orch team [create|join|set-lead|add-task]
│   │   ├── msg.ts                 # orch msg [send|broadcast|inbox]
│   │   ├── context.ts             # orch context [set|get|list|delete]
│   │   ├── update.ts              # orch update (проверка и установка обновлений)
│   │   └── tui.ts                 # orch tui (запуск TUI дашборда)
│   ├── update-check.ts            # Background version check (npm registry, 4h cache)
│   ├── editor.ts                  # Открытие $EDITOR (task/agent edit)
│   ├── output.ts                  # Форматирование вывода (icons, colors)
│   └── context.ts                 # CLI context helpers
│
├── tui/                           # TUI дашборд (Ink/React)
│   ├── App.tsx                    # Главный компонент (tabs, activity feed, GoalDetailPanel)
│   ├── colors.ts                  # Цветовая палитра
│   ├── commandBar.ts              # Конфигурация горячих клавиш
│   ├── wizardConfigs.ts           # Конфигурации форм-визардов
│   └── components/                # UI-компоненты
│       ├── Header.tsx             # Шапка с tabs
│       ├── TabBar.tsx             # Переключатель вкладок
│       ├── TaskList.tsx           # Список задач
│       ├── AgentList.tsx          # Список агентов
│       ├── GoalList.tsx           # Список целей
│       ├── DetailPanel.tsx        # Панель деталей
│       ├── CommandBar.tsx         # Командная строка
│       ├── Footer.tsx             # Подвал со статусом
│       ├── FormWizard.tsx         # Wizard-формы (add task/agent/goal)
│       ├── Spinner.tsx            # Анимированный спиннер
│       ├── OnboardingBox.tsx      # Onboarding wizard для новых пользователей
│       ├── HelpOverlay.tsx        # 3-column help overlay (?/F1)
│       ├── LogsFilterPicker.tsx   # Agent filter popup для Logs view
│       ├── LogsSearchBar.tsx      # Search bar с regex и highlight
│       ├── LogsTypeFilterPicker.tsx # Type filter popup (8 types + presets)
│       ├── ToastBanner.tsx        # Notification toast (done/failed/review)
│       └── useAnimTick.ts         # Hook для анимации (shared interval)
│
├── bin/
│   └── cli.ts                     # Точка входа CLI
├── container.ts                   # DI-контейнер (LightContainer / Container)
├── index.ts                       # Public API exports
└── utils/                         # Утилиты (зарезервировано)
```

---

## 5. Доменная модель

### 5.1. Task (Задача)

```typescript
interface Task {
  id: string;                    // nanoid, e.g. "tsk_a1b2c3"
  title: string;                 // "Implement user auth"
  description: string;           // Markdown-описание задачи
  status: TaskStatus;            // todo | in_progress | retrying | review | done | failed | cancelled
  priority: number;              // 1 (urgent) — 4 (low)
  assignee?: string;             // agent_id
  labels: string[];              // ["backend", "auth"]
  depends_on: string[];          // id задач-блокеров
  created_at: string;            // ISO-8601
  updated_at: string;
  attempts: number;              // Количество попыток выполнения
  max_attempts: number;          // Лимит retry (default: 3)
  workspace_mode?: WorkspaceMode; // Режим workspace для этой задачи (override agent/global)
  workspace?: string;            // Относительный путь workspace (заполняется автоматически)
  proof?: TaskProof;             // Доказательства выполнения
  review_criteria?: ReviewCriterion[]; // Критерии авто-ревью (test_pass, typecheck, lint)
  review_results?: ReviewResult[];     // Результаты проверки по каждому критерию
  scope?: string[];              // Glob-паттерны затрагиваемых файлов (для scope overlap detection)
  feedback?: string;             // Обратная связь от ревьюера или оркестратора
  goalId?: string;               // ID цели, если задача создана автономным агентом
  attachments?: string[];        // Имена прикреплённых файлов (basename, хранятся в .orchestry/attachments/{taskId}/)
}

// Критерий авто-ревью
type ReviewCriterion = 'test_pass' | 'typecheck' | 'lint';

// Результат проверки одного критерия
interface ReviewResult {
  criterion: ReviewCriterion;    // Какой критерий проверялся
  passed: boolean;               // Пройден ли
  output: string;                // Вывод проверки (stdout/stderr)
}

// Режим изоляции workspace. Приоритет: task → agent → global default
type WorkspaceMode = 'shared' | 'worktree' | 'isolated';

interface TaskProof {
  branch?: string;               // git branch
  pr_url?: string;               // PR URL
  files_changed: string[];       // Изменённые файлы
  test_results?: string;         // Результаты тестов
  agent_summary?: string;        // Резюме от агента
}

type TaskStatus = 'todo' | 'in_progress' | 'retrying' | 'review' | 'done' | 'failed' | 'cancelled';
```

### 5.2. Agent (Агент)

```typescript
interface Agent {
  id: string;                    // nanoid, e.g. "agt_x1y2z3"
  name: string;                  // "backend-dev", "frontend-dev"
  adapter: string;               // "claude" | "codex" | "cursor" | "shell" | "custom"
  role?: string;                 // "Senior Backend Engineer"
  config: AgentConfig;           // Конфигурация адаптера
  status: AgentStatus;           // idle | running | error | disabled
  current_task?: string;         // task_id
  stats: AgentStats;
}

interface AgentConfig {
  command?: string;              // Команда запуска (для shell/custom)
  model?: string;                // Модель (для claude/codex)
  approval_policy?: ApprovalPolicy; // Политика подтверждений
  max_turns?: number;            // Лимит итераций за запуск
  timeout_ms?: number;           // Таймаут одного запуска (default: 3600000)
  stall_timeout_ms?: number;     // Таймаут бездействия агента (default: 300000)
  env?: Record<string, string>;  // Переменные окружения
  system_prompt?: string;        // Дополнительный системный промпт
}

// "suggest" — агент предлагает действия, пользователь подтверждает (default)
// "auto"    — агент действует автономно без подтверждений
// "manual"  — каждое действие требует ручного одобрения
type ApprovalPolicy = 'suggest' | 'auto' | 'manual';

interface AgentStats {
  tasks_completed: number;
  tasks_failed: number;
  total_runs: number;
  total_runtime_ms: number;
  tokens_used?: number;
}

type AgentStatus = 'idle' | 'running' | 'error' | 'disabled';
```

### 5.3. Run (Запуск)

```typescript
interface Run {
  id: string;                    // nanoid
  task_id: string;
  agent_id: string;
  attempt: number;               // Номер попытки
  status: RunStatus;
  started_at: string;
  finished_at?: string;
  workspace_path: string;
  prompt: string;                // Сгенерированный промпт
  pid?: number;                  // PID процесса агента (для running)
  error?: string;
  tokens?: { input: number; output: number; total: number };
  // events хранятся отдельно в .orchestry/runs/<id>.jsonl (append-only стриминг)
  // НЕ в памяти Run-объекта, чтобы избежать утечки памяти на длинных запусках
}

type RunStatus = 'preparing' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

interface RunEvent {
  timestamp: string;
  type: string;                  // "agent_output" | "file_changed" | "command_run" | "error"
  data: any;
}
```

### 5.4. Goal (Цель)

```typescript
// Статусы цели. State machine: active → achieved | abandoned; active ↔ paused
type GoalStatus = 'active' | 'paused' | 'achieved' | 'abandoned';

// Терминальные статусы — дальнейшие переходы невозможны
const TERMINAL_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set(['achieved', 'abandoned']);

interface Goal {
  id: string;                    // nanoid, e.g. "gol_a1b2c3"
  title: string;                 // "Increase test coverage to 90%"
  description: string;           // Markdown-описание цели
  status: GoalStatus;            // active | paused | achieved | abandoned
  assignee?: string;             // agent_id — агент, ответственный за цель
  created_at: string;            // ISO-8601
  updated_at?: string;           // ISO-8601
}

interface CreateGoalInput {
  title: string;
  description?: string;
  assignee?: string;             // Если указан — автоматически включает autonomous mode агента
}
```

**Приоритет**: Цели имеют более низкий приоритет, чем задачи — агенты работают над целями только когда нет обычных задач.

### 5.5. Team (Команда)

```typescript
type TeamStatus = 'active' | 'paused' | 'disbanded';

interface TeamMember {
  agent_id: string;              // Ссылка на Agent.id
  role: 'lead' | 'member';      // Роль в команде
  joined_at: string;             // ISO-8601
}

interface Team {
  id: string;                    // nanoid, e.g. "team_a1b2c3"
  name: string;                  // "Backend Squad"
  description?: string;          // Описание команды
  status: TeamStatus;            // active | paused | disbanded
  members: TeamMember[];         // Участники команды
  task_pool: string[];           // task_id[] — общий пул задач команды
  lead_agent_id: string;         // agent_id лида команды
  created_at: string;            // ISO-8601
  updated_at: string;            // ISO-8601
  config: TeamConfig;            // Конфигурация команды
}

interface TeamConfig {
  max_concurrent_tasks?: number; // Лимит параллельных задач команды
  auto_claim: boolean;           // Автоматический claim задач из пула (default: true)
  message_ttl_ms?: number;       // TTL сообщений команды (default: 86400000 = 24h)
}

interface CreateTeamInput {
  name: string;
  description?: string;
  lead_agent_id: string;         // Обязательный лид
  member_agent_ids?: string[];   // Начальные участники
  config?: Partial<TeamConfig>;
}

// Default конфигурация
const DEFAULT_TEAM_CONFIG: TeamConfig = {
  auto_claim: true,
  message_ttl_ms: 86400000,      // 24 часа
};
```

### 5.6. Message (Сообщение)

```typescript
type MessageChannel = 'direct' | 'broadcast' | 'lead';

type MessageStatus = 'pending' | 'delivered' | 'expired';

interface Message {
  id: string;                    // nanoid
  channel: MessageChannel;       // Канал доставки
  from_agent_id: string;         // Отправитель (agent_id)
  to_agent_id: string | null;    // Получатель (null для broadcast)
  subject: string;               // Тема сообщения
  body: string;                  // Тело сообщения (Markdown)
  created_at: string;            // ISO-8601
  expires_at?: string;           // ISO-8601, auto-set из TTL
  status: MessageStatus;         // pending | delivered | expired
  delivered_at?: string;         // ISO-8601, заполняется при доставке
  team_id?: string;              // team_id для team broadcast
  reply_to?: string;             // message_id для reply-chain
}

interface CreateMessageInput {
  channel: MessageChannel;
  from_agent_id: string;
  to_agent_id?: string;          // Обязателен для 'direct', null для 'broadcast'
  subject: string;
  body: string;
  ttl_ms?: number;               // TTL в ms (default: 86400000 = 24h, max: 604800000 = 7d)
  team_id?: string;              // Для team-scoped broadcast
  reply_to?: string;             // Для цепочки ответов
}

// Константы TTL
const MAX_MESSAGE_TTL_MS = 604800000;     // 7 дней
const DEFAULT_MESSAGE_TTL_MS = 86400000;  // 24 часа
```

**Доставка**: Сообщения хранятся как JSON файлы в `.orchestry/messages/` и инжектируются в промпт агента при dispatch. После доставки статус меняется на `delivered`.

### 5.7. GoalContext (Контекст цели для промпта)

```typescript
interface GoalContext {
  id: string;                    // ID цели
  title: string;                 // Название цели
  description: string;           // Описание цели
  status: GoalStatus;            // Статус цели
  task_names: string[];          // Названия связанных задач
  progress?: string;             // Текущий прогресс (из context store)
}
```

**Использование**: GoalContext инжектируется в промпт агента через `PromptContext.goal` при dispatch задачи, связанной с целью (`task.goalId`). Агент получает полный контекст цели для принятия решений.

### 5.8. ClipboardService API

```typescript
type ClipboardContentType = 'image' | 'text' | 'empty';

interface ClipboardImage {
  data: Buffer;                  // Бинарные данные изображения
  ext: string;                   // Расширение файла ('png')
}

// Проверить наличие clipboard-утилиты (pbpaste, xclip, PowerShell)
function isClipboardToolAvailable(): boolean;

// Определить тип содержимого clipboard (image/text/empty)
async function detectClipboardType(): Promise<ClipboardContentType>;

// Извлечь изображение из clipboard (null если нет изображения)
async function getClipboardImage(): Promise<ClipboardImage | null>;
```

**Платформы**: macOS (osascript), Linux (xclip), Windows (PowerShell). Timeout: 3s. Ошибки graceful → `'empty'`/`null`.

---

## 6. Файловая структура `.orchestry/`

```
.orchestry/
├── config.yml              # Конфигурация проекта
├── state.json              # Текущее состояние оркестратора
├── tasks/
│   ├── tsk_a1b2c3.yml      # Задача (YAML для читаемости)
│   ├── tsk_d4e5f6.yml
│   └── ...
├── agents/
│   ├── agt_x1y2z3.yml      # Конфигурация агента
│   └── ...
├── runs/
│   ├── run_m1n2o3.jsonl     # Лог запуска (JSON-lines для стриминга)
│   └── ...
├── workspaces/             # Рабочие директории агентов (опционально)
│   ├── tsk_a1b2c3/         # Workspace для задачи
│   └── ...
├── templates/              # Шаблоны промптов
│   ├── default.md          # Шаблон по умолчанию
│   └── ...
└── logs/
    └── orchestry.log       # Общий лог
```

### 6.1. Пример `config.yml`

```yaml
# .orchestry/config.yml
project:
  name: "My Project"
  description: "AI-powered SaaS app"

defaults:
  agent:
    adapter: claude
    approval_policy: suggest   # suggest | auto | manual
    max_turns: 50
    timeout_ms: 3600000        # 1 час
    stall_timeout_ms: 300000   # 5 мин без событий → считается зависшим
    workspace_mode: shared     # shared | worktree | isolated

  task:
    max_attempts: 3
    priority: 3

scheduling:
  poll_interval_ms: 10000      # Проверка новых задач каждые 10с
  max_concurrent_agents: 6     # Максимум параллельных агентов
  retry_base_delay_ms: 10000   # Базовая задержка retry (10s * 2^attempt, cap 5min)
  retry_max_delay_ms: 300000   # Максимальная задержка retry

prompt:
  template: |                  # Шаблон промпта для агентов
    You are {{ agent.name }} ({{ agent.role }}).

    ## Task: {{ task.title }}
    {{ task.description }}

    Priority: {{ task.priority }}
    Attempt: {{ attempt }} of {{ task.max_attempts }}

    ## Context
    Project: {{ project.name }}
    Working directory: {{ workspace_path }}
```

### 6.2. Формат `state.json`

Текущее runtime-состояние оркестратора. Обновляется при каждом изменении. Не предназначен для git.

```typescript
interface OrchestratorState {
  version: 1;                           // Версия формата
  pid?: number;                         // PID процесса оркестратора (lock)
  started_at?: string;                  // Когда запущен демон
  running: Record<string, RunningEntry>; // task_id → running info
  claimed: string[];                    // task_id[], зарезервированные для dispatch
  retry_queue: RetryEntry[];            // Очередь повторных запусков
  stats: {
    total_runs: number;
    total_tasks_completed: number;
    total_tasks_failed: number;
    total_tokens: { input: number; output: number; total: number };
    total_runtime_ms: number;
  };
}

interface RunningEntry {
  run_id: string;
  agent_id: string;
  task_id: string;
  pid: number;                          // PID процесса агента
  started_at: string;
  last_event_at: string;               // Для stall detection
}

interface RetryEntry {
  task_id: string;
  attempt: number;
  due_at: string;                       // ISO-8601, когда повторить
  error: string;                        // Причина предыдущей неудачи
}
```

### 6.3. `.gitignore` для `.orchestry/`

При `orchestry init` создаётся `.orchestry/.gitignore`:

```gitignore
# Runtime state — не коммитить
state.json
*.lock

# Логи и запуски — не коммитить
runs/
logs/

# Рабочие директории агентов — не коммитить
workspaces/
```

**Коммитятся в git** (конфигурация проекта):
- `config.yml` — настройки проекта
- `tasks/` — определения задач
- `agents/` — определения агентов
- `templates/` — шаблоны промптов

### 6.4. Lock file и single-process

Одновременно может работать только один экземпляр оркестратора в режиме `--watch`.

```
.orchestry/orchestry.lock
```

**Алгоритм:**
1. При старте `orchestry run --watch` — записать PID в `orchestry.lock`
2. Если файл уже существует — проверить, жив ли процесс (`kill -0 <pid>`)
3. Если процесс жив — вывести ошибку: "Orchestrator already running (PID: N)"
4. Если процесс мёртв — удалить stale lock, продолжить

**Одноразовые команды** (`task add`, `status`, `logs` и т.д.) не создают lock и работают параллельно с демоном. Доступ к файлам задач/агентов через atomic write (write to temp → rename).

### 6.5. Формат task-файла для `--file`

Команда `orchestry task add --file task.md` принимает Markdown с опциональным YAML front matter:

```markdown
---
priority: 1
labels: [backend, auth]
depends_on: [tsk_a1b2c3]
max_attempts: 5
workspace_mode: worktree
---
# Fix authentication bug

Users report 401 errors when token expires during active session.

## Acceptance criteria

- Token refresh works seamlessly
- Existing tests pass
- New tests cover edge cases
```

- `title` — берётся из первого `# заголовка` в body
- `description` — весь body после заголовка
- Все поля front matter опциональны, используются дефолты из config

---

## 7. Адаптеры агентов

### 7.1. Общий интерфейс

```typescript
interface AgentAdapter {
  /** Уникальный идентификатор адаптера */
  readonly kind: string;

  /** Проверка доступности агента (установлен ли CLI, есть ли API key и т.д.) */
  test(): Promise<AdapterTestResult>;

  /** Запуск агента на задачу */
  execute(params: ExecuteParams): AsyncGenerator<AgentEvent>;

  /** Принудительная остановка */
  stop(pid: number): Promise<void>;
}

interface AdapterTestResult {
  ok: boolean;                   // Агент доступен и готов к работе
  version?: string;              // Версия CLI агента (если определена)
  error?: string;                // Описание ошибки (если ok=false)
  details?: Record<string, any>; // Дополнительная информация (модель, лимиты и т.д.)
}

interface ExecuteParams {
  prompt: string;
  workspace: string;
  env?: Record<string, string>;
  config: AgentConfig;
  signal?: AbortSignal;
}

interface AgentEvent {
  type: 'output' | 'file_change' | 'command' | 'tool_call' | 'error' | 'done';
  timestamp: string;
  data: any;
}
```

### 7.2. Claude Code Adapter

```typescript
// Запускает claude code в non-interactive (headless) режиме
class ClaudeAdapter implements AgentAdapter {
  kind = 'claude';

  async test(): Promise<AdapterTestResult> {
    try {
      const { stdout } = await execAsync('claude --version');
      return { ok: true, version: stdout.trim() };
    } catch {
      return { ok: false, error: 'Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code' };
    }
  }

  async *execute(params: ExecuteParams): AsyncGenerator<AgentEvent> {
    const args = [
      '--print',                                    // Non-interactive: выполнить и выйти
      '--output-format', 'stream-json',             // JSON-lines стриминг событий
      '--max-turns', String(params.config.max_turns ?? 50),
      '--verbose',                                  // Детальный вывод для логирования
    ];

    // Модель (опционально)
    if (params.config.model) {
      args.push('--model', params.config.model);
    }

    // System prompt (опционально)
    if (params.config.system_prompt) {
      args.push('--system-prompt', params.config.system_prompt);
    }

    // Промпт задачи — последний аргумент
    args.push(params.prompt);

    const proc = spawn('claude', args, {
      cwd: params.workspace,
      env: { ...process.env, ...params.env },
      signal: params.signal,
    });

    // Parse JSON-lines from stdout
    for await (const line of readLines(proc.stdout)) {
      yield parseClaudeEvent(line);
    }

    // Stderr логируется отдельно, не парсится как протокол
    proc.stderr?.on('data', (chunk) => {
      logDebug('claude:stderr', chunk.toString());
    });
  }

  async stop(pid: number): Promise<void> {
    process.kill(pid, 'SIGTERM');
    // Grace period обрабатывается оркестратором
  }
}
```

> **Примечание**: Claude Code CLI поддерживает `--print` + `--output-format stream-json` для headless-стриминга.
> Формат stream-json выдаёт по одному JSON-объекту на строку с полями `type`, `content`, `tool_use` и т.д.

### 7.3. Shell Adapter

```typescript
// Запускает произвольную команду
class ShellAdapter implements AgentAdapter {
  kind = 'shell';

  async *execute(params: ExecuteParams): AsyncGenerator<AgentEvent> {
    const proc = spawn('bash', ['-lc', params.config.command!], {
      cwd: params.workspace,
      env: {
        ...process.env,
        ...params.env,
        ORCHESTRY_TASK_PROMPT: params.prompt,
      },
      signal: params.signal,
    });
    // Stream stdout/stderr as events
  }
}
```

---

## 8. CLI-команды

### 8.1. Базовые команды

```
orchestry                        # Запуск интерактивного TUI (dashboard)
orchestry tui                    # То же самое (явный alias)
orchestry init                   # Инициализация .orchestry/ в текущей директории
orchestry status                 # Обзор: задачи, агенты, активные запуски
orchestry doctor                 # Диагностика: проверка адаптеров, зависимостей
orchestry update                 # Проверка обновлений и установка latest
orchestry update --check         # Только проверить, без установки
```

### 8.2. Управление задачами

```
orchestry task add "Title" [-d description] [-p priority] [-l label1,label2]
orchestry task add --file task.md         # Задача из Markdown-файла
orchestry task list [--status todo|done]  # Список задач с фильтрами
orchestry task show <id>                  # Детали задачи
orchestry task edit <id>                  # Редактирование в $EDITOR
orchestry task assign <task-id> <agent-id>
orchestry task cancel <task-id>
orchestry task retry <task-id>            # Перезапуск неудачной задачи
```

### 8.3. Управление агентами

```
orchestry agent add <name> --adapter claude [--role "Backend Dev"]
orchestry agent add <name> --adapter shell --command "python bot.py"
orchestry agent list                      # Список агентов и их статус
orchestry agent status <id>               # Детали + текущая задача + статистика
orchestry agent remove <id>
orchestry agent disable/enable <id>
```

### 8.4. Запуск и мониторинг

```
orchestry run <task-id>                   # Запуск конкретной задачи
orchestry run --all                       # Запуск всех todo-задач
orchestry run --watch                     # Режим демона: поллинг + автозапуск

orchestry logs <run-id>                   # Лог конкретного запуска
orchestry logs --agent <agent-id>         # Все логи агента
orchestry logs --follow                   # Live-стриминг логов
```

### 8.5. Конфигурация

```
orchestry config set defaults.agent.adapter codex
orchestry config get defaults.agent.timeout_ms
orchestry config edit                     # Открыть config.yml в $EDITOR
```

---

## 9. Интерактивный TUI (Dashboard)

При запуске без аргументов (`orchestry` или `orchestry tui`) открывается интерактивный терминальный интерфейс.

> Подробное описание TUI, всех views и взаимодействий — см. `CLI_UI_DESIGN.md`.

```
┌─ orch · my-saas-app ─────────────────── watching · 2 run · 14m ─┐
│                                                                   │
│  ⠹ P1  Fix auth token refresh         backend    3:12            │
│  ⠼ P2  Create user profile page       frontend   1:05            │
│  ○ P2  Add rate limiting to API       backend      —             │
│  ○ P3  Write API documentation           —         —             │
│  ◈ P2  Setup CI/CD pipeline           devops     done            │
│  ✓ P1  Setup project structure        backend      8m            │
│  ✓ P2  Configure ESLint & Prettier    frontend     3m            │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ 14:32  backend  Modified src/auth/refresh.ts                      │
│ 14:31  backend  Running npm test                                  │
│ 14:31  frontend Created src/pages/Profile.tsx                     │
│ 14:30  frontend Modified src/styles/profile.css                   │
│ 14:30  orch     Assigned "User profile" → frontend                │
│                                                                   │
├─ T tasks  A agents  N new  R run  L logs  / cmd  ? help  Q quit ─┤
└───────────────────────────────────────────────────────────────────┘
```

### Навигация TUI

Хоткеи case-insensitive (`t` и `T` работают одинаково):

- `t` — фокус на задачи (default view)
- `a` — список агентов с детальной статистикой
- `n` — создать новую задачу (inline form)
- `r` — запустить выбранную задачу
- `l` — переключить на full-screen логи
- `j/k` или `↑/↓` — навигация по списку
- `Enter` — детали выбранной задачи/агента
- `/` — command input (набрать команду)
- `?` — справка по горячим клавишам
- `Esc` — назад / закрыть
- `q` — выход

---

## 10. Оркестратор (State Machine)

### 10.1. Жизненный цикл задачи

```
                    ┌──────────┐
         ┌─────────│   todo   │◄────────────────────────┐
         │         └────┬─────┘                          │
         │              │ assign + run                   │ reject (from review)
         │              ▼                                │
         │       ┌─────────────┐                         │
  cancel │       │ in_progress │──────────┐              │
         │       └──────┬──────┘          │              │
         │              │                 │ fail          │
         │     success  │                 │ (attempts     │
         │              │                 │  < max)       │
         │              ▼                 ▼              │
         │       ┌────────────┐    ┌────────────┐       │
         │       │   review   │    │  retrying  │       │
         │       └──────┬─────┘    └─────┬──────┘       │
         │              │                │ backoff timer │
         │     approve  │                ▼              │
         │              │          ┌─────────────┐      │
         │              │          │ in_progress │      │
         │              │          └─────────────┘      │
         │       ┌──────┴──────┐                         │
         ▼       ▼             ▼                         │
    ┌──────────┐ ┌──────┐ ┌────────┐                    │
    │cancelled │ │ done │ │ failed │  (attempts >= max) │
    └──────────┘ └──────┘ └────────┘                    │
```

**Переходы:**
- `todo → in_progress`: задача назначена агенту и запущена
- `in_progress → review`: агент завершил успешно
- `in_progress → retrying`: агент упал / таймаут / stall (attempts < max)
- `retrying → in_progress`: backoff timer истёк, перезапуск
- `in_progress → failed`: attempts >= max_attempts
- `review → done`: пользователь одобрил результат (или auto_approve)
- `review → todo`: пользователь отклонил (задача возвращается с новым описанием)
- `* → cancelled`: пользователь отменил вручную

### 10.2. Логика оркестратора

```
КАЖДЫЙ ТИКТ (poll_interval_ms):
  1. Reconcile
     - Проверить статус запущенных агентов (PID alive?)
     - Обнаружить stalled runs (нет событий > stall_timeout_ms)
     - Убить зависшие процессы → retry

  2. Dispatch
     - Получить задачи в статусе "todo" без блокеров
     - Отсортировать по updated_at (более новые — выше)
     - Назначить свободным агентам (если есть слоты)
     - Запустить agent adapter

  3. Collect
     - Собрать события от запущенных агентов
     - Обновить статусы задач
     - Записать логи
     - Обновить статистику
```

### 10.2.1. Назначение задач без assignee

При `orchestry run <task-id>` или auto-dispatch:

1. **Задача имеет `assignee`** → запустить указанного агента
2. **Задача имеет `labels`** → найти агента, чьё имя или роль совпадают с одним из labels
3. **Задача без assignee и labels** → назначить первого свободного (`idle`) агента
4. **Нет свободных агентов** → оставить в `todo`, попробовать в следующий тик
5. **При `orchestry run <task-id>` без агентов вообще** → ошибка: "No agents configured. Run `orchestry agent add` first."

### 10.2.2. Защита от двойного запуска

Задача может быть запущена только если:
- Статус: `todo` или `retrying`
- `task_id` отсутствует в `state.claimed` и `state.running`

Если пользователь вызывает `orchestry run <task-id>` для задачи в `in_progress`:
→ ошибка: "Task tsk_xxx is already running (run: run_yyy, agent: backend-dev)"

Проверка происходит атомарно: claim → validate → dispatch. Если dispatch провалился — claim снимается.

### 10.3. Retry-стратегия

| Событие | Действие |
|---------|----------|
| Агент завершился успешно | Задача → `review` (или `done` если `approval_policy: auto`) |
| Агент упал с ошибкой | Задача → `retrying`, attempt++, retry через `delay = min(retry_base_delay_ms * 2^attempt, retry_max_delay_ms)` |
| `timeout_ms` истёк | SIGTERM → 5s → SIGKILL, задача → `retrying` |
| Stall (`stall_timeout_ms` без событий) | SIGTERM → 5s → SIGKILL, задача → `retrying` |
| Превышен `max_attempts` | Задача → `failed` |
| Процесс агента исчез (crash) | Обнаруживается через reconcile (PID check), задача → `retrying` |

---

## 11. Workspace Management

### 11.1. Режимы workspace

| Режим | Описание | Когда использовать |
|-------|----------|-------------------|
| `shared` | Агент работает в текущей директории проекта | Простые задачи, единственный агент |
| `worktree` | Создаётся `git worktree` для каждой задачи | Параллельная работа, изоляция git |
| `isolated` | Копия проекта в `.orchestry/workspaces/` | Максимальная изоляция, не-git проекты |

**Приоритет определения режима**: task.workspace_mode → agent.config.workspace_mode → defaults.agent.workspace_mode → `shared`

**Ограничение `shared` mode**: при `max_concurrent_agents > 1` и нескольких задачах, shared mode может вызвать конфликты. Оркестратор выдаёт предупреждение, если несколько агентов работают в одном shared workspace одновременно.

### 11.2. Алгоритм workspace

```
1. Определить workspace_mode (task → agent → global → "shared")

2. Если workspace_mode == "shared":
   workspace = process.cwd()

3. Если workspace_mode == "worktree":
   Требуется: текущая директория — git-репозиторий
   branch = "orchestry/<task-id>/<sanitized-title>"
   git worktree add .orchestry/workspaces/<task-id> -b <branch>
   workspace = .orchestry/workspaces/<task-id>

4. Если workspace_mode == "isolated":
   Используется git-aware копирование:
   git clone --local --no-hardlinks . .orchestry/workspaces/<task-id>
   Если не git-репозиторий:
   rsync -a --exclude-from=.orchestry/workspace-exclude . .orchestry/workspaces/<task-id>/
   workspace = .orchestry/workspaces/<task-id>

5. Валидация (обязательно):
   - resolve(workspace) начинается с resolve(project_root)
   - workspace — существующая директория
   - Имя директории содержит только [A-Za-z0-9._-]
```

### 11.3. Файл `.orchestry/workspace-exclude` (для isolated mode без git)

Создаётся при `orchestry init`, пользователь может редактировать:

```
.orchestry
node_modules
.env
.env.*
dist
build
.next
__pycache__
*.pyc
.venv
```

---

## 12. Prompt Construction

### 12.1. Шаблонизация

Используется Liquid-совместимый движок (как в Symphony). Переменные:

| Переменная | Описание |
|------------|----------|
| `{{ project.name }}` | Имя проекта из config |
| `{{ project.description }}` | Описание проекта |
| `{{ task.id }}` | ID задачи |
| `{{ task.title }}` | Заголовок |
| `{{ task.description }}` | Полное описание |
| `{{ task.priority }}` | Приоритет (1-4) |
| `{{ task.labels }}` | Метки |
| `{{ agent.name }}` | Имя агента |
| `{{ agent.role }}` | Роль агента |
| `{{ attempt }}` | Номер попытки (null для первой) |
| `{{ workspace_path }}` | Путь к workspace |

### 12.2. Пример сгенерированного промпта

```markdown
You are backend-dev (Senior Backend Engineer).

## Task: Fix authentication bug
Users report 401 errors when token expires during active session.
The refresh token flow in src/auth/refresh.ts is not handling edge cases.

Priority: 1 (urgent)
Attempt: 1 of 3
Working directory: /home/user/my-project

## Instructions
- Fix the bug and add tests
- Run existing tests to verify nothing is broken
- Create a git commit with your changes
```

---

## 13. Event System

### 13.1. Внутренняя шина событий

```typescript
type OrchestratorEvent =
  // Task events
  | { type: 'task:created'; task: Task }
  | { type: 'task:assigned'; taskId: string; agentId: string }
  | { type: 'task:status_changed'; taskId: string; from: TaskStatus; to: TaskStatus }
  | { type: 'task:auto_reviewed'; taskId: string; passed: boolean; results: ReviewResult[] }
  | { type: 'task:scope_overlap'; taskId: string; overlappingTaskId: string; patterns: string[] }
  | { type: 'task:orphaned'; taskId: string }
  // Agent events
  | { type: 'agent:started'; agentId: string; taskId: string; runId: string }
  | { type: 'agent:output'; runId: string; agentId: string; data: string }
  | { type: 'agent:file_changed'; runId: string; agentId: string; path: string }
  | { type: 'agent:completed'; runId: string; agentId: string; success: boolean }
  | { type: 'agent:error'; runId: string; agentId: string; error: string }
  | { type: 'agent:autonomous_toggled'; agentId: string; autonomous: boolean }
  // Run events
  | { type: 'run:retry'; runId: string; attempt: number; delay_ms: number }
  // Orchestrator events
  | { type: 'orchestrator:tick'; running: number; queued: number }
  | { type: 'orchestrator:stall_detected'; runId: string }
  | { type: 'orchestrator:error'; error: string; context: string; fatal: boolean }
  | { type: 'orchestrator:shutdown'; reason: string }
  // Workspace events
  | { type: 'workspace:merge_succeeded'; taskId: string; branch: string }
  | { type: 'workspace:merge_conflict'; taskId: string; branch: string; conflictInfo: string }
  // Message events
  | { type: 'message:sent'; messageId: string; fromAgentId: string; toAgentId: string | null; channel: MessageChannel }
  | { type: 'message:delivered'; messageId: string; toAgentId: string; taskId: string }
  // Team events
  | { type: 'team:created'; teamId: string; name: string; leadAgentId: string }
  | { type: 'team:member_joined'; teamId: string; agentId: string }
  | { type: 'team:member_left'; teamId: string; agentId: string }
  | { type: 'team:task_claimed'; teamId: string; taskId: string; agentId: string }
  | { type: 'team:disbanded'; teamId: string }
  | { type: 'team:task_added'; teamId: string; taskId: string }
  // Goal events
  | { type: 'goal:created'; goalId: string; title: string }
  | { type: 'goal:status_changed'; goalId: string; from: GoalStatus; to: GoalStatus }
  | { type: 'goal:updated'; goalId: string }
  | { type: 'goal:deleted'; goalId: string };
```

### 13.2. Подписчики

- **TUI**: обновление dashboard в реальном времени
- **Logger**: запись в `.orchestry/logs/`
- **Run Store**: обновление `.orchestry/runs/<id>.jsonl`
- **State**: обновление `.orchestry/state.json`

---

## 14. Безопасность

### 14.1. Ограничения

- Workspace path строго внутри проекта или `.orchestry/workspaces/`
- Имена файлов задач/агентов sanitized: только `[A-Za-z0-9._-]`
- Секреты через `$ENV_VAR` индирекцию в конфиге, никогда не записываются в файлы
- Approval policy по умолчанию `suggest` (агент предлагает, пользователь подтверждает)
- Atomic file writes: запись во временный файл → `rename()` (предотвращает corrupted reads)

### 14.2. Sandbox

- Агенты запускаются как обычные подпроцессы (доверенная среда)
- Опционально: ограничение через `--sandbox` флаг агента (если поддерживает)
- Таймауты обязательны для предотвращения зависания

### 14.3. Graceful Shutdown

При получении `SIGINT` (Ctrl+C) или `SIGTERM`:

```
1. Прекратить dispatch новых задач
2. Отправить SIGTERM всем запущенным процессам агентов
3. Ждать завершения до 10 секунд (grace_period)
4. Если не завершились — SIGKILL
5. Для каждого прерванного run:
   - Записать event {type: "cancelled", reason: "orchestrator_shutdown"}
   - Run.status → "cancelled"
   - Task.status → "retrying" (если attempts < max) или оставить "in_progress"
6. Сохранить state.json
7. Удалить orchestry.lock
8. Exit 0 (SIGINT) или exit 1 (ошибка)
```

При следующем запуске `orchestry run --watch`:
- Задачи в `in_progress` без живого процесса → переводятся в `retrying`
- Задачи в `retrying` → автоматически перезапускаются по backoff-таймеру
- Stale `state.json` с мёртвыми PID → очищается

### 14.4. Система обновлений

Background version check проверяет npm registry на наличие новой версии:

```
Поток:
1. При завершении любой CLI-команды вызывается checkForUpdate(currentVersion)
2. Проверяется кеш ~/.orchestry/update-check.json
3. Если кеш свежий (< 4 часов) — возвращает результат из кеша
4. Если кеш устарел — запускает background fetch (npm view, timeout 5s)
5. Background fetch не блокирует команду — результат будет в кеше при следующем запуске
6. Если обновление доступно — выводит уведомление в stderr после завершения команды
```

Формат кеша (`~/.orchestry/update-check.json`):

```json
{
  "latest": "1.2.3",
  "checked_at": 1710345600000
}
```

Команда `orch update`:
- `orch update` — force-check + установка (`npm install -g @oxgeneral/orch@latest`)
- `orch update --check` — только проверка без установки
- Таймаут npm registry: 5 секунд
- Таймаут установки: 60 секунд
- Ошибки сети не прерывают работу — silent fallback

### 14.5. Lazy Imports и оптимизация запуска

DI-контейнер разделён на два уровня для ускорения CLI startup (~40%):

```
LightContainer (быстрый):
├── Stores (TaskStore, AgentStore, RunStore, StateStore, ConfigStore, etc.)
├── Services (TaskService, AgentService, RunService, etc.)
└── EventBus
    Используется: task, agent, context, msg, goal, team, logs, status, config

Container extends LightContainer (полный):
├── ProcessManager
├── AdapterRegistry (Claude, Codex, Cursor, Shell)
├── WorkspaceManager
├── LiquidTemplateEngine
├── DoctorService
└── Orchestrator
    Используется: run, tui, doctor
```

CLI-команды загружаются через dynamic `import()` — каждый subcommand подгружается
только при вызове. Тяжёлые зависимости (LiquidJS, адаптеры, Orchestrator) не загружаются
для read-only команд (`task list`, `agent list`, `--help`).

Результат: `--help` 70ms→40ms, `task list` 110ms→80ms.

---

## 15. Фазы реализации (Roadmap)

### Phase 1: MVP Core ✅

- [x] Инициализация проекта (TypeScript, Commander.js)
- [x] Файловое хранилище (`.orchestry/`, YAML tasks/agents)
- [x] Task CRUD (add, list, show, edit, cancel)
- [x] Agent CRUD (add, list, remove)
- [x] Claude Code adapter (базовый)
- [x] Shell adapter
- [x] Оркестратор: dispatch одной задачи одному агенту
- [x] CLI-команда `orchestry run <task-id>`
- [x] Базовое логирование
- [x] `orchestry status` — текстовый вывод

### Phase 2: Multi-Agent & TUI ✅

- [x] Параллельный запуск нескольких агентов
- [x] Retry с exponential backoff
- [x] Stall detection
- [x] Режим демона (`orchestry run --watch`)
- [x] TUI dashboard (Ink)
- [x] Live-логи (`orchestry logs --follow`)
- [x] Workspace modes (shared, worktree, isolated)

### Phase 3: Smart Orchestration ✅

- [x] Автоматическое назначение задач агентам (по роли/меткам)
- [x] Зависимости между задачами (`depends_on`)
- [x] Reconciliation (проверка состояния при рестарте)
- [x] Шаблоны промптов (Liquid engine)
- [x] Codex adapter
- [x] Cursor adapter
- [x] Статистика и метрики (tokens, runtime)

### Phase 4: Governance & Polish (в процессе)

- [x] Review mode (задача → review → approve/reject)
- [x] Proof of work (git diff, test results, summary)
- [ ] Export/import задач (Markdown, JSON)
- [ ] Интеграция с GitHub Issues (опционально)
- [ ] Плагинная система адаптеров (статический реестр реализован, динамическая загрузка — нет)
- [ ] Документация и примеры

### Вне roadmap (реализовано дополнительно)

- [x] Команды агентов (teams): создание, участники, lead, task pool
- [x] Межагентный обмен сообщениями (direct, broadcast, lead channel, TTL)
- [x] Shared context между агентами (key-value store с TTL)
- [x] Auto-review criteria (test_pass, typecheck, lint)
- [x] Workspace merge-back (автоматическое слияние после успешного run)
- [x] Scope overlap detection (предупреждение при пересечении файлов задач)
- [x] Task feedback (комментарии ревьюера при reject)
- [x] OOM-оптимизации TUI (batched updates, JSONL tail read, LRU cap)
- [x] Система обновлений (background version check, `orch update`)
- [x] Lazy imports и LightContainer (CLI startup ~40% быстрее)

---

## 16. Примеры использования

### Пример 1: Быстрый старт

```bash
cd my-project
orchestry init
orchestry agent add backend --adapter claude --role "Backend Developer"
orchestry task add "Fix login bug" -d "Users get 401 on token refresh" -p 1
orchestry run --all
```

### Пример 2: Команда из нескольких агентов

```bash
orchestry agent add backend --adapter claude --role "Backend Engineer"
orchestry agent add frontend --adapter claude --role "Frontend Engineer"
orchestry agent add qa --adapter shell --command "./run-tests.sh"

orchestry task add "Implement user profiles API" -p 2 -l backend
orchestry task add "Create profile page UI" -p 2 -l frontend --depends-on tsk_xxx
orchestry task add "E2E tests for profiles" -p 3 -l qa --depends-on tsk_yyy

orchestry run --watch  # Автоматически назначит и запустит по зависимостям
```

### Пример 3: Интерактивный режим

```bash
orchestry  # Открывает TUI dashboard

# Внутри TUI:
# t → увидеть доску задач
# n → создать новую задачу
# Enter на задаче → детали, назначить, запустить
# l → live-логи текущих запусков
```

---

## 17. Метрики успеха

| Метрика | Цель |
|---------|------|
| Время запуска CLI | < 500ms |
| Время от `task add` до начала работы агента | < 5s |
| Overhead оркестратора на задачу | < 1% от времени агента |
| Потеря данных при crash | 0 (всё на диске) |
| Поддерживаемых агентов | 4+ (claude, codex, cursor, shell) |
