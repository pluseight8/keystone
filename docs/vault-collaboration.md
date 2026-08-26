# Vault collaboration and CRDT

Markdown note text is mirrored into a Yjs document and written back through
the normal Vault revision path. Offline updates can be queued and replayed once
the authenticated peer reconnects; nonce/event sets provide bounded replay and
deduplication. Durable Markdown remains readable if `.keystone` derived state
is lost or corrupt.

Text, properties, rename/move/delete, attachments and Canvas mutations are
validated separately. A stale revision is surfaced as an explicit conflict,
never silently overwritten. Collaboration presence is ephemeral, TTL-bound and
not durable social history. Shared Canvas uses the existing typed Canvas
mutation model and its own MANAGE_CANVAS permission.

The same identity may use several trusted devices. Revoking one device does not
silently revoke the identity; policy decides membership and epoch rotation.
