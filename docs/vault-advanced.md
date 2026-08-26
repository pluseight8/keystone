# Advanced Vaults

Advanced Vaults keeps Markdown as the portable source of truth. `DailyNoteService`,
`VaultTemplateService`, `VaultBookmarksService`, `VaultQuickSwitcherService`
and `VaultTaskIndexService` are bounded local services on top of the existing
`VaultService`; sidecars are disposable and may be encrypted by the host.

Daily notes use configurable folders, date/filename formats and a Markdown
template. Calendar, task and activity references are inserted as ordinary
Markdown references. Templates expand only declared scalar variables; there is
no JavaScript, shell, filesystem or tool evaluation.

Bookmarks are references, not permissions. They can point at notes, headings,
blocks, searches, graph queries, canvases, folders or Keystone objects. The
quick switcher searches local indexed titles, aliases, headings, tags and
bookmarks with a bounded fuzzy result set.

Tasks remain Markdown checkboxes (`[ ]`/`[x]`). Due dates, priority, tags and
references are indexed locally. Conversion to a WorkItem is explicit and adds
only a source marker; no WorkItem is created automatically.

Desktop and mobile consume typed host adapters. An uninstalled adapter yields a
readable “not configured” state rather than a fake filesystem or server.
