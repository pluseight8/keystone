# Временные Agent Workers

Сервис workers предоставляет временных исполнителей для постоянного Agent Bot. Worker
решает одну bounded-задачу и не является новым человеком, cryptographic
Identity, AgentProfile или постоянной AgentSession. Только явное действие
родительского Agent может превратить завершённый worker в Agent.

## Общий runtime

`EphemeralAgentWorkerService` отправляет все задачи в существующий
`AIResourceScheduler`. Workers используют тот же provider/model runtime и
`ModelLease`, поэтому веса модели загружаются один раз на пару provider/model.
Workers всегда считаются background-работой: `USER_INTERACTIVE` и
`ACTIVE_AGENT` сохраняют приоритет.

Через `AIContextCacheManager` каждый worker получает namespace
`worker:<worker-id>` и отдельный cache lease. При завершении, отмене, ошибке или
уничтожении lease освобождается, а runtime KV очищается. KV не является
Identity, Memory, историей чата или permissions.

## Профили и lifecycle

Поддержаны `Research`, `Browser`, `Coding`, `Planning`, `Summarization` и
`Analysis`. Профиль задаёт описание и консервативный budget, но не выдаёт
tools или данные.

```text
CREATED → QUEUED → RUNNING ⇄ WAITING_FOR_TOOL/PAUSED
        → COMPLETED | FAILED | CANCELLED → DESTROYED
```

Result хранит только ограниченный output, source references, tools, data
classes, confidence и status. Durable snapshot не сохраняет task context и
grant payload. Незавершённый worker после restart fail-closed, а завершённый
результат можно восстановить без private context.

## Явные grants

`WorkerCapabilityGrant` содержит точные tool/skill IDs, capabilities, data
classes и source/object scope, expiry, max uses, max runtime и флаг
`canSpawnWorkers`. Наследования всех прав Agent Bot нет. Перед ToolExecutor
проверяется grant, а перед добавлением результата — его data class. Unknown
tool, undeclared capability, expired/exhausted grant и external intent
отклоняются. Web/file/remote-agent content считается untrusted и не может
расширить grant.

По умолчанию worker не создаёт worker; depth ограничен одним уровнем, fan-out
обычно четырьмя (максимум пять). Deterministic fingerprint блокирует duplicate
subtask. Runtime/model/tool/retry/context/queue budgets ограничивают storms и
infinite loops.

## Privacy и promotion

`local` и `personal_trusted` получают private context только из явного scope.
`external` работает лишь через существующий orchestrator/egress firewall;
PRIVATE/SECRET отклоняются до scheduling, наружу допускаются только PUBLIC и
USER_EXPLICIT, а local tools для external worker запрещены. Private task не
делает автоматический cloud fallback.

Result содержит provenance и проверяется по worker/task ID и generation.
После terminal state runtime/cache/tool state очищаются. `promoteToAgent(...,
{ confirmed: true })` требует отдельного host callback; worker никогда не
становится постоянным автоматически.

Mobile Agents screen показывает Agent Bot, тип worker, задачу, grant tools,
state, model/tool calls, timing, result и кнопку остановки. Worker не получает
отдельный social UI или публичный профиль.

Тесты проверяют общий model runtime, scoped grants, external privacy,
cancellation/cache cleanup, fan-out/recursion, promotion, spoof protection и
durable bounded restore. Коммерческих функций, рекламы, платежей и hosted
worker service нет.
