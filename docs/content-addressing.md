# Content addressing

Русский обзор: [контент и вложения](ru/social-media.md#контент-и-вложения).

Large media is identified by `sha256-<hex>` and referenced as `keystone://content/sha256-<hex>`. The identifier is the SHA-256 of the complete immutable byte stream; it is independent of a chat, community, or UI attachment.

A v1 manifest records byte length, claimed MIME type, optional name, chunk size, and SHA-256 for every chunk. Receivers validate manifest bounds before allocating or requesting data, verify every chunk before caching it, and verify the assembled content hash before returning it. MIME metadata is descriptive only and must still be checked by the renderer/player boundary.

`ContentCache` enforces a local quota with LRU eviction and explicit pinning. A pinned object is never evicted automatically; an over-quota pinned set fails rather than silently storing unlimited media. `ContentFetcher` resumes from verified cached chunks and can fall back to another provider for each chunk. No Keystone storage service, CDN, or mandatory seeder exists.

`ContentProvider` is deliberately transport-neutral. Hyperswarm, WebRTC data channels, LAN peers, and future voluntary discovery providers can implement it. `DistributedContentService` is the bounded multi-source implementation above this immutable manifest contract: it schedules missing chunks across eligible sources, verifies each chunk and the final SHA-256 address, persists resumable state, and honors cache quota/pinning. Its requests travel through the existing `KeystoneDeliveryInterface`/`ConnectivityFabric`; it does not create a CDN, global seeder directory or mandatory cloud store.

Manifest policy is explicit. `PUBLIC_CACHEABLE` permits voluntary public caching; `OWNED_DEVICES`, `AUTHORIZED_GROUP` and `PRIVATE_NO_STRANGER_CACHE` require matching authorization. Private callers create the manifest from ciphertext using the existing application encryption boundary. The content layer never receives decryption keys, treats possession as authority, or announces private availability globally. Bounded retries, source concurrency, pending requests and transfer state keep RAM, disk and network use finite; malformed, stale, wrong-length or corrupt chunks are rejected before cache commit.

## Publication revisions

Personal Web publication bodies are serialized into ordinary content manifests
with a bounded 16 KiB baseline chunk size so signed chunk responses remain
below the transport frame budget. The publication revision stores the manifest
and immutable content address; it does not implement a second blob or chunk
protocol. A voluntary public cache can serve verified bytes, but it cannot
change the publisher signature, latest pointer or authorship. Unpublish does
not recall immutable bytes already cached elsewhere.
