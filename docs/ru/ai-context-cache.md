# Кэш AI-контекста и KV

В  веса модели остаются общими, а runtime-контекст становится временным. `AIContextCacheManager` хранит только состояние runtime сессии; `AgentSession`, Identity, Memory, permissions и durable history остаются в существующих хранилищах.

## Тиры

- **HOT** — активная сессия с `KVCacheLease`; интерактивный запрос защищён.
- **WARM** — недавно использованный контекст, который можно сохранить в optional portable backend.
- **COLD** — KV отсутствует, а `ContextSnapshot` и durable AgentSession позволяют заново собрать prompt.
- **FROZEN** — очень старая сессия только со структурированным durable state.

Лимиты RAM/VRAM задаются глобально и для каждой сессии. При давлении сначала удаляется WARM, затем неактивный HOT; активная интерактивная inference не эвиктится. Gaming и Battery быстро очищают фоновые кэши. `clearRuntimeCache` не удаляет историю, Memory, Identity или permissions.

## Snapshot и восстановление

`ContextSnapshot` содержит namespace агента/сессии, generation, summary, последние user/assistant/tool turns, ссылки на Memory/objects, tool-state refs и provenance. В нём нет system policy или capability, поэтому содержимое web/file/remote-agent не может стать инструкцией через сохранённый summary.

Private summary выполняется только local/trusted compute. External summarizer для PRIVATE/SECRET отклоняется. Исходная durable history сохраняется, а summary не становится Memory автоматически.

При восстановлении COLD менеджер учитывает reserve output/tool schema, вызывает существующий capability-aware `ContextBuilder`, а затем отбрасывает сначала low-priority retrieved context. Текущий пользовательский prompt всегда сохраняется. План показывает dropped IDs, ссылки и untrusted sources.

Граница интеграции:

```text
ModelLease scheduler → acquire/ContextRestorePlan → общая модель → release
```

IDs агента и сессии обязательны, поэтому контексты Eight, Research и Browser не смешиваются. После restart все runtime entries восстанавливаются как COLD.
