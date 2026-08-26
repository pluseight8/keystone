# Tasks, Reminders and Personal Planning

`TaskService` in
`packages/core/src/tasks.ts`. It is local-first, permission-aware and
platform-neutral. It is not a second Workboard, Calendar or Chronos store.

## Canonical model

`TaskService` owns bounded personal `TaskList` and `Task` records. Every record
has a branded stable ID, revision, timestamps and tombstone state. The built-in
`task-list:inbox` is private and cannot be deleted. Tasks support title/note,
tags, priority, start/due dates, typed references, assignee, stable fractional
ordering and bounded subtasks (maximum depth 8). Search is local and indexed;
list queries expose Inbox, Today, Upcoming, Overdue, Completed, Someday,
Assigned to me, Shared and Trash views with bounded pagination.

`TaskDate` distinguishes date-only values from timed values. Date-only tasks
retain calendar semantics in the owner timezone; they are not silently treated
as midnight UTC instants. Quick capture is deterministic English/Russian
parsing with a preview and ambiguity marker. It never executes task text and
does not require AI.

## Recurrence and reminders

Recurrence is represented on one task rather than materializing an unbounded
future task stream. Fixed schedules and completion-relative schedules support
bounded daily, weekly, monthly and yearly rules, occurrence history, limits and
an end date/count. Completing or skipping an occurrence advances the same task.

Reminder delivery is a typed `TaskReminderScheduler` adapter over the existing
Chronos host. `TaskService` owns reminder records and reconciliation, while
Chronos owns durable wake-up/delivery scheduling. There is no per-task timer.
Delivery is idempotent by stable task/reminder/revision identifiers, never
auto-completes a task, and missed reminders are bounded/coalesced. Notification
actions are explicit: complete, snooze or open. SECRET references use generic
notification copy.

## Sharing and own-device sync

Private lists are owner-only. Shared lists use OWNER, EDITOR and VIEWER roles,
explicit invitations, bounded expiry, membership epochs and revocation. Task
replication events are typed, optionally signed and checked for actor, list,
revision, epoch, invitation and identity scope. Stale epochs, replayed event
IDs, cross-list payloads and unauthorized actors fail closed.

The same replication adapter can target `ownerDeviceRecipients` for other
devices controlled by the same owner identity. This is an optional transport
boundary, not a cloud dependency or a new device-mesh protocol. Offline state
remains usable and peers catch up through their existing delivery mechanism.
Shared Yjs collaboration is exposed through the collaboration port as a
bounded adapter; it does not duplicate collaboration authority.

## References, projections and integrations

Tasks store typed references to existing Keystone objects (`file`, `vault`,
`web-library`, `mail`, `message`, `place`, `calendar-event`, `work-item`, and
others). A reference is provenance, not permission: `openReference` delegates
availability and authorization to the source resolver, and SECRET references
stay private.

Calendar receives projections and explicit time-block creation through its
existing adapter. Workboards receive explicit card creation, and Workboard
items can be imported as a Task with a typed `work-item` reference. Daily Layer
receives a bounded private Tasks source. Universal Inbox receives only open
tasks assigned to the current owner; personal Tasks do not become a second
Inbox feed.

Agent/AI code receives no automatic task context. Owner selection is required,
source permissions still apply, and task text is always data. There is no
automatic extraction of Tasks from arbitrary documents, mail, pages or AI
output, no location reminder feature and no productivity score/streak layer.

## Host surfaces

Desktop exposes `desktop-tasks-runtime.ts` and a first-class Tasks tab,
quick-capture preview, smart views, completion/trash actions and a detail
projection. Mobile exposes `tasksRuntime.ts` and `/tasks`; the compatibility
`/vault-tasks` route points to this same canonical surface. Both renderers are
optional host projections and show an adapter boundary when `TaskService` is
not installed. Neither renderer creates a store, timer, calendar event or
replication transport.

## Validation

Focused checks are available through:

- `pnpm test:tasks` — lifecycle, parser, reminders, sharing, integrations,
  security, scale and multi-process replication proof;
- `pnpm test:integration`, `pnpm test:network`, `pnpm test:performance` and
  `pnpm test:security` — task security is included in the existing release matrix;
- `pnpm --filter @keystone/core lint`, plus desktop/mobile lint for host
  projections.

The declared development/validation environment is **Omarchy (Arch Linux-based
distribution)** with Node v22.23.2, pnpm 9.15.0 and package engine `>=22 <23`.
Keystone remains platform-neutral; Omarchy is not a required dependency.
