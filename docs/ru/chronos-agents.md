# Chronos и Agents

`AgentAutomationService` добавляет интеграцию Agents с существующим Chronos,
не переписывая его core. Для каждой automation хранится валидированное
`ChronosRule`: schedule использует текущий cron timer, event — добавленный
`system` trigger и существующую подписку `ChronosEventSource`.

Action `ai.workflow` содержит только непрозрачный automation ID. Chronos не
получает instruction, private context, аргументы tools или payload события.
Сервис разрешает ID, создаёт durable job и вызывает существующий
AgentRuntime с сохранённой policy сессии.

В Chronos audit добавляются только безопасные metadata: `automationId`,
`agentId`, trigger label, IDs tools, result status и approval state. Plaintext
prompts, private payload и tool results не записываются.

При `start()` после restart правила и jobs восстанавливаются, interrupted runs
исправляются, queued work продолжается, retry timers перевооружаются. `stop()`
удаляет Chronos listener и timers. Host adapter должен передавать
аутентифицированные стабильные event IDs и не может расширять capabilities.

Это не central scheduler и не удалённый automation service; Chronos сохраняет
существующие file/Wi-Fi интеграции и остаётся полезным для deterministic tests.
