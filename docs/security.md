<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Security protocol

PII flow: requester creates a scoped `DisclosureRequest` → owner reviews fields and expiry → owner signs approval → requester reviews the exact browser action → requester signs execution approval → encrypted payload is delivered once → audit event is appended. Any mismatch in action hash, audience, nonce or expiry aborts the flow.

В production следует подключить audited crypto implementation (например, libsodium) и OS keychain. В boilerplate криптография инкапсулирована за интерфейсом `CryptoProvider`, чтобы не допустить случайного использования ad-hoc primitives.

Реализация `SodiumCryptoProvider` использует Ed25519 detached signatures, `randombytes_buf` для nonce и `crypto_generichash` (BLAKE2b) для action hash. Nonce помечается consumed после успешной авторизации; TTL ограничен пятью минутами по умолчанию.
