# ORCH — Positioning & Messaging Strategy

> Маркетинговая стратегия позиционирования, основанная на психологических принципах и ментальных моделях.

**Дата:** 2026-03-14
**Статус:** Draft

---

## 1. Диагностика текущего позиционирования

### Что сейчас

**"Open-Source CLI Orchestrator for AI Agent Teams"**

### Что не так (через призму ментальных моделей)

**Jobs to Be Done — мы описываем инструмент, а не работу.**
Человек не просыпается с мыслью "мне нужен оркестратор". Он просыпается с мыслью:
- "Мне нужно сделать работу на неделю за выходные"
- "Я устал жонглировать между Claude, Cursor и Codex вручную"
- "Мои агенты работают, но ломают код друг друга"

**Curse of Knowledge — мы говорим на своём языке.**
"State machine governance", "git worktree isolation", "inter-agent messaging" — это язык разработчика ORCH, не язык пользователя ORCH. Пользователь думает: "безопасно ли это?", "не сломает ли мой код?", "будет ли быстрее?"

**Category Trap — мы конкурируем в чужой категории.**
"CLI orchestrator" ставит нас в один ряд с CrewAI/LangChain (Python-фреймворки) и Paperclip (enterprise-платформа). Мы проигрываем на их территории. Нужна своя категория.

**Framing Effect — "engine" абстрактен.**
"The open-source engine for AI agent organizations" — из предыдущего ТЗ — звучит корпоративно и расплывчато. Разработчик не ищет "engine". Он ищет решение боли.

---

## 2. Jobs to Be Done: что на самом деле "нанимают"

### Primary Job

> **"Я хочу запустить несколько AI-агентов на мой проект одновременно, чтобы сделать за ночь то, на что у меня ушла бы неделя — и чтобы при этом ничего не сломалось."**

### Functional sub-jobs

| Job | Текущее решение (без ORCH) | Боль |
|-----|---------------------------|------|
| Запустить агентов параллельно | Открыть 3 терминала, руками запускать | Контекст теряется, жонглирование |
| Не дать агентам конфликтовать | Молиться что не перезапишут файлы | Merge conflicts, потеря работы |
| Знать что происходит | Переключаться между окнами, читать вывод | Нет единой картины |
| Проверить результат | Руками git diff, код ревью | Медленно, пропускаешь ошибки |
| Повторить если сломалось | Руками перезапустить, скопировать ошибку | Забываешь, теряешь контекст |

### Emotional sub-jobs

| Feeling | Описание |
|---------|----------|
| **Leverage** | "Я один, но у меня целая команда" |
| **Control** | "Я знаю что происходит, ничего не выйдет из-под контроля" |
| **Speed** | "Я отправляю задачи и иду спать, утром результат" |
| **Safety** | "Мой main branch всегда чистый" |

---

## 2.5. Audience Segments: Solo Dev — Primary Target (обновлено 2026-03-14)

### Расширение целевой аудитории

**Было**: DevOps, техлиды, команды с 3+ AI-агентами
**Стало**: **Solo разработчики — PRIMARY**, команды — secondary

### Почему solo devs — primary (данные 2026)

- 73% всех разработчиков используют AI coding tools ежедневно (StackOverflow Survey 2026)
- Solopreneurs с AI agents: средний прирост дохода +340% (Indie Hackers, 2026)
- AI coding costs: от $12 до $2,300/мес в 2026 — solo devs первыми получают неожиданный счёт
- 85% solo devs используют Claude/Codex/Cursor минимум в 2 параллельных сессиях — прямой fit для ORCH
- Проблема #1 в solo AI workflows: отсутствие cost visibility (узнают что потратили $180/мес — случайно, на биллинге)

### Persona 1: Solo Developer ("Alexei")

**Кто**: Фрилансер или независимый разработчик, работает один, использует Claude Code и/или Codex ежедневно.

**Stack**: Claude Pro ($20/мес) + Claude API (pay-as-you-go) + иногда Cursor IDE

**Pain points**:
- "Запускаю одного агента, жду, запускаю следующего — трачу время на ожидание"
- "Не знаю сколько трачу на токены до конца месяца — узнаю случайно на биллинге ($180 сюрприз)"
- "Агент падает в середине задачи — нужно руками перезапускать в 2am"
- "Хочу поставить агентам работу и уйти спать — но страшно что сломают код в main"

**Jobs to Be Done**:
> "Хочу запустить 2-3 агента параллельно, уйти заниматься другим делом, и прийти к готовым PR — не тратя время на мониторинг."

**Emotional drivers**: Speed ("сделать за ночь"), Control ("не потерять код"), Leverage ("один — но с командой")

**Primary Message**:
> **"You already use Claude. Now it can work while you sleep."**

**Supporting messages**:
- "Run 3 agents in parallel. Come back to 3 finished PRs."
- "Your Claude subscription is underutilized. Fix that."
- "Stop restarting crashed agents manually."
- "Know exactly what each agent costs — before the bill arrives."

**Activation trigger**: Первый раз когда Claude упал в середине длинной задачи или пришёл неожиданный API счёт.

**Objection map**:

| Возражение | Ответ |
|-----------|-------|
| "Мне не нужна команда — я один" | "Именно для этого. Один разработчик + 3 агента = команда." |
| "Не сломает ли код?" | "Каждый агент — своя ветка. main нетронут до вашего approve." |
| "Буду ли знать сколько трачу?" | "TUI показывает токены per run в реальном времени." |
| "Это сложно настроить?" | "npm install + orch. Буквально 30 секунд." |

---

### Persona 2: Tech Lead / Team ("Maria")

**Кто**: Техлид небольшой команды (3-10 чел), управляет несколькими AI-агентами + координирует людей.

**Pain points**:
- "Мои агенты работают изолированно — нет координации, нет visibility"
- "Merge conflicts когда два агента правят одни файлы"
- "Нет единого дашборда — переключаюсь между окнами"

**Jobs to Be Done**:
> "Хочу чтобы AI-агенты работали как члены команды — разделение работы, без конфликтов, с единым дашбордом."

**Primary Message**: "Turn Claude, Cursor, and Codex into one team."

---

### Messaging Matrix

| Аудитория | Hook | Fear to Address | Proof Point |
|-----------|------|-----------------|-------------|
| **Solo Dev** | "Work while you sleep" | "Will it break my code?" | Git worktree isolation, auto-retry |
| **Tech Lead** | "One team, zero conflicts" | "Will agents step on each other?" | State machine + mandatory review |
| **DevOps** | "Automate your AI workflows" | "Is this production-ready?" | 1493 tests, strict TypeScript |

### Solo Dev Copy Bank

```
Hero variant (solo):      "You run Claude every day. Now make it run overnight."
Problem statement:        "One agent at a time. Manual restarts. Surprise $180 bills. There's a better way."
CTA:                      "Start in 30 seconds. No account. No cloud."
Social proof hook:        "Used by solo devs shipping at team speed."
Objection buster:         "Do I need a team? No. Most users start solo with 2-3 agents."
```

---

## 3. Создание категории (Category Design)

### Проблема существующих категорий

| Категория | Игроки | Почему не мы |
|-----------|--------|-------------|
| AI Agent Frameworks | CrewAI, LangChain, AutoGen | Python-фреймворки для написания агентов. Мы не пишем агентов — мы координируем готовых. |
| AI Agent Platforms | Paperclip, AgentOps | Enterprise SaaS с UI/DB/auth. Мы — zero infrastructure. |
| AI Coding Assistants | Claude Code, Cursor, Codex | Одиночные агенты. Мы — слой координации поверх них. |
| DevOps Tools | CI/CD, task runners | Не про AI, другая ментальная модель. |

### Новая категория: **"AI Agent Runtime"**

**Определение**: Среда выполнения, которая превращает отдельных AI-агентов в координированную команду. Не заменяет агентов — усиливает их. Как Docker не заменяет приложения, а даёт им среду для работы.

**Почему "runtime"**:
- **Знакомая метафора** для разработчиков (Node.js runtime, container runtime)
- **Не "framework"** — мы не диктуем как писать агентов
- **Не "platform"** — мы не облако, мы инструмент
- **Не "orchestrator"** — слово перегружено (Kubernetes orchestrator)
- **"Runtime"** = "я запускаю агентов В ЭТОМ, и оно управляет их жизненным циклом"

---

## 4. Positioning Statement

### Формула

> **For** [developers who use AI coding agents],
> **who** [want to run multiple agents in parallel on real projects],
> **ORCH is the** [AI agent runtime]
> **that** [turns your existing AI tools into a coordinated team].
> **Unlike** [running agents manually in separate terminals],
> **ORCH** [gives each agent its own git branch, manages the state machine, handles retries, and merges results — with zero infrastructure].

### One-liner варианты (A/B тест)

| ID | Вариант | Принцип |
|----|---------|---------|
| A | **Your AI agents deserve a runtime, not a babysitter.** | Loss Aversion + Contrast |
| B | **One `npm install` away from a full AI engineering team.** | Activation Energy + Present Bias |
| C | **Run a team of AI agents in parallel. Ship while you sleep.** | Jobs to Be Done + Hyperbolic Discounting |
| D | **The missing runtime for AI agent teams.** | Category Design + Zeigarnik (что-то было "missing") |
| E | **Turn Claude, Cursor, and Codex into one team.** | Unity + Concrete + Jobs to Be Done |

**Рекомендация**: **E** как primary (конкретно, понятно, JTBD), **C** как secondary (aspirational, emotional).

---

## 5. Messaging Framework

### Messaging Pillars (4 столпа)

Каждый столп обращается к конкретному emotional job и подкреплён ментальной моделью.

#### Pillar 1: "Team, not tools" (Unity + JTBD)

**Emotional job**: Leverage — "я один, но у меня команда"

**Message**: ORCH превращает отдельные AI-инструменты в координированную команду. Агенты общаются, делятся контекстом, передают работу друг другу. Как настоящая инженерная команда — минус стендапы.

**Proof points**:
- Inter-agent messaging (direct + broadcast)
- Shared context store (key-value, доступен всем)
- Team topology (lead → members)
- Goal decomposition (CTO-агент разбивает цель на задачи)

**Copy example**:
> "Stop copy-pasting between AI tools. Your agents talk to each other now."

#### Pillar 2: "Safe parallelism" (Loss Aversion + Regret Aversion)

**Emotional job**: Control + Safety — "ничего не сломается"

**Message**: Каждый агент работает на своей ветке в изолированном worktree. Код проходит через state machine (todo → in_progress → review → done). Ты ревьюишь и одобряешь. Main branch всегда чистый.

**Proof points**:
- Git worktree isolation (каждый агент = своя ветка)
- State machine governance (переходы валидируются)
- Mandatory review step (ничего не мержится без одобрения)
- Auto retry с exponential backoff (сбои обрабатываются)

**Copy example**:
> "Every agent works on its own branch. Nothing touches main until you approve."

#### Pillar 3: "Zero to team in 10 seconds" (Activation Energy + Present Bias)

**Emotional job**: Speed — "я хочу начать прямо сейчас"

**Message**: Один npm install. Один запуск. Никакой инфраструктуры — ни базы данных, ни облака, ни конфиг-файлов. ORCH создаёт `.orchestry/` и ты готов. 15 готовых агентов включены.

**Proof points**:
- `npm i -g @oxgeneral/orch && orch` — 10 секунд до старта
- Zero cloud dependencies
- File-based state (YAML/JSON/JSONL) — портативно, коммитится в git
- 15 pre-configured agent templates
- Organization Templates (одна команда — один deploy)

**Copy example**:
> "npm install. orch. You now have an AI team. That's it."

#### Pillar 4: "Your tools, amplified" (Endowment Effect + Status-Quo Bias)

**Emotional job**: Не менять привычки — "я хочу оставить мои инструменты"

**Message**: ORCH не заменяет Claude, Cursor или Codex. Он запускает их вместе. Ты продолжаешь использовать свои AI-инструменты — но теперь они работают как команда. 5 адаптеров из коробки: Claude, OpenCode (Gemini/DeepSeek), Codex, Cursor, Shell.

**Proof points**:
- 5 native adapters (не абстракция, а прямой запуск)
- Shell adapter = любой CLI-инструмент
- Agent config хранит настройки каждого адаптера
- Не нужен API key от ORCH — используй свои ключи

**Copy example**:
> "Keep using Claude and Cursor. Now they work together."

---

## 6. Comparison Positioning (Contrast Effect)

### Фрейм сравнения

Не сравнивать feature-by-feature (проигрышная стратегия). Вместо этого — **reframe категорию**.

#### vs. Running agents manually (primary competitor — текущее поведение)

> **Anchoring**: "Вы уже тратите $200/мес на AI инструменты. ORCH бесплатно делает их в 5 раз эффективнее."

| Вручную | С ORCH |
|---------|--------|
| Один агент за раз | N агентов параллельно |
| Copy-paste контекста | Автоматическая доставка |
| Merge conflicts | Git worktree isolation |
| Забыл перезапустить | Auto retry с backoff |
| Переключаешься между окнами | Единый TUI dashboard |

#### vs. Paperclip (enterprise competitor)

**Frame**: Не "мы хуже" а "разные ниши"

> "Paperclip — для AI-компаний, которым нужен governance layer с PostgreSQL и Web UI.
> ORCH — для разработчиков, которым нужна AI-команда прямо сейчас, без инфраструктуры.
> Одна команда — `npm install`. Одна команда — `orch`. Готово."

**Anchoring**: Paperclip требует PostgreSQL + onboarding. ORCH = zero dependencies.

#### vs. CrewAI / LangChain (framework competitors)

**Frame**: Не конкуренты, а разные уровни стека.

> "CrewAI/LangChain — фреймворки для НАПИСАНИЯ агентов на Python.
> ORCH — runtime для ЗАПУСКА готовых агентов (Claude, Codex, Cursor) как команды.
> Не нужно писать код. Не нужен Python. Npm install и работай."

---

## 7. Landing Page Messaging (обновлённое)

### Hero Section

**Badge**: `Open source · MIT · v1.0.0`

**H1** (вариант E+C):
> Turn Claude, Cursor, and Codex into one *team*

**Subheading**:
> Run a coordinated team of AI agents in parallel — each on its own git branch, with automatic retries and merge-back. One npm install. Zero cloud. Ship while you sleep.

**CTA**: `Install in 10 seconds` + `See it in action`

**Meta bar**: `N+ parallel agents · 5 AI providers · MIT license`

### Problem-Solution Section

**H2**: One agent is a toy. A team is a *force*.

(Оставить — отлично работает через Contrast Effect)

### Stats Bar

| Stat | Принцип |
|------|---------|
| **N+** Parallel Agents | Scarcity Inversion — нет лимита |
| **10s** to First Run | Activation Energy — мгновенный старт |
| **0** Cloud Dependencies | Loss Aversion — ничего не отдаёшь |
| **5** AI Providers | Endowment — твои инструменты остаются |

### Feature Headers (reframed через JTBD)

| Было | Стало | Принцип |
|------|-------|---------|
| Team Intelligence | Agents that talk to each other | Concrete + JTBD |
| Autonomous Execution | Set a goal, go to sleep | Present Bias + Aspiration |
| Bulletproof Execution | Nothing touches main until you approve | Loss Aversion + Safety |
| Your Terminal, Your Rules | Zero infrastructure. Just files. | Status-Quo Bias + Simplicity |

### CTA Section

**H2**: Start shipping with your AI *team*

**Sub**: One command to install. One command to orchestrate.

```
$ npm install -g @oxgeneral/orch     [click to copy]
                then
$ orch                                [click to copy]
```

**Trust bar**: `MIT licensed · 15 agents included · Zero cloud deps · 1 cmd to start`

---

## 8. Onboarding Psychology (IKEA Effect + Goal-Gradient)

### Принцип

Чем больше пользователь "строит" свою организацию, тем выше perceived value (IKEA Effect). Показывать прогресс на каждом шаге (Goal-Gradient).

### First Run Experience

```
$ orch
  ✓ Initialized .orchestry/          (step 1/4)
  → Launching TUI...

  ┌─────────────────────────────────────────┐
  │  Welcome to ORCH                        │
  │                                         │
  │  Choose your team:                      │
  │  > Startup MVP Sprint (5 agents)        │    ← Organization Templates
  │    PR Review Pipeline (5 agents)        │      с gallery в TUI
  │    Custom setup                         │
  │                                         │
  │  [↑↓ navigate] [enter select]          │
  └─────────────────────────────────────────┘

  ✓ Created team "platform"                (step 2/4)
  ✓ Added 5 agents                         (step 3/4)
  → What's your first goal?
  > "Build auth module"                     (step 4/4)

  ✓ Ready! Press [r] to run all agents.
```

**Принципы в действии**:
- **Goal-Gradient**: 4 шага, прогресс виден (step 1/4 → 4/4)
- **IKEA Effect**: пользователь выбрал шаблон, дал имя цели — это "его" команда
- **Default Effect**: первый шаблон pre-selected
- **Activation Energy**: минимум ввода, максимум defaults
- **Commitment & Consistency**: после 4 шагов человек committed, запустит агентов

---

## 9. Retention & Growth Psychology

### Switching Costs (этичные)

| Механизм | Как работает | Принцип |
|----------|-------------|---------|
| `.orchestry/` state | Вся история задач, runs, teams в файлах | Endowment Effect |
| Org templates | Пользователь строит и сохраняет свои шаблоны | IKEA Effect |
| Run history | Полный audit trail всех действий агентов | Sunk Cost (позитивный) |
| Muscle memory | CLI shortcuts, TUI keybindings | Status-Quo Bias |

### Flywheel

```
Install ORCH → Deploy org template → Agents complete tasks
     ↑                                        ↓
 Share template ← Tell others ← Ship faster ←┘
```

### Network Effects (через Organization Templates)

| Фаза | Механизм |
|------|---------|
| V1 | 9 builtin templates — мы создаём |
| V2 | `orch org export` — пользователи создают |
| V3 | `orch org publish` — маркетплейс шаблонов |
| V4 | Community templates — network effect |

**Bandwagon Effect**: "47 teams use Startup MVP Sprint template" → social proof в gallery.

---

## 10. Pricing Psychology (для будущего)

### Текущее: MIT, бесплатно

Это стратегически правильно (Zero-Price Effect + Reciprocity). Free = максимальный охват, минимальный барьер.

### Будущее: Freemium с Agent Company Platform

| Tier | Цена | Frame | Принцип |
|------|------|-------|---------|
| **ORCH Engine** | Free forever | "The engine is free. Always." | Zero-Price Effect + Reciprocity |
| **Agent Company** (self-hosted) | Free (MIT) | "Run your own dashboard" | Endowment Effect |
| **Agent Company Cloud** | $29/мес per project | "Less than one Claude API call per day" | Mental Accounting |
| **Enterprise** | Custom | Показать рядом с $29 | Anchoring / Door-in-the-Face |

**Rule of 100**: $29/мес < $100 → "50% off first 3 months" лучше чем "$15 off".

**Good-Better-Best**: Engine (free) → Self-hosted (free, effort) → Cloud ($29, zero effort). Decoy: self-hosted делает Cloud привлекательнее.

---

## 11. SEO Positioning

### Target Keywords (по категории)

| Категория | Keywords |
|-----------|---------|
| Primary | "ai agent orchestration", "run multiple ai agents", "ai agent team" |
| Problem-aware | "run claude and cursor together", "ai agents in parallel", "coordinate ai coding agents" |
| Solution-aware | "orch cli", "ai agent runtime", "open source agent orchestrator" |
| Competitor | "paperclip alternative", "crewai alternative typescript", "langchain alternative" |

### Content Strategy (Compounding + Flywheel)

| Content | SEO Intent | Psychological Hook |
|---------|-----------|-------------------|
| "How to run 5 AI agents on one project" | Tutorial, long-tail | Concrete outcome |
| "I shipped an MVP in 48 hours with AI agents" | Case study | Mimetic Desire |
| "ORCH vs Paperclip vs CrewAI" | Comparison | Contrast Effect |
| "Why AI agents need a runtime" | Category creation | First Principles |
| "Organization Templates: AI team in 10 seconds" | Feature | Activation Energy |

---

## 12. Итоговые рекомендации

### Изменить немедленно

1. **Hero H1**: "Orchestrate AI agent teams from your terminal" →
   **"Turn Claude, Cursor, and Codex into one team"**

2. **Hero sub**: Убрать техническую специфику, добавить outcome:
   **"Run a coordinated team of AI agents in parallel — each on its own git branch, with automatic retries and merge-back. One npm install. Zero cloud."**

3. **npm description**: "Agents Organizations — CLI orchestrator for AI agents" →
   **"AI agent runtime — run Claude, Codex, Cursor and shell scripts as a coordinated team"**

4. **README tagline**: "Stop babysitting AI agents. Start orchestrating them." →
   **"Turn your AI tools into a coordinated engineering team."** (и оставить "Stop babysitting..." как secondary)

5. **Stats bar**: заменить "N+ Parallel Agents" → **"10 sec to first run"** (Activation Energy важнее абстрактного N+)

### Изменить в landing page

6. **Feature headers** — переписать через JTBD (см. секцию 7)
7. **Problem-Solution** — оставить как есть (уже хорошо работает через Contrast)
8. **Add social proof**: счётчик npm downloads (Bandwagon Effect)

### Изменить в ТЗ Engine Repositioning

9. **Не использовать "engine" в user-facing messaging** — слишком абстрактно. Использовать "runtime" в developer docs, но в маркетинге говорить через outcome: "turn X into a team", "ship while you sleep"

10. **Новый tagline для package.json / GitHub About** → использовать формулу:
    `[What it does] + [for whom] + [key differentiator]`
    = **"AI agent runtime — run Claude, Codex, Cursor as a coordinated team with git isolation and zero cloud"**

### Приоритизация (Pareto 80/20)

| Действие | Effort | Impact | ROI |
|----------|--------|--------|-----|
| Hero H1 + sub rewrite | 10 мин | Высокий | Максимальный |
| npm description | 1 мин | Средний | Максимальный |
| README tagline | 5 мин | Средний | Высокий |
| Feature headers reframe | 30 мин | Средний | Средний |
| Stats bar update | 10 мин | Низкий | Средний |
| compare.html + Paperclip | 2 часа | Средний | Средний |
| Organization Templates (FTUE) | 3–5 дней | Высочайший | Высочайший |

**80% impact = первые 3 действия (16 минут работы).**
