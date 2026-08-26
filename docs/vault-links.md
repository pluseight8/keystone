# Vault links

Keystone indexes wikilinks (`[[Note]]`, aliases, `#Heading` and `#^block`), Markdown links and embeds. Each link retains its raw source and line, then receives `resolved`, `unresolved` or `ambiguous` status. Heading and block targets are checked against the target note rather than treated as plain text.

The link index provides outgoing links, backlinks, unresolved targets, aliases, headings, block references and mentions. Attachment paths are resolved without reading their binary payload. Missing attachments remain visible as missing host entries and can be repaired by the user.

Portable object links are:

* `keystone://vault/<vaultId>`
* `keystone://vault/<vaultId>/note/<noteId>`

Parsing a link and authorizing access are separate operations. A route must pass the host permission boundary before a note is opened. Traversal, absolute paths, control characters and malformed IDs are rejected.
