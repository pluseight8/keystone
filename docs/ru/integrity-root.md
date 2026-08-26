# Integrity root

`IntegrityRoot`/`ReleaseTrustRoot` — host boundary, а не mutable настройка. Он содержит public verification key, key id, environment и verifier callback. Production signing key хранится в release infrastructure и не генерируется и не сохраняется в репозитории.

Подпись manifest покрывает canonical JSON всех полей кроме `signatureMetadata`. Каждый required critical entry читается через `IntegrityFileReader`, проверяется SHA-256 и размер. Policy/protocol maps должны соответствовать entries; при наличии `MandatoryPolicyRoot` его immutable references обязаны совпадать.

Trust classes: `IMMUTABLE_CORE`, `TRUSTED_RUNTIME`, `SANDBOXED_EXTENSION`, `USER_CONTENT`, `UNTRUSTED_REMOTE_DATA`, `UNTRUSTED_MODEL`. Recovery допускает только inspect/verify/repair/authenticated artifact; ignore/continue отсутствует.
