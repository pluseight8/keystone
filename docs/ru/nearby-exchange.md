# Nearby Exchange

Nearby Exchange — first-class поверхность анонимного one-hop обмена. Владелец
может предложить typed object nearby endpoint без центрального directory,
сервера или обязательного Internet. Discovery не называет человека, не
создаёт Contact, не enroll-ит устройство и не устанавливает trust. Получатель
сам явно выбирает, что принять.

## Граница архитектуры

```text
Desktop/mobile projection
        -> NearbyExchangeService
        -> AnonymousNearbyTransportProvider / NearbyLinkAdapter
        -> ConnectivityFabric
        -> выбранный transport provider
```

`NearbyExchangeService` переиспользует существующий nearby provider. Он
не создаёт второй Bluetooth stack, не выбирает BLE/Wi-Fi/Hyperswarm и не
показывает пользователю route picker. Единственной high-level authority
доставки остаётся Fabric. Nearby frames — зашифрованные opaque envelopes;
endpoint handles, session keys и raw native transport identifiers остаются ниже
host boundary.

Desktop и mobile получают только projections endpoint, offer и transfer. В UI
не попадают private keys, transport handles, manifests, chunks и полученные
bytes. Если native/core adapter не подключён, поверхность сообщает
unavailable, а не подменяет её UI-only реализацией.

## Objects и consent

Поддерживаются typed exchange objects:

- `file` — ограниченная копия, никогда не source access. Файлы используют
  manifest/chunk/resume путь `DistributedContentService`, а content и
  chunk hashes проверяются до `RECEIVED`.
- `text`, `url`, `place`, `route`, `publication` — ограниченные previews или
  references. Place и route — snapshot, а не live location fix, proximity
  measurement или история движения.
- `contact` — раскрываются только выбранные поля. Создание Contact — отдельное
  явное действие владельца.
- `collaboration` и `document` — режимы `COPY` и `GRANT_ACCESS` различаются;
  копирование не выдаёт доступ, а access grant не превращается в копию молча.

Offer виден до принятия и имеет короткий TTL. Получатель может использовать
`NOT_ACCEPTING`, `CONTACTS_ONLY`, `TEMPORARILY_VISIBLE` или `ASK_EVERY_TIME`.
Обычный flow — явный offer и затем accept/reject. Статусы различают consent,
ожидание route, verification, receipt, cancellation и failure.

Receive QR — короткоживущий одноразовый scoped bootstrap context. В нём нет
Profile QR data, private key, password, secret, social graph или общего права
enrollment устройства. Profile QR остаётся отдельным feature/protocol.

## Privacy и safety

Nearby discovery намеренно не показывает точный GPS, расстояние по RSSI,
историю встреч, Bluetooth address, public identity или глобальный граф «люди
рядом». Видимый endpoint имеет ephemeral local session ID, capabilities,
короткий verification code и expiry. Identity disclosure выбирается по полям,
а Add Contact требует отдельного явного действия.

Receive не открывает URL, не исполняет file, не устанавливает plugin, не
запускает command, не импортирует Contact, не enroll-ит device, не вызывает
agent и не публикует content автоматически. URL и contact links проверяются и
остаются действиями пользователя. Имена files sanitise-ятся; preview, MIME,
EXIF и прочие metadata — untrusted и не authority. Принятый file остаётся
локальной копией и не становится executable только из-за accept.

State bounded: endpoints, sessions, pending offers, deduplication, fragment
reassembly, active transfers, content bytes, batch size и явная transfer history
имеют независимые лимиты. Terminal live projections compact-ятся, а bounded
history сохраняется. Durable state содержит только проверенные ограниченные
offer/transfer projections и history; это не anonymous peer или encounter
database.

## Evidence и platform boundary

У Nearby Exchange разные классы evidence:

| Evidence | Значение |
| --- | --- |
| Controlled | Deterministic in-process protocol, consent, hostile-input и scale tests. |
| Hybrid / implemented | Два независимых localhost-процесса проверяют реальную session cryptography и exchange через framed loopback adapter; это не physical Bluetooth evidence. |
| Physical Bluetooth | Нужны powered/permissioned native controller, production BlueZ data adapter и второй физический Keystone peer. При отсутствии условий результат `BLOCKED_BY_ENVIRONMENT`, а не simulated success. |

Текущий development/validation host — **Omarchy (Arch Linux-based
distribution)**, Node v22.23.2, pnpm 9.15.0, package engine `>=22 <23`.
Omarchy не становится dependency Keystone. Проверки не предполагают apt, dnf,
GNOME или Flatpak и не устанавливают системные пакеты для Nearby Exchange.

## Implementation references

- Core contract/service: [`packages/core/src/nearby-exchange.ts`](../../packages/core/src/nearby-exchange.ts)
- Controlled fixture и scale: [`packages/core/src/testing/nearby-exchange-fixture.ts`](../../packages/core/src/testing/nearby-exchange-fixture.ts), [`packages/core/src/testing/nearby-exchange-scale.test.ts`](../../packages/core/src/testing/nearby-exchange-scale.test.ts)
- Hybrid two-process proof: [`packages/core/src/testing/nearby-exchange-real-network.test.ts`](../../packages/core/src/testing/nearby-exchange-real-network.test.ts)
- Physical evidence boundary: [`packages/core/src/testing/nearby-physical-evidence.test.ts`](../../packages/core/src/testing/nearby-physical-evidence.test.ts)
- Desktop projection: [`apps/desktop/src/desktop-nearby-exchange-runtime.ts`](../../apps/desktop/src/desktop-nearby-exchange-runtime.ts)
- Mobile projection/surface: [`apps/mobile/src/nearbyExchangeRuntime.ts`](../../apps/mobile/src/nearbyExchangeRuntime.ts), [`apps/mobile/app/nearby.tsx`](../../apps/mobile/app/nearby.tsx)
