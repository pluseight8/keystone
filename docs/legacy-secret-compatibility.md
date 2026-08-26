# Legacy secret compatibility

Legacy compatibility keeps older identity fixtures and migration inputs without keeping them
as a production authority boundary.

## Production boundary

Production code uses `SecretHandle`, scoped `SecretCapability`,
`IdentitySigningCapability`, `DeviceSigningCapability`, and the host crypto
interfaces. `IdentityManager.devicePublicIdentity()` is the metadata-only
projection intended for startup and transport wiring. `CapabilityEnvelopeSecurity`
binds that metadata to a typed signer without accepting `DeviceSessionKeys`.

The old `masterSeed`, `sessionKeys()`, `deriveSessionKeys()`,
`generateSessionKeys()`, `addDevice()`, and `SelfEnvelopeSecurity` paths are
deprecated compatibility APIs. They require a real
`LegacySecretCompatibilityBoundary`; an ordinary config value, remote payload,
agent, skill, browser, renderer, tool, or network handler cannot create one.
`PRODUCTION` is rejected at runtime. The Vitest bridge exists only to keep
deterministic fixtures source-compatible and is detected from Vitest's isolated
test-worker marker, never from `NODE_ENV`, `VITEST`, or another environment/config
flag.

`DeviceSessionKeys` is a legacy view. Its private fields are deliberately
non-enumerable and its `toJSON()` returns public metadata only. It must never be
placed in a snapshot, envelope, task artifact, context snapshot, log, metric,
crash report, or UI model.

Private Shared Space and Shared Vault epoch keys follow the same rule. Their
runtime values are sealed with a device-scoped snapshot key before persistence;
snapshots contain only authenticated ciphertext and epoch metadata. A state
store without a device-bound host omits the key material and fails closed for
operations that require it. Shared Space accepts its older plaintext field only
as a bounded in-memory migration input and rewrites it immediately; the Shared
Vault reader ignores a legacy plaintext epoch-key field and therefore fails
closed rather than restoring old authority.

## Migration

`LegacySecretMigrationService` accepts bytes only inside an explicit named
`MIGRATION` boundary, imports them into a `SecureSecretHost`, and returns an
opaque `SecretHandle`. The temporary byte copy is cleared after import. A
bounded migration record contains only a digest, handle id, and timestamp; it
supports idempotent retry and optional durable host rehydration. Failed imports
do not enable a permanent legacy fallback.

The legacy cold-backup module is direct migration tooling only. Its internal
seed-bearing snapshot has a metadata-only `toJSON()` projection, and the seed
is placed in the authenticated encrypted container rather than backup
inspection metadata.

Do not claim filesystem secure deletion unless the platform host can guarantee
it. The compatibility layer records operation, caller, purpose, environment,
and time, never secret values.

## Plugin and AI rule

The package entrypoint does not re-export `MasterSeed`, `DeviceSessionKeys`,
`AddDevicePayload`, or `parseAddDevice`. Future PluginHost/Skill/Agent APIs must
receive only capability-oriented metadata and handles; they must not import the
legacy identity module. Private context and tool results remain subject to the
existing AI egress and redaction boundaries.

Security tests cover production denial, forged boundaries, non-enumerable
serialization, migration idempotence, and continued typed signing.

## Audit inventory

| Classification | Remaining paths | Decision |
| --- | --- | --- |
| `PRODUCTION_REQUIRED` | `IdentityManager.devicePublicIdentity()`, typed identity/device signers, `ImmutableCore` unlock | metadata and capabilities only; raw session derivation is internal and host-backed when a `SecureSecretHost` is supplied |
| `MIGRATION_ONLY` | `IdentityManager.exportMasterSeed()`, `createAddDeviceUri()`, `addDevice()`, `captureColdBackupState()` and legacy cold-backup seed import | explicit named compatibility context; audited and fail-closed |
| `TEST_ONLY` | `packages/core/src/**/*.test.ts`, distributed/real-network fixtures | Vitest-only compatibility bridge or explicit test boundary; raw fields are non-enumerable |
| `LEGACY_UNUSED` | `SelfEnvelopeSecurity` without a typed signer, direct `DeviceSessionKeys` consumers | deprecated; no generic package re-export and no normal production injection |
| `UNSAFE_PRODUCTION_BYPASS` | old broad identity/secrets re-exports and enumerable session-key serialization | removed: root exports are narrowed, transport/redaction inspect secret-shaped fields, and `DeviceSessionKeys.toJSON()` exposes metadata only |

Social/media/agent constructors that still mention the deprecated type are
compatibility consumers. They cannot obtain a key object from a normal
production `IdentityManager` call; only a migration or test boundary can
produce the legacy view.
