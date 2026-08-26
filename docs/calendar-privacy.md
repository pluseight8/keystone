# Calendar privacy

Calendar disclosure is fail-closed. A private calendar is visible only to its owner unless an explicit membership or permission grants a narrower disclosure. A private event shown through `FREE_BUSY` becomes `BUSY`; description, location, participant identities, recurrence, related object references, and attachments are removed. `TITLE_ONLY` keeps only the title and the minimum permitted participant view. Outsiders cannot search private events.

Availability APIs return signed, derived intervals (`FREE_BUSY`, `derivedOnly: true`). They do not return raw calendar objects and therefore cannot leak titles or locations while negotiating a common time. The query is bounded by a date range, participant list, duration, working hours, and result limits.

Attachment IDs are references. The Calendar surface asks the existing content/File authorization boundary before unlocking a reference; unavailable or private files remain locked. Calendar membership never grants access to a private File, Message, Memory, Space, device, or Agent state.

Search is local and permission-aware. Replication filters membership before applying objects, and public/contacts visibility never makes a private event public. Read/reminder state is local. Chronos and notification adapters receive only the minimum reminder payload needed to schedule a local notification.

Agents can receive derived availability according to their existing capabilities. External AI receives no Calendar data. A remote model can only be given an explicitly public, non-personalized subtask through the existing egress firewall.
