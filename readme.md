# Agents Organizations

Легковесный CLI-оркестратор для AI-агентов. Управляет командой агентов (Claude Code, Codex, Cursor, shell-скрипты и др.), выполняющих задачи параллельно.

## Возможности

- **Управление задачами** — создание, назначение и отслеживание задач через конечный автомат (`todo → in_progress → review → done`)
- **Управление агентами** — конфигурация нескольких агентов с разными адаптерами и ролями
- **Параллельное выполнение** — запуск нескольких агентов одновременно с автоматической диспетчеризацией
- **Повторные попытки** — стратегия экспоненциального отступа при ошибках
- **Изоляция рабочих пространств** — три режима: `shared`, `worktree`, `isolated`
- **Интерактивный дашборд** — полноэкранный TUI с мониторингом в реальном времени
- **Watch-режим** — демон, непрерывно отслеживающий и распределяющий задачи
- **Журнал событий** — хранение в формате JSON-lines

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Язык | TypeScript (strict) |
| Рантайм | Node.js 20+ |
| CLI | Commander.js |
| TUI | Ink + React |
| Шаблоны | LiquidJS |
| Хранение | YAML/JSON файлы |
| Тесты | Vitest |
| Сборка | tsup |

## Установка

```bash
# Клонировать репозиторий
git clone <repo-url>
cd AgentsOrchestryCLI

# Установить зависимости
npm install

# Собрать проект
npm run build

# Установить глобально (опционально)
npm install -g .
```

**Требования:** Node.js >= 20.0.0

## Быстрый старт

```bash
# Инициализация в проекте
orchestry init

# Добавить агента
orchestry agent add backend --adapter claude --role "Backend developer"

# Добавить задачу
orchestry task add "Реализовать авторизацию" -p 1

# Назначить и запустить
orchestry task assign <task-id> <agent-id>
orchestry run <task-id>

# Или запустить всё
orchestry run --all
```

## Команды CLI

### Инициализация и статус

```bash
orchestry init          # Создать .orchestry/ в текущей директории
orchestry status        # Обзор задач и агентов
orchestry doctor        # Диагностика системы
```

### Задачи

```bash
orchestry task add "Заголовок" [-d описание] [-p приоритет] [-l метки]
orchestry task list [--status todo|done]
orchestry task show <id>
orchestry task assign <task-id> <agent-id>
orchestry task cancel <task-id>
orchestry task retry <task-id>
```

### Агенты

```bash
orchestry agent add <имя> --adapter claude [--role "Роль"]
orchestry agent add <имя> --adapter shell --command "python bot.py"
orchestry agent list
orchestry agent remove <id>
orchestry agent disable/enable <id>
```

### Выполнение и логи

```bash
orchestry run <task-id>       # Запустить конкретную задачу
orchestry run --all           # Запустить все todo-задачи
orchestry run --watch         # Демон с автодиспетчеризацией
orchestry logs <run-id>       # Просмотр логов
orchestry logs --follow       # Поток в реальном времени
```

### Конфигурация

```bash
orchestry config set defaults.agent.adapter codex
orchestry config get defaults.agent.timeout_ms
orchestry config edit         # Открыть в $EDITOR
```

### Интерактивный режим

```bash
orchestry                     # Открыть TUI-дашборд
orchestry tui                 # Явный запуск TUI
```

### Глобальные опции

```
--json       JSON-вывод
--quiet      Минимальный вывод
--no-color   Без ANSI-цветов
--ascii      Только ASCII (без Unicode)
```

**Псевдонимы:** `orchestry`, `orch`, `ao`

## Структура проекта

```
src/
├── bin/cli.ts              # Точка входа CLI
├── index.ts                # Экспорт библиотеки
├── cli/commands/           # Реализация команд
├── tui/                    # Ink React-компоненты
├── domain/                 # Доменные модели (DDD)
├── application/            # Бизнес-логика (сервисы)
└── infrastructure/         # Инфраструктура
    ├── adapters/           # Адаптеры агентов (Claude, Shell)
    ├── storage/            # Файловое хранилище
    ├── process/            # Управление процессами
    ├── template/           # Шаблонизатор промптов
    └── workspace/          # Изоляция рабочих пространств
```

## Архитектура

Проект построен по принципам **Domain-Driven Design** с чётким разделением слоёв:

- **Domain** — типы, сущности, state machine переходов задач
- **Application** — оркестратор, сервисы задач/агентов/запусков, шина событий
- **Infrastructure** — адаптеры агентов, файловое хранилище, управление процессами

Все данные хранятся в директории `.orchestry/` — без внешних баз данных.

## Разработка

```bash
npm run dev            # Запуск через tsx
npm run build          # Сборка в dist/
npm run build:watch    # Сборка в watch-режиме
npm run test           # Запуск тестов
npm run test:watch     # Тесты в watch-режиме
npm run typecheck      # Проверка типов
npm run clean          # Очистить dist/
```

## Документация

- [Техническая спецификация](docs/SPEC.md)
- [API Reference](docs/API.md)
- [UI/UX дизайн](docs/CLI_UI_DESIGN.md)
- [Пользовательские истории](docs/USER_STORIES.md)

## Лицензия

MIT
