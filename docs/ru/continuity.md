# Continuity устройств и handoff

Device Continuity — явный слой **Отправить на устройство** и **Продолжить на
устройстве**. Он передаёт между уже доверенными личными устройствами
ограниченный типизированный intent/reference. Это не второй протокол
синхронизации и не новая authority для enrollment или trust.

## Контракт

`ContinuityService` находится над существующими границами
`PersonalDeviceMesh` и `KeystoneDeliveryInterface`/`ConnectivityFabric`:

```text
host UI -> typed Continuity host adapter -> ContinuityService
        -> PersonalDeviceMesh: trust + epochs
        -> KeystoneDeliveryInterface / Fabric
        -> authenticated recipient-encrypted envelope
```

Сначала локально сохраняются outbox и inbox, затем выполняется попытка
доставки. Недоступный route не блокирует локальное действие. Retry использует
ограниченный backoff и восстанавливается после restart. Приём envelope
провайдером не равен application delivery receipt: запрос остаётся pending,
пока устройство-получатель не проверит, расшифрует, применит и не подтвердит
его.

У запроса есть стабильный request ID, source/target device IDs, action, expiry,
счётчик попыток и статус `QUEUED`, `SENDING`, `DELIVERED_TO_DEVICE`, `OPENED`,
`ACCEPTED`, `FAILED`, `EXPIRED` или `CANCELLED`. Повторы deduplicate-ятся;
старые epochs, revoked devices, stale requests и неверные capability claims
отклоняются.

## Типизированные references

Поддерживаются `file`, `vault`, `document`, `browser`, `place`, `route`,
`mail`, `publication`, `collaboration`, `messaging`, `workspace` и явно
подтверждённый `clipboard`. В payload находится только минимальный reference и
ограниченный continuation context: позиция документа/Canvas/Workboard,
viewport карты, mail thread/message, revision публикации, URL и scroll
браузера или ограниченный layout workspace. Секреты, credentials provider,
browser cookies/tokens, shell commands, executable content, remote input,
screen capture, live location, текущая навигация и произвольные plugin
instructions недопустимы.

File handoff передаёт signed/content-addressed reference, а bytes остаются в
`DistributedContentService`; большой blob не вкладывается в envelope.
Browser handoff содержит только безопасный URL. Maps передаёт place или
snapshot маршрута, но не текущую геопозицию и live navigation. Mail передаёт
account/thread/message identity и ограниченную subject metadata, но не
credentials. Collaboration и publication references не дают access, edit
rights или publication authority.

## Устройства и capabilities

Записи `PersonalDeviceMesh` рекламируют ограниченный набор continuity capabilities и грубое
наблюдение availability. Picker различает trusted, revoked, pending, offline и
recently available. Отсутствующая capability означает unsupported, а unknown
не является гарантией. Revocation сразу запрещает новые отправки и делает
старые epoch envelopes недействительными.

## Clipboard policy

Automatic clipboard continuity по умолчанию **выключена**. Clipboard handoff
короткоживущий, ограничен по размеру и требует явного подтверждения владельца.
Получатель может показать explicit clipboard surface, но Continuity никогда не
делает auto-paste в terminal, browser, form или message composer и не создаёт
базу истории clipboard.

## Host boundary

Desktop и mobile показывают только typed local projections: picker устройств,
статусы, inbox, open/cancel, retry и clipboard policy. Native host устанавливает
adapters для key material, OS storage, route setup и application open handlers.
Keystone остаётся platform-neutral; Omarchy (Arch Linux-based distribution) —
только текущая development/validation environment, Node v22.23.2, pnpm 9.15.0,
package engine `>=22 <23`.

Continuity не добавляет central cloud, gateway authority, remote shell,
remote desktop/input, screen capture, wipe, передачу секретов или implicit
clipboard synchronization.

## Проверка

Controlled tests проверяют E2E ciphertext, capabilities и revocation,
offline queue/restart, deduplication, hostile references, clipboard consent,
10 000 ограниченных requests и 1 000 endurance cycles. Реальный network
harness использует два независимых Hyperswarm/Noise процесса и проверяет online
delivery, offline queue, reconnect и revocation. Полный release gate остаётся
общим repository suite: `tsc`, unit, integration, network, performance,
security, build, `release:check` и `git diff --check`.
