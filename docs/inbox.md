# Universal Inbox, Communications Hub & Action Center

Universal Inbox is a first-class local projection without a central
notification server, a second message transport, or a second authoritative
source store.
`UniversalInboxService` is a bounded local projection over typed adapters. The
source service remains authoritative for content, permissions, delivery,
invites, approvals and source mutations.

## Contract

The public contract is in [`packages/core/src/inbox.ts`](../packages/core/src/inbox.ts).
`InboxSourceRef` is a discriminated canonical reference; arbitrary JSON
pointers, serialized callbacks and source-owned action code are not accepted.
Adapters are registered once in `InboxAdapterRegistry` and produce trusted
source badges, bounded text previews and typed action hints.

Supported source families include Keystone notifications/messages, external
Mail, missed Calls, Collaboration invitations/comments, Continuity handoffs,
Nearby offers/completions, Agents, Approvals, Automation, Calendar, Workboard,
Security/System events and Personal Web archive events. The generic canonical
projection port exists for sources whose host boundary is installed later; it
does not weaken source-specific revalidation.

## Semantics

Inbox read, archive, dismiss, pin, save and snooze are local organization
state. They do not mark a Mail message read, emit a Keystone receipt, delete a
source object, accept an invitation or approve an Agent. Archive and dismiss
are not source delete/archive. Snooze uses one durable sorted wake index; the
service does not create one timer per item.

Source actions are explicit. Before execution, the adapter refreshes and
reprojects the canonical source reference and action allow-list. Expired or
revoked invitations/approvals fail closed. Mail reply creates a draft through
`MailService`; send requires an explicit owner action, the exact account and
the existing Mail idempotency/outbox boundary. Call-back never grants media
permission. Nearby stays endpoint-anonymous until its own consent flow.

`InboxNotificationProjection` is only an ephemeral OS-notification boundary;
durable Inbox state is separate. `createInboxDailySource` feeds the bounded
Daily Layer projection, so Daily does not rescan source databases.

## Offline, devices and privacy

Offline owners can list, search, filter, group, read, archive, pin, save and
snooze cached metadata. Source actions retain their source-specific live or
queued semantics. Optional owned-device synchronization carries only
organization state (`read`, `archive`, `snooze`, `pin`, `save`) with a
device/revision tie-break; source content and source authority do not cross
that boundary.

Previews are bounded text and are rendered as text. HTML, scripts, prompt
injection, giant titles, control characters, forged source badges and arbitrary
action descriptors do not acquire execution authority. External AI has no
implicit Inbox context and no automatic memory ingestion; local-AI selection is
an explicit bounded owner action.

## UX and platform boundary

Desktop and mobile expose Inbox as a first-class surface with source badges,
All/Unread/Needs action/Snoozed/Archive filters, local organization actions and
explicit source actions. They receive typed projections only; filesystem paths,
credentials, Mail bodies beyond the source preview, media permissions and
browser sessions stay behind their existing host boundaries.

The current validation host is **Omarchy (Arch Linux-based distribution)**,
Node v22.23.2 and pnpm 9.15.0. This is validation context, not a Keystone
dependency. No GNOME, Flatpak, apt or dnf assumption is part of Inbox.

## Explicit non-goals

The Inbox does not implement a central notification server, a unified messaging
transport, unified trust semantics, automatic source read/delete/accept/reply,
AI auto-reply/auto-approve, external-AI ingestion, engagement ranking,
attention scores, ads or social surveillance graphs.

## Optional Feeds source

Inbox may register the typed `subscriptions` adapter. It projects only unread
items from subscriptions whose owner enabled `notifyOnNewItems`, uses a
`FEED_ITEM` source badge and exposes navigation only. It does not turn every
feed entry into an Inbox event, does not override feed read state, and does not
fetch origins or store enclosure bytes. If the policy is disabled, the source
is absent rather than noisy.
