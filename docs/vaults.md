# Keystone Vaults

Vaults are local-first Markdown workspaces. The files selected by the user are the source of truth; the index, link graph and revision history are disposable derived state. A Vault is private by default and is never published through P2P discovery.

## Core boundary

`VaultService` uses a typed `VaultStorageAdapter` supplied by the desktop, mobile or another host. The core boundary exposes `read`, atomic writes, create/rename/move/delete, `list`, `stat` and optional `watch`; it does not import Node, Tauri or platform filesystem APIs. `VaultPermissionBoundary` runs before reads, mutations, indexing and history operations.

`Vault`, `VaultEntry`, `MarkdownNote`, `VaultAttachment`, `VaultIndex`, `VaultLinkIndex`, `VaultSearchService`, `VaultHistoryService` and `VaultMutationService` are exported from `@keystone/core`. Multiple services can be registered with `VaultRegistry`.

## Durable semantics

Notes carry a portable `keystone_id` frontmatter property. Rename and move preserve that ID, so Chat, Shared Space, AI context and the desktop/mobile UI can reference the same note. Updates include a base revision. A stale base creates an explicit conflict containing the incoming content; Keystone never silently overwrites a concurrent edit. History records bounded revisions and can restore a selected revision.

An index rebuild walks the host root, skips `.keystone` sidecars and symlinks, bounds note reads, and reconstructs links from Markdown. Corrupt index or history state is discarded independently; the Markdown and attachments remain readable. External writes can be observed through the adapter watch boundary.

## AI and sharing

The existing `UnifiedContextResolver` can use `VaultUnifiedContextSource`. It emits bounded, `PRIVATE`, explicitly owner-scoped and `UNTRUSTED_VAULT_MARKDOWN` records. Local/trusted AI may receive notes only after the normal permission filter; external execution is blocked before ranking and payload construction. Vault notes are context, not automatic `Memory`, and Markdown cannot grant capabilities or change AI policy.

No cloud, central index, ads, payments, marketplace or monetization is part of the Vault layer.
