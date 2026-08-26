# Vault Graph, Canvas and Visual Security

- Markdown and ordinary attachments remain source of truth; graph indexes and Canvas history are disposable/isolated derived state.
- Every Vault, note and attachment read still passes `VaultPermissionBoundary`.
- Canvas object cards require an explicit object permission adapter. A reference does not grant access to the underlying object.
- Web Cards accept only `http`/`https` URLs without credentials. They cache no session or credential data and do not execute browser actions implicitly.
- Canvas IDs, node IDs, edge IDs, coordinates, text and group depth are bounded. Duplicate IDs, stale revisions, malformed schemas and oversized graphs fail closed.
- Unresolved links, recursive embeds and missing attachments are safe visible states, never infinite traversal or silent guessing.
- Note/File/Web content is untrusted. It cannot alter AI policy, capabilities, ToolPolicy, Memory or Agent permissions.
- Graph/Canvas AI context requires an explicit local/trusted scope. `AIEgressFirewall` continues to deny private Vault, graph and Canvas context to external providers.
- Corrupt graph cache/history/Canvas JSON is discarded or rejected without deleting Markdown, user files or linked Keystone objects.
