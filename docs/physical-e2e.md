# Physical E2E evidence

Physical tests are separate from deterministic adapter tests. Every result has
an explicit classification: `REAL`, `SIMULATED`, `SAME_HOST`, `HARDWARE`,
`BLOCKED` or `UNSUPPORTED`, plus a method, timestamp and limitations.

The current Linux harness exercises real filesystem/process primitives and a
framed loopback `LocalNetworkTransport`. The latter is a **same-host local
network test**, not a two-device Wi-Fi or Ethernet claim. Controller/device
presence probes do not imply that a scan, capture or connection was started.

No probe advertises a social Identity. Radio, USB and LAN endpoint identifiers
remain transport-local and opaque. Native media probes do not persist frames or
audio.
