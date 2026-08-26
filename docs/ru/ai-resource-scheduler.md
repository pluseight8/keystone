# Единый планировщик AI-ресурсов

Keystone рассматривает модели как вычислительный ресурс, а агентов — как идентичности со своим состоянием, контекстом и capabilities. `AIResourceScheduler` — локальный host-neutral слой координации для Personal AI, Browser, Research/Coding workers, Agent Social, Automations, Recommendations и Memory jobs.

## Общий runtime

Задача указывает `provider/model` и получает короткоживущий `ModelLease`. Для каждого model reference хранится один `AIModelRuntime`: веса загружаются один раз, а независимые jobs используют runtime в пределах resource budget. Scheduler не собирает и не смешивает контекст: каждый handler получает собственные `agentId`/`sessionId` и продолжает использовать существующие capability/privacy boundaries.

Lifecycle модели: `UNLOADED → LOADING → READY → BUSY → IDLE → UNLOADING`; ошибки переходят в `FAILED` и могут быть восстановлены host adapter. Выгрузка runtime не удаляет `AgentSession`, `Memory`, `Identity` или другое durable state.

## Очередь и fairness

Есть приоритеты `USER_INTERACTIVE`, `ACTIVE_AGENT`, `BROWSER`, `AGENT_SOCIAL`, `AUTOMATION`, `RECOMMENDATION`, `MEMORY_CONSOLIDATION`, `BACKGROUND`, per-agent quotas, bounded queue, timeout, cancellation, pause/resume, cooperative `checkpoint()`/`yieldIfNeeded()` и защита от starvation.

При появлении interactive job низкоприоритетная работа получает запрос на yield на ближайшей checkpoint-точке. Foreground job получает освободившийся slot; затем при явном resume paused handler продолжает тот же job/session.

В scheduler store сохраняются только scheduling metadata. Prompt, context, tool results и output туда не записываются. После restart running jobs переводятся в queued crash-recovery state; host должен повторно подключить typed handler.

## Режимы

- `PERFORMANCE` — больше concurrency, background разрешён.
- `BALANCED` — обычный bounded foreground и один background slot.
- `GAMING` — foreground разрешён, обычный background и Memory consolidation paused; разрешены только jobs `RECOMMENDATION`, явно отмеченные `cheap`.
- `BATTERY` — aggressive idle unload и сильное ограничение proactive/background AI.

Host adapter передаёт нормализованные RAM/VRAM pressure, CPU/GPU utilization, battery/charging, thermal state и foreground-heavy-app. Platform API остаётся вне `@keystone/core`.

Mobile `AI Resources` показывает загруженную модель, lifecycle, queue, jobs, mode и локальные metrics. Можно поставить background AI на паузу или запросить unload; private prompts и model weights UI не раскрывает.
