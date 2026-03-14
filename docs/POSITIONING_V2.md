# ORCH — Positioning V2: Zero-Human Companies

> Open-source orchestration for zero-human companies in your terminal.

**Дата**: 2026-03-14
**Статус**: Final Draft
**Заменяет**: POSITIONING.md (v1 — "Turn your AI tools into a team")

---

## 1. Vision

**Один человек может запустить целую инженерную компанию из AI-агентов — из терминала, за 30 секунд, бесплатно.**

Не "инструмент для запуска агентов". Не "оркестратор". А **операционная система для компаний, где ты — единственный человек, а AI — весь остальной штат**.

---

## 2. Почему "turn your tools into a team" не работает

| Проблема | Модель |
|----------|--------|
| Описывает feature, а не vision | JTBD: люди покупают трансформацию, не инструмент |
| Копируемо — Superset, Codex, любой wrapper может это сказать | Category Design: нет owned territory |
| Не вызывает эмоций — "координация" это скучно | Mimetic Desire: нет "я тоже хочу так" |
| Не масштабируется — "team" это 3-5 агентов, потолок | Anchoring: низкий anchor ограничивает восприятие |

**"Zero-human company"** — это vision, который:
- Нельзя скопировать feature description'ом
- Создаёт новую категорию
- Масштабируется от 2 агентов до 20 департаментов
- Уже в zeitgeist (AI companies, AI employees — горячая тема 2026)

---

## 3. Jobs to Be Done — глубокий анализ

### 3.1. Functional JTBD

> **Core Job**: "Я хочу чтобы мой проект двигался вперёд, пока я занят другим — или сплю."

| Sub-Job | Текущее решение | Боль | Решение ORCH |
|---------|----------------|------|-------------|
| Запустить несколько агентов на разные задачи | 3 терминала, ручной запуск | Контекст теряется, жонглирование, один падает — не замечаешь | `orch run --all` — один launch, все агенты |
| Не дать агентам сломать код друг друга | Молиться, руками мержить | Merge conflicts, потеря работы, сломанный main | Git worktree isolation — каждый на своей ветке |
| Знать что каждый агент делает прямо сейчас | Переключаться между окнами, читать raw output | Нет единой картины, пропускаешь ошибки | TUI dashboard — live activity feed |
| Проверить результат перед мержем | Руками git diff каждой ветки | Медленно, пропускаешь баги | Mandatory review step в state machine |
| Автоматически перезапустить упавшего агента | Заметить что упал → ручной restart | Не замечаешь часами, теряешь время | Auto-retry с exponential backoff + stall detection |
| Поставить стратегическую цель, не расписывать каждую задачу | Самому декомпозировать цель → руками создать 10 задач | Bottleneck на тебе, агенты простаивают | Goals + autonomous decomposition через CTO-agent |
| Чтобы агенты передавали результаты друг другу | Copy-paste output одного агента в prompt другого | Ручная рутина, ошибки, потеря контекста | Inter-agent messaging + shared context store |
| Знать сколько потратил на AI | Ждать счёт в конце месяца | $180 surprise, нет visibility | Token tracking per run per agent (budget alerts — roadmap) |
| Быстро собрать команду под проект | Руками создать каждого агента, прописать роли | 30 минут настройки, нудно | `orch org deploy startup-mvp` — 30 секунд |
| Масштабировать с 2 до 10 агентов | Больше терминалов, больше хаос | Не масштабируется | Teams + departments + автоматическое распределение |

### 3.2. Emotional JTBD

| Feeling | Описание | Как ORCH доставляет |
|---------|----------|---------------------|
| **Leverage** | "Я один, но у меня целый штат" | 15 готовых агентов, teams, departments |
| **Power** | "Я управляю компанией, а не слежу за терминалами" | Goals → CTO agent → автономное выполнение |
| **Safety** | "Мой код всегда в безопасности" | Git isolation + mandatory review + state machine |
| **Speed** | "Я ложусь спать — а утром PRs готовы" | Autonomous execution + auto-retry |
| **Control** | "Я вижу всё, могу остановить в любой момент" | TUI dashboard + cancel/pause + review gate |
| **Identity** | "Я не просто разработчик — я founder AI-компании" | Zero-human company framing |
| **Freedom** | "Мне не нужен чей-то cloud или чьё-то разрешение" | MIT, zero infra, твои API keys |

### 3.3. Social JTBD

| Job | Описание |
|-----|----------|
| **Статус** | "Я запускаю zero-human engineering team" — звучит впечатляюще |
| **Story** | "Я один, но отправил 18 задач на ночь и утром было 14 PR" — контент для Twitter/блога |
| **Community** | "Я опубликовал свой org template — другие используют мою конфигурацию компании" |
| **Signaling** | "Я на передовой AI — я не просто использую Claude, я управляю AI-командой" |

---

## 4. Personas через призму "Zero-Human Company"

### Persona 1: Solo Founder — "Alexei"

**Кто**: Фрилансер или indie hacker. Работает один. Использует Claude Code и/или Codex ежедневно. Делает проекты для клиентов или строит свой продукт.

**Текущий стек**: Claude Pro ($20/мес) + Claude API (pay-as-you-go) + иногда Cursor IDE

**Текущий workflow**:
```
Утро: Открыл Claude → дал задачу → ждёшь 15 минут → забрал результат
      Открыл Codex → дал вторую задачу → ждёшь → забрал
      Руками мержишь, руками проверяешь
Вечер: Claude упал → не заметил → потерял 2 часа работы
Конец месяца: $180 счёт → "откуда?!"
```

**Желаемый workflow**:
```
Вечер: orch org deploy startup-mvp → "Build auth module"
       orch run --all → 5 агентов поехали
       Пошёл спать
Утро:  Открыл orch → 4 из 5 задач в review
       Approve, approve, reject с feedback, approve
       git push → done
       Tokens: $3.40 total (видно per agent per task)
```

**Core JTBD**:
> "Я хочу работать как студия из 6 человек, оставаясь одним человеком — и не тратить время на менеджмент."

**Activation trigger**: Первый раз когда:
- Claude упал в середине длинной задачи, и ты не заметил 2 часа
- Пришёл счёт за API и ты не понял откуда $180
- Ты захотел отправить 3 задачи параллельно и понял что не можешь
- Ты увидел как кто-то в Twitter показывает "мой AI team отправил 14 PR за ночь"

**Objection map**:

| Возражение | Ответ | Принцип |
|-----------|-------|---------|
| "Мне не нужна 'компания' — я один" | "Именно. Один человек + ORCH = engineering department. Ты founder, агенты — штат." | Unity + Reframe |
| "Мои задачи слишком маленькие для этого" | "Даже 2 агента параллельно — это 2x скорость. Даже 1 агент с auto-retry — это страховка от крашей." | Foot-in-the-Door |
| "Не сломает ли код?" | "Каждый агент на своей ветке. Mandatory review. Ничего не тронет main пока ты не approve." | Regret Aversion |
| "Сколько стоит?" | "Бесплатно навсегда. MIT. Твои API keys." | Zero-Price Effect |
| "Это долго настраивать?" | "`npm install -g @oxgeneral/orch && orch` — 10 секунд. Или `orch org deploy` — готовая команда за 30 секунд." | Activation Energy |
| "Я не смогу контролировать" | "TUI dashboard, live activity feed, cancel/pause любой задачи. Ты CEO — полный контроль." | Loss Aversion |

**Primary message для Alexei**:
> **"You run Claude every day. What if you had an entire engineering team?"**

**Supporting messages**:
- "5 AI agents. Zero employees. One npm install."
- "Deploy a CTO, backend, QA, and reviewer. Go to sleep. Wake up to PRs."
- "Stop restarting crashed agents. ORCH retries automatically."
- "Know exactly what each agent costs — before the bill arrives."

---

### Persona 2: Tech Lead — "Maria"

**Кто**: Техлид команды из 3-8 человек. Уже использует Claude/Cursor для своих задач. Хочет масштабировать AI на команду.

**Текущий workflow**:
```
Создаёт задачи в Jira → разработчики используют AI каждый по отдельности
Нет видимости кто сколько тратит на AI
Merge conflicts когда два человека + два AI правят одни файлы
```

**Желаемый workflow**:
```
Загружает спринт в ORCH → 6 агентов разбирают задачи
Dashboard показывает прогресс всей команды
Worktree isolation — ноль конфликтов
Утром: 80% задач в review → approve/reject → ship
```

**Core JTBD**:
> "Хочу AI engineering department, который работает ночью и выходит на review утром — без моего микроменеджмента."

**Primary message для Maria**:
> **"Run a zero-human night shift. Review the results in the morning."**

---

### Persona 3: AI-First Founder — "Daniel"

**Кто**: Стартапер/предприниматель, строит продукт с минимальным human involvement. Уже думает в терминах "AI workforce".

**Текущий workflow**:
```
Руками оркестрирует 5-10 AI tools
Paperclip слишком тяжёлый (PostgreSQL, cloud setup)
CrewAI — нужно писать Python, не хочет
Хочет "запустить и забыть"
```

**Core JTBD**:
> "Хочу запустить полноценную AI-компанию: отделы, цели, процессы — из терминала, без инфраструктуры, за 5 минут."

**Primary message для Daniel**:
> **"Paperclip needs PostgreSQL. You need npm install."**

---

## 5. Feature → Benefit → JTBD mapping

### Уровень: Departments (отделы)

| Feature | Benefit | JTBD |
|---------|---------|------|
| Teams с lead agent | У тебя есть CTO, который распределяет работу | "Не хочу сам расписывать каждую задачу каждому агенту" |
| Team task pools | Задачи автоматически разбираются агентами из пула | "Хочу загрузить backlog и пойти спать" |
| Multiple teams | Frontend team, Backend team, QA team — как настоящие отделы | "Хочу структуру, а не хаос из 10 агентов" |
| Team broadcasts | Объявление всему отделу за одну команду | "Хочу сказать 'API schema changed' и чтобы все услышали" |

### Уровень: Process (процессы)

| Feature | Benefit | JTBD |
|---------|---------|------|
| State machine (todo→in_progress→review→done) | Ничего не теряется, ничего не мержится без проверки | "Не хочу чтобы AI сломал production" |
| Mandatory review | Ты видишь и одобряешь каждое изменение | "Хочу быть CEO, а не рабом — контролировать, не делать" |
| Auto-retry + exponential backoff | Упавший агент перезапускается сам | "Не хочу мониторить агентов в 2am" |
| Stall detection + zombie cleanup | Зависший агент убивается и задача re-queued | "Не хочу утром обнаружить что агент висит 6 часов" |
| Reject with feedback | Отклонил → агент получает feedback и переделывает | "Хочу сказать 'не так, вот так' и получить результат без ручной работы" |

### Уровень: Strategy (стратегия)

| Feature | Benefit | JTBD |
|---------|---------|------|
| Goals | Ставишь цель — CTO-agent декомпозирует в задачи | "Хочу сказать ЧТО, а не расписывать КАК" |
| Autonomous task generation | Idle агенты сами берут работу из goal | "Не хочу быть bottleneck раздачи задач" |
| Goal progress tracking | Видишь % выполнения каждой цели | "Хочу знать где мы — без спрашивания" |
| Goal-task linking | Каждая задача привязана к стратегической цели | "Хочу чтобы вся работа была aligned с целями" |

### Уровень: Communication (коммуникация)

| Feature | Benefit | JTBD |
|---------|---------|------|
| Direct messages | Агент A отправляет результат агенту B напрямую | "Не хочу быть router между агентами" |
| Broadcasts | Одно сообщение всем агентам или всей команде | "Хочу сказать 'database schema changed' — и все узнали" |
| Shared context store | Key-value хранилище, доступное всем агентам | "Хочу чтобы все агенты знали tech stack, conventions, decisions" |
| Mailbox delivery | Сообщения инжектируются в prompt при запуске | "Не хочу думать о timing — сообщение дойдёт когда agent начнёт работать" |

### Уровень: Safety (безопасность)

| Feature | Benefit | JTBD |
|---------|---------|------|
| Git worktree isolation | Каждый агент = своя ветка, свой worktree | "Не хочу чтобы агенты перезаписывали код друг друга" |
| Auto merge-back | Approved task → автоматический merge в main | "Не хочу руками мержить 5 веток" |
| Scope overlap detection | Предупреждение если два агента правят одни файлы | "Хочу знать о конфликтах ДО того как они случатся" |
| Run event log (JSONL) | Полная история каждого действия каждого агента | "Хочу audit trail — знать кто что сделал и почему" |
| Token tracking per run | Сколько токенов потратил каждый агент на каждую задачу | "Хочу видеть расходы, а не получать surprise bill" |

### Уровень: Onboarding (быстрый старт)

| Feature | Benefit | JTBD |
|---------|---------|------|
| `npm install -g` + `orch` | 10 секунд от нуля до рабочей системы | "Не хочу настраивать PostgreSQL, Docker, cloud accounts" |
| 15 pre-built agents | Готовые роли: CTO, Backend, QA, Reviewer, etc. | "Не хочу писать system prompts для каждого агента" |
| Organization Templates | `orch org deploy startup-mvp` — вся команда за 30 сек | "Хочу нажать одну кнопку и получить готовую структуру" |
| TUI Settings Wizard | Интерактивная настройка из TUI без YAML | "Не хочу читать docs чтобы начать" |
| Auto-init on first run | `orch` в любом git repo создаёт `.orchestry/` | "Не хочу думать об init/setup — просто запусти" |

---

## 6. Opportunity Map: новые возможности

### 6.1. Что становится возможным с zero-human company framing

| Возможность | Описание | Статус |
|-------------|----------|--------|
| **Overnight sprint** | Загрузить 18 задач спринта, запустить перед сном, утром 14 PR в review | Возможно сейчас |
| **Parallel MVP** | CTO декомпозирует → Backend×2 + Frontend + QA → MVP за 48 часов вместо 3 недель | Возможно сейчас |
| **Continuous refactoring** | Агенты рефакторят по модулю за ночь, QA тестирует, Reviewer проверяет | Возможно сейчас |
| **Autonomous bug triage** | Triager анализирует issues → создаёт задачи → Fixer×3 исправляют → QA проверяет | Возможно сейчас |
| **24/7 PR review** | Каждый PR проходит через Security + Performance + Style + QA агентов автоматически | Возможно сейчас |
| **AI content pipeline** | Strategist → Writer×2 → Editor → SEO — контент-фабрика без людей | Возможно с shell adapter |
| **Multi-repo coordination** | Один ORCH instance на монорепо или несколько на разные repos | Возможно сейчас |
| **Cost-aware operations** | Budget per agent, авто-пауза при лимите, cost reports | Roadmap (EP-31) |
| **Web command center** | Web UI для менеджеров и стейкхолдеров | Roadmap (EP-32) |
| **Company templates marketplace** | Publish/share org templates — community-driven | Roadmap |

### 6.2. "Day in the Life" scenarios

#### Scenario 1: Solo dev midnight sprint

```
22:00  $ orch org deploy startup-mvp
         ✓ Created team "platform" — 5 agents
         ✓ CTO (claude), Backend A (claude), Backend B (codex),
           QA (codex), Reviewer (claude)

22:01  $ orch goal add "Implement user auth with OAuth2, JWT, and role-based access"
         ✓ Goal assigned to CTO → autonomous mode ON

22:02  $ orch run --all --watch
         ✓ CTO decomposed goal → 6 tasks created
         ✓ Backend A → "Implement OAuth2 flow"        [feature/oauth]
         ✓ Backend B → "JWT token service"              [feature/jwt]
         ✓ QA → waiting for implementations...

22:02  → You close the laptop and go to sleep.

06:30  $ orch
         ┌─ Tasks ─────────────────────────────────┐
         │ ✓ done    4 │ ⏳ review  2 │ ✗ failed 0 │
         └──────────────────────────────────────────┘

         review: "Role-based middleware"  — Backend A
         review: "Auth integration tests" — QA

06:35  $ orch task review tsk_a3f --approve
       $ orch task review tsk_b7c --approve
         ✓ Merging [feature/rbac] → main
         ✓ Merging [test/auth] → main

06:40  $ git log --oneline -6
         Auth integration tests (QA agent)
         Role-based access middleware (Backend A)
         JWT token service (Backend B)
         OAuth2 flow implementation (Backend A)
         User model and migrations (Backend B)
         Auth module architecture (CTO agent)

       Total: 6 PRs merged. $4.20 in tokens. 0 humans involved overnight.
```

#### Scenario 2: Tech lead sprint offload

```
Friday 17:00  $ orch task add "Migrate user service to TypeScript" -p 1
              $ orch task add "Add rate limiting to API" -p 2
              $ orch task add "Fix N+1 query in dashboard" -p 1
              $ orch task add "Write E2E tests for checkout flow" -p 2
              ... (14 more tasks from sprint backlog)

              $ orch run --all --watch
              ✓ 6 agents dispatched across 3 teams

Monday 09:00  $ orch
              ┌─ Sprint Status ────────────────────────┐
              │ ✓ done 11 │ ⏳ review 4 │ retrying 2 │ todo 1 │
              └────────────────────────────────────────┘
              Tokens used: $18.30 (Backend A: $6.20, Backend B: $5.10, ...)

              → Review 4 PRs, give feedback on 2, approve 2
              → Team delivered 60% of sprint over the weekend
```

#### Scenario 3: AI-first founder building a product

```
$ orch org deploy startup-mvp --goal "Build a SaaS invoicing app with Stripe integration"

  ✓ CTO agent decomposed into 12 tasks:
    - Database schema design
    - REST API scaffolding
    - Stripe integration
    - Invoice PDF generation
    - Email notifications
    - User authentication
    - Dashboard frontend
    - ... and 5 more

  ✓ 5 agents working in parallel
  ✓ Estimated completion: 4-6 hours

  → Founder goes to dinner. Comes back to a working prototype.
```

---

## 7. Competitive positioning through JTBD lens

### vs. "Doing it manually" (primary competitor — current behavior)

| Their JTBD | Manual | ORCH |
|------------|--------|------|
| Run tasks in parallel | 3 terminals, tab-switching | `orch run --all` — one command |
| Don't break main | Hope for the best | Git worktree isolation guaranteed |
| Retry crashed agents | Notice → manually restart | Automatic, exponential backoff |
| Track spending | Wait for monthly bill | Per-run per-agent token counts |
| Scale beyond 3 agents | Impossible manually | Teams, departments, shared pools |
| Strategic direction | You decompose everything | Goals → CTO agent → auto tasks |

**Key insight**: Manual = you're the employee. ORCH = you're the CEO.

### vs. Paperclip

| Their JTBD | Paperclip | ORCH |
|------------|-----------|------|
| Launch AI company | Cloud signup → PostgreSQL → config → onboard | `npm install && orch` |
| Zero infrastructure | Needs Postgres, web server | Files only. Zero deps. |
| Cost | Paid / freemium | Free forever (MIT) |
| Control | Their cloud, their rules | Your machine, your keys |
| Speed to start | 30+ minutes | 30 seconds |
| Budgets | Built-in | Roadmap (EP-31) |
| Web UI | Built-in | Roadmap (EP-32) |

**Key insight**: Paperclip = enterprise AI company platform. ORCH = hacker's AI company from terminal.

### vs. Superset

| Their JTBD | Superset | ORCH |
|------------|----------|------|
| Run agents in parallel | Yes (desktop GUI) | Yes (CLI + TUI) |
| State machine | No — just parallel execution | Yes — todo→review→done |
| Auto-retry | No | Yes + stall detection |
| Inter-agent messaging | No | Direct + broadcast + context store |
| Goals & autonomy | No | CTO decomposes, agents self-organize |
| Teams / departments | No | Full team topology with leads |
| Platform | macOS only | macOS + Linux + Windows |

**Key insight**: Superset = parallel runner. ORCH = managed AI company.

### vs. CrewAI / LangChain

| Their JTBD | CrewAI / LangChain | ORCH |
|------------|-------------------|------|
| Use existing AI tools | No — write custom agents in Python | Yes — Claude, Codex, Cursor as-is |
| Language | Python | TypeScript (npm install) |
| Code required | Write agent code | Zero code — config + CLI |
| Production-ready agents | You build them | 15 included |
| Git integration | None | Native worktree isolation |

**Key insight**: CrewAI = framework to BUILD agents. ORCH = runtime to RUN existing agents as company.

---

## 8. Messaging Framework

### Primary Tagline

> **Open-source orchestration for zero-human companies**

### Hero Variants (A/B test)

| ID | H1 | Sub | For |
|----|----|----|-----|
| A | Launch a zero-human engineering *company* | CTO, backend, QA, reviewer — an entire AI engineering department. From your terminal. Free forever. | Bold vision |
| B | Zero employees. Full engineering team. *One npm install.* | Deploy an AI CTO, backend engineers, QA, and code reviewer. They message each other, retry on failure, and merge code — while you sleep. | Concrete + activation |
| C | You're the founder. *AI is the team.* | Set a goal. Deploy a department. Go to sleep. Wake up to pull requests. ORCH runs your AI company from the terminal. | Empowerment |
| D | Run a company while you *sleep* | 5 AI agents. Departments, goals, messaging. State machine governance. Zero cloud. `npm install` and launch. | Aspirational outcome |

### Messaging Pillars

| Pillar | Headline | Body | Proof |
|--------|----------|------|-------|
| **You're the CEO** | One human. Full engineering department. | Set goals, not tasks. Your CTO agent decomposes strategy into work. Backend builds. QA tests. Reviewer checks. You approve. | Goals → autonomous decomposition, teams with leads |
| **Real departments** | Not just agents. Departments. | CTO, Backend, QA, Reviewer — organized in teams with leads, shared task pools, and direct messaging. Like a real company org chart. | Teams, leads, broadcasts, shared context |
| **Runs while you sleep** | Deploy at night. Review in the morning. | Auto-retry, stall detection, exponential backoff. Your agents don't stop when one fails — ORCH restarts, re-queues, and keeps going. | State machine, retry logic, zombie cleanup |
| **Nothing breaks** | Main branch is sacred. | Every agent works on its own git branch. Nothing merges until you approve. Scope overlap detection prevents conflicts before they happen. | Worktree isolation, mandatory review, scope detection |
| **30 seconds to company** | One command. Entire department. | `orch org deploy startup-mvp` — CTO, backend×2, QA, reviewer. Team created. Goal set. Agents ready. | Org templates, 15 pre-built agents |
| **Free. Yours. Forever.** | No cloud. No signup. No bills from us. | MIT license. Your API keys. Your machine. State in `.orchestry/` — plain files you can read, edit, commit. | MIT, zero cloud, file-based storage |

### Copy Bank

```
Headlines:
  "Zero employees. Full engineering team."
  "Your AI company starts with npm install."
  "5 agents. 0 employees. Overnight sprints."
  "You set the goal. AI runs the company."
  "The open-source OS for AI companies."

Sub-headlines:
  "Deploy a CTO, backend, QA, and reviewer. Go to sleep. Wake up to PRs."
  "State machine governance. Git isolation. Inter-agent messaging. From your terminal."
  "Paperclip needs PostgreSQL. You need npm install."

CTAs:
  "Deploy your first AI team"
  "Launch a zero-human company"
  "Start in 30 seconds"

Social proof (future):
  "47 zero-human companies launched this week"
  "Used by solo founders shipping at team speed"

Objection busters:
  "Do I need a team? No. Most founders start solo with 2-3 agents."
  "Is it safe? Every agent on its own branch. Nothing touches main."
  "Is it free? MIT. Forever. Your keys, your machine."
```

---

## 9. Stats Bar

**Было**: `N+ Parallel Agents · 15 Ready-Made Agents · 1 Command · 0 Cloud`
**Было v2**: `10s To First Run · 5 AI Providers · 15 Ready-Made Agents · 0 Cloud`

**Стало**:
```
6 departments  ·  15 AI employees  ·  0 humans required  ·  30s to launch
```

**Почему**: "departments" и "AI employees" усиливают company framing. "0 humans required" — provocative hook. "30s to launch" — Activation Energy.

---

## 10. Landing Page Narrative (AIDA)

### Attention (Hero)

```
H1:  Launch a zero-human engineering company
Sub: CTO, backend engineers, QA, code reviewer — an entire AI department.
     From your terminal. Free forever.
CTA: [Deploy your first AI team]  [See it in action]
```

### Interest (Problem-Solution)

```
Header: "One agent is a tool. A department is a company."

Before                          After
────────────────────────       ─────────────────────────
Manual agent juggling      →   CTO routes work automatically
No process, no review      →   State machine: todo → review → done
Agents don't talk          →   Direct messages + broadcasts
You babysit every crash    →   Auto-retry + stall detection
Surprise $180 API bills    →   Token tracking per agent per run
```

### Desire (Demo + Use Cases)

```
Terminal demo: orch org deploy → orch run --all → agents working → PRs ready
TUI screenshot/video: live dashboard with departments
Use cases: Overnight MVP, Sprint Offload, 24/7 PR Review, Migration Squad
```

### Action (CTA)

```
H2:  Your AI company starts here
Sub: One command to install. One command to launch.

$ npm install -g @oxgeneral/orch     [click to copy]
              then
$ orch org deploy startup-mvp        [click to copy]

Trust: MIT licensed · 15 AI employees · 0 cloud deps · 30s to launch
```

---

## 11. Organization Templates — продуктовое выражение vision

Templates — это ключевой продуктовый элемент, который делает "zero-human company" не абстракцией, а **one-click reality**.

### Каталог "компаний"

| Template | Роль | Агенты | JTBD |
|----------|------|--------|------|
| `startup-mvp` | AI Startup | CTO, Backend×2, Frontend, QA, Reviewer | "MVP за 48 часов" |
| `pr-review-corp` | AI QA Department | Security, Performance, Style, QA, CTO | "Automated review для каждого PR" |
| `migration-squad` | AI Migration Team | CTO, Migrator×3, QA, Reviewer | "JS→TS за выходные" |
| `content-agency` | AI Content Studio | Strategist, Writer×2, Editor, SEO | "Контент-фабрика" |
| `security-dept` | AI Security Team | Shell(Semgrep), Shell(Trivy), Shell(Gitleaks), Hunter, Reviewer | "Аудит без security team" |
| `test-factory` | AI QA Factory | Shell(c8), Backend×2, QA×2, Reviewer | "Coverage 40%→80% за ночь" |
| `monorepo-org` | AI Monorepo Team | CTO, Backend, Frontend, Infra, QA, Reviewer | "Full-stack monorepo" |
| `bugfix-dept` | AI Bug Squad | Triager, Fixer×3, QA, Reviewer | "100 issues → 0 за неделю" |
| `data-lab` | AI Analytics | Shell(pandas), Shell(duckdb), Shell(matplotlib), Writer | "3 CSV → executive report" |

**CLI**:
```bash
orch org list                        # Показать все "компании"
orch org info startup-mvp            # Детали: агенты, роли, структура
orch org deploy startup-mvp          # Развернуть: agents + team + goal
orch org deploy startup-mvp \
  --goal "Build invoicing SaaS"      # С конкретной целью
orch org export my-company           # Экспортировать текущий setup
```

---

## 12. SEO Keywords

| Категория | Keywords |
|-----------|---------|
| Category-defining | "zero-human company", "ai company from terminal", "ai engineering team" |
| Problem-aware | "run multiple ai agents parallel", "ai agent crashes retry", "coordinate claude cursor codex" |
| Solution-aware | "orch ai agent runtime", "open source ai orchestrator", "ai team cli" |
| Competitor | "paperclip alternative open source", "superset alternative", "crewai alternative typescript" |
| Aspirational | "build with ai agents only", "ship code while sleeping", "solo developer ai team" |

---

## 13. Content Strategy

| Content | Hook | Audience | Platform |
|---------|------|----------|----------|
| "I ran a zero-human dev team for 48 hours" | Story + results | Solo devs | Twitter thread, blog |
| "How I shipped an MVP while sleeping" | Aspirational outcome | Indie hackers | Indie Hackers, HN |
| "ORCH vs Paperclip: which AI company OS?" | Comparison | Decision-makers | Blog, SEO |
| "From solo dev to AI startup founder" | Identity transformation | Solo devs | Twitter, blog |
| "5 org templates for zero-human engineering" | Practical | All | Blog, docs |
| "The $4 overnight sprint: 6 PRs, 0 humans" | Concrete numbers | Cost-conscious | Twitter, Reddit |
| Video: "Setting up a zero-human company in 30s" | Demo | All | YouTube, Twitter |

---

## 14. Metrics: North Star

**North Star Metric**: **Active zero-human companies** (= projects with ≥2 agents that ran ≥1 task in last 7 days)

**Supporting metrics**:
- Time to first run (target: <60s)
- Org templates deployed per week
- Tasks completed per night (overnight sprints)
- Token cost per completed task (efficiency)
