# Файлы (Phase 26)

Keystone хранит файл как подписанный `file_object` поверх существующего content-addressed manifest/chunk протокола. Объект содержит имя, MIME, размер, content ID, owner, uploader, описание и visibility. Owner и uploader разделены: локальный импорт не меняет заявленного правообладателя.

Один FileObject используется в DM, групповых чатах, Community, Profile и share. В сообщении передаются тот же FileObject ID и content URI; копии media metadata не создаются. `FileReplicationService` доставляет только подписанный объект, а bytes остаются в обычном provider layer.

`FileTransferManager` продолжает передачу по проверенным chunks, ограничивает число workers (по умолчанию три), заново получает список providers для каждого chunk и принимает данные только после SHA-256 проверки. Доступность обозначается как `AVAILABLE LOCAL`, `AVAILABLE REMOTE`, `PARTIALLY AVAILABLE`, `UNAVAILABLE` или `DOWNLOADING`. Это текущее наблюдение, а не обещание вечной доступности.

Пауза, отмена и retry сохраняют проверенные chunks. Corrupt chunk отбрасывается, после чего используется другой provider. Provider может отключиться и подключиться снова без копирования FileObject.

Private/community файл сначала шифруется через существующий Phase 25 `PrivateCommunityService.encryptAttachment` через `FileEncryptionAdapter`. В P2P распространяется ciphertext и epoch/key/nonce metadata; private объект не попадает в public discovery, а plaintext hash не рекламируется. Новая криптосистема, central storage, CDN, DRM, реклама, платежи и marketplace не добавляются.
