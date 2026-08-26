# Совместная работа и CRDT

Текст Markdown зеркалируется в Yjs и записывается через обычную Vault revision.
Offline updates ставятся в bounded очередь и применяются после reconnect.
Dedup/replay, epoch и подпись Transport проверяются до применения.

Потеря `.keystone` не удаляет Markdown: индекс и CRDT state восстанавливаются.
Stale revision показывается как явный конфликт. Presence имеет TTL и не является
историей социальной активности. Canvas использует существующую typed mutation
модель и отдельное право MANAGE_CANVAS.
