# Web Library, Read Later and Offline Archive

The Web Library is a local-first, owner-controlled index of
bookmarks and explicit page captures; it is not a central Keystone archive,
browser history database, crawler, origin proxy, or automatic publication
service.

## Core contract

The canonical implementation is
[`packages/core/src/web-library.ts`](../packages/core/src/web-library.ts).

```text
BrowserHostAdapter.capturePage (explicit owner action)
    -> BrowserAgentRuntime.capturePage (origin/revision/budget boundary)
    -> BrowserRuntimeWebCaptureAdapter
    -> WebCaptureService (bounded queue)
    -> WebLibraryService (metadata + immutable revision)
    -> ContentCache / content manifests (private bytes)
    -> ReaderRenderer (static local HTML/text)
```

The capture adapter is the only place allowed to obtain an origin
representation. `WebLibraryService` never calls `fetch`, follows a manifest,
opens an origin, runs page JavaScript, submits forms, or uses ConnectivityFabric
as a Web proxy.

Capture modes are explicit:

- `BOOKMARK_ONLY` stores bounded URL metadata only.
- `READER_SNAPSHOT` stores deterministic extracted reader blocks and skips page
  resources unless a host explicitly supplies a different policy.
- `SAFE_PAGE_ARCHIVE` stores the deterministic reader representation and
  bounded image resources in the private content cache.

Every archive revision is immutable. An explicit refresh creates a new
revision and moves the entry's latest pointer; earlier reader text, source
metadata and content references remain addressable for diff and provenance.

## Safe reader and archive policy

The capture boundary removes scripts, `javascript:` URLs, event attributes,
forms, iframe/object/embed/plugin content, SVG scripting and page CSS/chrome
spoofing. Relative links are resolved against the captured source URL without
making a request. The final reader is generated from typed
`ReaderDocument` blocks, not from origin HTML.

The renderer emits no live origin `src`, form, script or executable URL. Images
use private content references; unavailable assets become an offline
placeholder. External links are presented as inert, explicit links. Render
evidence is always `externalRequestCount: 0`, `scriptsExecuted: 0` and
`formsSubmitted: 0`.

URLs are HTTP(S)-only, reject embedded credentials, and redact common
credential/session query keys before metadata persistence. Generic archive
metadata contains no cookies, authorization headers, browser session, path or
credential material. Page text remains untrusted content; it cannot grant
Agent, Plugin, NativeHost, Browser or publication authority.

## Organization, search and storage

Entries support collections (including `Read Later`), tags, favorites, read
state, local search, revision lists, bounded line diffs, highlights and notes.
Search is local and permission-aware and reports matched fields such as title,
hostname, reader text, tag, collection and annotation.

Archive HTML and images use SHA-256 content-addressed manifests with
`PRIVATE_NO_STRANGER_CACHE`. Web Library metadata and content storage are
separate host-replaceable boundaries. Quotas cover entries, revisions,
collections, annotations, HTML, blocks, resources and capture queue depth.
No cloud archive account or central Web Library server is required.

## Explicit sharing boundaries

`WebLibraryShareBoundary` has separate explicit destinations:
`OWNED_DEVICE`, `NEARBY` and `PERSONAL_WEB`. The service passes a private
`WebSharePlan`; the destination adapter owns its own consent and policy.

- Continuity/owned-device transfer carries an archive bundle or typed document
  reference through the existing trusted-device/E2E boundary. It does not
  carry cookies, an active browser session or a remote-control command.
- Nearby is an explicit copy boundary. It does not turn an endpoint into a
  Keystone identity, contact or device enrollment.
- Vault export is an explicit note adapter with source URL, capture timestamp
  and revision provenance.
- Personal Web may publish only the adapter's intentional safe rendition; Web
  Library does not publish, announce, expose a private manifest or become an
  origin proxy.
- Agents and plugins receive no implicit archive access. Any future AI action
  must use an explicit bounded projection and the existing egress policy.

`createWebArchiveBundle` and `importWebArchiveBundle` are metadata-first,
explicit owned-device/share APIs. Import accepts content only from a caller
supplied resolver, verifies manifest hashes, rejects public-cache policy for
private archives, and never fetches a URL or manifest itself.

## Host surfaces

Desktop uses
[`desktop-web-library-runtime.ts`](../apps/desktop/src/desktop-web-library-runtime.ts)
and exposes saved items, Read Later, collections, search, offline reader
status, source/revision provenance, highlights/notes and explicit share,
Continuity and Vault actions. Browser surfaces expose separate `Save Reader`
and `Save safe archive` actions; saving is never automatic browsing history.

Mobile uses the corresponding
[`webLibraryRuntime.ts`](../apps/mobile/src/webLibraryRuntime.ts) projection
and `web-library` route. Both surfaces remain replaceable host adapters and do
not read filesystem paths, browser cookies or origin pages directly.

## Evidence and validation

- `web-library.test.ts`: bookmark/archive semantics, safe rendering, revisions,
  diff, annotations, bundle round-trip and bounded cancellation.
- `web-library-security.test.ts`: unsafe URLs, prompt-injection-as-data,
  private manifest policy, visibility and integrity failures.
- `testing/web-library-browser-evidence.test.ts`: a real local HTTP origin is
  captured through `BrowserAgentRuntime`; after the origin is shut down, two
  reader opens add zero requests and execute zero scripts/forms.
- `testing/web-library-scale.test.ts`: 10,000 metadata entries, 10,000
  annotations, 100 captures and 1,000 offline reader opens with bounded
  resource assertions.

The test is physical loopback evidence for the Browser-to-local archive path;
it is not a claim of Android/iOS browser-engine verification. Production
Browser hosts must provide the optional typed `capturePage` capability; old
hosts fail closed with `HOST_UNAVAILABLE`.

Validation uses Omarchy (Arch Linux-based distribution), Node v22.23.2,
pnpm 9.15.0 and package engine `>=22 <23`. No apt/dnf/GNOME/Flatpak or system
package installation is part of the Web Library gate.
