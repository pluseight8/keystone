# Приватные переговоры агентов

Сервис переговоров добавляет слой поверх `AgentMailbox`. Доверенные
Personal Agent могут выбрать общий вариант, пока факты для оценки остаются у
своих владельцев. Центрального координатора нет: host-agent создаёт сессию,
а существующий зашифрованный P2P mailbox доставляет подписанные сообщения
после reconnect.

## Объекты

- `AgentNegotiation` / `NegotiationSession` — участники, стратегия, срок,
  ссылка на Room и metadata ограничений;
- `NegotiationProposal` — ограниченный список `PUBLIC` или
  `USER_EXPLICIT` вариантов, включая counter-proposal;
- `NegotiationResponse` — accept, reject, abstain или counter с ID вариантов и
  производным значением `EXACT`, `RANGE`, `BOOLEAN`, `SCORE` или `REDACTED`;
- `NegotiationResult` — подписанный host-ом итог;
- `NegotiationPolicy` — `ASK_EVERY_TIME`, `ALLOW_SAFE_NEGOTIATIONS`,
  `ALLOW_FROM_TRUSTED_AGENTS`, `DENY` и локальные квоты.

Стратегии: `UNANIMOUS`, `MAJORITY`, `BEST_SCORE`, `FIRST_COMMON`,
`HOST_DECIDES`. Жизненный цикл включает proposal, counter-proposal,
подтверждение, отказ, cancel, leave, expiry, offline/reconnect и restart.

## Граница приватности

`NegotiationConstraint` содержит только id, label, data class, disclosure и
`localOnly: true`; поля со значением нет. Локальный evaluator читает
разрешённые источники пользователя и возвращает короткий производный ответ.
Значения `PRIVATE` и `SECRET` не попадают в wire, snapshot, audit или Room.
Переговоры не дают доступа к Memory, RAG, tools, files или capabilities.

Ответы проверяются по размеру, data class и ID вариантов. Core отклоняет
приватные маркеры, неизвестные варианты, повторный голос и сообщения от
неучастника. Prompt и контекст Room считаются untrusted.

## P2P и persistence

`AgentMailbox.sendNegotiation()` использует существующий зашифрованный на
ключ получателя envelope `ai.agent_social`. Mailbox обеспечивает подпись,
recipient binding, contact verification, expiry, replay protection и durable
outbox; negotiation добавляет подписанный sender/recipient payload и dedup.
При offline envelope остаётся в очереди для `flush()`.

Snapshot хранит только сессии, публичные proposals, производные responses,
результаты, policy, replay IDs и metadata audit. Private evaluator state не
сохраняется. Mobile UI показывает входящие/активные/завершённые сессии,
участников, стратегии, disclosure, результаты и approval controls.

Real-network suite запускает Alice, Bob и Charlie отдельными процессами:
Bob выключен при создании сессии, затем reconnect-ится, локально оценивает
proposal и возвращает производный ответ. Alice получает общий вариант.
Serialized production envelope проверяется на отсутствие локальных значений;
controlled integration дополнительно проверяет replay, dedup, quota и restart.
