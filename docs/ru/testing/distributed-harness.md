# Распределённый test harness

`pnpm test:integration` создаёт независимые Alice, Bob и Mallory: отдельные
identity, temporary directory, durable social/community files, runtime state и
`Transport` endpoint. `ControlledNetwork` умеет restart/offline/partition,
queue, reorder, duplicate и malformed input.

Используются production `DirectMessageService`, `CommunityService`, подписи,
encrypted DM, schemas, content hashes и `PersistentSocialStorage`. Адаптер
заменяет только физический Hyperswarm socket, поэтому это не доказательство
интернет/Hyperswarm/WebRTC interoperability.

Быстрый unit suite запускается через `pnpm test`, а распределённый — через
`pnpm test:integration`; CI запускает их отдельными jobs.

## Граница приватности сообществ

`CommunityReplicationService` пока реплицирует только `public` communities.
Envelope аутентифицирует отправителя, но не реализует group-key distribution,
исключение участника и rotation ключей; передача `contacts` community раскрыла
бы body события на link. Поэтому сервис безопасно отказывает до появления и
проверки encrypted group transport. Личные сообщения остаются
recipient-encrypted.
