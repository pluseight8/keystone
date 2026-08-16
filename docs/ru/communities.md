# Сообщества

Состояние Community — это журнал отдельных подписанных Keystone objects. Ревизия `community` сохраняет стабильный ID; изменения используют `supersedes`, а удаление — подписанный tombstone. Центрального registry нет: peers обмениваются объектами через существующий `CommunityReplicationService` и локально строят одинаковую projection. Проектор сначала применяет события полномочий, затем каналы, moderation и сообщения, поэтому задержанные объекты сходятся детерминированно.

## Видимость и replication

`public` Communities передаются по production Hyperswarm/Noise через подписанные envelopes. `private` и `contacts` намеренно блокируются на replication boundary: обычный подписанный envelope не выдаётся за group encryption. Они остаются локальными до появления generic group-encryption протокола с rotation membership keys. Вход в private/contacts требует локально известного invite; неизвестный join не делает приватные данные публичными.

## Роли, каналы и permissions

Создатель — owner, его нельзя удалить или заблокировать. Подписанные `role` содержат position, managed flag и явный набор permissions. Core проверяет `manage_community`, `manage_channels`, `manage_roles`, `invite_members`, `kick_members`, `ban_members`, `moderate_messages`, `pin_messages`, `post_announcements`, `post_message` и `view_channel`; старое `moderate` сохранено для совместимости. Role manager не может назначать, удалять или модерировать роль выше собственной максимальной position. Custom roles действуют только внутри одного сообщества.

Подписанные `channel` бывают `text`, `media` и `announcement`, имеют position, optional category и allow/deny overrides для ролей. Categories — тоже подписанные objects. Порядок каналов детерминирован по position, имени и ID. Deny override имеет приоритет над allow; owner защищён от случайной блокировки.

## Membership и moderation

`community_member` описывает join, leave, принятие invite, назначение роли, kick, ban/unban, mute/unmute и timeout. Actor подписывает событие, `createdAt` служит immutable timestamp, `member` — target, reason сохраняется. Для pin/tombstone доступны `community_moderation` с явными action, target, reason и timestamp. Replay безопасен: encrypted community storage дедуплицирует object IDs, а replication ограниченно хранит envelope nonces.

Сообщения, mentions, replies и attachments ссылаются на исходные Keystone object IDs. Core проверяет канал, membership, mute/timeout, announcement permission и ссылки. Pinned messages и moderation попадают в подписанный audit log. Reports — только локальные objects, без отправки на центральный сервер Keystone. Локальные block/mute фильтруют объекты до показа и поиска.

`CommunityService` — единственная authorization boundary для mutations. Подписанный, но неавторизованный объект может остаться в локальном журнале как evidence, но не меняет видимую projection. Проверяются out-of-order events, replay, malformed/spoofed signatures, restart, partition/convergence и реальный multi-process Hyperswarm сценарий.
