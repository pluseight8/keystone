# Shared Spaces (общие пространства)

Shared Space — локальное P2P-рабочее пространство поверх существующих Identity, Transport и Yjs CRDT. Один подписанный объект `SharedSpace` содержит durable-документ с документами, заметками, списками/задачами, ссылками, комментариями, ссылками на файлы и явно расшаренным контекстом. Chat, Community и Agent Room используют те же ID и не создают копии media или Memory.

## Участники и агенты

Изменения membership/ролей подписывает владелец и проверяет core. Роли owner/admin/editor/commenter/viewer/agent дают granular permissions. Agent Visit или Agent Room сами по себе не дают доступ к Workspace: требуется отдельный `SpaceAgentGrant` с TTL, лимитом использований и явными разрешениями. Отзыв проверяется на каждой операции.

## Offline/restart

Typed-изменения сразу попадают в локальный Yjs, а при недоступном peer — в подписанную bounded очередь. После reconnect отправляется state-vector/update, поэтому независимые edits сходятся без центрального сервера. Snapshot содержит Yjs state, metadata, replay markers и очередь. `PersistentSharedSpaceStateStore` шифрует snapshot ключом устройства.

## Private Spaces

Private Space использует recipient-wrapped libsodium `crypto_box` epoch keys и XChaCha20-Poly1305 для metadata/CRDT ciphertext. Join/leave/kick/ban/revoke device ротирует epoch. Исключённый peer не получает новый ключ. Это group encryption, но не MLS/Double Ratchet/forward secrecy.

## Явный Share with Space

`shareWithSpace` принимает только `PUBLIC` и `USER_EXPLICIT`; `PRIVATE`/`SECRET` отклоняются до сериализации. Память, DM, файлы и social graph не читаются автоматически. File reference указывает на существующий `FileObject`/content URI, а не копирует media.
