# AgentsOrchestry — Console UI/UX Design

## Design Philosophy

**Эстетика: Instrument-grade terminal.**
Каждый символ на счету. Никаких лишних рамок, никакого ASCII-арта ради красоты.
Информация читается мгновенно — как приборная панель пилота: взгляд, понял, действуй.

### Три режима работы

| Режим | Когда | Что видит пользователь |
|---|---|---|
| **One-shot** | `orch status`, `orch task list` | Быстрый вывод и выход |
| **Interactive TUI** | `orch` (без аргументов) | Полноэкранный dashboard (Ink) |
| **Watch daemon** | `orch run --watch` | Live-лог с компактным статусом |

Каждый режим спроектирован отдельно. Один и тот же инструмент, три уровня погружения.

---

## 1. One-shot Commands — быстрый вывод

Принцип: вывел, прочитал, ушёл. Никакого интерактива. Идеально для pipe, grep, скриптов.

### `orch status`

```
orch · my-saas-app · watching

  RUNNING  2                    AGENTS  3
  queued   2                    idle    1
  review   1
  done     2

  ● backend   Fix auth token refresh          3:12  P1
  ● frontend  Create user profile page        1:05  P2

  Next poll in 28s · 14,232 tokens · up 14m
```

**Принципы:**
- Первая строка = контекст (имя, проект, режим)
- Левый блок = задачи по статусам (только числа)
- Средний блок = что прямо сейчас работает (running tasks)
- Последняя строка = метрики одной строкой
- Ширина: ≤80 колонок (работает в любом терминале)
- Цвета: ANSI 256 с fallback на 16 цветов

### `orch task list`

```
  STATUS    PRI  TASK                              AGENT      TIME
  ● run     P1   Fix auth token refresh            backend    3:12
  ● run     P2   Create user profile page          frontend   1:05
  ○ todo    P2   Add rate limiting to API           backend     —
  ○ todo    P3   Write API documentation              —        —
  ◈ review  P2   Setup CI/CD pipeline              devops     done
  ✓ done    P1   Setup project structure            backend    8m
  ✓ done    P2   Configure ESLint & Prettier        frontend   3m

  7 tasks · 2 running · 1 review · 2 done
```

**Принципы:**
- Табличный формат, выровненный по колонкам
- Иконки статусов: `●` running, `○` todo, `◈` review, `✓` done, `✕` failed, `↻` retrying
- Приоритеты: P1 красный, P2 жёлтый, P3 без цвета, P4 dim
- Сортировка: running → retrying → review → todo → done → failed
- Футер: одна строка-итог
- `--json` флаг для машинного вывода

### `orch task show tsk_a1b`

```
  Fix auth token refresh
  ══════════════════════════════════════════

  Status     ● in_progress · attempt 1/3
  Priority   P1 urgent
  Agent      backend (claude · opus-4)
  Labels     backend, auth, bugfix
  Workspace  .orchestry/workspaces/tsk_a1b · worktree
  Created    2 hours ago
  Running    3:12

  Description
  ──────────────────────────────────────────
  Users report 401 errors when token expires during
  active session. The refresh token flow in
  src/auth/refresh.ts is not handling edge cases.

  Acceptance criteria:
    - Seamless token refresh during active sessions
    - Existing auth tests pass
    - New tests for concurrent expiry edge case

  Recent Activity
  ──────────────────────────────────────────
  14:32:05  Modified src/auth/refresh.ts
  14:31:58  Running npm test
  14:31:12  Read src/auth/middleware.ts
  14:30:44  Analyzing codebase structure

  Tokens  ↑ 2,340 in · ↓ 1,892 out · Σ 4,232
```

**Принципы:**
- Заголовок крупно, разделитель `═`
- Key-value пары с выравниванием по двоеточию
- Description и Activity — отдельные блоки с `─` разделителями
- Токены в одну строку, tabular nums

### `orch agent list`

```
  STATUS  AGENT       ADAPTER  TASK                         TIME
  ● run   backend     claude   Fix auth token refresh       3:12
  ● run   frontend    claude   Create user profile page     1:05
  ○ idle  devops      shell    —                             —

  3 agents · 2 running · 14,232 tokens total
```

### `orch logs --follow`

```
  14:32:05  backend   ▸ Modified src/auth/refresh.ts
  14:31:58  backend   ▸ Running npm test
  14:31:42  frontend  ▸ Created src/pages/Profile.tsx
  14:31:12  backend   ▸ Read src/auth/middleware.ts
  14:30:44  frontend  ▸ Modified src/styles/profile.css
  14:30:01  orch      → Assigned "User profile" → frontend
  14:29:30  backend   ▸ Started Fix auth token refresh
  14:29:12  orch      → Dispatched 2 tasks
```

**Принципы:**
- `▸` для действий агента, `→` для событий оркестратора
- Имя агента цветом (каждый агент свой ANSI-цвет)
- `--agent backend` фильтрует по агенту
- `--task tsk_a1b` фильтрует по задаче
- `--since 5m` фильтр по времени
- При `--follow` — стримится в реальном времени, новые строки появляются внизу

### `orch init`

```
  orch · initialized

  Created .orchestry/
  ├── config.yml
  ├── tasks/
  ├── agents/
  ├── templates/default.md
  └── .gitignore

  Next: orch agent add <name> --adapter claude
```

Минимальный вывод. Показывает что создано и подсказывает следующий шаг.

### `orch run <task-id>` (одноразовый запуск)

```
  orch · running tsk_a1b "Fix auth token refresh"
  Agent: backend (claude)
  Workspace: .orchestry/workspaces/tsk_a1b (worktree)

  14:29:30  ▸ Analyzing codebase structure
  14:30:12  ▸ Read src/auth/refresh.ts
  14:30:44  ▸ Read src/auth/middleware.ts
  14:31:12  ▸ Modified src/auth/refresh.ts
  14:31:58  ▸ Running npm test
  14:32:05  ▸ Modified src/auth/refresh.ts
  14:32:30  ▸ Running npm test
  14:32:45  ▸ All tests passed

  ✓ DONE · 3:15 · 4,232 tokens · 2 files changed
```

Показывает live-стрим событий одной задачи. При завершении — итоговая строка.
Если запускается в фоне (`--detach`), вывод минимальный:

```
  orch · started tsk_a1b "Fix auth token refresh" → backend (PID 12345)
  Use: orch logs --task tsk_a1b --follow
```

### `orch agent status <agent-id>`

```
  backend
  ══════════════════════════════════════════

  Adapter    claude (opus-4)
  Status     ● running
  Task       Fix auth token refresh (tsk_a1b)
  Running    3:12
  Policy     suggest

  Stats
  ──────────────────────────────────────────
  Tasks completed    5
  Tasks failed       1
  Total runs         8
  Total runtime      42m
  Tokens used        28,430

  Recent tasks
  ──────────────────────────────────────────
  ✓  Setup project structure          8m
  ✓  Configure ESLint & Prettier      3m
  ✓  Setup CI/CD pipeline            12m
  ✕  Write API docs (attempt 2/3)     —
  ●  Fix auth token refresh          3:12
```

### Вывод ошибок

Ошибки — одна строка с кодом и подсказкой. Без stack trace.

```
  ✕ Not initialized. Run: orch init
```

```
  ✕ Task tsk_a1b is already running (backend · PID 12345)
    Use: orch logs --task tsk_a1b --follow
```

```
  ✕ Agent adapter "claude" not available
    Claude Code CLI not found. Install: npm i -g @anthropic-ai/claude-code
    Run: orch doctor    (check all adapters)
```

```
  ✕ Orchestrator already running (PID 12345)
    Use: orch status    (view current state)
```

```
  ✕ No agents configured
    Run: orch agent add <name> --adapter claude
```

**Принципы ошибок:**
- Символ `✕` + описание проблемы в первой строке
- Подсказка "что делать" — отступом на второй строке
- Выход с кодом ≠ 0 (см. секцию 11, Exit codes)
- При `--json`: `{"error": "not_initialized", "message": "...", "hint": "orch init"}`

### `orch doctor`

```
  orch doctor · checking adapters and dependencies

  ✓  claude    Claude Code 1.2.3 · opus-4 available
  ✕  codex     Not installed (codex: command not found)
  ✓  shell     bash 5.2.26
  —  cursor    Not configured

  ✓  .orchestry/   exists · 3 agents · 7 tasks
  ✓  git            2.43.0 · worktree support
  ✓  node           v20.11.0

  2 of 3 adapters ready
```

---

## 2. Interactive TUI — полноэкранный режим

Запуск: `orch` (без аргументов) или `orch tui`.

Хоткеи case-insensitive: `t` и `T` работают одинаково. В футере отображаются прописными для визуального выделения.

### Layout (80x24 минимум, растягивается)

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

**Структура: 3 зоны по вертикали**

| Зона | Что | Высота |
|---|---|---|
| **Header** | Проект, режим, метрики | 1 строка |
| **Task list** | Все задачи, навигация ↑↓ | ~40% терминала |
| **Live feed** | Последние события | ~50% терминала |
| **Footer** | Hotkeys | 1 строка |

### Навигация

| Клавиша | Действие |
|---|---|
| `↑` `↓` `j` `k` | Перемещение по списку задач |
| `Enter` | Открыть детали задачи (заменяет feed-зону) |
| `Esc` | Назад / закрыть |
| `T` | Фокус на задачи (default) |
| `A` | Переключить на список агентов |
| `L` | Переключить на full-screen логи |
| `N` | Создать задачу (inline form) |
| `R` | Запустить выбранную задачу |
| `/` | Command input (набрать команду) |
| `?` | Справка |
| `Q` | Выход |

### Детали задачи (при Enter)

Feed-зона заменяется на detail view:

```
┌─ orch · my-saas-app ─────────────────── watching · 2 run · 14m ─┐
│                                                                   │
│  ⠹ P1 ▸Fix auth token refresh         backend    3:12            │
│  ⠼ P2  Create user profile page       frontend   1:05            │
│  ...                                                              │
│                                                                   │
├── Fix auth token refresh ─────────────────────────────────────────┤
│  Status   ● in_progress · attempt 1/3                             │
│  Agent    backend (claude)                                        │
│  Labels   backend, auth, bugfix                                   │
│                                                                   │
│  14:32:05  Modified src/auth/refresh.ts                           │
│  14:31:58  Running npm test                                       │
│  14:31:12  Read src/auth/middleware.ts                             │
│                                                                   │
│  Tokens  ↑ 2,340  ↓ 1,892  Σ 4,232                              │
├─ Esc back  R retry  C cancel  E edit ────────────────────────────┤
└───────────────────────────────────────────────────────────────────┘
```

**Принцип:** выбранная задача подсвечена `▸`, нижняя половина = детали + лог задачи.
Footer меняется на контекстные действия.

### View: Agents (`A`)

```
┌─ orch · my-saas-app ─────────────────── watching · 2 run · 14m ─┐
│                                                                   │
│  ⠹ backend   claude  Fix auth token refresh       3:12   4.2k tk │
│  ⠼ frontend  claude  Create user profile page     1:05   2.1k tk │
│  ○ devops    shell   idle                          —     8.3k tk │
│                                                                   │
│  Total: 14,232 tokens · 3 agents · 14m uptime                    │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ 14:32  backend  Modified src/auth/refresh.ts                      │
│ 14:31  backend  Running npm test                                  │
│ ...                                                               │
│                                                                   │
├─ T tasks  A agents  N new agent  Enter details  ? help  Q quit  ─┤
└───────────────────────────────────────────────────────────────────┘
```

### View: Logs (`L`) — fullscreen

```
┌─ orch · logs ──────────────── all agents ─── follow ─── Q quit ──┐
│                                                                   │
│  14:32:05  backend   ▸ Modified src/auth/refresh.ts               │
│  14:31:58  backend   ▸ Running npm test                           │
│  14:31:42  frontend  ▸ Created src/pages/Profile.tsx              │
│  14:31:12  backend   ▸ Read src/auth/middleware.ts                │
│  14:30:44  frontend  ▸ Modified src/styles/profile.css            │
│  14:30:01  orch      → Assigned "User profile" → frontend        │
│  14:29:30  backend   ▸ Started Fix auth token refresh             │
│  14:29:12  orch      → Dispatched 2 tasks                        │
│  14:28:55  devops    ✓ Completed Setup CI/CD pipeline             │
│  14:25:00  orch      → Watching · poll interval 30s               │
│                                                                   │
│                                                                   │
│                                                                   │
│                                                                   │
│                                                                   │
│                                                                   │
│                                                                   │
│                                                                   │
├─ 1 backend  2 frontend  3 devops  0 all  / filter  Esc back ────┤
└───────────────────────────────────────────────────────────────────┘
```

**Фильтрация:** цифры 1-9 переключают агентов, `0` показывает всех, `/` вводит текстовый фильтр.

### Inline task creation (`N`)

```
├── New task ───────────────────────────────────────────────────────┤
│                                                                   │
│  Title:    █                                                      │
│  Priority: P3 (1-4, Enter to keep)                                │
│  Labels:   (comma-separated, Enter to skip)                       │
│  Agent:    (Enter for auto-assign)                                │
│                                                                   │
│  Tab next · Esc cancel · Enter confirm                            │
├───────────────────────────────────────────────────────────────────┤
```

Минимум полей. Tab переключает поля. Enter на последнем поле — создать.
Для длинного описания: создаёт задачу и открывает `$EDITOR`.

### Command input (`/`)

```
├─ ❯ run --all█ ───────────────────────────────────────────────────┤
```

Одна строка внизу. Набираешь команду как в vim `:`. Enter — выполнить. Esc — отмена.
Autocomplete: `run`, `task add`, `agent add`, `config`, `logs`.

---

## 3. Watch Daemon — `orch run --watch`

Не полноэкранный. Работает как обычный лог-стрим, но с компактным статус-баром сверху.

```
orch · watching · 2/3 agents · next poll 28s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

14:29:12  orch      → Dispatched 2 tasks
14:29:30  backend   ▸ Started "Fix auth token refresh"
14:29:31  frontend  ▸ Started "Create user profile page"
14:30:01  frontend  ▸ Read package.json
14:30:12  backend   ▸ Read src/auth/refresh.ts
14:30:44  frontend  ▸ Modified src/styles/profile.css
14:31:12  backend   ▸ Read src/auth/middleware.ts
14:31:42  frontend  ▸ Created src/pages/Profile.tsx
14:31:58  backend   ▸ Running npm test
14:32:05  backend   ▸ Modified src/auth/refresh.ts
...
```

**Принципы:**
- Первая строка — sticky status (обновляется in-place через `\r`)
- Дальше — append-only лог
- Работает в tmux, screen, pipe
- `Ctrl+C` — graceful shutdown
- Не перерисовывает экран, не ломает scroll-back buffer

### Ключевые события (выделяются визуально)

```
14:33:00  orch      ✓ DONE  "Fix auth token refresh" · 4m · 4,232 tokens
14:33:01  orch      → Dispatched "Add rate limiting" → backend
14:35:22  orch      ✕ FAIL  "Write API docs" · attempt 2/3 · timeout
14:35:23  orch      ↻ RETRY "Write API docs" · next in 40s
```

Ключевые события: `✓ DONE`, `✕ FAIL`, `↻ RETRY`, `→ Dispatched`, `⚠ STALL` — крупнее и заметнее в потоке.

---

## 4. Цветовая система (ANSI)

### Палитра

```
Цвет         ANSI 256    16-color fallback    Использование
─────────────────────────────────────────────────────────────
amber        214         yellow               бренд, акцент, orch.
green        72          green                running, success, done
red          167         red                  error, fail, P1
blue         74          cyan                 review, info
yellow       178         yellow               P2, warning, retrying
dim          240         bright black         мета-информация
ghost        236         bright black         разделители, неактив
white        255         white                основной текст
purple       141         magenta              файловые пути
```

### Правила применения

1. **Статус всегда цветной**: `●` green running, `○` dim todo, `◈` blue review, `✓` green done, `✕` red fail
2. **Приоритет**: P1 red, P2 yellow, P3 default, P4 dim
3. **Имена агентов**: каждый агент получает фиксированный цвет (первый — green, второй — blue, третий — purple, и т.д. по палитре)
4. **Файловые пути**: всегда purple/magenta — мгновенно считываются в потоке текста
5. **Метаинформация**: dim (серый) — не отвлекает, но доступна
6. **Ошибки**: red фон не используем (раздражает), только red текст

### No-color mode

`NO_COLOR=1 orch status` или `--no-color` — полностью без ANSI-кодов. Для pipe и CI.

---

## 5. Типографика терминала

### Иконки (Unicode, не emoji)

Используем только символы, которые рендерятся в ЛЮБОМ моноширинном шрифте:

```
●  U+25CF  Filled circle      — running
○  U+25CB  Empty circle       — todo, idle
◈  U+25C8  Diamond            — review
✓  U+2713  Check mark         — done
✕  U+2715  Cross mark         — failed
↻  U+21BB  Clockwise arrow    — retrying
▸  U+25B8  Right triangle     — agent action
→  U+2192  Right arrow        — orchestrator event
━  U+2501  Heavy horizontal   — разделитель
─  U+2500  Light horizontal   — лёгкий разделитель
⚠  U+26A0  Warning            — stall, warning
```

### ASCII fallback

При `TERM=dumb` или `--ascii`:

```
*  running       >  agent action
o  todo/idle     -> orchestrator event
#  review        -- separator
+  done          !! warning
x  failed
~  retrying
```

### Выравнивание

- Все таблицы выровнены по колонкам с padding 2 пробела
- Числа: tabular (правое выравнивание)
- Время: фиксированная ширина `HH:MM:SS` или `HH:MM` в компактном режиме
- ID задач: обрезаются до 7 символов в компактном виде (`tsk_a1b`)

---

## 6. Адаптация под размер терминала

### Breakpoints

| Ширина | Режим | Что меняется |
|---|---|---|
| **≥120** | Wide | Двухколоночный layout в TUI (tasks + feed рядом) |
| **80-119** | Normal | Стандартный layout (верх/низ) |
| **60-79** | Compact | Сокращённые колонки, без agent name в таблице |
| **<60** | Minimal | Только essential info, одна колонка |

### Пример compact (60 col):

```
orch · my-saas-app · 2 run
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

● P1 Fix auth token refresh    3:12
● P2 Create user profile page  1:05
○ P2 Add rate limiting           —
○ P3 Write API documentation     —
◈ P2 Setup CI/CD pipeline      done
✓ P1 Setup project structure     8m
✓ P2 Configure ESLint            3m
```

### Пример wide (120+ col):

```
┌─ orch · my-saas-app ─── watching ── 2 run ── 14m ───────────────────────────────────────────────────────────────┐
│                                                                                                                   │
│  ⠹ P1  Fix auth token refresh         backend    3:12  │  14:32  backend  Modified src/auth/refresh.ts            │
│  ⠼ P2  Create user profile page       frontend   1:05  │  14:31  backend  Running npm test                        │
│  ○ P2  Add rate limiting to API       backend      —   │  14:31  frontend Created src/pages/Profile.tsx            │
│  ○ P3  Write API documentation           —         —   │  14:30  frontend Modified src/styles/profile.css          │
│  ◈ P2  Setup CI/CD pipeline           devops     done  │  14:30  orch     Assigned "User profile" → frontend      │
│  ✓ P1  Setup project structure        backend      8m  │  14:29  backend  Started Fix auth token refresh           │
│  ✓ P2  Configure ESLint & Prettier    frontend     3m  │  14:29  orch     Dispatched 2 tasks                       │
│                                                         │                                                          │
├─ T tasks  A agents  N new  R run  L logs  / cmd  ? help  Q quit ─────────────────────────────────────────────────┤
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Задачи слева, live feed справа, разделены `│`. Максимальное использование пространства.

**Правила wide-mode:**
- Колонки скроллятся независимо: `j/k` скроллят задачи, feed автоскроллится вниз
- Высота обеих колонок = доступная высота терминала минус header/footer
- Если задач меньше — пустое место внизу левой колонки
- Если событий больше — показываются последние N, старые уходят вверх
- Ширина: tasks ~55%, feed ~45% (пропорции адаптивны)

---

## 7. Рамки и разделители

### Стиль рамок

**Не используем** тяжёлые box-drawing (`╔═╗`). Они загромождают и выглядят устаревше.

**Используем:**

```
┌─ ... ─┐    Лёгкие углы для TUI-границ
│       │    Вертикальные разделители
├─ ... ─┤    Горизонтальные секции
└─ ... ─┘    Нижняя граница

━━━━━━━━     Тяжёлая линия: основной разделитель (header от content)
──────────   Лёгкая линия: разделитель секций внутри

Без рамок    One-shot команды — вообще без box-drawing
```

### Правило: рамки только в TUI

- One-shot команды (`status`, `task list`) — **без рамок**, чистый текст с отступами
- Interactive TUI — лёгкие рамки для структуры
- Watch mode — одна линия `━` после header, дальше чистый поток

---

## 8. Анимации в терминале

### Что анимируем

| Элемент | Анимация | Как |
|---|---|---|
| Running task spinner | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille dots) | 80ms interval |
| Таймер задачи | `3:12` → `3:13` → `3:14` | Каждую секунду, in-place update |
| Watch mode status | `watching ●` пульсация | Чередование dim/bright каждые 2с |
| Новое событие в feed | Появляется снизу | Scroll, без мигания |
| Poll countdown | `next poll 28s` → `27s` → ... | Обратный отсчёт |

### Что НЕ анимируем

- Никаких "loading bars" для неизвестного прогресса
- Никаких мигающих текстов (accessibility)
- Никаких rainbow-эффектов
- Никаких cursor-based анимаций в one-shot mode

### Spinner для running tasks

```typescript
const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
// Используется ТОЛЬКО в TUI и watch mode
// В one-shot: статичный ● вместо спиннера
```

**Где какой символ:**

| Контекст | Running | Todo | Review | Done | Failed | Retrying |
|---|---|---|---|---|---|---|
| One-shot (`orch task list`) | `●` static | `○` | `◈` | `✓` | `✕` | `↻` |
| TUI (`orch`) | `⠋⠙⠹...` animated | `○` | `◈` | `✓` | `✕` | `↻` |
| Watch (`--watch`) | `●` static (в логе) | — | — | `✓` | `✕` | `↻` |

---

## 9. Звуковые сигналы (опционально)

```
orch config set notifications.bell true
```

- `\x07` (BEL) при: задача завершена, задача упала, все задачи завершены
- По умолчанию выключено

---

## 10. Реализация (Ink Components)

### Component tree

```
<App>
  <Header project="my-saas-app" mode="watching" stats={...} />
  <Box flexDirection="column" flexGrow={1}>
    {view === 'tasks' && <TaskList tasks={tasks} selected={idx} />}
    {view === 'agents' && <AgentList agents={agents} />}
    {view === 'logs' && <LogView events={events} filter={filter} />}
  </Box>
  {detailOpen && <DetailPanel task={selectedTask} />}
  {cmdOpen && <CommandInput onSubmit={handleCmd} />}
  <Footer keys={contextKeys} stats={footerStats} />
</App>
```

### Key components

```
<TaskRow>
  <StatusIcon status={task.status} />    // ● ○ ◈ ✓ ✕ ↻
  <Priority level={task.priority} />     // P1 P2 P3 P4
  <Text>{task.title}</Text>
  <AgentBadge name={task.assignee} active={isRunning} />
  <Timer started={task.run_started_at} />
</TaskRow>

<AgentRow>
  <Indicator status={agent.status} />    // ● ○ с пульсацией для running
  <Text bold>{agent.name}</Text>
  <AdapterBadge adapter={agent.adapter} />
  <Text dimColor>{agent.current_task || 'idle'}</Text>
</AgentRow>

<FeedEvent>
  <Time>{event.time}</Time>
  <AgentRef color={agentColor}>{event.agent}</AgentRef>
  <Text>{event.action}</Text>
  <FilePath>{event.file}</FilePath>         // purple/magenta
</FeedEvent>
```

### Ink hooks

```typescript
// Обновление таймера каждую секунду
useInterval(() => setElapsed(e => e + 1), 1000);

// Слушаем события оркестратора
useEventBus('agent:output', (event) => {
  setFeedEvents(prev => [...prev.slice(-100), event]);
});

// Автоматический resize
const { columns, rows } = useStdout();
const layout = columns >= 120 ? 'wide' : columns >= 80 ? 'normal' : 'compact';
```

---

## 11. Пайплайн-совместимость

### Машинный вывод

```bash
orch task list --json          # JSON array
orch task list --json | jq '.[] | select(.status == "running")'

orch status --json             # JSON object
orch logs --json --follow      # JSON-lines stream (одна строка = одно событие)
```

### Pipe-friendly

```bash
orch task list --quiet         # Только ID задач, по одному на строку
tsk_a1b2c3
tsk_d4e5f6
tsk_g7h8i9

orch task list --quiet --status running | xargs -I{} orch task cancel {}
```

### Exit codes

```
0   Success
1   General error
2   Invalid arguments
3   No .orchestry/ found (not initialized)
4   Lock conflict (orchestrator already running)
5   Agent error (adapter test failed)
```

---

## 12. Accessibility

- **NO_COLOR**: полная поддержка
- **Screen readers**: one-shot output — чистый текст, без control characters
- **TERM=dumb**: ASCII fallback для всех символов
- **Высокий контраст**: dim-тексты имеют contrast ratio ≥3:1 на чёрном фоне
- **Без мигания**: никаких blink-эффектов (WCAG 2.3.1)
- **Keyboard-only**: вся навигация через клавиатуру, мышь не требуется

---

## 13. Сравнение с аналогами

| Аспект | Claude Code | htop | LazyGit | **orch** |
|---|---|---|---|---|
| Модель | Chat REPL | Monitoring | Git TUI | Task orchestration |
| Запуск | <1s | <0.5s | <0.5s | <0.5s |
| Вывод | Streaming text | Full-screen | Full-screen | Hybrid (3 modes) |
| Цвета | 16 ANSI | 256 | 256 | 256 + fallback |
| Pipe | `--print` | нет | нет | `--json`, `--quiet` |
| Keyboard | Readline | `F1-F10` | vim-keys | vim-keys + hotkeys |
| Рамки | Нет | Нет | Box-drawing | Лёгкие (только TUI) |

Вдохновлён лаконичностью Claude Code, информационной плотностью htop, навигацией LazyGit.
