# Keystone Links

Keystone Links are typed references, not bearer capabilities.

## Supported form

```text
keystone://profile/<object-id>
keystone://chat/<object-id>
keystone://space/<object-id>
keystone://file/<object-id>
keystone://agent/<object-id>
keystone://media/<object-id>
```

The same reference can be opened from a Chat, Community, Home card, pane or
workspace. It continues to identify one underlying Keystone object. The shell
does not copy media metadata into another surface.

## Authorization

`KeystoneLinkRouter` validates the scheme, known kind, bounded ID and host
permission callback before a tab is opened. Private, revoked or deleted
objects produce a locked result (or are rejected by the host). Knowing a link
does not disclose the object or bypass a Community, conversation, file or
Identity permission.

External web URLs are routed to the Browser surface. The Browser surface has
no implicit access to Keystone private context, Memory, Files, chats, or tools.

## Drag and drop

Desktop surfaces use `application/x-keystone-ref` with the minimal typed
reference payload. A drop routes through the same link/permission path. A
malformed payload is ignored and reported locally; no untrusted drag data is
executed as JavaScript or a plugin command.

## Persistence safety

Only object kind, bounded ID, display label and visibility may be persisted for
a tab. URL credentials, hashes and common secret query parameters are removed.
Prompts, private object payloads, recovery material and private keys are never
part of a shell link or workspace snapshot.
