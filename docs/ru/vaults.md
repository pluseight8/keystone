# Keystone Vaults (Хранилища)

Vault — локальное Markdown-пространство знаний. Файлы пользователя являются источником истины; индекс, граф ссылок и история — восстанавливаемое производное состояние. По умолчанию Vault приватен и не публикуется через P2P discovery.

`VaultService` работает только через типизированный `VaultStorageAdapter`, установленный desktop/mobile host. Core не импортирует Node, Tauri или platform filesystem API. `VaultPermissionBoundary` проверяет identity до чтения, записи, индексации и истории.

Заметка содержит переносимый `keystone_id` во frontmatter. Rename/move сохраняют ID, поэтому Chat, Shared Space, AI context и UI используют один объект. Обновления проверяют `baseRevision`; устаревший revision создаёт явный conflict с incoming content, без тихой перезаписи. Индекс можно полностью перестроить из Markdown.

`UnifiedContextResolver` выдаёт Vault как bounded `PRIVATE` и `UNTRUSTED_VAULT_MARKDOWN` источник только локальному/trusted AI после обычной permission filter. External AI блокируется до ranking и payload. Заметка не становится автоматически Memory.
