# Plugin storage

Each Plugin receives an isolated, quota-bounded `PluginStorageNamespace` with
bounded keys, paginated listing and restart-safe snapshots. Snapshot restore
recomputes serialized byte sizes and rejects tampering or quota overflow. A
Plugin cannot address another Plugin's namespace, Core databases, Vault or
SecretStore.
