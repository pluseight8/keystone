# Universal Capture, Share-In and Quick Capture

Universal Capture is Keystone's explicit intake boundary. It accepts a
bounded user-selected payload and places it in a private local Capture Tray.
The Tray is not a new Universal Inbox, Task Inbox, Files store, Vault store,
Web Library, Photos library or Documents database. Existing canonical services
remain authoritative.

## Contract

`packages/core/src/capture.ts` exposes `CaptureService`, typed source
provenance, bounded payloads, deterministic suggestions, destination previews,
idempotent routing, undo where a destination supports it, local search and
private own-device sync envelopes. Large files are represented by an opaque
handle and bounded metadata; file bytes are read only by the selected
destination adapter. Capture state is local-first and restart-safe.

States are `DRAFT`, `READY`, `PROCESSING`, `ROUTED`, `FAILED` and `DISMISSED`.
Every item records a source kind, optional typed source reference, capture time,
data class and result references. A source reference is data, not an
authorization grant.

## Inputs

The Core boundary supports manual text, safe HTTP(S) URLs, one-shot clipboard
reads, explicit files/images/documents, drag/drop metadata, browser page or
selection projections, OS Share-In payloads, contact cards, mail/message and
other Keystone references, places/routes, calendar/tasks/workboard references,
Nearby/Continuity proposals and `keystone://capture` proposals. The UI may
offer only the inputs for which its host has a typed capability.

Clipboard access is explicit-only. There is no clipboard watcher, clipboard
history, background polling or automatic paste. Browser capture receives a
bounded page/selection projection and never receives credentials or ambient
Keystone context. OS Share-In is an untrusted proposal; it does not open a URL,
execute a command or route itself.

`keystone://capture` accepts only a bounded `text`, safe `url`, or typed
`type`/`id` proposal. Action, command, destination, executable, privileged and
arbitrary `file://` fields are rejected. Deep-link acceptance creates a Tray
item, not a privileged action.

## Tray and routing

Capture uses bounded metadata pagination and local search, deterministic
fingerprint deduplication, bulk intake, dismiss/restore, explicit cleanup and
crash recovery. A destination registry contains typed adapters for Tasks,
Vault, Web Library, Files, Photos, Documents, Contacts, Calendar, Workboard
and Shared Folders.

Routing is always two-step:

1. the adapter returns a preview with destination, summary, disclosure class,
   warnings and an owner-confirmation requirement;
2. the owner confirms the selected destination and Keystone executes the
   adapter with a stable item/destination idempotency key.

The operation is persisted before execution. A completed receipt is returned
for a retry instead of executing the canonical write again. Interrupted
operations recover as `FAILED` until explicitly retried; no startup replay
creates Tasks, Contacts, events, files or shares.

Private destinations keep the item private. A Shared Folder preview discloses
that the selected payload will become shared. Publication, external mail,
social sharing, public Web Library publication, Memory writes and agent/tool
execution are not Capture destinations and are never implicit consequences.

## Canonical integrations

Adapters call the existing service boundaries. Task creation calls
`TaskService`; Vault writes Markdown through `VaultService`; Web Library uses
its bookmark/archive contract; Files and Shared Folders use content-addressed
canonical storage; Photos and Documents use their existing import services;
Contacts and Calendar require their existing explicit owner actions. Capture
does not copy canonical bytes into a second store.

Source references from Mail, Messages, Contacts, Maps, Calendar, Tasks,
Workboard, Nearby, Continuity and collaboration are reference-only until the
owner selects a compatible destination. Remote data cannot grant permission,
create an identity, accept a share or trigger a command.

## Desktop and mobile

Desktop exposes Quick Capture from the activity bar, header, Quick Actions,
the `Ctrl/Cmd+Shift+Space` shortcut and the typed drag/drop boundary. Text and
URL capture work in the local fallback before native bootstrap. Clipboard,
browser and file actions report an unavailable host boundary when no adapter
is installed.

Mobile exposes an in-app Quick Capture screen with local text/URL fallback,
Tray search, suggestions and preview/confirm routing. Android `ACTION_SEND` /
`ACTION_SEND_MULTIPLE` and iOS Share Extension integration are represented by
`MobileShareInBoundary`; a platform adapter must pass a typed payload and an
explicit acceptance decision. No PWA or background clipboard assumption is
made.

## Privacy and resource safety

Text, URLs, HTML-derived clipboard text, titles, references and errors are
bounded and normalized. HTML is reduced to text and scripts/styles are
discarded. Only credential-free HTTP(S) URLs are accepted. File bytes stay
behind an opaque selected handle and are read at route time with a size bound.
There is no directory scan, arbitrary path access, automatic archive/plugin
execution, external fetch, remote command execution or implicit external AI.

Own-device Continuity and sync exchange only private bounded metadata and
typed references. A sync envelope is owner-scoped and may be restricted to a
trusted device set. Sync merge never replays a destination operation.

## Validation

Focused checks are run with Node v22.23.2, pnpm 9.15.0 and package engine
`>=22 <23`:

- `pnpm test:capture` — core unit/security/integration/controlled-runtime/
  scale tests and native clipboard command-boundary tests;
- `pnpm tsc`, `pnpm test`, `pnpm test:integration`, `pnpm test:network`,
  `pnpm test:performance`, `pnpm test:security`, `pnpm build` and
  `pnpm release:check` — the existing release gates with Capture included;
- `git diff --check` — whitespace validation.

The current development/validation distro is **Omarchy (Arch Linux-based
distribution)**. Native evidence is classified from the actual host. The
Wayland clipboard adapter uses fixed `wl-paste` argv with `shell: false`; a
missing compositor/clipboard session is reported as unavailable, not silently
replaced with a test adapter. No system package is installed or changed.
The physical-evidence probe reports `RUNTIME_DETECTED`/`SAME_HOST` for
the available `wl-paste` command without reading or logging the owner's
clipboard contents; it does not claim physical clipboard verification.
