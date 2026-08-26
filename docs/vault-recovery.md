# Vault recovery and portability

Markdown files are the recovery anchor. Query indexes, templates, bookmarks,
saved views, task indexes, graph projections, Canvas history and CRDT snapshots
are derived sidecars and are bounded so they can be discarded and rebuilt.

Private Shared Vault epochs and pending replication state must be stored using
the host's encrypted sidecar boundary. A corrupt sidecar is isolated; it must
never cause deletion of Markdown or user-owned attachments. On reconnect,
unauthorized, stale-epoch and malformed updates are rejected and remain out of
the restored state.
