# Keystone Links

Keystone Links are typed, non-bearer references. They identify an object or a
stable application surface; they never contain credentials, private payloads,
or permission material.

## Canonical routes

These links open the corresponding surface in the desktop shell:

```text
keystone://home
keystone://search
keystone://settings
keystone://music
keystone://video
keystone://shorts
keystone://files
keystone://documents
keystone://tasks
keystone://capture
keystone://ai
keystone://devices
keystone://network
```

## Canonical objects

Object links keep the stable object ID:

```text
keystone://file/<id>
keystone://document/<id>
keystone://task/<id>
keystone://capture/<id>
keystone://media/<id>
keystone://conversation/<id>
```

`task` and `conversation` are user-facing aliases for the shell's typed
`tasks` and `chat` objects. Vault notes, publication revisions, maps and other
typed objects keep their existing extended forms, for example
`keystone://vault/<vault-id>/note/<note-id>`.

The same link can be copied from a tab or an object's Links section, pasted
into the omnibox, selected from local Search, or clicked in supported Markdown
previews. Opening a link creates or focuses a tab and runs the normal
permission check. A missing, deleted, or no-longer-authorized object is shown
as unavailable; Keystone never substitutes a different object silently.

## Authorization and external URLs

`KeystoneLinkRouter` validates the scheme, known kind, bounded ID and host
permission callback before a tab is opened. Knowing a link does not disclose
the object or bypass a Conversation, Community, File or Identity permission.

External HTTP(S) URLs are routed to the Browser surface. Browser pages do not
receive Keystone private context, Memory, Files, chats, or tools implicitly.

## Drag and drop

Desktop surfaces use `application/x-keystone-ref` with the minimal typed
reference payload. A drop follows the same link and permission path. Malformed
drag data is ignored and reported locally; no untrusted data is executed as
JavaScript or a plugin command.

## Persistence safety

Workspace state stores only object kind, bounded ID, display label and
visibility for a tab. URL credentials, hashes and common secret query
parameters are removed. Prompts, private object payloads, recovery material
and private keys are never part of a shell link or workspace snapshot.
