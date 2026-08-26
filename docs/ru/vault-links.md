# Ссылки Vault

Индексируются wikilinks (`[[Note]]`, alias, `#Heading`, `#^block`), Markdown links и embeds. Каждая ссылка хранит raw source и line, затем получает статус `resolved`, `unresolved` или `ambiguous`. Backlinks, outgoing/unresolved links, aliases, headings, blocks и mentions доступны через `VaultLinkIndex`.

Переносимые ссылки:

* `keystone://vault/<vaultId>`
* `keystone://vault/<vaultId>/note/<noteId>`

Parsing ссылки не означает разрешение доступа: маршрут отдельно проходит permission boundary. Traversal, абсолютные пути, control characters и неверные IDs отклоняются. Бинарный attachment не читается для разрешения ссылки.
