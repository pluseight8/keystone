# Security Center

`SecurityEventLog` is a bounded local audit log for invalid signatures, replay attempts, spoof attempts, rejected devices, revoked-device access, corrupted content and unauthorized Community actions. It exposes counts and recent events without private key material. The log is host-persisted and should use the same encrypted local storage boundary as other security state.

The summary includes Identity ID/public key, recovery/backup status flags, key-rotation availability, private-Community epoch summaries, blocked identities, trusted identities and suspicious/rejected counters. Read status, presence and local watch/listen history remain local unless an existing protocol explicitly carries a user-authorized event.

Network diagnostics intentionally expose only bounded application-level state: online/offline mode, known connected peers, Hyperswarm availability and transfer limits. Sensitive remote network metadata is not shown.
