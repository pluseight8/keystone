# Distributed failure model

The harness models offline endpoints, partitions, queued/reordered/duplicated
envelopes, invalid signatures, malformed application bodies, interrupted
content providers, corrupt chunks, and runtime restart over an atomic test file
store. Failures are injected at the `Transport` or `ContentProvider` boundary;
application validation and persistence are not mocked.

Not yet represented: a real process crash during an operating-system write,
Hyperswarm NAT traversal, relay operation, WebRTC media recovery, device
revocation across real hosts, and persistent host-encrypted content cache.

Contacts-only community replication is also intentionally outside this model:
the production route rejects it until a group-encryption protocol exists.
