# Vault queries and views

`VaultQueryParser` accepts a safe, typed subset of Markdown metadata queries:
`SELECT`, `FROM notes|tasks`, `WHERE` (`AND`, `OR`, `NOT`, `CONTAINS`,
`EXISTS` and comparisons), `SORT`, `GROUP BY` and `LIMIT`. The planner rejects
costly or malformed input before scanning. Results are bounded, paginated and
cancelable.

`VaultQueryService` exposes LIST/TABLE/BOARD definitions. Table columns and
board moves call normal Vault mutations with revision checks; they do not write
an alternate database. Saved view definitions are sidecar metadata and can be
recreated from portable Markdown.

Embedded query syntax is parsed as data only. It cannot execute arbitrary
functions. `QueryFunctionProvider`, `VaultViewRenderer` and
`VaultIndexerExtension` are declaration-only extension boundaries with an
integrity hash; capability approval and host policy remain required.
