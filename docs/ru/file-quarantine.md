# Quarantine файлов

Полученные FileObjects, browser downloads и завершённые P2P transfers обязаны пройти через `FileContainmentService`/typed host boundary до обычного release файла. Сохраняются identity источника, object/transfer IDs, hash, заявленные metadata, сгенерированный quarantine path и `ContentProvenanceChain`.

Состояния fail-closed:

`RECEIVING → QUARANTINED → INSPECTING → INSPECTED → PREVIEW_ELIGIBLE → OWNER_RELEASED`.

После ошибки остаются `TRANSFER_FAILED`, `INSPECTION_FAILED`, `BLOCKED` или `KNOWN_MALICIOUS`. Restart никогда не превращает незавершённую проверку в clean. Release требует свежий `OwnerRequestedFileReleaseIntent`, exact object ID/hash, expiry, owner identity и risk acknowledgement для executable/high-risk. Agent, Skill и plugin release выполнить не могут.

`UserReleasedFileObject.executableAuthority` всегда false; запуск потребует отдельной native capability и confirmation boundary.

Facade containment выдаёт owner release service только если native host при
создании привязал текущий owner Identity ID. Произвольное поле
`ownerIdentityId` не превращается в release authority.

В реальном Hyperswarm suite есть synthetic malicious peer: он подписывает fixture PE с именем изображения. Bob получает тот же FileObject ID, проверяет hash, оставляет bytes в quarantine, определяет critical mismatch и не создаёт preview. Реальные malware/exploit payloads не используются.
