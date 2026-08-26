# Инварианты безопасности

`pnpm test:security` проверяет, что unclassified shared/public content не попадает на защищённые поверхности, SAFE-attestation отправителя не переопределяет policy получателя, личные данные не уничтожаются, generative AI не обязателен, AI/remote Agent/Skill не отключают Mandatory policy, blocked content не возвращается через индекс, token не выдаёт capability, а изменение bytes делает старый token недействительным.

Malformed payloads, Unicode/zero-width input, forged attestations, stale tokens, oversized data, replay и prompt-injection-like content приводят к reject/quarantine, а не к обходу Safety.

Обязательная локальная граница до privileged runtime — подписанное Immutable Core. Trusted startup и privileged operations невозможны без проверенного manifest, hash critical-файлов, обязательных policy references и rollback decision. Critical mismatch переводит систему в SecurityLockdown; mutable user data намеренно не входит в release integrity root.

Zero-trust protocol boundary означает, что remote bytes проходят bounded framing и schema validation до передачи consumer; signatures используют domain separation; replay, stale revisions, tombstones и epochs монотонны; downgrade protocol/crypto запрещён; NetworkResourceGovernor ограничивает unknown peers. Protocol validation не заменяет обязательный SafetySurfaceGate.

Malware/untrusted-content boundary ограничивает incoming bytes и сначала помещает их в quarantine; actual type проверяется независимо от extension/MIME; archive имеют limits expansion/path/symlink/recursion; media/document decoders — typed host boundaries; scanner/parser failure остаётся unknown/quarantined; preview — derived non-active artifact; release возможен только по свежему owner intent для exact hash. `CLEAN` не даёт execution authority, а полученный content не открывается, не устанавливается и не выполняется автоматически.
