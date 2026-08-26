# Security Lockdown

`SecurityLockdown` — явное fail-closed состояние при неопределённой целостности. Запрещены identity signing, P2P, privileged Agent, plugin runtime, security-sensitive settings, secret export, trusted update mutation и обычный private-key unlock. Сохраняются только ограниченные технические metadata ошибки; private content и secrets не попадают в отчёт.

UI предлагает только `INSPECT_FAILURE`, `VERIFY_AGAIN`, `REPAIR_HOST`, `VERIFY_RECOVERY_ARTIFACT`. После новой успешной проверки состояние очищается; кнопки и remote claims не могут его обойти. При отсутствии core shared/public surfaces и privileged operations остаются недоступны.
