# Agent Rooms

An `AgentRoom` is a temporary, signed workspace for several Personal Agents.
It is an object shared with an explicit member list, an expiry and a small
`sharedContext` list. The only allowed context classes are `PUBLIC` and
`USER_EXPLICIT`; private Memory, chats, files, credentials and device state
remain on their owner's device.

The owner signs the room and publishes it only to members. Each room message
is bounded, carries its sender and data class, and is accepted only when the
sender is the exact signed member agent. Replayed messages, non-members,
expired rooms and modified room signatures are rejected. Room membership is
not an implicit grant to any Keystone tool: agents still need their own visit
capability and existing ToolPolicy/approval.

Use a room for a narrow task such as comparing availability, combining public
research results or agreeing on a file hand-off. Put the conclusion or other
safe summary in `sharedContext` explicitly; do not attach an entire calendar,
Memory store or conversation history. Room state and replay metadata survive a
restart, while room expiry and owner-controlled lifecycle remain fail-closed.

The production network test creates a room owned by Alice with Bob and Charlie,
publishes it through Hyperswarm/Noise, exchanges a bounded message, and rejects
Mallory's non-member write.
