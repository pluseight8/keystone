# Vault portability

Keystone keeps Markdown notes and ordinary attachments as the durable Vault
source of truth. Daily notes, templates, tasks, properties and links use
portable Markdown/frontmatter conventions; saved queries, bookmarks, graph
projections, Canvas state and collaboration metadata are bounded derived
sidecars.

Opening the Vault in another Markdown editor remains safe: note text and
ordinary links remain readable, while Keystone-only views degrade to their
stored definition or plain text. Losing a derived index or collaborative cache
does not delete user Markdown. A later open rebuilds local indexes from the
files that remain.

Private Shared Vault epochs and pending replication are host-encrypted sidecar
state. They are never exported as plaintext content. Export/import boundaries
must preserve object references and permissions rather than copying private
content into public indexes.
