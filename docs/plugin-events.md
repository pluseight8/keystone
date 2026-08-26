# Plugin events

Events are an explicit allowlisted set (`object.*`, selection/workspace, connectivity, lifecycle and media metadata). Subscriptions require `events.subscribe`, a supported event and a bounded queue. Payloads are redacted, size/rate bounded and carry provenance; secret-bearing fields and route identities never cross the boundary.

Queues coalesce low-value state updates, drop excess safely, and invalidate on session/revision stop. Event delivery is not durable personal history and must tolerate offline transitions.
