# Unified Search

Keystone Search is a local-first view over objects already known to the device. It is not a global search engine.

## Three scopes

- **Local Search** — profiles, communities, Tracks, Albums, Playlists, Videos/Shorts, Live broadcasts, Posts, and permitted messages held locally. A private message can be indexed only by an already-authorized local caller; it is never put in the discovery index, durable discovery snapshot, advertisement, or P2P envelope.
- **Social Discovery** — an optional trusted-neighbour adapter supplies signed objects from known peers; each result is permission-checked and indexed locally.
- **Public P2P Discovery** — `DiscoveryReplicationService` sends the original signed public object through the existing authenticated Transport. Media bytes are not copied into discovery envelopes.

`UnifiedDiscoveryService.search()` checks visibility, blocked authors/communities, and the caller's `canView` policy before returning results. Empty or overlong queries are rejected, and pages are bounded to 100 results.

## One object graph

Cards carry the original Keystone object ID. A Track referenced by a DM, Community message, Home card, or Search result is the same Track object. A Short is a Video with short-form metadata; it does not create a second media store or transport.

## Ranking

Home, Following, and Communities use one `RankingProvider`. The default deterministic provider uses follows, community relevance, recency, local reactions, watch/listen history, bookmarks, interests, and trust hints. The state is device-local. Hosts may provide a local AI ranker later; no cloud recommendation service is required.

## Privacy and failure handling

Private DM bodies and live-chat messages never enter the index. Public replication rejects non-public visibility, malformed schemas, oversized objects, expired/replayed envelopes, and invalid object signatures. Block lists and search permissions are applied before a result is exposed. Public advertisements contain only minimal IDs/types/authors/timestamps and do not expose local interaction history.
