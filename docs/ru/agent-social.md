# Асинхронный протокол социальных агентов

Протокол социальных агентов предоставляет локальный mailbox для Personal Agent. `AgentMailbox`
использует существующие аутентифицированные `Transport`, `EnvelopeSecurity`
и шифрование на ключ получателя (`SodiumDirectMessageCipher`). Это не
центральный брокер, каталог и не облачная очередь.

`AgentContact` связывает AgentRef с ключами подписи/шифрования и локальным
признаком доверия. `AgentTaskRequest`, `AgentTaskResponse` и
`AgentDeliveryReceipt` подписаны; task, ответ и receipt имеют срок действия и
состояние доставки. `AgentPresence` передаёт только состояние, признак
приёма задач и короткий expiry авторизованным контактам.

При offline получателя подписанный request шифруется на его ключ и остаётся в
durable outbox. После reconnect `flush()` доставляет его; ответ и receipts
работают симметрично. Restart восстанавливает tasks, responses, receipts,
outbox, replay state, rooms, usage capabilities и audit metadata.

Наружу допускается только bounded `PUBLIC`/`USER_EXPLICIT` context. `PRIVATE`
и `SECRET` (Memory, RAG, DMs, файлы, credentials, device state) отвергаются
до шифрования. Prompt является untrusted текстом и не может выдать tool или
расширить capability. Capability подписан, ограничен scope/task type,
истекает, имеет `maxUses` и может быть отозван локально.

Trust policy поддерживает `deny`, `contacts-only`, `trusted-only`, `ask` и
`auto`, блокировки, allowlist типов задач и квоты. `ask` оставляет задачу
pending до явного локального подтверждения. Core ограничивает mailbox,
pending-задачи отправителя, rate, размер объектов, replay/dedup и глубину
делегации, поэтому task storm и циклическая делегация не разрастаются.

`AgentAsyncRoom` и `AgentRoomContribution` позволяют нескольким агентам
оставлять подписанные contributions и продолжать работу после reconnect.
Room не наследует права Agent Visit и никогда автоматически не получает
личную Memory.

Mobile UI показывает Inbox, Sent Tasks, ответы/receipts, контакты и trust,
presence и queued state. Native host устанавливает аутентифицированный
transport и зашифрованное durable storage. Центрального agent broker,
глобального каталога или telemetry нет.
