# Phase 12 hardening and operational boundaries

Русский обзор: [hardening и границы хранения](ru/social-media.md#hardening-и-хранение).

## Local moderation and anti-spam

`LocalSafetyPolicy` persists only on the user's selected local storage backend. It can block or mute an identity/community, hide an object, and retain a local report. Reports have no implicit network destination, telemetry upload, developer inbox, or backdoor. Before handing the policy to `LocalDiscoveryIndex`, a host must call `initialize()`; the policy fails closed while it is loading so a persisted block cannot briefly leak into a feed or search result.

`LocalPeerAbuseGuard` provides per-device, per-peer/per-message-kind rolling limits, byte caps, malformed-packet penalties, and temporary local penalties. `DirectMessageService` accepts it as an optional ingress guard and applies it before decrypting a verified contact envelope. It intentionally has no global reputation score, proof-of-work mandate, or central identity service.

Community bans, kicks, roles, and permissions remain signed community events; direct-message blocking remains a separate local encrypted-storage policy.

## Multi-device and revocation

One Keystone owner can derive independent `Self` device session keys from the protected master seed. Existing Self-only swarm membership, CRDT peer allow-lists, and signed `DeviceRevocation` records cover trusted-device pairing and permanent lost-device revocation. Transport rejects revoked device identities. Private social storage remains a host-encrypted boundary and must be replicated only over authenticated Self-device paths; it must never be placed into public discovery, an unrelated peer's CRDT, or a relay.

## Storage and performance boundaries

| Data | Boundary |
| --- | --- |
| Master seed/device keys | Platform secure storage chosen by the native host. |
| DM, outbox, replay nonces, read state, local relationships | `PersistentSocialStorage` backed by authenticated encrypted host storage, with schema migration v1→v2. |
| Community event logs | Separate encrypted storage namespace. |
| Public/social object metadata and indexes | Bounded local object indexes; public advertising exposes only minimal metadata. |
| Media bytes/chunks | Content-addressed cache with hash verification, quota, LRU eviction, pinning, resume, and provider fallback. |
| AI/RAG | Existing host-local RAG/runtime boundary; no social blobs are put in React state or Yjs documents. |

Search limits query length to 128 characters and page size to 100. Feed/search are cursor-paginated; media downloads are chunked and cancelable. A production host must provide atomic authenticated writes, retention/compaction for replay/outbox/index records, and native MIME/container validation before opening any fetched content.

## Explicit non-claims

Keystone does not yet provide a global moderation service, public recommendation backend, streaming CDN/SFU, central notification service, financial-grade creator analytics, or a server-side decryption key. Optional push, DHT/gossip, shared block-list, and native media implementations remain host integrations subject to user choice and independent security review.
