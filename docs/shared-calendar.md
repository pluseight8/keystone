# Shared calendars

Shared calendars are ordinary Keystone Calendar objects with signed memberships. A member receives only the permissions and disclosure granted by the calendar owner or an authorized manager. `VIEW_FREE_BUSY` does not imply access to titles or event payloads; `VIEW_EVENTS` is still required for event details.

Invites are signed objects addressed to the invitee and delivered over the existing P2P replication path even before membership exists. Accepting an invite creates a membership and replicates the revised calendar. Removing a member tombstones membership and immediately blocks future writes; old local data remains governed by the host's retention policy.

Shared calendar replication is offline-tolerant and generic: arbitrary identity IDs, any number of members, reordered delivery, restart, duplicate events, stale revisions, and concurrent edits are handled without hardcoded Alice/Bob/Charlie assumptions. A conflict is explicit and can be resolved by an authorized editor/owner.

A shared calendar is not a private Community, Message group, Shared Space, or Agent room. Those systems keep their own permissions and encryption. Event attachments are references to existing objects and never grant file access. A shared calendar may link a Workboard/WorkItem or Space, but following a link still invokes that object's core permission check.

Production delivery uses `CalendarReplicationService` over Hyperswarm/Noise. Controlled transport remains appropriate for deterministic fault tests. Hosts should expose connection cleanup through the existing Transport lifecycle.
