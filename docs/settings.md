# Settings Center

Settings Center is a local-first surface for privacy, network, storage,
notifications, local AI and appearance/language. Settings are versioned and
persisted by a host-supplied `SettingsStorage`; they are never put in public
discovery or a shared CRDT.

`SettingsService.bind()` connects controls to live core services. The bindings control discovery participation, local interaction history, typing/presence/read receipts, media policy, notification ingestion, transfer parallelism/bandwidth, offline transport mode and storage quota. A host should provide encrypted durable storage and install the bindings during bootstrap.

Every user-facing setting has a short consequence-oriented description and a
`Learn more`/`Подробнее` link when the consequence is not obvious. Technical
provider names, peer identifiers and route diagnostics belong in developer
mode, not ordinary settings. A setting is not presented until its effect is
implemented or explicitly marked as host-dependent.

Background synchronization, nearby discovery, bounded relay participation and
Personal Device Mesh participation (where the operating system permits them)
are baseline network behavior, not ordinary opt-out switches. Resource
profiles change intensity, scheduling, bandwidth and battery use. Nearby
discovery supports `Balanced`, `Battery Saver` and `High Availability`; the
selected profile is persisted locally and is applied to the live provider.
Profiles do not silently change the protocol's meaning. OS denial or battery restrictions are
reported and degrade gracefully; Keystone never bypasses the OS. Anonymous
one-hop nearby participation has no ordinary disable toggle. General stranger
relay and multi-hop remain future work and are not exposed as shipped settings.

The startup surface is a separate local preference: last opened, Home, Feed,
Video, Messages, Storage or a selected workspace. See [the product contract](product.md)
and [desktop shell](desktop-shell.md).

### Daily Layer

Daily Layer is an optional local projection. Its settings are stored with the
local SettingsService and have no effect on the underlying source service:

- enable/disable the projection;
- choose Calendar, Messages, Tasks, Workboards, Spaces, Files, Devices, Agent
  results, approvals and Memory sources independently;
- choose concise, normal or detailed presentation;
- choose important-only, moderate or selected-time frequency;
- choose approximate morning/day/evening/night times;
- choose a startup surface (Last opened, Home, Feed, Video, Messages, Storage,
  Calendar, Vault or a workspace).

Each source contributes bounded typed references. The layer does not copy
messages, events, tasks, files or memory into a second database. Source errors
are isolated and Home does not wait for network or AI. Daily cards are
presentation-only: opening a card rechecks permission in the owning service;
approval, privacy, security and location actions remain in their existing
OwnerAuthority boundaries. Disabling a source only removes its Daily Layer
projection and does not disable that subsystem.

The mobile screen is bilingual (English/Russian) and changes the shared `i18n` locale. The fallback runtime is deliberately in-memory for development; production hosts must install a durable adapter.

Settings are local policy controls; no setting enables a central account, cloud
backup, recommendation service, payments, ads or a marketplace.

### Location access

Location is shown only when a host installs `LocationService`. The screen
reports the OS permission state, the number of scoped grants and active share
sessions, and provides an immediate stop-sharing action. It does not offer a
global “location = true” switch: each feature requests a just-in-time
owner-authorized `ONE_SHOT`, `FOREGROUND` or explicitly confirmed `BACKGROUND`
grant with `APPROXIMATE`/`PRECISE` precision. A host without a verified adapter
reports `UNAVAILABLE`; no IP or Wi-Fi fallback is used and no location history
is written by the settings screen.
