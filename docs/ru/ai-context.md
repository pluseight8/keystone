# Контекст Personal AI

`UnifiedContextResolver` — локальный read-boundary поверх существующих сервисов Keystone. Он не создаёт второй индекс и не копирует media objects. Адаптеры проецируют проверенные Memory, сообщения, Communities, Shared Spaces, Files, Music, Video/Shorts, Live и notifications в ограниченные записи.

`ContextResult` содержит только extractive-ответ и реальные `ContextCitation`: object ID, тип источника, автора, время, permission scope и ссылки. Если доступных данных нет, возвращается «No permitted Keystone objects found.»

Сначала отбрасываются blocked/deleted/revoked/недоступные записи, затем выполняется поиск, переход по существующим references и token budget. Private-запись требует текущую Identity в `accessibleTo`. Поддерживаются области `all-private`, `current-space`, `current-chat`, `communities`, `files`, `public-only`; temporal-запросы используют IANA timezone (`yesterday` — предыдущий локальный день, `last week` — 7 дней, `month ago` — 30 дней).

Local и PERSONAL_TRUSTED_COMPUTE могут получить ограниченный контекст. External execution fail-closed: результат пустой, а `AIEgressFirewall` отклоняет маркер `keystone-unified-context` даже для public objects. Внешней модели нужно передавать только обезличенную подзадачу, сформированную локально. Центрального AI-индекса нет.
