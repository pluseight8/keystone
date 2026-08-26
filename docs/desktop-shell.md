# Unified Desktop Shell

Keystone Desktop now uses one browser/workspace-style shell. The shell is a
navigation and layout layer over existing Keystone services; it does not
replace identity, content, transport, social, storage, or AI policy code.

## Architecture

`DesktopShellController` composes the following bounded managers:

- `TabManager` — open, close, duplicate, pin, reorder, dirty/locked state and
  a bounded reopen stack;
- `PaneManager` — horizontal/vertical nested splits (maximum depth three),
  focus, resize and typed tab movement;
- `WorkspaceManager` — named layouts with tabs, pane tree, active pane,
  activity-bar order and panel sizes;
- `DesktopNavigation` — back/forward history for Keystone objects and web
  pages;
- `KeystoneLinkRouter` — permission-checked `keystone://` object links and
  ordinary web URLs;
- `ContextProviderRegistry` — typed providers for the right context sidebar.

Tabs store only a `KeystoneObjectReference` (`kind`, `id`, visibility and an
optional display label). They never copy a Track, File, message, private
memory, or media payload. Existing domain services remain responsible for
loading the referenced object and enforcing authorization.

The optional Contacts surface is a host projection over the canonical
`ContactService`. It receives bounded non-private fields through
`desktop-contacts-runtime.ts`; the shell does not create a second address-book
store, infer Identity links or grant plugin/AI access.

## Surfaces

The desktop environment contains a customizable activity bar, toolbar/omnibox,
top tab strip, bounded pane tree, optional Context Sidebar, optional Agent Bot
panel and a small status area. Home, Agent Bot, Chat, Profile, Community,
Space, Vault, Calendar, Contacts, Maps, File, Music/Media, Video, Settings and
Browser are available as typed tabs. Contacts is an owner-local address-book
projection; it can search and organize Contacts and start only explicit
card/import or recipient actions. Maps is a host-adapter surface: it can render
local/offline provider state, search Places, plan a manual route and invoke
the explicit one-shot location action, but the shell never reads an
ambient location or invents provider data. `keystone://place/<id>` opens the
Maps tab as a typed Place reference.

`QuickActions` routes Message, Group, Space, Note, Canvas, Calendar Event,
Task, File, Agent and Community to typed object references. A dropped reference
uses `application/x-keystone-ref`, so a File can be moved from Chat to Space
without creating another File object.

## Agent Bot boundary

The Agent Bot panel is reachable from every tab (Ctrl/Cmd+Space). Its scope is
displayed explicitly as the active object and object ID. On a Browser tab the
scope is the current page origin/revision only; page content remains untrusted
and is supplied by `BrowserContextExtractor` through the typed browser-agent
boundary. Opening the panel does not attach all workspace data, private
history, neighboring panes, cookies, or credentials. A real
AgentRuntime/AIOrchestrator host can consume this scope through its existing
capability and egress policies.

The Browser tab is projected through `DesktopBrowserRuntimeState` and
`applyBrowserActionResult`. A host adapter can feed observations and typed
action results into the same tab, while workspace restore retains only
non-sensitive session ID, origin, revision, data class, and activity metadata.
See [Browser Agent Runtime](browser-agent-runtime.md) and
[Browser Security](browser-security.md) for the host contract.

## Persistence and recovery

The current layout is stored locally under versioned keys
`keystone.desktop.workspaces.v1` and `keystone.desktop.current-workspace.v1`.
The persistence envelope is bounded and validated on restore. Malformed state
falls back to a safe Personal workspace. URL credentials, hashes and common
secret query parameters (`token`, `secret`, `password`, `key`, `auth`, etc.)
are removed before a URL is persisted. No prompt text, private payload or
private key is written by the shell.

If a restored object no longer passes the host permission callback, its tab is
locked or can be closed; restoring a tab never grants permission. A
`keystone://` URL is only a reference and is not an authorization token.

## Startup, commands and workspaces

The startup surface is a local preference. The host may open the last
permission-checked object, Home, Feed, Video, Messages, Storage or a selected
workspace; if the saved object is gone or no longer authorized, it falls back
to the selected safe surface.

The Omnibox accepts typed `keystone://` references, ordinary HTTP(S) URLs,
bounded local search terms and a small command vocabulary such as `> Open…`,
`new message`, `split pane` and `settings`. Natural-language questions open
Agent Bot with only the active-object scope. Unknown schemes, object kinds and
malformed IDs are rejected, and a navigation URL never grants permission.

The Command Palette exposes Open, New message, New Space, New note, Calendar
Event, Search, Ask Agent Bot, Settings, sidebar, pane, tab and workspace
actions. Extension commands remain inactive until the plugin permission model
approves them. Workspaces are local layout records: they save tab references,
the bounded pane tree, sidebar state and activity-bar order, never a second
copy of a domain object.

Navigation history is bounded to 100 entries. Back and Forward select an
existing tab when possible or use the same permission-checked object router;
persisted web URLs have credentials, secret query parameters and fragments
removed.

## Keyboard and accessibility

Ctrl/Cmd+K or Ctrl/Cmd+P opens the Command Palette; Ctrl/Cmd+L focuses the
Omnibox; Ctrl/Cmd+T/W/Shift+T create, close and reopen tabs; Ctrl/Cmd+\\ splits
the current pane; Ctrl/Cmd+Tab switches tabs; Ctrl/Cmd+Space opens Agent Bot.
The key mapping uses a platform abstraction so macOS uses Command while Linux
and Windows use Control. Focus-visible styles, labels, reduced-motion support,
and keyboard buttons are included in the shell surface.

## Non-commercial boundary

The shell adds no payments, advertising, marketplace, telemetry, hosted browser,
central search, or cloud workspace service. Mobile navigation remains a
separate surface; the desktop shell is intentionally desktop-first.

Model and integration tests live in
`apps/desktop/src/desktop-shell-model.test.ts` and cover the restart journey,
tab/pane operations, corrupted state, URL redaction, permissions, history,
typed context providers and workspace switching.
