# Файлы

Keystone хранит файл как подписанный `file_object` поверх существующего content-addressed manifest/chunk протокола. Объект содержит имя, MIME, размер, content ID, owner, uploader, описание и visibility. Owner и uploader разделены: локальный импорт не меняет заявленного правообладателя.

Один FileObject используется в DM, групповых чатах, Community, Profile и share. В сообщении передаются тот же FileObject ID и content URI; копии media metadata не создаются. `FileReplicationService` доставляет только подписанный объект, а bytes остаются в обычном provider layer.

`FileTransferManager` и общий `DistributedContentService` продолжают передачу по проверенным chunks, ограничивают workers, заново получают список providers для каждого chunk и принимают данные только после SHA-256 проверки. Высокоуровневая доставка остаётся через ConnectivityFabric. Доступность обозначается как `AVAILABLE LOCAL`, `AVAILABLE REMOTE`, `PARTIALLY AVAILABLE`, `UNAVAILABLE` или `DOWNLOADING`. Это текущее наблюдение, а не обещание вечной доступности.

Пауза, отмена и retry сохраняют проверенные chunks. Corrupt chunk отбрасывается, после чего используется другой provider. Provider может отключиться и подключиться снова без копирования FileObject.

Private/community файл сначала шифруется через существующий
`PrivateCommunityService.encryptAttachment` и `FileEncryptionAdapter`. В P2P
распространяется ciphertext и epoch/key/nonce metadata; private объект не
попадает в public discovery, а plaintext hash не публикуется. Новая
криптосистема, central storage и CDN не добавляются.
## File containment

Network/browser/shared bytes сначала попадают в quarantine до materialization в пользовательский FileObject. Подробности lifecycle и owner-release boundary: `untrusted-content.md`, `file-quarantine.md`, `file-risk-model.md`.

## Handoff

Device Continuity передаёт только bounded FileObject/content reference,
filename и безопасную metadata. Bytes, executable paths и большой serialized
file в handoff не вкладываются. Получатель разрешает reference через
существующие permission и `DistributedContentService` boundaries;
доступность content остаётся локальным наблюдением, а handoff сам по себе не
выдаёт права на файл.

## Shared folders и distributed drive

`SharedFolderService` — local-first каноническая state machine для folders,
entries, immutable revisions, memberships, invitations, Drop Zones и conflicts.
Folder/entry/file/revision IDs стабильны: rename и move не меняют identity.
Revisions сохраняются, поэтому offline edits можно сравнить и восстановить, а
не превратить в тихий last-write-wins.

Shared folders не добавляют Drive, central file server, S3, IPFS, global metadata service
или второй content store. `ContentCacheFolderContentStore` оборачивает
существующий `ContentCache`; `DistributedContentFolderDelivery`
использует manifest/chunk delivery для authorized on-demand reads. Hash
или content ID — только integrity locator и не permission: authority остаётся
за folder membership, signed changes и текущим epoch.

Роли разделены: VIEWER читает, CONTRIBUTOR создаёт/upload, EDITOR также
редактирует, OWNER управляет membership и destructive actions. Drop Zone —
upload-only: uploader получает bounded receipt, но не может перечислять folder
или узнать private file ID. Private content не становится stranger-cacheable
из-за известного hash. Personal Device Mesh — отдельная owner-device
authority, не social collaborator sharing. Обычны metadata-first, on-demand и
явный Keep on device. Revocation блокирует дальнейшее authorized retrieval
после получения нового epoch; уже скачанные bytes не стираются ложно.

Desktop filesystem sync требует явного owner-selected native binding. NativeHost
даёт только relative/bounded операции и coalesced watcher events; absolute path
не проходит в Core/UI, home directory автоматически не сканируется, symlink не
следуется, а path не становится authority. Initial import, materialization,
local-delete propagation и baseline conflict detection выполняются явно.
Mobile использует document picker или app storage и не обещает произвольный
background folder watcher на iOS/Android. Files — это data: auto-run, extract,
AI/memory ingestion, publication и plugin execution не подразумеваются.

## Документы и Reader

`DocumentService` — projection над этим каноническим File layer. PDF, EPUB,
Markdown и plain text используют FileObject ID и immutable content revision;
`ContentCacheDocumentFileSource` читает bytes из существующего `ContentCache`.
Document metadata, progress, annotations, OCR results и search
index — bounded derived state, не второй byte store. Scanner export создаёт
новый private File через `FileServiceDocumentWriter` и не меняет исходный
Photo/File; private write требует caller-provided encrypted content metadata.

Reader проверяет size и content hash до открытия. Авторизованный локально
закэшированный File можно читать offline без cloud или central document server.
Desktop и Mobile получают только typed document projections и safe render
results; paths и ambient filesystem access остаются за пределами UI. См.
[Документы и Reader](documents.md).
