# Browser Security Boundary

Web content is always `UNTRUSTED`. Prompt-injection detection can be useful as
a signal, but it is not the security boundary. The boundary is the typed
intent protocol, scoped context, host policy, revision checks, and existing
Keystone capability/confirmation policy.

## Context and privacy

`BrowserContextExtractor` exposes only the current page URL/origin/title,
bounded visible relevant text, bounded accessibility information, semantic
interactive elements, and an optional screenshot reference. It does not dump
the DOM. Page content is marked untrusted and cannot alter system policy,
capabilities, ToolPolicy, or confirmation state.

External execution is denied for `PRIVATE` and `SECRET` pages, artifacts, and
private FileObject uploads. Local and trusted-personal execution remains
subject to the same data-class permissions as the rest of Keystone. Memory,
DMs, private Communities, files, identity data, cookies, tokens, and saved
passwords are never implicitly placed in browser context.

Hosts may use saved credentials for a user-approved autofill operation, but
the model sees neither the credential nor its value. Password fields are not
accepted as a model typing target. Uploads require an explicit, authorized
FileObject reference; the worker cannot search the private filesystem.

## Navigation and action safety

Only HTTP(S) URLs are accepted. Credentials in URLs, `javascript:` URLs, file
URLs, and unsafe redirects are rejected. `allowedOrigins`, tab limits,
navigation limits, action limits, download limits, and runtime limits are
enforced by `BrowserPolicy`/`BrowserAgentRuntime`. Sensitive actions can be
listed in `requireConfirmationFor`; an absent confirmation returns
`NEEDS_CONFIRMATION` without calling the host.

Semantic element references are bound to both page and element revisions. Any
navigation, host mutation, or human action can invalidate them. Reusing a
stale reference returns `STALE_PAGE` or `STALE_ELEMENT`.

Downloads are size/MIME checked and must cross the typed
`BrowserDownloadBoundary` before the action can complete. If that host
boundary is unavailable, the download fails closed; it is never silently
returned as a normal browser file. The boundary connects to the existing
File/storage quarantine, which owns durable content-addressed storage and
further scanning. Downloaded content cannot silently become trusted
instructions.

There is no arbitrary JavaScript/eval escape hatch. A host adapter that adds
one would violate the package contract and should not be used by Keystone.
# Browser downloads and untrusted files

Browser downloads are handed to the typed  `BrowserDownloadBoundary` and remain `UNTRUSTED` quarantine artifacts. The Browser Agent cannot open, install or execute a downloaded file. A core host can use `createBrowserDownloadContainmentBoundary` to connect it to `FileContainmentService`.
