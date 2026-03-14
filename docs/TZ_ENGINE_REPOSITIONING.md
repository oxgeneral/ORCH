# ТЗ: Репозиционирование ORCH — от CLI Orchestrator к Engine

**Дата:** 2026-03-14
**Статус:** Draft
**Автор:** Core Team

---

## 1. Цель

### Зачем меняем позиционирование

Текущий branding "CLI orchestrator for AI agents" ограничивает восприятие продукта одним интерфейсом — терминалом. Это:

1. **Сужает аудиторию** — менеджеры, нетехнические стейкхолдеры не видят себя в "CLI" продукте
2. **Блокирует расширение** — Web UI (EP-32), SDK, Organization Templates воспринимаются как "надстройки к CLI", а не как равноправные интерфейсы к единому движку
3. **Проигрывает в сравнении** — конкуренты (Paperclip, CrewAI) позиционируют себя как "платформы", а мы — как "CLI утилита"
4. **Не отражает архитектуру** — архитектура уже layered (Domain -> Application -> Infrastructure -> CLI/TUI), движок de facto отделён от интерфейса

### Целевое позиционирование

**Было:** "CLI orchestrator for AI agent teams"
**Стало:** "The open-source engine for AI agent organizations"

Ключевой сдвиг: ORCH — это **движок** (engine), а CLI/TUI — это **reference interface** (один из возможных). Web UI, SDK, Organization Templates — это другие интерфейсы к тому же движку.

---

## 2. Текущее состояние

### Код

| Аспект | Состояние |
|--------|-----------|
| Архитектура | Layered DDD: Domain -> Application -> Infrastructure -> CLI/TUI |
| DI-контейнер | `LightContainer` (read-only) и `Container` (full) в `src/container.ts` |
| Точка связи CLI<->Engine | `CliContext` в `src/cli/context.ts` — импортируется в `src/container.ts` |
| npm exports | Один entry point `.` -> `./dist/index.js` |
| index.ts | Экспортирует Domain, Application, Infrastructure interfaces, Container builders |
| `CliContext` | НЕ экспортируется из `index.ts`, но используется в container — "скрытая" зависимость |

### Маркетинг

| Канал | Текущее сообщение |
|-------|-------------------|
| package.json description | "Agents Organizations — CLI orchestrator for AI agents" |
| landing `<title>` | "ORCH — Open-Source CLI Orchestrator for AI Agent Teams" |
| landing hero h1 | "Orchestrate AI agent teams from your terminal" |
| landing footer | "The open-source CLI orchestrator for AI agent teams" |
| landing OG description | "Orchestrate teams of AI coding agents in parallel..." |
| readme.md tagline | "Stop babysitting AI agents. Start orchestrating them." |
| readme.md subtitle | "One CLI to run Claude, OpenCode, Codex, Cursor, and shell scripts as a team" |
| compare.html | Сравнение с CrewAI, LangChain, AutoGen, MetaGPT — Paperclip **отсутствует** |

---

## 3. Целевое состояние

### Архитектура (что меняется)

```
src/
├── domain/           # Без изменений
├── application/      # Без изменений
├── infrastructure/   # Без изменений
├── cli/
│   ├── context.ts    # УДАЛИТЬ CliContext, оставить createContext() как CLI-обёртку
│   └── ...           # Без изменений
├── engine/
│   └── context.ts    # НОВЫЙ: EngineContext (ядро), перемещён из cli/context.ts
├── tui/              # Без изменений
├── container.ts      # Импортирует EngineContext вместо CliContext
└── index.ts          # Экспортирует EngineContext + engine entry points
```

### Маркетинг (что меняется)

> **Принцип**: В developer docs и архитектуре — "engine/runtime". В user-facing marketing — outcome-driven messaging ("turn X into a team", "ship while you sleep"). См. `docs/POSITIONING.md` для полного анализа.

| Канал | Новое сообщение | Психологический принцип |
|-------|-----------------|------------------------|
| package.json description | "AI agent runtime — run Claude, Codex, Cursor as a coordinated team with git isolation and zero cloud" | Concrete JTBD + Differentiator |
| landing `<title>` | "ORCH — Turn Your AI Tools Into a Coordinated Engineering Team" | Unity + JTBD |
| landing hero h1 | "Turn Claude, Cursor, and Codex into one *team*" | Unity + Concrete naming |
| landing hero sub | "Run a coordinated team of AI agents in parallel — each on its own git branch, with automatic retries and merge-back. One npm install. Zero cloud." | Activation Energy + Loss Aversion |
| landing footer | "The open-source runtime for AI agent teams. Built with TypeScript." | Category Design |
| readme.md tagline | "Turn your AI tools into a coordinated engineering team." | Unity + JTBD |
| readme.md subtitle | "Run Claude, OpenCode, Codex, Cursor, and shell scripts as one team — in parallel, with git isolation, retries, and zero infrastructure." | Concrete + Safety |
| GitHub About | "AI agent runtime — coordinate Claude, Codex, Cursor as one team. MIT." | Category + Social proof |

---

## 4. Технические изменения

### 4.1. Рефакторинг CliContext -> EngineContext

**Суть:** Контекст, необходимый движку для работы, не должен жить в `src/cli/`. Это нарушение layered architecture — container (уровень Application/Infrastructure) зависит от CLI.

**Шаги:**

1. **Создать `src/engine/context.ts`** — новый файл:
   ```typescript
   /**
    * Engine context — project root and runtime options.
    *
    * Interface-agnostic: used by CLI, TUI, Web UI, SDK, and tests.
    */
   export interface EngineContext {
     projectRoot: string;
     json: boolean;
     quiet: boolean;
     noColor: boolean;
     ascii: boolean;
   }
   ```

2. **Обновить `src/cli/context.ts`** — оставить `createContext()` функцию, но реэкспортировать тип:
   ```typescript
   // Re-export for backward compatibility
   export type { EngineContext, EngineContext as CliContext } from '../engine/context.js';
   export { createContext } from './create-context.js';
   ```
   Либо проще — `createContext()` остаётся в `src/cli/context.ts`, но возвращает `EngineContext`:
   ```typescript
   import type { EngineContext } from '../engine/context.js';

   /** @deprecated Use EngineContext directly. CliContext is a legacy alias. */
   export type CliContext = EngineContext;

   export function createContext(opts: {
     json?: boolean;
     quiet?: boolean;
     noColor?: boolean;
     ascii?: boolean;
   }): EngineContext {
     // ... existing implementation
   }
   ```

3. **Обновить `src/container.ts`**:
   ```diff
   - import type { CliContext } from './cli/context.js';
   + import type { EngineContext } from './engine/context.js';
   ```
   Все сигнатуры `(context: CliContext)` -> `(context: EngineContext)`.
   Поле `LightContainer.context` меняет тип на `EngineContext`.

4. **Обновить тесты** — поиск по `CliContext` в тестах, замена импортов.

**Файлы для изменения:**

| Файл | Что менять |
|------|-----------|
| `src/engine/context.ts` | **Создать** — `EngineContext` interface |
| `src/cli/context.ts` | Реэкспорт `CliContext = EngineContext` (deprecated alias) + `createContext()` |
| `src/container.ts` | Import `EngineContext`, заменить `CliContext` в типах и сигнатурах |
| `src/index.ts` | Добавить экспорт `EngineContext` |
| `test/**/*.ts` | Обновить импорты при наличии прямых ссылок на `CliContext` |

### 4.2. Обновление exports в index.ts

**Файл:** `src/index.ts`

Добавить:
```typescript
// Engine
export type { EngineContext } from './engine/context.js';

// Backward compatibility (deprecated)
/** @deprecated Use EngineContext */
export type { EngineContext as CliContext } from './engine/context.js';
```

Текущие экспорты `buildContainer`, `buildLightContainer`, `buildFullContainer`, `Container`, `LightContainer` — оставить как есть, но в JSDoc пометить что функции принимают `EngineContext`.

### 4.3. Обновление package.json

**Файл:** `package.json`

```diff
- "description": "Agents Organizations — CLI orchestrator for AI agents",
+ "description": "AI agent runtime — run Claude, Codex, Cursor as a coordinated team with git isolation and zero cloud",
```

Обновить keywords:
```diff
  "keywords": [
-   "cli",
-   "orchestrator",
+   "engine",
+   "orchestration",
+   "orchestrator",
    "ai",
    "agents",
+   "ai-agents",
+   "agent-engine",
+   "agent-organizations",
    "claude",
    "codex",
-   "terminal",
    "llm",
    "multi-agent",
    "ai-team",
    "agent-orchestration",
    "claude-code",
    "openai",
    "workflow",
-   "devops"
+   "devops",
+   "sdk",
+   "typescript"
  ],
```

### 4.4. Обновление README

**Файл:** `readme.md`

**Шапка (строки 1-16):**
```diff
- <strong>Stop babysitting AI agents. Start orchestrating them.</strong><br/>
- One CLI to run Claude, OpenCode, Codex, Cursor, and shell scripts as a team — in parallel, with retries, from your terminal.
+ <strong>The open-source engine for AI agent organizations.</strong><br/>
+ Run coordinated teams of AI agents — from CLI, TUI, or your own code. Claude, OpenCode, Codex, Cursor, and shell scripts working in parallel with retries.
```

**Секция "You know the pain" (строки 29-35)** — оставить как есть (pain point валидный).

**Секция "What if your AI agents worked like a real team?" (строки 37-53)** — оставить (показывает CLI usage, это OK — CLI это reference interface).

**Секция Architecture (строки 204-234)** — добавить абзац перед деревом:
```markdown
ORCH is an engine first, CLI second. The core (`domain/` + `application/` + `infrastructure/`)
has zero dependencies on the CLI or TUI layers. You can import `@oxgeneral/orch` as a library
and build your own interface on top of the same engine.
```

**Секция "Why teams choose ORCH" (строки 72-127)** — добавить пункт:
```markdown
### Engine-first architecture
ORCH is a library, not just a CLI tool. Import `@oxgeneral/orch` into your Node.js project
and build custom interfaces — Web UI, Slack bot, CI pipeline — on top of the same orchestration engine.
```

### 4.5. Обновление landing page

**Файл:** `landing/index.html`

| Элемент | Строка(и) | Было | Стало |
|---------|-----------|------|-------|
| `<title>` | 6 | "ORCH — Open-Source CLI Orchestrator for AI Agent Teams" | "ORCH — The Open-Source Engine for AI Agent Organizations" |
| `<meta description>` | 7 | "Orchestrate teams of AI coding agents in parallel..." | "The open-source engine for AI agent organizations. Run coordinated AI agent teams with state machine governance, git isolation, and inter-agent messaging." |
| OG title | 13 | "ORCH — Orchestrate AI Agent Teams From Your Terminal" | "ORCH — The Open-Source Engine for AI Agent Organizations" |
| OG description | 14 | "Open-source CLI that orchestrates..." | "The open-source engine for running coordinated AI agent teams. State machine governance, git worktree isolation, inter-agent messaging. Zero cloud." |
| Twitter title | 26 | "ORCH — Open-Source CLI Orchestrator for AI Agent Teams" | "ORCH — The Open-Source Engine for AI Agent Organizations" |
| Twitter description | 27 | "Orchestrate AI coding agents in parallel..." | "The open-source engine for AI agent organizations. State machine governance, git isolation, inter-agent messaging. Zero cloud." |
| Hero h1 | ~1885 | "Orchestrate *AI agent teams* from your terminal" | "The engine for *AI agent organizations*" |
| Hero sub | ~1887 | "Run a coordinated team of AI agents in parallel — with **git worktree isolation**, **inter-agent messaging**..." | "Run coordinated AI agent teams from CLI, TUI, or your own code — with **state machine governance**, **git worktree isolation**, **inter-agent messaging**, and **zero infrastructure**." |
| PS CTA | ~2070 | "Stop babysitting agents. Start orchestrating them" | "Your agents deserve an engine, not a babysitter" |
| Footer | ~2497 | "The open-source CLI orchestrator for AI agent teams..." | "The open-source engine for AI agent organizations. Built with TypeScript. Runs on macOS, Linux, and Windows." |

### 4.6. Обновление CLAUDE.md

**Файл:** `CLAUDE.md`

В начале файла (или в секции Architecture) добавить:
```markdown
## Positioning

ORCH is an **engine** — the CLI and TUI are reference interfaces, not the product itself.
The npm package `@oxgeneral/orch` exports the full engine API via `src/index.ts`.
```

В секции "Container (DI)" обновить упоминание `CliContext`:
```diff
- `src/bin/cli.ts` determines which tier to build based on the subcommand
+ Entry point passes an `EngineContext` (project root + flags) to the container builders.
+ The CLI creates this via `createContext()` in `src/cli/context.ts`.
```

### 4.7. Обновление compare.html

**Файл:** `landing/compare.html`

**Добавить Paperclip** в таблицу сравнения как конкурента. Paperclip — это Web UI-first платформа для AI agent organizations. Ключевые отличия ORCH:

| Критерий | ORCH | Paperclip |
|----------|------|-----------|
| Interface | CLI + TUI (+ engine SDK) | Web UI |
| Infrastructure | Zero (file-based) | Cloud/self-hosted |
| Open source | MIT | Proprietary |
| Budget tracking | Planned (EP-31) | Built-in |
| Multi-project | Planned (EP-33) | Built-in |
| Cost | Free | Paid |
| Setup | `npm install -g` | Cloud signup |

В `<title>` и мета-теги добавить "Paperclip":
```diff
- "ORCH vs CrewAI vs LangChain vs AutoGen — AI Agent Orchestrator Comparison"
+ "ORCH vs CrewAI vs LangChain vs AutoGen vs Paperclip — AI Agent Orchestrator Comparison"
```

---

## 5. Маркетинговые изменения

> Полный маркетинговый анализ с ментальными моделями: [`docs/POSITIONING.md`](./POSITIONING.md)

### 5.1. Новый tagline

**Primary (user-facing):** "Turn your AI tools into a coordinated engineering team."
**Secondary (aspirational):** "Run a team of AI agents in parallel. Ship while you sleep."
**Technical (docs/SDK):** "The open-source AI agent runtime"
**Legacy (оставить как supporting):** "Stop babysitting AI agents. Start orchestrating them."

### 5.2. Новые описания

| Контекст | Описание | Принцип |
|----------|----------|---------|
| npm (1 строка) | AI agent runtime — run Claude, Codex, Cursor as a coordinated team with git isolation and zero cloud | JTBD + Concrete |
| GitHub About | AI agent runtime — coordinate Claude, Codex, Cursor as one team. MIT. | Category + Social proof |
| Landing hero h1 | Turn Claude, Cursor, and Codex into one *team* | Unity + Concrete naming |
| Landing hero sub | Run a coordinated team of AI agents in parallel — each on its own git branch, with automatic retries and merge-back. One npm install. Zero cloud. | Activation Energy + Safety |
| README tagline | Turn your AI tools into a coordinated engineering team. | Unity + JTBD |
| README subtitle | Run Claude, OpenCode, Codex, Cursor, and shell scripts as one team — in parallel, with git isolation, retries, and zero infrastructure. | Concrete + Safety |

### 5.3. Messaging Pillars (4 столпа)

| Pillar | Message | Emotional Job | Психологический принцип |
|--------|---------|---------------|------------------------|
| **Team, not tools** | Agents talk to each other, share context, hand off work | Leverage: "я один, но у меня команда" | Unity + JTBD |
| **Safe parallelism** | Every agent on its own branch. Nothing touches main until you approve. | Control + Safety | Loss Aversion + Regret Aversion |
| **Zero to team in 10s** | npm install → orch → ready. No DB, no cloud, no config. | Speed: "хочу начать сейчас" | Activation Energy + Present Bias |
| **Your tools, amplified** | Keep using Claude and Cursor. Now they work together. | Comfort: "не менять привычки" | Endowment Effect + Status-Quo Bias |

### 5.4. Новая категория

**"AI Agent Runtime"** — не framework (мы не пишем агентов), не platform (мы не облако), не CLI tool (мы движок). Runtime = среда выполнения, которая превращает отдельных агентов в координированную команду.

### 5.5. Comparison Framing

Не feature-by-feature таблицы (проигрышная стратегия). Вместо этого — reframe через категории:

- **vs. Running manually** (primary competitor): "You're already paying $200/mo for AI tools. ORCH makes them 5x more effective for free."
- **vs. Paperclip**: "Paperclip is for AI companies needing governance with PostgreSQL. ORCH is for developers who want an AI team right now, zero infrastructure."
- **vs. CrewAI/LangChain**: "They're frameworks for WRITING agents in Python. ORCH is a runtime for RUNNING existing agents as a team. No code needed."

---

## 6. User Stories

### EP-34. Engine Repositioning

| ID | User Story | Приоритет |
|---|---|:---:|
| US-34.1 | Как library consumer, я хочу импортировать `EngineContext` из `@oxgeneral/orch`, чтобы инициализировать движок программно без CLI | P1 |
| US-34.2 | Как library consumer, я хочу вызвать `buildLightContainer({ projectRoot, json: false, quiet: true, noColor: false, ascii: false })` без зависимости от CLI модулей, чтобы использовать ORCH как библиотеку в своём Node.js приложении | P1 |
| US-34.3 | Как existing user, я хочу чтобы `CliContext` продолжал работать как deprecated alias, чтобы мой код не сломался при обновлении | P1 |
| US-34.4 | Как разработчик ORCH, я хочу чтобы `src/container.ts` не импортировал из `src/cli/`, чтобы соблюдать layered architecture (Engine слой не зависит от CLI слоя) | P2 |
| US-34.5 | Как потенциальный пользователь, я хочу видеть на landing page что ORCH — это engine, а не просто CLI tool, чтобы понять что могу использовать его как основу для своих решений | P2 |
| US-34.6 | Как потенциальный пользователь, я хочу видеть Paperclip в таблице сравнения на compare.html, чтобы понять чем ORCH отличается от проприетарных AI agent платформ | P3 |
| US-34.7 | Как npm-пользователь, я хочу видеть актуальное описание пакета ("engine" вместо "CLI orchestrator"), чтобы понять что это библиотека, а не только CLI | P2 |

---

## 7. Acceptance Criteria

### Технические

- [ ] `src/engine/context.ts` существует и экспортирует `EngineContext`
- [ ] `src/container.ts` импортирует `EngineContext` из `src/engine/context.ts`, а НЕ из `src/cli/context.ts`
- [ ] `src/cli/context.ts` экспортирует `CliContext` как deprecated alias на `EngineContext`
- [ ] `src/index.ts` экспортирует `EngineContext`
- [ ] `import { EngineContext, buildLightContainer } from '@oxgeneral/orch'` работает
- [ ] `import { CliContext } from '@oxgeneral/orch'` продолжает работать (backward compat)
- [ ] `npm run typecheck` проходит без ошибок
- [ ] `npm test` — все тесты зелёные
- [ ] `npm run build` — успешная сборка

### Маркетинговые

- [ ] `package.json` description содержит "engine", а не "CLI orchestrator"
- [ ] `package.json` keywords содержат "engine", "agent-engine", "agent-organizations"
- [ ] `readme.md` hero содержит "engine" messaging
- [ ] `readme.md` Architecture секция упоминает engine-first
- [ ] `landing/index.html` title, h1, description содержат "engine" messaging
- [ ] `landing/compare.html` содержит Paperclip в сравнении
- [ ] `CLAUDE.md` содержит Positioning секцию

---

## 8. Что НЕ меняется

Следующие компоненты **не затрагиваются** этим ТЗ:

| Компонент | Почему не меняется |
|-----------|-------------------|
| CLI commands (`src/cli/`) | CLI остаётся как reference interface. Все команды работают как прежде |
| TUI (`src/tui/`) | Dashboard не меняется |
| Domain layer (`src/domain/`) | Модели, state machine, ошибки — без изменений |
| Application layer (`src/application/`) | Orchestrator, services, event bus — без изменений |
| Storage (`src/infrastructure/storage/`) | YAML/JSON/JSONL storage — без изменений |
| Adapters (`src/infrastructure/adapters/`) | Claude, OpenCode, Codex, Cursor, Shell — без изменений |
| Process Manager (`src/infrastructure/process/`) | PID management — без изменений |
| Workspace Manager (`src/infrastructure/workspace/`) | Worktree isolation — без изменений |
| Template Engine (`src/infrastructure/template/`) | LiquidJS — без изменений |
| `.orchestry/` directory structure | Формат хранения данных — без изменений |
| npm package name | `@oxgeneral/orch` остаётся |
| CLI binary names | `orchestry`, `orch`, `ao` — остаются |
| Test structure | `test/unit/` mirror — без изменений |
| Release process | `scripts/release.sh` — без изменений |

---

## 9. Порядок выполнения

1. **Фаза 1 — Engine Core** (технический рефакторинг)
   - Создать `src/engine/context.ts`
   - Обновить `src/container.ts`
   - Обновить `src/cli/context.ts` (deprecated alias)
   - Обновить `src/index.ts`
   - Обновить тесты
   - `npm run typecheck && npm test` — зелёные

2. **Фаза 2 — Package & Docs** (package.json, README, CLAUDE.md)
   - Обновить `package.json` description и keywords
   - Обновить `readme.md` messaging
   - Обновить `CLAUDE.md`

3. **Фаза 3 — Landing & Compare** (маркетинговые страницы)
   - Обновить `landing/index.html`
   - Обновить `landing/compare.html` (добавить Paperclip)

4. **Фаза 4 — User Stories** (документация)
   - Добавить EP-34 в `docs/USER_STORIES.md`

---

## 10. Риски и митигация

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Breaking change для consumers, которые импортируют `CliContext` | Низкая (мало library consumers на v1.0.0) | Deprecated alias сохраняет совместимость |
| SEO drop при смене title/description landing | Средняя | Постепенно — сначала добавить "engine" рядом с "CLI", потом убрать "CLI" |
| Путаница "engine vs CLI" в документации | Средняя | Чётко разграничить: "ORCH Engine" = library, "ORCH CLI" = reference interface |
