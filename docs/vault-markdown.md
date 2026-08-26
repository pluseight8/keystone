# Vault Markdown format

Keystone reads ordinary UTF-8 Markdown and preserves unknown content. Optional YAML-like frontmatter supports `string`, `number`, `boolean`, `date`, `datetime`, lists, `tags` and `links`. The writer adds `keystone_id` without moving the user’s source files. Malformed frontmatter is reported as a diagnostic while the body remains readable.

Supported metadata includes `aliases`, `tags` and arbitrary typed properties. Inline `#tags` and `@mentions` are indexed. Large notes are bounded by the core limit and are not loaded into the index without a diagnostic. Attachments remain ordinary files; binaries are never eagerly copied into an AI prompt.

Hosts can import an existing Markdown directory by pointing `VaultStorageAdapter` at its root. Import does not require conversion, server upload or a new database. The `.keystone` sidecar contains only derived vault/index/history state and can be deleted and rebuilt.

## Editor contract

Desktop and mobile use a host adapter for source editing. The UI exposes source text, preview-capable boundaries, search, outline, properties, backlinks, create, rename, move and delete. Hosts should implement debounced atomic saves, undo/redo and an external-change notification; stale saves must provide `baseRevision` and surface a conflict.
