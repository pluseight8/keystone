# Безопасность Vault

Vault работает fail-closed. Root — host capability, а не разрешение. `VaultPermissionBoundary` проверяет локальную identity на каждой операции. Приватные Vault metadata не попадают в public discovery/search и payload внешнего AI.

Core отклоняет traversal, абсолютные/drive-letter paths, control characters и небезопасные IDs. Symlink по умолчанию пропускается indexer; решение остаётся host policy. Ошибки frontmatter, oversized notes, MIME/link anomalies и corrupted sidecars дают bounded diagnostics, а не destructive repair.

Markdown, attachment, web и remote-agent content считаются untrusted: они не меняют capabilities, system instructions, permissions или egress policy. External AI не получает Vault records, filenames, paths или private attachments. Corrupt index/history восстанавливается независимо из текущего Markdown; user-owned/pinned data не является обычным cache.
