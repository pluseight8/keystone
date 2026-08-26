# Восстановление и переносимость Vault

Якорь восстановления — Markdown-файлы. Индексы, templates, bookmarks, views,
task/graph projections, Canvas history и CRDT snapshots производны и могут быть
перестроены.

Private epoch keys и pending replication должны храниться через encrypted host
sidecar. Corrupt sidecar изолируется и не удаляет Markdown или user-owned
attachments. При reconnect stale, revoked, unauthorized и malformed updates
отклоняются.
