# Групповые чаты

Группы Keystone — local-first проекция существующих Identity, encrypted messaging и content-addressed storage. Центрального message server и обязательного cloud push нет.

## Identity и состав

`groupConversationId(members)` хеширует отсортированные криптографические Identity ID. Title и avatar — изменяемые подписанные данные и не меняют Conversation ID. Создатель становится первым admin. `conversation_event` поддерживает `create`, `add`, `remove`, `leave`, `set_role`, `update`, полный members/admins и проверяется по подписи автора, envelope, expiry и replay-дедупликации (nonce и object ID).

Каждое событие и сообщение шифруется отдельно для каждого получателя существующим cipher. Offline участник получает те же объекты после reconnect из зашифрованного outbox. Core не принимает group message от отсутствующего в текущей membership projection или заблокированного identity.

## Повседневное использование

Durable conversation хранит title/avatar, members/admins, last-message preview, unread, last-read, pin/archive/mute и draft. Поддерживаются text, reply/quote, reactions, immutable edit, tombstone, attachments и ссылки на Track, Video, Short, Profile, Community и Live. History имеет bounded pagination, локальный message search и jump по reply. Typing/presence эфемерны и не записываются как social history. Delivery/read остаются в рамках участников разговора.

Attachment — это только `keystone://content/sha256-*`; host использует `AttachmentTransferController`, `ContentFetcher`, проверенные manifest/chunk, cache quota и pinning. После cancel transfer можно retry/resume с уже проверенных chunks, а повреждённые chunks отвергаются.

## Проверка

Controlled integration suite проверяет deterministic ordering, offline outbox, restart, роли, unread/read, typing cleanup и attachment references. Real-network suite запускает четыре независимых процесса и проверяет production Hyperswarm/Noise для группы из трёх участников, offline reconnect, reply/reaction/edit/tombstone, replay rejection и member removal. WebRTC для сообщений не используется.
