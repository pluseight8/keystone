# Сообщения и групповые чаты

Слой сообщений не зависит от UI и находится в `@keystone/core/social/messaging` и `social/conversations`.

`DirectMessageService` использует явно добавленные `SocialContact`, детерминированный ID личного разговора, подписанные зашифрованные envelope, durable `SocialStorage`, offline outbox/retry, подтверждения доставки/read, reply/quote, реакции, immutable edit и tombstone, поиск, пагинацию, ephemeral typing/presence и replay/dedup. Входящее личное сообщение создаёт локальную запись чата с preview и unread-счётчиком. Глобального username registry нет.

`GroupConversationService` использует тот же messaging и production transport. ID группы — `SHA-256("keystone:group-conversation:v1:" + отсортированные Identity ID)`, поэтому Alice, Bob и Charlie получают один Conversation ID. Membership/role изменения — подписанные автором `conversation_event`, зашифрованные отдельно для каждого получателя и содержащие полный набор members/admins. Только администраторы могут добавлять/удалять участников, менять роли и переименовывать группу. Core отвергает сообщения неучастников и применяет block policy.

Групповые text/reply/reaction/edit/delete и attachment fan-out используют один подписанный `message` object. Track, Video, Short, Profile, Community и Live передаются ссылкой на исходный Keystone object ID, без копирования media. Attachment содержит только content URI; `AttachmentTransferController` обеспечивает проверку manifest/chunk, quota/pinning, progress, cancel, retry и resume.

Typing и online approximation эфемерны и ограничены в памяти. Read/delivery state относится только к участникам разговора и не публикуется глобально. Mobile routes Chats, Conversation, New Chat, New Group, Group Info, Members и Media/Files являются тонким адаптером установленного host runtime, без demo/fake server.

Controlled transport используется для deterministic fault tests. `pnpm test:network` запускает независимые Alice/Bob/Charlie/Mallory поверх production Hyperswarm/Noise и проверяет общий ID, offline Charlie/reconnect, reply/reaction/edit/delete, attachment reference, replay/role rejection и удаление участника.
