# Unified Home, discovery, and ranking (Phase 21)

Русский обзор: [единая главная, поиск и discovery](ru/discovery.md).

`Post` and `Comment` are signed immutable objects. A Post carries small text and/or content-addressed URIs while its `references` link to existing Tracks, Videos, Shorts, live broadcasts, Communities, files, or other Posts. A Comment references its Post. This keeps one connected content graph instead of copying media metadata into each surface.

`LocalDiscoveryIndex` receives only objects already validated by their owning services. It indexes known non-private profiles, communities, posts/comments, music, videos, shorts, and broadcasts. Direct-message bodies and live-chat messages are categorically rejected. Search is local, bounded to 1–128 query characters, returns deterministic relevance ordering, and uses cursor pagination with a 1–100 item limit.

`UnifiedDiscoveryService` projects the same object IDs into Home, Following, Communities, Search, chat references, and community references. `DeterministicRankingProvider` is the default `RankingProvider`; it combines follows, community relevance, recency, local reactions, watch/listen history, bookmarks, interests, and trust hints. A host may install a local AI provider later without changing the object graph or transport. The small AI status shown at the top of mobile Home is a local-provider boundary, not a recommendation backend.

Interactions and followed/community sets are persisted in a separately namespaced local discovery store. They are never placed in public advertisements and are not replicated unless the user explicitly chooses another social action. A restarted process restores its local feed and search metadata without republishing private history.

Discovery scopes are intentionally separate:

- `local` searches all eligible objects already held by this device;
- `neighbourhood` uses an optional caller-provided trusted-peer adapter, then indexes returned eligible objects locally;
- `public` uses the signed `social.discovery_object` envelope over the existing authenticated Transport/Hyperswarm path, or an optional DHT/gossip-style adapter. Only public, schema-valid, signature-valid objects are accepted.

Permissions are evaluated before a result is returned. Private DM objects, blocked authors/communities, contacts-only objects, community-restricted objects, malformed objects, and invalid signatures cannot enter public discovery. A Video with `shortForm.aspectRatio === "9:16"` is surfaced as a Short; it remains the same Video ID and media object.

There is no built-in global search endpoint, central index, central analytics, or recommendation server. Remote adapters are transport integrations and must validate incoming objects through their owning service before treating them as trusted social state. Private, contacts-only, community-only, message, and live-chat data are never included in public advertisements.
