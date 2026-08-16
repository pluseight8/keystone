# Shared workspace protocol

The wire type is `social.shared_space` (`keystone.shared-space.v1`). Envelopes use the normal `EnvelopeSecurity` signature and expiry checks. The inner message is also signed by the actor/owner and carries a bounded operation ID. Receivers reject unknown members, invalid signatures, stale membership revisions, old private epochs, duplicate operations and malformed Yjs updates.

The protocol has no coordinator or global workspace index. Public spaces can be sent to active members over Hyperswarm/Noise. Private spaces send only recipient-wrapped epoch keys and authenticated ciphertext. Providers and content-addressed storage remain the existing Keystone primitives.

Use the controlled transport suite for deterministic partitions and replay tests. The real network suite starts independent Keystone processes and verifies signed SharedSpace metadata plus encrypted CRDT state over production Hyperswarm/Noise.
