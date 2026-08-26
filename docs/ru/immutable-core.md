# Immutable Core и доверенный запуск

Keystone проверяет подписанное ядро выпуска до запуска любого privileged runtime. Граница включает bootstrap целостности, release/update verifier, MandatoryPolicyRoot, корни Safety/ToolPolicy, AI egress, валидаторы протоколов, crypto profile, capability enforcement, sandbox, quarantine и settings authority.  также запрещает secret export, private-key unlock и provider credential use в LOCKDOWN; model/Skill/plugin не могут открыть secret host.

Host передаёт `ReleaseTrustRoot` только с идентификатором и публичными данными проверки. Приватный release key не входит в приложение. Typed `IntegrityManifest` описывает release/build/platform/architecture, время, минимальную policy epoch, security profile, verifier, policy/protocol references и hash/size/trust class/required для файлов.

Стадии монотонны: `UNVERIFIED → MANIFEST_VERIFIED → CORE_FILES_VERIFIED → POLICY_VERIFIED → ROLLBACK_VERIFIED → TRUSTED_CORE_READY → PRIVILEGED_RUNTIME_READY`. Ошибка подписи, critical hash/size mismatch, несовместимый policy/protocol/security profile или rollback переводит core в `SecurityLockdown`. Mutable user state не входит в release root без отдельного signed package.

Dev build явно отображается как `DEVELOPMENT_BUILD`, а remote `official=true` не даёт никаких прав. `IdentitySecretAccess` возвращает только typed signing capability после `TRUSTED_CORE_READY`, без private key.
