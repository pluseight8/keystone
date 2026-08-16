# Модерация сообществ

Moderation в Keystone — local-first и подписанная. Центрального moderation backend, глобальной очереди reports, рекламы, платежей и monetization нет.

`CommunityService` проверяет права owner/admin/mod/member в core. Kick, ban, unban, mute, timeout, удаление сообщения и pin несут actor (author объекта), target, reason и immutable timestamp. Owner нельзя удалить или заблокировать. Обычный member не может выдать роль, пригласить участника, управлять каналами, закрепить сообщение, опубликовать announcement или модерировать через UI либо replay чужого события.

Локальная projection применяет block и mute до отображения. События заблокированного actor игнорируются локально; muted actor остаётся в durable storage, но скрывается локальной policy. Timeout ограничен ISO expiry. Удалённый или заблокированный участник сразу теряет право писать в projection. Подписанный tombstone скрывает удалённое сообщение, канал или Community, не стирая evidence object.

Audit entries строятся из принятых moderation/report events и хранятся в encrypted community namespace. Reports — optional локальные objects и автоматически никуда не отправляются. Notification settings, read state и local reports остаются на устройстве.

Production replication принимает только `public` objects. Private и contacts moderation не передаётся до появления group encryption и rotation membership keys. Тесты проверяют malformed signatures, replay/dedup, owner protection, role inheritance и overrides, delayed/offline convergence, restart persistence и независимые Alice/Bob/Charlie/Mallory процессы через Hyperswarm/Noise.
