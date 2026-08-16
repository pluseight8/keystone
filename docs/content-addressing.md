# Content addressing (Phase 5)

Русский обзор: [контент и вложения](ru/social-media.md#контент-и-вложения).

Large media is identified by `sha256-<hex>` and referenced as `keystone://content/sha256-<hex>`. The identifier is the SHA-256 of the complete immutable byte stream; it is independent of a chat, community, or UI attachment.

A v1 manifest records byte length, claimed MIME type, optional name, chunk size, and SHA-256 for every chunk. Receivers validate manifest bounds before allocating or requesting data, verify every chunk before caching it, and verify the assembled content hash before returning it. MIME metadata is descriptive only and must still be checked by the renderer/player boundary.

`ContentCache` enforces a local quota with LRU eviction and explicit pinning. A pinned object is never evicted automatically; an over-quota pinned set fails rather than silently storing unlimited media. `ContentFetcher` resumes from verified cached chunks and can fall back to another provider for each chunk. No Keystone storage service, CDN, or mandatory seeder exists.

`ContentProvider` is deliberately transport-neutral. Hyperswarm, WebRTC data channels, LAN peers, and future voluntary discovery providers can implement it. Provider discovery, parallel scheduling, bandwidth limits, and host file-backed cache adapters remain implementation work above this immutable manifest contract.
