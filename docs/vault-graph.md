# Vault Graph

Vault Graph is a bounded, rebuildable projection of a Markdown-first Vault. `VaultService` and the Markdown files remain authoritative; the graph does not become a second database of note content.

`VaultGraphService` derives NOTE, HEADING, BLOCK, ATTACHMENT, TAG, CANVAS and typed Keystone-reference nodes from `VaultIndex`/`VaultLinkIndex`. Edges include wikilinks, Markdown links, embeds/transclusions, heading/block references, tag relations and explicit Canvas links. Unresolved and ambiguous targets are represented as distinct visual nodes.

Global queries support folder, tag, property, modified-date, node-kind, search, attachment/tag/unresolved visibility, orphan and minimum-degree filters. Results are paginated and bounded by node/edge limits. Local graph queries use a configurable depth (normally 1–2), include incoming/outgoing relationships and keep viewport work out of the core.

The cache is disposable. A corrupt or stale graph cache is discarded and rebuilt from the Vault indexes. Layout mode (`FORCE`, `RADIAL`, `GRID`), zoom, pan, selection and filters are workspace state, never Markdown metadata. Rendering hosts should use viewport culling and the keyboard node/edge list as an accessible alternative.

AI graph context is explicit, local/trusted-only and labelled untrusted. A suggested relationship is not persisted as knowledge; only a user-approved mutation can create an explicit relation.
