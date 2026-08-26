# Browser Agent Runtime

The runtime provides a typed browser boundary for the unified Desktop Shell. A
browser is still an ordinary `browser` tab in a pane/workspace; there is no
second browser UI or second object store.

```text
Desktop browser tab
  -> BrowserPageState (bounded observation)
  -> BrowserContextExtractor (current-page scope)
  -> Browser Worker / Agent Bot
  -> BrowserIntent (typed)
  -> BrowserPolicy (scope, privacy, confirmation, budgets)
  -> host BrowserHostAdapter
  -> BrowserActionResult
```

`@keystone/browser-engine` exports `BrowserAgentRuntime`, `BrowserSession`,
`BrowserPageState`, `BrowserIntent`, `BrowserActionResult`,
`BrowserContextExtractor`, `BrowserPermissionScope`, and `BrowserArtifact`.
The host adapter is intentionally driver-neutral. It must implement
`observe()` and typed `execute()`; optional tab and human-takeover hooks are
also typed. It never accepts JavaScript, CSS/XPath selectors, cookie values,
passwords, or arbitrary filesystem paths.

The runtime supports navigation, history, bounded tab creation/switching,
semantic click/type/select/scroll/submit, find/extraction, screenshots,
bounded downloads, explicit FileObject uploads, and wait-for-state. Semantic
element references carry `pageRevision` and `elementRevision`; stale
references are rejected and must be re-observed.

Autonomous work is an `OBSERVE -> PLAN -> ACT -> VERIFY` loop. Runtime, tab,
navigation, failed-action, download, and step limits are enforced before host
actions. A run ends as `COMPLETED`, `NEEDS_USER`, `FAILED`, or `CANCELLED`.
Pause/take-control marks the session paused; a manual host action increments
the page revision, invalidating old plans. Resuming never resurrects a stale
reference.

Desktop workspace persistence stores only non-sensitive tab metadata (URL
without credentials/secrets, session ID, origin, revision, data class, and
activity). Page text, screenshots, cookies, and credentials are not persisted
by the shell.

The same model runtime and scheduler used by Agent Bot/ephemeral workers are
expected at the host composition boundary. Browser results can enter the
existing Task Graph through `BrowserArtifactTaskGraphAdapter`; no browser
transport, media store, or central web service is introduced.

Native Chromium/WebView/Gecko integration remains a host-provided adapter. A
Node test adapter is useful for deterministic policy tests, but it is not
presented as proof of a native browser engine.
