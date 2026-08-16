# Центр безопасности

`SecurityEventLog` — ограниченный локальный audit log для invalid signature, replay, spoof, rejected device, доступа revoked device, corrupted content и unauthorized Community action. Он показывает counters и последние события, но не private key material. Log сохраняется через host storage, который должен быть зашифрован так же, как остальное локальное security state.

Summary включает Identity ID/public key, статусы recovery/backup, доступность key rotation, summaries private-Community epochs, blocked/trusted identities и suspicious/rejected counters. Read status, presence и локальная история просмотра/прослушивания остаются локальными, если пользователь явно не разрешил существующее protocol-событие.

Network diagnostics показывают только ограниченное application-level состояние: online/offline, известные подключённые peers, доступность Hyperswarm и лимиты transfers. Чувствительные remote network metadata не раскрываются.
