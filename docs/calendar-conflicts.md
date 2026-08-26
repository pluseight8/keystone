# Calendar conflicts and revisions

Every CalendarEvent has a stable ID and monotonic local revision. Updates carry an optional `baseRevision` and produce a signed `CalendarEventRevision` with a compact patch and model-independent snapshot. Snapshots allow stale bases to be reconstructed after restart without relying on backend-specific cache state.

When both local and incoming changes modify the same field from the same base, `CalendarConflictResolver` creates a durable `CalendarConflictState` containing current and incoming events, the base revision, and the conflicting fields. The service does not silently choose a winner. Authorized owners/editors may keep current, accept incoming, or provide a validated merged event.

Non-overlapping changes merge deterministically. Deleted-versus-modified events remain an explicit `deleted_modified` conflict. RSVP updates are participant-bound and revisioned separately through the event object, so an unrelated title edit does not authorize another identity's response.

Replication rejects malformed IDs, invalid signatures, unauthorized actors, replayed envelopes, stale regressions, and events for calendars the local identity cannot read. Tombstones are retained in durable state so delayed peers cannot resurrect deleted calendars or events.
