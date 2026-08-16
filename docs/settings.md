# Settings Center

Phase 27 adds one local-first Settings Center for privacy, network, storage, notifications, local AI and appearance/language. Settings are versioned and persisted by a host-supplied `SettingsStorage`; they are never put in public discovery or a shared CRDT.

`SettingsService.bind()` connects switches to live core services. The bindings control discovery advertisement, local interaction history, typing/presence/read receipts, media policy, notification ingestion, transfer parallelism/bandwidth, offline transport mode and storage quota. A host should provide encrypted durable storage and install the bindings during bootstrap.

The mobile screen is bilingual (English/Russian) and changes the shared `i18n` locale. The fallback runtime is deliberately in-memory for development; production hosts must install a durable adapter.

No setting enables payments, advertising, telemetry, a central account, cloud backup or a recommendation service.
