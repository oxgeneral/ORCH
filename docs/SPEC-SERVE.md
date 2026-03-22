# ТЗ: `orch serve` — Server / Daemon Mode

> **Status**: ✅ Implemented in v1.0.5. This spec is now reference documentation.

> **Статус**: ✅ Implemented (v1.0.5)
> **Приоритет**: P2
> **Effort**: Фаза 1 — 3-5 дней, Фаза 2 — 5-7 дней, Фаза 3 — 3-5 дней/интеграция
> **Автор**: AJTBD-исследование (2026-03-16)

---

## 1. Проблема

ORCH работает только в терминале пользователя. Закрыл ноутбук — агенты остановились. Нет способа запустить непрерывную обработку задач на сервере.

### Работа пользователя (AJTBD)

> Когда я хочу, чтобы AI-агенты непрерывно обрабатывали задачи 24/7 без моего присутствия, хочу запустить ORCH на сервере как фоновый процесс, чтобы задачи выполнялись даже когда я сплю, и чувствовать что у меня работает "AI-команда", а не "скрипт в терминале".

### Текущее состояние

- `orch run --all --watch` — запускает orchestrator tick loop (`loadState → reconcile → seedAutonomousTasks → dispatchAll`), но привязан к терминалу
- `orch tui` — полноценный дашборд, но требует интерактивный терминал
- Оба прекращают работу при закрытии терминала / SSH-сессии
- Нет structured logging для headless-работы
- Нет graceful shutdown (SIGTERM не обрабатывается корректно для всех агентов)

### Целевой сценарий

```bash
# На VPS:
cd ~/my-project
orch serve &                          # или через pm2 / systemd

# С ноутбука (SSH или другой терминал):
orch task add "Fix auth bug" -p 1     # daemon подхватит на следующем тике
orch status                           # состояние оркестратора
orch logs                             # что происходит
```

---

## 2. Архитектурные решения

### 2.1 Scope

**Решение**: Headless orchestrator (MVP), REST API — фаза 2.

**Обоснование**: ORCH Engine уже отделён от CLI/TUI (`src/container.ts` → `Container` не зависит от `src/tui/` и `src/cli/`). Самый быстрый путь — запустить существующий tick loop без TUI, с structured logging в stdout.

### 2.2 Task source

**Решение**: `.orchestry/` файлы (MVP).

**Обоснование**: Orchestrator уже читает задачи из TaskStore на каждом тике. Если daemon работает, а пользователь в другом терминале делает `orch task add` — daemon подхватит задачу на следующем reconcile. Не нужно ничего нового для MVP.

### 2.3 Уведомления

**Решение**: Structured JSON logs в stdout (MVP), webhooks — фаза 2.

**Обоснование**: pm2 и systemd/journalctl работают со stdout. Structured JSON позволяет парсить логи (`jq`, Datadog, Grafana Loki). Формат:

```json
{"time":"2026-03-16T22:03:00Z","event":"task_dispatched","agent":"backend-a","task":"tsk_abc","detail":"Implement OAuth2"}
{"time":"2026-03-16T22:15:00Z","event":"task_done","agent":"backend-a","task":"tsk_abc","tokens":8100,"cost":1.62,"duration_ms":720000}
{"time":"2026-03-16T22:24:00Z","event":"task_retry","agent":"qa","task":"tsk_def","attempt":2,"reason":"assertion timeout"}
```

### 2.4 Управление

**Решение**: Через существующий CLI (MVP).

**Обоснование**: `orch status`, `orch task list`, `orch logs` уже читают из `.orchestry/` — работают параллельно с daemon без изменений. REST API для управления — фаза 2.

### 2.5 Lifecycle

**Решение**: Watch по умолчанию, `--once` для batch.

**Обоснование**: Core use case = "работает пока не остановишь". Но `--once` полезен для CI/CD (обработать текущие задачи и выйти с exit code 0/1).

### 2.6 Совместимость

**Решение**: Взаимоисключающие с `orch run` и `orch tui`, совместимые с CLI read-команды.

**Обоснование**: Orchestrator использует `stateMutex` (promise-chain mutex) для сериализации state mutations. Два orchestrator-инстанса на одном `.orchestry/` = race condition. Существующий `acquireLock()` (`src/infrastructure/storage/lock.ts`) уже предотвращает двойной запуск через `.orchestry/orchestry.lock` с stale PID detection. Отдельный `serve.pid` не нужен — переиспользуем существующий lock-механизм. CLI read-команды (`task list`, `status`, `logs`) безопасны — только читают.

---

## 3. Фазы реализации

### Фаза 1: MVP — Headless Orchestrator

**Effort**: 3-5 дней

#### 3.1 Команда

```
orch serve [options]

Options:
  --once                 Process current tasks and exit (default: watch mode)
  --tick-interval <ms>   Override tick interval (default: 10000)
  --log-file <path>      Also write logs to file
  --log-format <fmt>     json | text (default: json)
  --verbose              Include agent:output events (very noisy, off by default)
  --no-color             Disable ANSI colors in text mode
```

> **Примечание**: Отдельный `--pid-file` не нужен — переиспользуем существующий `.orchestry/orchestry.lock` через `acquireLock()` / `releaseLock()`.

#### 3.2 Что делает

1. **Инициализация**
   - `buildFullContainer()` — полный DI-контейнер (уже включает `requireInit()` внутри)
   - `orchestrator.startWatch()` внутри вызывает `acquireLock()` — если daemon уже запущен, exit с `LockConflictError`
   - Подписывается на EventBus → structured logger (вместо TUI)

2. **Tick loop**
   - Переиспользует `orchestrator.startWatch()` — тот же tick loop (`loadState → reconcile → seedAutonomousTasks → dispatchAll`)
   - `startWatch()` уже регистрирует SIGINT/SIGTERM handlers, управляет lock, cleanup stale entries
   - Единственное отличие от `orch run --watch`: events идут в structured logger вместо console output

3. **Structured logging**
   - Подписка на `eventBus.onAny()` → JSON line в stdout
   - **По умолчанию**: lifecycle events — `task:created`, `task:status_changed`, `agent:started`, `agent:completed`, `agent:error`, `run:retry`, `orchestrator:tick`, `orchestrator:stall_detected`, `orchestrator:shutdown`, `workspace:merge_succeeded`, `message:sent`
   - **`--verbose`**: добавляет `agent:output` (каждая строка stdout агента — может быть тысячи/мин, по умолчанию отключено)
   - Опциональная запись в файл (`--log-file`)

4. **Graceful shutdown**
   - Уже реализован в `orchestrator.stop()` через `registerSignalHandlers()`
   - SIGINT/SIGTERM → `shuttingDown = true` → `clearInterval` → kill agents with grace → save state → `releaseLock()`
   - `serve` команда добавляет: structured log `{"event":"shutdown"}` + exit code (0 = clean, 1 = timeout)

5. **Watch mode** (default)
   - После обработки всех задач — не exit, а ждёт новых
   - Tick loop продолжает reconcile (может обнаружить новые задачи, добавленные через `orch task add`)
   - Логирует `{"event":"idle"}` каждые 6 тиков (~60 секунд) — достаточно для мониторинга, не засоряет логи

6. **Once mode** (`--once`)
   - Обрабатывает все текущие `todo` задачи
   - **Пропускает `seedAutonomousTasks()`** — autonomous agents создают бесконечные [auto] задачи, что несовместимо с "обработай и выйди"
   - Когда все задачи в terminal status (done/failed/cancelled) — exit
   - Exit code: `0` если все done или cancelled, `1` если есть хотя бы один failed
   - `cancelled` = осознанная отмена (не failure)

#### 3.3 Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `src/cli/commands/serve.ts` | Новый — команда `orch serve`, подписка на EventBus → structured logger, вызов `startWatch()` |
| `src/infrastructure/logging/structured-logger.ts` | Новый — JSON/text logger, принимает `OrchestratorEvent`, пишет в stdout и опционально в файл |
| `src/bin/cli.ts` | Изменить — добавить `serve` в `FULL_COMMANDS` |
| `src/application/orchestrator.ts` | Минимально — добавить public getter `get isShuttingDown(): boolean` (поле `shuttingDown` сейчас private) |
| `src/container.ts` | Без изменений |

> **Не нужен**: отдельный `serve-loop.ts` — вся логика tick loop уже в `orchestrator.startWatch()`. Serve команда = structured logger + `startWatch()` + exit code.

#### 3.4 Structured Logger

```typescript
interface ServeEvent {
  time: string;          // ISO 8601
  event: string;         // event type
  agent?: string;        // agent name
  task?: string;         // task id
  detail?: string;       // human-readable detail
  tokens?: number;       // token count
  cost?: number;         // estimated cost
  duration_ms?: number;  // duration
  attempt?: number;      // retry attempt
  reason?: string;       // failure/retry reason
  [key: string]: unknown;
}
```

#### 3.5 Lock-механизм (переиспользуем существующий)

Файл: `.orchestry/orchestry.lock` — уже существует, используется в `startWatch()`.

Механизм (`src/infrastructure/storage/lock.ts`):
1. `acquireLock()` — атомарное создание файла (`O_CREAT | O_EXCL`), записывает `process.pid`
2. Если файл уже есть — читает PID, проверяет `process.kill(pid, 0)`
3. Если процесс жив — бросает `LockConflictError` с PID (CLI показывает hint)
4. Если процесс мёртв — удаляет stale lock, создаёт новый
5. `releaseLock()` — `fs.unlink()` при shutdown
6. `acquireMutex` — сериализует конкурентные вызовы внутри одного процесса

**Не нужен отдельный `serve.pid`** — `startWatch()` уже вызывает `acquireLock()` внутри.

#### 3.6 pm2 / systemd совместимость

**pm2**:
```bash
pm2 start "orch serve" --name orch-daemon --cwd ~/my-project
pm2 logs orch-daemon     # structured JSON logs
pm2 stop orch-daemon     # sends SIGINT → graceful shutdown
```

**systemd**:
```ini
[Unit]
Description=ORCH AI Agent Daemon
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/user/my-project
ExecStart=/usr/local/bin/orch serve
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 3.7 Тесты

| Тест | Что проверяем |
|------|--------------|
| `serve-loop.test.ts` | Tick loop запускается, обрабатывает задачи, выходит в `--once` mode |
| `serve-loop.test.ts` | Watch mode не exit после обработки задач |
| `serve-loop.test.ts` | Graceful shutdown: SIGINT → ждёт агентов → exit 0 |
| `serve-loop.test.ts` | Graceful shutdown timeout: agent зависает → exit 1 |
| `structured-logger.test.ts` | JSON format корректный, все event types |
| `structured-logger.test.ts` | Text format human-readable |
| `structured-logger.test.ts` | Log file writing |
| `serve-command.test.ts` | PID-файл: создаётся, проверяется, удаляется |
| `serve-command.test.ts` | Двойной запуск → ошибка |
| `serve-command.test.ts` | Stale PID-файл → перезаписывается |

---

### Фаза 2: REST API + Webhooks

**Effort**: 5-7 дней
**Зависит от**: Фаза 1

#### Команда

```
orch serve --api [options]

Options:
  --port <port>          API port (default: 3847)
  --host <host>          Bind host (default: 127.0.0.1)
  --api-key <key>        Bearer token for auth (optional)
  --webhook <url>        POST on task done/failed/review (repeatable)
  --cors                 Enable CORS for browser clients
```

#### Endpoints

```
GET    /api/v1/status                  # orchestrator state
GET    /api/v1/tasks                   # list tasks (?status=todo&limit=50)
POST   /api/v1/tasks                   # create task {title, priority, scope, agent}
GET    /api/v1/tasks/:id               # task detail
POST   /api/v1/tasks/:id/approve       # approve review
POST   /api/v1/tasks/:id/reject        # reject with feedback {feedback}
POST   /api/v1/tasks/:id/cancel        # cancel task
GET    /api/v1/agents                  # list agents
GET    /api/v1/agents/:id              # agent detail
GET    /api/v1/goals                   # list goals
POST   /api/v1/goals                   # create goal {title, description}
GET    /api/v1/runs/:id/events         # SSE stream of run events
GET    /api/v1/health                  # health check
```

#### Webhooks

При событиях `task_done`, `task_failed`, `task_review` — POST на указанные URL:

```json
{
  "event": "task_done",
  "task": { "id": "tsk_abc", "title": "...", "agent": "backend-a" },
  "run": { "id": "run_xyz", "tokens": 8100, "cost": 1.62, "duration_ms": 720000 },
  "timestamp": "2026-03-16T22:15:00Z"
}
```

#### Реализация

- HTTP-сервер: встроенный `node:http` (без express/fastify — zero deps принцип)
- Маршрутизация: простой router на Map
- Auth: optional Bearer token
- SSE: `Transfer-Encoding: chunked` для event streaming

---

### Фаза 3: Integrations

**Effort**: 3-5 дней каждая
**Зависит от**: Фаза 2 (webhooks)

#### 3a. Telegram / Slack уведомления

```
orch serve --notify telegram:BOT_TOKEN:CHAT_ID
orch serve --notify slack:WEBHOOK_URL
```

Уведомления при: task done (summary), task failed (error + hint), all tasks complete (run report).

#### 3b. GitHub Action

```yaml
# .github/workflows/orch.yml
- uses: oxgeneral/orch-action@v1
  with:
    goal: "Fix all TODO comments"
    template: bugfix-dept
    api-key: ${{ secrets.CLAUDE_API_KEY }}
```

#### 3c. GitHub App

Auto-pick issues by label (`orch:auto`), create tasks, assign agents, post PR when done.

---

## 4. Acceptance Criteria

### Фаза 1 MVP

- [ ] `orch serve` запускается без TUI, обрабатывает задачи
- [ ] Structured JSON logs в stdout с корректным форматом
- [ ] Watch mode: ждёт новых задач после обработки текущих
- [ ] `--once` mode: exit после завершения всех задач
- [ ] Graceful shutdown на SIGINT/SIGTERM
- [ ] PID-файл: создаётся, проверяется, удаляется
- [ ] Двойной запуск → понятная ошибка
- [ ] Совместимость с pm2: `pm2 start`, `pm2 stop`, `pm2 logs` работают
- [ ] Совместимость с systemd: unit-файл в документации
- [ ] `orch status`, `orch task list`, `orch logs` работают параллельно с daemon
- [ ] `orch task add` из другого терминала → daemon подхватывает задачу
- [ ] Тесты покрывают все сценарии (10+ тестов)
- [ ] Документация: README секция + systemd/pm2 примеры

### Фаза 2 REST API

- [ ] HTTP-сервер на `node:http` (zero deps)
- [ ] Все endpoints работают и возвращают JSON
- [ ] Optional auth через Bearer token
- [ ] SSE streaming для run events
- [ ] Webhooks: POST при task done/failed/review
- [ ] CORS для browser clients
- [ ] Тесты для всех endpoints

---

## 5. Не входит в scope

- Web UI / browser dashboard (отдельный проект)
- Кластер / распределённый mode (несколько серверов)
- Очередь задач (Redis, RabbitMQ) — файловая система достаточна
- Аутентификация пользователей (multi-tenant) — single-user tool
- Docker image (пользователь сам может сделать)

---

## 6. Риски

| Риск | Митигация |
|------|-----------|
| Race condition: CLI и daemon пишут в `.orchestry/` одновременно | Atomic writes (`atomicWrite()` в `fs-utils.ts`) уже реализованы. IndexManager использует promise-chain mutex |
| Agent процессы-зомби при crash daemon | `state.running` хранит PID каждого агента. При рестарте `cleanupStaleRunningEntries()` в `startWatch()` обнаруживает orphaned entries и переводит задачи в `cancelled` |
| OOM при длительной работе (24/7) | Уже решено: JSONL tail reads, LRU caps, batched IO. Для serve: добавить heap usage в structured logs каждые N тиков |
| Stale lock после kill -9 | `acquireLock()` уже проверяет `isProcessAlive(pid)` и удаляет stale locks |
| `consecutiveTickFailures` → fatal stop | После 5 подряд failed тиков orchestrator вызывает `stop()`. Для serve: логировать и позволить pm2/systemd перезапустить |

---

## 7. Связь с AJTBD-исследованием

| Артефакт | Ссылка |
|----------|--------|
| Спящая работа #5.6 | `docs/ajtbd/05-jobs-pains-solutions.md` |
| Механика #6 | Сделать частотную работу привычной (daemon = "всегда работает") |
| Механика #15 | Снять opportunity cost (агенты работают 24/7, не только когда ты за компом) |
| Why page | `landing/why.html` — "Want agents running 24/7 on a server" (coming soon) |
