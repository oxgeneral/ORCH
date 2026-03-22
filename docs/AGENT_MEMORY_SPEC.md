# Agent Memory System — Техническое задание

> **Status**: 🔬 Research — Exploratory design, not committed to roadmap.

## 1. Проблема

Сейчас агенты в AgentsOrchestryCLI **не имеют памяти между запусками**. Каждый `claude --print` — это новый subprocess без истории. Единственная «память» — это то, что оркестратор вручную собирает в промпт:

| Что есть сейчас | Ограничение |
|----------------|-------------|
| `ContextStore` (key-value) | Ручное управление, нет структуры, нет поиска |
| Retry context (последний failed run) | Только 1 предыдущая попытка, только ошибки |
| `task.proof.agent_summary` | 2KB, только финальный результат |
| `task.feedback` | Только от reviewer, одна строка |
| Workspace (git worktree) | Сохраняет файлы, но не контекст рассуждений |

**Следствия:**
- Агент на 3-й попытке не знает, что было на 1-й
- Агент не помнит паттерны проекта, которые уже выучил
- Нет истории действий для аудита и отладки
- Межагентная коммуникация ограничена `orch context set` + `orch msg send`
- При переключении задач теряется весь накопленный контекст

---

## 2. Цели

1. **Session memory** — агент помнит диалог в рамках задачи между попытками
2. **Activity log** — иммутабельный журнал всех действий в системе
3. **Agent knowledge** — агент накапливает опыт из прошлых задач (lessons learned)
4. **Semantic retrieval** — поиск по истории через embeddings (опционально)
5. **Compaction** — автоматическое сжатие контекста при росте

**Принцип: directory-scoped, zero-server, файловое хранилище (SQLite только для embeddings).**

---

## 3. Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    Orchestrator                      │
│                                                      │
│  dispatchTask()                                      │
│    ├── sessionStore.getOrCreate(agentId, taskId)     │
│    ├── activityLog.query(taskId, last: 20)           │
│    ├── knowledgeStore.getForAgent(agentId, limit: 5) │
│    ├── contextStore.getAll()         // существующий │
│    ├── messageService.drainMailbox() // существующий │
│    ├── buildPromptContext()          // расширенный  │
│    └── templateEngine.render()       // расширенный  │
│                                                      │
│  collectEvents()                                     │
│    ├── runStore.appendEvent()         // существующий │
│    └── activityLog.append()           // НОВЫЙ       │
│                                                      │
│  handleRunSuccess() / handleRunFailure()             │
│    ├── sessionStore.appendSummary()   // НОВЫЙ       │
│    └── knowledgeStore.extract()       // НОВЫЙ       │
└─────────────────────────────────────────────────────┘

Хранилище (.orchestry/):
├── sessions/           # НОВЫЙ: JSONL-файлы сессий
│   └── <agentId>_<taskId>.jsonl
├── activity/           # НОВЫЙ: иммутабельный лог
│   └── activity.jsonl
├── knowledge/          # НОВЫЙ: агентские знания
│   └── <agentId>.json
├── memory.db           # Phase 3: SQLite для embeddings
├── context/            # существующий key-value store
├── runs/               # существующий run logs
├── tasks/              # существующий
└── agents/             # существующий
```

---

## 4. Реализация по фазам

### Phase 1: Session Memory + Activity Log

**Приоритет: HIGH | Сложность: Medium | Зависимости: нет**

#### 4.1. Session Store

Персистентная сессия для пары agent+task. Сохраняет контекст между попытками одной задачи.

**Доменная модель** (`src/domain/session.ts`):

```typescript
export interface SessionEntry {
  timestamp: string;
  type: 'dispatch' | 'result' | 'error' | 'summary' | 'feedback';
  data: {
    attempt?: number;
    prompt_hash?: string;   // дедупликация
    content: string;        // summary / error / feedback text
    tokens?: TokenUsage;
    files_changed?: string[];
  };
}

export interface Session {
  agent_id: string;
  task_id: string;
  created_at: string;
  updated_at: string;
  entries: SessionEntry[];
  total_tokens: number;
}
```

**Хранилище** (`src/infrastructure/storage/session-store.ts`):

```typescript
export interface ISessionStore {
  getOrCreate(agentId: string, taskId: string): Promise<Session>;
  append(agentId: string, taskId: string, entry: SessionEntry): Promise<void>;
  getSummary(agentId: string, taskId: string, maxTokens?: number): Promise<string>;
  delete(agentId: string, taskId: string): Promise<void>;
  listForAgent(agentId: string): Promise<Session[]>;
}
```

**Формат файла** (`.orchestry/sessions/<agentId>_<taskId>.jsonl`):
```jsonl
{"timestamp":"2026-03-12T10:00:00Z","type":"dispatch","data":{"attempt":1,"content":"Task dispatched"}}
{"timestamp":"2026-03-12T10:05:00Z","type":"result","data":{"attempt":1,"content":"Implemented auth module...","files_changed":["src/auth.ts"]}}
{"timestamp":"2026-03-12T10:06:00Z","type":"feedback","data":{"content":"Tests missing for edge cases"}}
{"timestamp":"2026-03-12T10:10:00Z","type":"dispatch","data":{"attempt":2,"content":"Task re-dispatched after review rejection"}}
```

**Интеграция в Orchestrator:**

- `dispatchTask()`: перед рендером промпта загружает `sessionStore.getSummary(agentId, taskId)` и передаёт в `PromptContext.session_history`
- `handleRunSuccess()`: вызывает `sessionStore.append()` с типом `result`, содержащим `agent_summary` и `files_changed`
- `handleRunFailure()`: вызывает `sessionStore.append()` с типом `error`
- При review rejection: вызывает `sessionStore.append()` с типом `feedback`

**Изменения в PromptContext:**

```typescript
// Добавить в PromptContext
session_history?: string;  // рендеренная история сессии
```

**Добавить в DEFAULT_PROMPT_TEMPLATE:**

```liquid
{% if session_history %}
## Session History
Previous interactions for this task:
{{ session_history }}
{% endif %}
```

**Лимиты:**
- Максимум 50 entries на сессию (FIFO при превышении — удаляются старые)
- `getSummary()` возвращает последние N записей, укладываясь в `maxTokens` (default: 4000 токенов ~16KB)
- Файлы сессий удаляются вместе с задачей (`taskService.delete()`)

#### 4.2. Activity Log

Иммутабельный append-only журнал всех значимых действий в системе. Для аудита, отладки и потенциального контекста агентов.

**Доменная модель** (`src/domain/activity.ts`):

```typescript
export type ActivityAction =
  | 'task:created'
  | 'task:assigned'
  | 'task:status_changed'
  | 'task:completed'
  | 'task:failed'
  | 'agent:dispatched'
  | 'agent:completed'
  | 'agent:failed'
  | 'agent:stalled'
  | 'review:passed'
  | 'review:rejected'
  | 'context:set'
  | 'context:deleted'
  | 'message:sent'
  | 'goal:created'
  | 'goal:completed'
  | 'workspace:created'
  | 'workspace:merged';

export interface ActivityEntry {
  timestamp: string;
  action: ActivityAction;
  actor: {                    // кто совершил действие
    type: 'agent' | 'user' | 'system';
    id?: string;
    name?: string;
  };
  entity: {                   // над чем совершено
    type: 'task' | 'agent' | 'run' | 'context' | 'message' | 'goal' | 'workspace';
    id: string;
  };
  details?: Record<string, unknown>;  // произвольные метаданные
}
```

**Хранилище** (`src/infrastructure/storage/activity-store.ts`):

```typescript
export interface IActivityStore {
  append(entry: Omit<ActivityEntry, 'timestamp'>): Promise<void>;
  query(filter: ActivityFilter): Promise<ActivityEntry[]>;
  tail(count: number): Promise<ActivityEntry[]>;
}

export interface ActivityFilter {
  action?: ActivityAction | ActivityAction[];
  entityType?: string;
  entityId?: string;
  actorId?: string;
  since?: string;          // ISO timestamp
  limit?: number;          // default 50
}
```

**Формат файла** (`.orchestry/activity/activity.jsonl`):
```jsonl
{"timestamp":"2026-03-12T10:00:00Z","action":"task:created","actor":{"type":"user"},"entity":{"type":"task","id":"tsk_abc"},"details":{"title":"Fix auth"}}
{"timestamp":"2026-03-12T10:01:00Z","action":"agent:dispatched","actor":{"type":"system"},"entity":{"type":"agent","id":"agt_xyz"},"details":{"task_id":"tsk_abc","attempt":1}}
```

**Ротация:**
- При превышении 10MB файл ротируется: `activity.jsonl` → `activity.1.jsonl`
- Хранится максимум 5 ротаций (50MB суммарно)
- `query()` ищет по всем файлам (от нового к старому), останавливается при достижении `limit`

**Интеграция:**
- `ActivityStore` регистрируется в `Container`
- Orchestrator и сервисы вызывают `activityStore.append()` в ключевых точках
- Не через EventBus (activity log — это persistence, не pub/sub). EventBus используется для TUI updates, activity log — для аудита.

**CLI:**

```bash
orch activity                    # последние 20 записей
orch activity --action task:*    # фильтр по типу
orch activity --entity tsk_abc   # фильтр по сущности
orch activity --since 1h         # за последний час
orch activity --tail -f          # follow mode (для TUI)
```

---

### Phase 2: Agent Knowledge Store

**Приоритет: MEDIUM | Сложность: Medium | Зависимости: Phase 1**

Агенты накапливают знания из завершённых задач: паттерны, решения, ошибки.

**Доменная модель** (`src/domain/knowledge.ts`):

```typescript
export interface KnowledgeEntry {
  id: string;
  created_at: string;
  source_task_id: string;
  source_run_id: string;
  type: 'lesson' | 'pattern' | 'decision' | 'caveat';
  content: string;         // 1-3 предложения
  relevance: string[];     // теги: ["auth", "testing", "typescript"]
  ttl_days?: number;       // auto-expire (default: 90)
}

export interface AgentKnowledge {
  agent_id: string;
  entries: KnowledgeEntry[];
  updated_at: string;
}
```

**Хранилище** (`src/infrastructure/storage/knowledge-store.ts`):

```typescript
export interface IKnowledgeStore {
  getForAgent(agentId: string): Promise<AgentKnowledge | null>;
  addEntry(agentId: string, entry: Omit<KnowledgeEntry, 'id' | 'created_at'>): Promise<void>;
  getRelevant(agentId: string, tags: string[], limit?: number): Promise<KnowledgeEntry[]>;
  prune(agentId: string): Promise<number>;  // удаляет expired, возвращает кол-во
}
```

**Формат файла** (`.orchestry/knowledge/<agentId>.json`):
```json
{
  "agent_id": "agt_backend_a",
  "updated_at": "2026-03-12T15:00:00Z",
  "entries": [
    {
      "id": "kn_abc123",
      "created_at": "2026-03-10T12:00:00Z",
      "source_task_id": "tsk_xyz",
      "source_run_id": "run_def",
      "type": "lesson",
      "content": "В этом проекте миграции БД запускаются через npm run migrate, а не напрямую через SQL файлы",
      "relevance": ["database", "migrations"],
      "ttl_days": 90
    }
  ]
}
```

**Извлечение знаний:**

При `handleRunSuccess()` оркестратор формирует extraction prompt из `agent_summary` + `files_changed`:

```
Extract 0-3 reusable lessons from this completed task.
Each lesson: type (lesson|pattern|decision|caveat), content (1-2 sentences), relevance tags.
Return JSON array. Return [] if nothing worth remembering.
```

Extraction выполняется **асинхронно, после завершения задачи** — не блокирует dispatch pipeline.

Стоимость: ~100-200 токенов на extraction (haiku/flash модель).

**Инъекция в промпт:**

```typescript
// В buildPromptContext
knowledge?: KnowledgeEntry[];
```

```liquid
{% if knowledge %}
## Agent Memory
Lessons from your previous tasks:
{% for k in knowledge %}- [{{ k.type }}] {{ k.content }}
{% endfor %}
{% endif %}
```

**Лимиты:**
- Максимум 100 entries на агента
- При превышении — удаляются самые старые
- `getRelevant()` фильтрует по tags и возвращает top-N по свежести
- `prune()` вызывается при каждом `addEntry()` — удаляет expired

**CLI:**

```bash
orch knowledge <agent-id>             # показать знания агента
orch knowledge <agent-id> --prune     # удалить устаревшие
orch knowledge clear <agent-id>       # очистить всё
```

---

### Phase 3: Semantic Search (опционально)

**Приоритет: LOW | Сложность: High | Зависимости: Phase 1, Phase 2**

Полнотекстовый и семантический поиск по истории run логов и знаниям.

> **Решение по хранилищу:** SQLite с `better-sqlite3` + `sqlite-vec`. Файловая система не подходит для vector search. SQLite остаётся directory-scoped (один файл `.orchestry/memory.db`), не нарушает принцип «без внешних серверов».

**Компоненты:**

```
┌──────────────────────────────────┐
│         MemoryIndex              │
│                                  │
│  index(source, chunks[])         │
│  search(query, opts) → Result[]  │
│  sync()                          │
│  reindex()                       │
└──────┬───────────────────────────┘
       │
  ┌────┴─────┐
  │  SQLite   │
  │           │
  │  chunks   │  text, embedding, source, metadata
  │  files    │  path, hash, last_indexed
  │  cache    │  embedding cache by hash
  └──────────┘
```

**Схема SQLite:**

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,      -- 'run_log' | 'session' | 'knowledge' | 'context'
  source_id TEXT NOT NULL,        -- run_id | session key | knowledge entry id
  content TEXT NOT NULL,
  embedding BLOB,                 -- float32 vector
  metadata TEXT,                  -- JSON: { agent_id, task_id, timestamp, ... }
  created_at TEXT NOT NULL
);

CREATE TABLE files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding BLOB NOT NULL
);

-- FTS5 для keyword search
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, source_id);
```

**Embedding провайдеры (fallback chain):**

1. **Ollama** (local) — `nomic-embed-text`, бесплатно, ~0.5s/chunk
2. **OpenAI** — `text-embedding-3-small`, $0.02/1M tokens
3. **FTS-only** — fallback, без embeddings, только BM25

```typescript
export interface IEmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<Float32Array[]>;
  dimensions: number;
}
```

**Hybrid Search:**

```typescript
export interface SearchOptions {
  query: string;
  sourceType?: string;
  agentId?: string;
  limit?: number;           // default 10
  vectorWeight?: number;    // default 0.7
  textWeight?: number;      // default 0.3
}

export interface SearchResult {
  content: string;
  score: number;
  source_type: string;
  source_id: string;
  metadata: Record<string, unknown>;
}
```

Score = `vectorWeight × cosineSimilarity + textWeight × bm25Score`

**Синхронизация:**

- При завершении run → индексируются события из JSONL (фильтр: только `agent_output`)
- При изменении session → инкрементальная синхронизация
- При добавлении knowledge entry → индексируется content
- Background sync с debounce (5s после последнего изменения)

**CLI:**

```bash
orch memory search "как мигрировать базу"       # семантический поиск
orch memory search "auth" --agent agt_backend_a  # фильтр по агенту
orch memory reindex                              # полная переиндексация
orch memory stats                                # размер, кол-во chunks
```

**Инъекция в промпт:**

При dispatch оркестратор может выполнить `memoryIndex.search(task.title + task.description)` и добавить top-5 результатов в `PromptContext.memory_results`.

```liquid
{% if memory_results %}
## Relevant Memory
Search results from past agent activity:
{% for r in memory_results %}- [{{ r.source_type }}] {{ r.content }}
{% endfor %}
{% endif %}
```

---

### Phase 4: Compaction

**Приоритет: LOW | Сложность: High | Зависимости: Phase 1**

Автоматическое сжатие длинных сессий и run логов через LLM-суммаризацию.

**Когда запускается:**
- Session > 50 entries → compact
- Run JSONL > 1MB → compact summary
- Knowledge > 100 entries на агента → merge похожих

**Стратегия compaction:**

```
1. Определить бюджет: targetTokens = maxTokens × 0.5
2. Разделить entries на chunks по ~4K токенов
3. Суммаризировать каждый chunk (haiku/flash)
4. Merge summaries → итоговый summary
5. Заменить старые entries на один entry типа 'summary'
```

**Промпт для суммаризации:**

```
Summarize the following agent session history, preserving:
- Key decisions and why they were made
- Errors encountered and how they were resolved
- Files modified and their purpose
- Current state of the task

Be concise. Focus on actionable information for the next attempt.
```

**API:**

```typescript
export interface ICompactionService {
  compactSession(agentId: string, taskId: string, targetTokens?: number): Promise<void>;
  compactKnowledge(agentId: string): Promise<void>;
  shouldCompact(agentId: string, taskId: string): Promise<boolean>;
}
```

**Стоимость:** ~500-1000 токенов на compaction (haiku). Запускается редко (только при превышении лимитов).

---

## 5. Изменения в существующих файлах

### 5.1. Container (`src/container.ts`)

```typescript
// Новые зависимости
import { SessionStore } from './infrastructure/storage/session-store.js';
import { ActivityStore } from './infrastructure/storage/activity-store.js';
import { KnowledgeStore } from './infrastructure/storage/knowledge-store.js';

// В interface Container:
sessionStore: ISessionStore;
activityStore: IActivityStore;
knowledgeStore: IKnowledgeStore;

// В buildContainer():
const sessionStore = new SessionStore(paths);
const activityStore = new ActivityStore(paths);
const knowledgeStore = new KnowledgeStore(paths);
```

### 5.2. Paths (`src/infrastructure/storage/paths.ts`)

```typescript
// Новые пути
get sessionsDir(): string { return join(this.root, 'sessions'); }
get activityDir(): string { return join(this.root, 'activity'); }
get knowledgeDir(): string { return join(this.root, 'knowledge'); }
get memoryDbPath(): string { return join(this.root, 'memory.db'); }

sessionPath(agentId: string, taskId: string): string {
  return join(this.sessionsDir, `${agentId}_${taskId}.jsonl`);
}
activityPath(): string {
  return join(this.activityDir, 'activity.jsonl');
}
knowledgePath(agentId: string): string {
  return join(this.knowledgeDir, `${agentId}.json`);
}
```

### 5.3. PromptContext (`src/infrastructure/template/template-engine.ts`)

```typescript
// Добавить в PromptContext:
session_history?: string;          // Phase 1
knowledge?: KnowledgeEntry[];      // Phase 2
memory_results?: SearchResult[];   // Phase 3
```

### 5.4. Orchestrator (`src/application/orchestrator.ts`)

**dispatchTask()** — добавить загрузку session history и knowledge перед рендером промпта.

**collectEvents()** → **handleRunSuccess()** / **handleRunFailure()** — добавить запись в session store и activity log.

### 5.5. CLI Commands

Новый файл `src/cli/commands/activity.ts`:
```bash
orch activity [--action <type>] [--entity <id>] [--since <duration>] [--limit <n>]
```

Новый файл `src/cli/commands/knowledge.ts`:
```bash
orch knowledge <agent-id> [--prune] [--clear]
```

Phase 3: Новый файл `src/cli/commands/memory.ts`:
```bash
orch memory search <query> [--agent <id>] [--limit <n>]
orch memory reindex
orch memory stats
```

### 5.6. TUI

- Activity tab (или вкладка в существующем Detail Panel) — лента действий в реальном времени
- Knowledge indicator на Agent card — количество записей в knowledge store

---

## 6. Тестирование

### Unit-тесты

| Компонент | Тесты |
|-----------|-------|
| `SessionStore` | CRUD, FIFO overflow, getSummary с token limit, cleanup при удалении задачи |
| `ActivityStore` | append, query с фильтрами, rotation при 10MB, tail, follow |
| `KnowledgeStore` | add/get/prune, relevance filtering, TTL expiration, entry limit |
| `MemoryIndex` (Phase 3) | index/search, hybrid scoring, incremental sync |
| `CompactionService` (Phase 4) | session compaction, knowledge merge |

### Integration-тесты

- Full dispatch cycle с session persistence: dispatch → fail → retry → проверить session_history в промпте
- Activity log записывает полный lifecycle задачи: created → dispatched → completed
- Knowledge extraction после успешного run
- Concurrent writes в activity log (multiple agents)

---

## 7. План реализации

```
Phase 1 (Session + Activity)     ██████████░░░░░░  ~3-4 дня
  ├─ domain models                █░
  ├─ session-store                ██░
  ├─ activity-store               ██░
  ├─ orchestrator integration     ██░
  ├─ template changes             █░
  ├─ CLI commands                 █░
  ├─ tests                        ██░
  └─ TUI updates                  █░

Phase 2 (Knowledge)              ░░░░░░████░░░░░░  ~2-3 дня
  ├─ knowledge-store              ██░
  ├─ extraction service           ██░
  ├─ orchestrator integration     █░
  ├─ CLI + tests                  ██░
  └─ TUI updates                  █░

Phase 3 (Semantic Search)        ░░░░░░░░░░████░░  ~3-4 дня
  ├─ SQLite + sqlite-vec setup    █░
  ├─ embedding providers          ██░
  ├─ memory index                 ██░
  ├─ hybrid search                ██░
  ├─ sync pipeline                ██░
  └─ CLI + tests                  ██░

Phase 4 (Compaction)             ░░░░░░░░░░░░░░██  ~2 дня
  ├─ compaction service           ██░
  ├─ orchestrator triggers        █░
  └─ tests                        █░
```

---

## 8. Зависимости (новые npm пакеты)

| Пакет | Phase | Зачем |
|-------|-------|-------|
| — | Phase 1-2 | Нет новых зависимостей, используем существующие fs-utils |
| `better-sqlite3` | Phase 3 | SQLite для embeddings и FTS |
| `sqlite-vec` | Phase 3 | Vector similarity search extension |

---

## 9. Метрики успеха

| Метрика | Цель |
|---------|------|
| Retry success rate | +20% (агент видит историю, не повторяет ошибки) |
| Prompt context utilization | Session history < 15% от context window |
| Activity log write latency | < 5ms (append-only, без fsync) |
| Knowledge extraction cost | < $0.001 per task (haiku) |
| Semantic search latency (Phase 3) | < 200ms для 10K chunks |
| Memory footprint | .orchestry/ увеличение < 50MB на 1000 задач |

---

## 10. Риски и митигации

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Prompt bloat — session history раздувает контекст | High | Жёсткий лимит 4K токенов на session_history, compaction |
| Activity log grows unbounded | Medium | Ротация 10MB × 5 файлов = 50MB max |
| Knowledge extraction галлюцинирует | Medium | Validation JSON schema, human review через CLI |
| SQLite dependency усложняет установку | Low | Phase 3 опциональна, graceful fallback на FTS-only |
| Concurrent writes в JSONL | Low | Уже решено в fs-utils через O_APPEND |

---

## 11. Обратная совместимость

- Все новые данные в новых директориях — существующие `.orchestry/` структуры не затронуты
- `PromptContext` расширяется (новые optional поля) — существующие шаблоны продолжают работать
- Phase 3 (SQLite) полностью опциональна — без неё система работает как Phase 1+2
- `orch init` создаёт новые директории при первом запуске, не требует миграции
