# Рабочие доски агентов

Рабочие доски добавляют durable Workboard поверх существующих AgentRuntime,
TaskGraph, ToolFlow, workers и AIResourceScheduler. Это локальный слой очереди
долгих задач, а не новый scheduler, runtime моделей, identity или storage.

`AgentWorkboardService` хранит `Workboard`, `WorkItem`, claims, зависимости,
комментарии, артефакты и signed activity. Акторы различаются как человек,
Agent и временный worker. Статусы: `BACKLOG`, `TODO`, `READY`, `RUNNING`,
`BLOCKED`, `NEEDS_USER`, `PAUSED`, `REVIEW`, `DONE`, `FAILED`, `CANCELLED`.

Зависимости образуют DAG: циклы отклоняются, незавершённый prerequisite не
получает claim, failed prerequisite блокирует потомка, а завершение upstream
разблокирует готовый item. Claim — это lease с heartbeat/renew и expiry.
`recoverStaleClaims()` не оставляет зависшую задачу в `RUNNING`, а возвращает её
в `READY` или `BLOCKED`. Долгий execution key защищает от duplicate/replay.

`NEEDS_USER` — жёсткая граница: запрос появляется в Owner Inbox и переживает
restart/offline. Только явный ответ владельца возвращает item в `READY`.

TaskGraph, ToolFlow, Agents и workers подключаются typed host adapters. При
наличии AIResourceScheduler сохраняются его приоритеты и режимы: интерактивная
работа важнее фоновой, GAMING/BATTERY приостанавливают дорогой фон, а private
задача не уходит во внешний AI. Chronos/Automation только создают
deduplicated trigger; второго scheduler нет.

Board и item объявляют минимальные capabilities/data scopes. Private/secret
артефакт разрешён только в соответствующем scope; external execution не может
объявить private scope. `SHARED_SPACE` требует явного Space grant. Visit,
trust или human follow не дают Workboard permissions автоматически. Media и
другие Keystone objects передаются ссылками по ID, а не копиями.

Состояние сохраняется через `WorkboardStateStore`, а
`WorkboardTransportReplication` использует существующие authenticated
Transport/EnvelopeSecurity. Desktop Workboard показывает Board/List/Activity,
статусные колонки и Owner Inbox через host adapter; UI локализован на EN/RU.

Тесты в `packages/core/src/ai/workboards.test.ts` проверяют restart, leases,
stale recovery, DAG/cycles, adapters, NEEDS_USER, private scopes, offline
replication и forged events. Keystone остаётся некоммерческим: без платежей,
рекламы, marketplace и telemetry.
