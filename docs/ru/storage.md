# Storage и доступность providers

`ContentCache` соблюдает byte quota и удаляет только незащищённый LRU-контент. `FileStorageManager` различает:

- `user-owned` — импортированные или явно принадлежащие пользователю данные;
- `pinned` — данные для offline использования;
- `cache` — воспроизводимые remote данные;
- `temporary` — partial chunks или явно удалённая локальная копия.

Обычная eviction никогда не удаляет user-owned/pinned данные. `deleteLocalCopy` — отдельное действие пользователя: оно удаляет только локальные chunks и снимает локальную защиту, не удаляя подписанный FileObject. После этого файл может стать `AVAILABLE REMOTE` или `UNAVAILABLE`.

Provider directory динамический: для каждого chunk могут использоваться Alice, Charlie или другой разрешённый provider. `DistributedContentService` назначает независимые chunks ограниченному набору sources, а путь к source выбирает существующий Fabric route optimizer. Corrupt ответы не принимаются, дубликаты content ID дедуплицируются. Ограничение workers, AbortSignal и quota не позволяют создавать бесконечные downloads/connections.

Для disk-backed restart resume host может предоставить persistent `WritableFileContentStore`/cache backend. Keystone не обещает вечную доступность. Ciphertext private-файла может находиться в общем P2P content layer, но private metadata не публикуется в Discovery/Search, а plaintext content ID не становится публичным.
