# Общие Vault

`SharedVaultService` повторно использует `VaultService`, Yjs и существующий
аутентифицированный Transport. Разрешения scoped: VIEW, EDIT, CREATE_NOTE,
DELETE_OWN, DELETE_ALL, MOVE, MANAGE_ATTACHMENTS, MANAGE_CANVAS, INVITE,
REMOVE_MEMBER, MANAGE_PERMISSIONS.

Private/contacts содержимое шифруется до репликации. Join/leave/kick/ban и
отзыв устройства создают новый `SharedVaultKeyEpoch`; старый epoch, replay,
spoof, malformed и oversized события отклоняются. По умолчанию хранится только
текущее состояние; shared history разрешается лишь при безопасном encrypted
host storage.

Приватные данные не попадают в public discovery, Memory, сообщения, Files,
Calendar, Spaces или Agents без явной ссылки и существующих ToolPolicy.

При join/leave/kick/ban и отзыве устройства новый ключ эпохи оборачивается для
каждого текущего разрешённого устройства через его encryption public key. Если
ключ устройства неизвестен, private replication завершается fail-closed.
Membership и epoch подписываются; исключённый участник не получает новый ключ и
будущие зашифрованные обновления. Очередь authenticated envelopes сохраняется
для reconnect и дедуплицируется при получении.

В индекс конкретного Shared Vault попадают только заметки, явно созданные или
полученные через этот Vault. Локальная заметка другого Vault не утечёт через
Shared Vault или UnifiedContext. Shared Canvas использует типовой
`CanvasMutation` и хранится как ограниченное производное состояние; Markdown и
файлы Vault остаются якорем восстановления.

Вложения передаются как references. Public Vault может использовать обычный
content reference; private Vault требует явно зашифрованный/opaque content ID
до выхода reference из локального процесса. Plaintext content hash не
подставляется в private replication.
