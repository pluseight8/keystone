# Резервная копия и восстановление

Backup Keystone — это локальный зашифрованный экспорт для восстановления установки без центрального аккаунта и облачного сервиса. Это граница переносимости, а не сетевой sync-протокол.

## Контейнер

В Phase 28 используется контейнер `keystone.backup` версии 2. Во внешнем manifest находятся только:

- формат и версия;
- время создания;
- приблизительный размер зашифрованной нагрузки;
- названия включённых секций;
- признак включённого cache.

Manifest аутентифицируется как AEAD associated data. Payload шифруется libsodium XChaCha20-Poly1305-IETF. Recovery secret передаётся через явную host boundary и не записывается в backup, manifest, логи или результат inspection. Материал master seed Identity находится только внутри аутентифицированного ciphertext, чтобы восстановленная установка получила ту же Identity.

Неверный secret, изменённые manifest/ciphertext, неподдерживаемая версия и обрезанный файл отклоняются до записи в restore target. Restore сначала staging-ит временное состояние и только затем делает атомарный commit.

## Секции и policy

Policy по умолчанию включает identity/security, application state, settings, social graph, conversations, Communities, зашифрованное состояние private Community, media metadata, library/playlists, notifications и pinned/storage references. Временный cache/chunks по умолчанию не переносится: его можно снова получить через content-addressed P2P layer.

Доступны четыре независимых переключателя:

| Policy | Значение |
| --- | --- |
| `identitySecurity` | seed Identity (внутри ciphertext), trusted devices и security events |
| `applicationState` | settings и durable social/application stores |
| `userOwnedMedia` | пользовательские файлы и media references |
| `cache` | временный cache/chunks; включается отдельно |

Состояние private Community экспортируется как существующие encrypted-at-rest records. Plaintext group key не добавляется в API backup. Read/unread, settings и cache не публикуются peers после восстановления.

## Поток восстановления

1. Host просит пользователя создать или ввести recovery secret в безопасной boundary.
2. Host записывает/читает `.keystone` bytes в выбранное пользователем локальное место.
3. Keystone показывает manifest без раскрытия private content.
4. Restore расшифровывает и проверяет секции, затем staging-ит пустой profile.
5. Host делает commit, после чего Identity выводится из восстановленного seed.

После подключения нового устройства старую установку следует отозвать в списке Devices. Backup сам по себе не удаляет старое устройство: revoke остаётся явным подписанным действием Devices.

## Не входит в scope

Нет обязательного cloud backup, центрального account recovery, telemetry, платежей, рекламы, marketplace или server-side media cache. Media bytes можно не включать; content-addressed references при этом сохраняются и позволяют получить данные по P2P.

Основная реализация: `packages/core/src/sync/backup-recovery.ts`. Старый cold-backup API для Yjs/config архивов оставлен без изменений.
