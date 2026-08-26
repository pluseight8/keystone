# Конфликты и ревизии Calendar

Каждый CalendarEvent имеет стабильный ID и revision. Update может указать `baseRevision` и создаёт подписанный `CalendarEventRevision` с patch и model-independent snapshot. Snapshot позволяет восстановить stale base после restart без backend-specific KV state.

Если local и incoming изменения меняют одно поле от общей базы, `CalendarConflictResolver` создаёт durable `CalendarConflictState` с current/incoming event и списком полей. Сервис не выбирает победителя молча; owner/editor явно выбирает keep current, accept incoming или передаёт validated merge. Непересекающиеся изменения объединяются детерминированно.

Удаление против изменения остаётся конфликтом `deleted_modified`. Replay, malformed IDs, invalid signatures, unauthorized actors, stale regressions и события недоступного календаря отклоняются. Tombstone сохраняется, чтобы delayed peer не воскресил удалённый объект.
