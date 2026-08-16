# Distributed test harness

`pnpm test:integration` creates independent Alice, Bob, and Mallory runtimes.
Each has a generated identity, isolated temporary directory, separate durable
social/community files, runtime state, and a separate `Transport` endpoint.
The test-only `ControlledNetwork` can stop/restart peers, partition links,
queue traffic, deliver envelopes out of order, duplicate a captured envelope,
and inject malformed input.

It uses production `DirectMessageService`, `CommunityService`,
`CommunityReplicationService`, Ed25519 envelope/object signatures, encrypted
direct-message cipher, schemas, content manifests, chunk hashing, and
`PersistentSocialStorage`. The controlled adapter replaces only the physical
Hyperswarm socket so failures are deterministic. It is not evidence of a real
internet/Hyperswarm/WebRTC interoperability run.

Run the fast unit suite with `pnpm test` and this slower suite with
`pnpm test:integration`. CI runs them in separate jobs.

## Community privacy boundary

`CommunityReplicationService` currently permits replication only for `public`
communities. Its envelope authenticates the sender but does not implement
group-key distribution, member removal, or key rotation; sending a
`contacts`-only community through it would expose its event body to the link.
The service therefore fails closed until an encrypted group transport is
designed and tested. Direct messages remain recipient-encrypted.
