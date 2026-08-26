# Совместимость со старыми секретами

 сохраняет старые identity-fixture и migration-входы, но не оставляет их
границей полномочий в production.

## Production-граница

Production-код использует `SecretHandle`, scoped `SecretCapability`,
`IdentitySigningCapability`, `DeviceSigningCapability` и typed crypto-host API.
`IdentityManager.devicePublicIdentity()` — безопасная metadata-only проекция для
startup и transport wiring. `CapabilityEnvelopeSecurity` связывает эту metadata
с typed signer и не принимает `DeviceSessionKeys`.

Старые `masterSeed`, `sessionKeys()`, `deriveSessionKeys()`,
`generateSessionKeys()`, `addDevice()` и `SelfEnvelopeSecurity` помечены как
deprecated compatibility API. Им нужен настоящий
`LegacySecretCompatibilityBoundary`; обычный config, remote payload, agent,
skill, browser, renderer, tool или network handler не могут его создать.
`PRODUCTION` отклоняется во время выполнения. Vitest-мост оставлен только для
детерминированных fixture и определяется по маркеру изолированного Vitest
worker; он не читает `NODE_ENV`, `VITEST` или любой другой environment/config
flag.

`DeviceSessionKeys` — legacy-представление. Его приватные поля
неперечисляемы, а `toJSON()` возвращает только публичную metadata. Нельзя
помещать его в snapshot, envelope, task artifact, context snapshot, log,
metric, crash report или UI model.

Epoch-ключи приватных Shared Space и Shared Vault подчиняются тому же правилу:
в runtime они запечатаны device-scoped snapshot-ключом перед сохранением;
snapshot содержит только authenticated ciphertext и metadata эпохи. State store
без device-bound host не сохраняет key material и fail-closed для операций,
которым он нужен. Shared Space принимает старое plaintext-поле только как
ограниченный in-memory migration input и сразу переписывает его; reader
Shared Vault игнорирует старое plaintext epoch-поле и потому fail-closed,
не восстанавливая старую authority.

## Миграция

`LegacySecretMigrationService` принимает bytes только внутри явно названного
`MIGRATION`-контекста, импортирует их в `SecureSecretHost` и возвращает только
opaque `SecretHandle`. Временная копия bytes очищается после импорта.
Ограниченная migration-запись содержит digest, handle id и время; это даёт
идемпотентный retry и optional rehydrate durable host. Ошибка не включает
постоянный legacy fallback.

Старый cold-backup module — только direct migration tooling. Его внутренний
snapshot с seed имеет metadata-only `toJSON()` projection, а seed попадает в
authenticated encrypted container, но не в inspection metadata backup.

Нельзя заявлять secure deletion файлов, если это не гарантирует host-платформа.
Audit записывает operation, caller, purpose, environment и время, но никогда не
значения секретов.

## Правило для Plugin и AI

Главный package entrypoint не экспортирует `MasterSeed`, `DeviceSessionKeys`,
`AddDevicePayload` и `parseAddDevice`. Будущие PluginHost/Skill/Agent API должны
получать только capability-oriented metadata и handles; legacy identity module
нельзя импортировать. Private context и tool results по-прежнему проходят
существующие AI egress и redaction boundaries.

Security-тесты проверяют production deny, forged boundary, безопасную
сериализацию, idempotent migration и рабочий typed signing.

## Аудит callsites

`PRODUCTION_REQUIRED`: `devicePublicIdentity()`, typed identity/device signers и
`ImmutableCore` теперь работают с metadata/handles.

`MIGRATION_ONLY`: `exportMasterSeed()`, `createAddDeviceUri()`, `addDevice()`,
`captureColdBackupState()` и старый cold-backup import требуют именованный
compatibility context.

`TEST_ONLY`: `packages/core/src/**/*.test.ts` и distributed/real-network
fixtures используют Vitest boundary; raw-поля неперечисляемы.

`LEGACY_UNUSED`: `SelfEnvelopeSecurity` без typed signer и прямые
`DeviceSessionKeys` consumers оставлены deprecated для миграции, но убраны из
generic package exports.

Старые широкие re-export и enumerable serialization были unsafe bypass и
удалены. Social/media/agent-конструкторы, которые ещё упоминают deprecated
тип, не могут получить его через обычный production `IdentityManager`.
