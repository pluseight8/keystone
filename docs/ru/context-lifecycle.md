# Жизненный цикл контекста

`SessionContextState` — ограниченный runtime-индекс по `(agentId, sessionId)`, а не замена AgentRuntime или Memory.

1. Host регистрирует сессию.
2. Scheduler выдаёт `ModelLease`.
3. Cache manager восстанавливает HOT/WARM KV либо строит план из snapshot/history/разрешённых источников.
4. Inference работает с namespace конкретной сессии.
5. После release контекст остаётся HOT для интерактивной работы либо переходит в WARM/COLD.
6. Idle sweep и memory pressure применяют лимиты.

Смена модели инвалидирует backend KV и восстанавливает контекст из model-independent snapshot. Поэтому unload, crash recovery и restart не меняют Identity, permissions или Memory.

Режимы PERFORMANCE, BALANCED, GAMING и BATTERY управляют количеством HOT/WARM. При давлении порядок такой: WARM → COLD → старые неактивные HOT. Долго неиспользуемый COLD переходит в FROZEN, сохраняя durable snapshot. Активная inference не удаляется обычным pressure. Очистка runtime-кэша через UI не трогает durable данные.

Длинные сессии compact'ятся только local/trusted AI с provenance. Remote-agent, web и file контент остаётся untrusted и не может расширить system policy или capabilities. Portable raw KV — лишь оптимизация; обязательный формат восстановления — durable snapshot вместе с существующим ContextBuilder.
