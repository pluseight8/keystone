# Native Host security / Безопасность

- Principal/provenance сохраняются через helper chains; remote provenance нельзя повысить до Core.
- Sensitive operations требуют Owner UI или trusted Core и, где нужно, explicit confirmation.
- Raw identity keys, masterSeed, session keys, credentials и recovery material не входят в API.
- Secure storage возвращает только opaque `NativeSecretHandle`; production не использует in-memory fallback.
- Notifications и external links проходят Core-owned gateways; Plugin не может impersonate Security или открыть URL в обход gateway.
- OS errors mapped to typed `NativeHostError`; logs/audit содержат metadata, не plaintext secrets.
- Live handles/session state очищаются при revoke, shutdown, suspension и sandbox termination.
- Plugin process boundary не является shell API; `shell:false`, sanitized environment, bounded lifetime/output и explicit termination.
- Linux Secret Service (`secret-tool`) используется только при успешном runtime probe; при недоступном backend secure операции остаются fail-closed. Наличие Secret Service не означает hardware-backed enclave.
- Physical evidence не раскрывает hardware IDs, IP/MAC, serial numbers или социальную Identity. Same-host network и controller probes не выдаются за multi-device P2P.

# Безопасность

- Principal/provenance сохраняются через helper chains; remote provenance нельзя повысить до Core.
- Sensitive operations требуют Owner UI или trusted Core и, где нужно, explicit confirmation.
- Raw identity keys, masterSeed, session keys, credentials и recovery material не входят в API.
- Secure storage возвращает только opaque `NativeSecretHandle`; production не использует in-memory fallback.
- Notifications и external links проходят Core-owned gateways; Plugin не может impersonate Security или открыть URL в обход gateway.
- OS errors mapped to typed `NativeHostError`; logs/audit содержат metadata, не plaintext secrets.
- Live handles/session state очищаются при revoke, shutdown, suspension и sandbox termination.
- Plugin process boundary не является shell API; `shell:false`, sanitized environment, bounded lifetime/output и explicit termination.
- Linux Secret Service (`secret-tool`) используется только при успешном runtime probe; при недоступном backend secure операции остаются fail-closed. Наличие Secret Service не означает hardware-backed enclave.
- Physical evidence не раскрывает hardware IDs, IP/MAC, serial numbers или социальную Identity. Same-host network и controller probes не выдаются за multi-device P2P.
