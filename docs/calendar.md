# Keystone Calendar

Calendar is a generic, local-first Keystone object layer. It is not a second messaging, files, Spaces, Workboards, or scheduler system. A `Calendar` owns signed `CalendarEvent` objects; events keep stable IDs and may reference a WorkItem, Shared Space, FileObject, Track, Video, Live, or any other permitted Keystone object without copying it.

## Core model

`CalendarService` persists calendars, events, revisions, participants, reminders, invites, recurrence exceptions, and conflict state through the host's durable store. Identities are opaque cryptographic identity IDs; no people, names, roles, or central username registry are built into the model. `SharedCalendarService` only applies the same model with shared visibility.

Events use IANA timezone IDs and UTC instants, with bounded daily/weekly/monthly/yearly expansion. DST transitions are resolved at occurrence time. Exceptions edit, move, or delete one occurrence; expansion always has a hard bound and never materializes an infinite series.

RSVP responses are actor-bound and revisioned. Replayed or unauthorized responses are rejected. Workboard due dates can point to the canonical CalendarEvent via `calendarEventId`.

## Reminders and host boundaries

Calendar does not schedule itself. `ChronosCalendarReminderScheduler` adapts the existing Chronos scheduler, and `CalendarNotificationBoundary` adapts local notifications. Recurring reminders are scheduled only for a bounded horizon and fired occurrence IDs are durable. A native/desktop host installs these adapters after identity and storage bootstrap.

## Permissions and privacy

Membership and permissions are independent from private Messages, Memory, Files, Spaces, and Agent state. The permission set includes `VIEW_EVENTS`, `VIEW_FREE_BUSY`, create/edit/delete scopes, invite/member management, and calendar administration. Disclosure is explicit: `FULL_EVENT`, `TITLE_ONLY`, `FREE_BUSY`, or `HIDDEN`. Free/busy responses contain derived intervals only and never event titles, locations, participants, or attachment metadata. Attachment references remain locked unless the existing File/Content permission boundary authorizes them.

Agent Bot may query events or derived availability through the existing capability and confirmation boundary. A write returns `AGENT_SUGGESTION` until the owner confirms; only a confirmed action returns `OWNER_CONFIRMED_DECISION`.

## P2P replication

`CalendarReplicationService` uses the existing authenticated Hyperswarm/Noise `Transport` and `EnvelopeSecurity`. Calendar events are signed, revisioned, bounded, deduplicated, replay-protected, and queued while a peer is offline. Applying an event checks the calendar membership/permission policy before changing local state. Concurrent stale writes produce a durable `CalendarConflictState` instead of silently dropping data. Reconnect and restart recover the durable snapshot and pending events.

Links are `keystone://calendar/<calendar-id>` and `keystone://calendar/event/<event-id>`. Routers must run their normal permission check before opening a link.

## UI

Desktop exposes Day, Week, Month, and Agenda views, shared-calendar selection, timezone context, common-time action, and a side panel. Mobile has its own Calendar screen and view selector. Both are host-adapter surfaces: they never invent or duplicate event state. English/Russian copy is selected by the existing language setting.

Keystone remains non-commercial: Calendar contains no payments, advertising, marketplace, subscriptions, or monetization paths.
