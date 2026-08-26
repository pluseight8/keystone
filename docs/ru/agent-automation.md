# Автоматизации Agents

Автоматизации Keystone — это local-first слой поверх `AgentRuntime` и
`Chronos`. Они запускают уже существующую Agent-сессию по расписанию или
реагируют на типизированное локальное событие. Trigger никогда не выдаёт
новые tools, skills, источники контекста или capabilities.

Основной контракт находится в
`packages/core/src/ai/automation.ts`:

- `AgentAutomation` хранит agent/session, инструкцию, trigger, одобренные
  allowlist tools/skills, privacy class и execution budget.
- `AgentTrigger` — пятичастный cron либо allowlist событий (`dm.received`,
  `community.mention`, `file.created`, `track.created`, `video.created`,
  `live.started`, `device.security`, `system.local`).
- `AgentJob` и `AgentJobRun` — durable state machines: queued, pause/resume,
  retry, cancel и `waiting_for_approval`.
- `AgentAutomationStateStore` — явная host boundary. In-memory хранилище нужно
  для тестов; desktop/mobile host должны передать зашифрованное durable storage.

`WRITE_PRIVATE`, `NETWORK_SEND`, `DEVICE_ACTION`, `DESTRUCTIVE` и
`SECURITY_SENSITIVE` требуют существующего confirmation boundary. Если
пользователя нет, job остаётся `waiting_for_approval`; подтверждение не
обходится. Private Agent с внешним fallback отклоняется при создании и
изменении (`PRIVATE_EXTERNAL_FALLBACK_DENIED`). Отозванные tools/skills
останавливают будущие запуски.

Действуют лимиты runtime/model/tool/retry/backoff, daily resource units,
concurrency и pending jobs. Повторные event IDs дедуплицируются, trigger storm
ограничивается, а причинные IDs и bounded depth блокируют рекурсию A → B → A.
После restart queued jobs продолжаются, interrupted runs помечаются CRASHED и
повторяются только в пределах budget, retry timers восстанавливаются. Missed
schedule использует `run_once` (по умолчанию) или `skip`.

Host публикует `AgentTriggerEvent` через типизированный adapter со стабильным
ID и data class. PRIVATE/SECRET payload не попадает в audit; event-контекст
передаётся агенту только если у сессии заранее есть `ATTACHMENTS`, через общий
ContextBuilder. Public discovery для локальной автоматизации не нужен.

Поддерживаются примеры: утренняя сводка непрочитанных Communities, локальная
классификация нового файла, локальное уведомление о начале Live у followed
creator и вечерняя daily summary. Нет cloud scheduler или shell.
