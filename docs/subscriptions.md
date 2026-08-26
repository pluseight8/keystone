# Feeds, Subscriptions and Podcasts

The reader supports owner-selected RSS 2.0, Atom 1.0 and
JSON Feed sources, plus explicit podcast/audio handling. The capability is
implemented by `packages/core/src/subscriptions.ts` and exposed to desktop
and mobile only through typed host projections. It is not a central
aggregator, crawler, proxy, recommendation engine, advertising surface or
cloud inbox.

## Ownership and lifecycle

A subscription is an explicit owner relationship with one canonical HTTP(S)
feed URL. Keystone stores the subscription, folders, bounded feed metadata,
read/favorite state and explicit download state locally. The external origin
remains authoritative for feed content. Subscribe, pause, resume, unsubscribe,
refresh, mark read, favorite, save to Web Library, open original, share and
continue-on-device are separate actions.

The first successful refresh establishes a quiet baseline: existing items are
read and do not create notifications. Later new items are unread. A 304 keeps
the local history unchanged. A failed refresh preserves cached entries and
reports a typed error/backoff state; it never erases local data.

Retention is bounded per feed and globally. Favorites, Web Library references
and explicitly downloaded episodes are retained when ordinary feed history is
trimmed. There is no per-feed timer: `FeedRefreshScheduler` computes one
bounded due set and the host decides when to call it.

## Direct fetch boundary

`FeedFetchClient` is the only external feed HTTP boundary. Its transport:

- sends direct GET requests with a fixed Keystone user agent and no cookies,
  Keystone identity, Authorization header or credential material;
- follows only bounded HTTP redirects, rejects credential-bearing URLs,
  unsafe schemes and HTTPS-to-HTTP downgrade;
- blocks loopback, link-local, RFC1918, ULA and `.local` destinations unless
  the owner explicitly authorized private-network access for that subscription;
- applies timeout, response, decompressed-body and redirect limits;
- supports ETag/Last-Modified conditional refresh and 304;
- classifies 401/403, 429, 5xx, timeout, TLS, offline and malformed responses
  as typed local errors.

The client does not send feed requests through a Keystone server. It does not
discover or fetch feeds merely because a page contains a link.

## Parsing and content safety

The bounded parser accepts RSS 2.0, Atom 1.0 and JSON Feed from response
content. It validates URLs without credentials or credential-like query
parameters, bounds XML depth/elements/attributes/text, bounds JSON nesting and
items, and rejects DTD, ENTITY, NOTATION and other unsafe XML declarations.
HTML summaries/content are sanitized with the Web Library safety boundary
before they enter durable state. Scripts, event handlers, forms, unsafe links
and live remote resource behavior are not executable. Reader evidence exposes
zero external requests, script executions and form submissions.

OPML import is a network-free, bounded preview followed by explicit owner
confirmation. It reports invalid and duplicate URLs, preserves nested folder
paths, rejects XML external entities and exports subscriptions without
credentials. Feed discovery is proposal-only: it reads bounded page HTML and
returns typed alternate-feed candidates; it never subscribes or fetches.

## Podcasts and media

RSS enclosures, Atom enclosure links and JSON Feed attachments are metadata
until the owner selects Download. Audio/video downloads use the same direct
HTTP boundary, bounded bytes, redirect/SSRF checks, Range/resume semantics,
content-addressed local storage and integrity metadata. Executable MIME types
are rejected. Auto-download is disabled by default and, if enabled per feed,
is bounded by an owner-selected episode count. Playback is available only for
verified local content through the host media runtime; playback position is
local metadata. No background microphone/camera/media indexing is implied.

## Cross-surface projections

- Web Library receives an explicit `saveArticle` call; it owns the immutable
  offline article capture and safe reader revision.
- Universal Inbox has an optional `subscriptions` source badge and projects
  only unread items from feeds whose notification policy is enabled. It stores
  presentation metadata, not source authority or action callbacks.
- Daily Layer consumes a bounded `feed` source only when the owner enables it.
  No-change means silence; feed items are not engagement ranking.
- Device Continuity carries a typed article/podcast reference and optional
  position only after an explicit action. Owned-device sync merges bounded
  subscription metadata and owner organization state; it does not become a
  central feed database.
- Desktop and mobile receive safe metadata/reader projections through host
  adapters. Missing adapters are shown as unavailable.

Feed content is untrusted source material. It is never implicit AI context,
memory input, plugin authority or a permission grant. Any future AI use must be
an explicit, bounded local operation or pass the existing egress policy.

## Validation

Focused checks:

```sh
pnpm test:subscriptions
pnpm --filter @keystone/core lint
```

The focused suite covers parser/security cases, persisted-state tampering,
conditional refresh, baseline/read semantics, Inbox policy, OPML/discovery,
podcast download and a real loopback HTTP server using the production-shaped
`FetchFeedHttpTransport`. The scale proof covers 1,000 feed entries and 256
subscriptions without per-feed timers. The current validation host is
**Omarchy (Arch Linux-based distribution)** with Node v22.23.2, pnpm 9.15.0
and package engine `>=22 <23`; no apt, dnf, GNOME, Flatpak or system-package
installation is required.

Central aggregation, provider accounts, recommendations, ads, proxying and
background media ingestion remain outside the subscription contract.
