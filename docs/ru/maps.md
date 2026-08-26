# Maps, Places и Navigation

Keystone Maps — privacy-first и local-first поверхность для географических
данных. Это доменный сервис в `packages/core/src/maps.ts`, а не authority
геолокации, selector транспорта, vendor SDK или hosted map backend.

## Границы

- Карта открывается и отображается без permission геолокации. Текущая позиция
  доступна только после явного действия владельца через grant-путь
  `LocationService`.
- Для «показать мою геопозицию» и поиска достаточно one-shot grant, если хватает
  precision. Для активной turn-by-turn navigation нужен foreground precise grant.
- Navigation стартует только после явного подтверждения владельца, владеет
  bounded foreground watch и освобождает его при завершении, revoke,
  interruption или shutdown. После crash navigation не возобновляется сама.
- IP, Wi-Fi fingerprint, browser geolocation, silent precise read, история
  перемещений, inference Home/Work, geofencing, people tracking, Find My,
  реклама и sponsored ranking в Maps отсутствуют.
- Maps получает только границы `LocationService` и
  `KeystoneDeliveryInterface`. Он не импортирует raw transport, Hyperswarm,
  native location и не создаёт центральный Keystone location service.

## Places и sharing

`Place` — portable provider-aware объект со стабильным `placeId`, названием,
необязательными координатами или approximate region, address/category,
bounded public metadata и явной provenance. Provenance различает local data,
offline data, external provider, user-created place, полученную Keystone
reference и publication data.

Saved places и collections — локальные durable objects. Они отделены от live
location и не выводятся из движения. User-created или полученное место может
быть представлено ссылкой:

```text
keystone://place/<encoded-place-id>
```

URI — reference, а не authorization token. Place share — явный application
envelope. Private share использует recipient E2E encryption; public share всё
равно идёт через signed delivery boundary. Передаётся только выбранный
portable `PlaceReference`; current location отправителя, location fix и
movement history отклоняются. Messages, Spaces, Calendar, Collaboration,
Workboard и Personal Web могут переносить URI без копирования объекта.

## Provider policy

`MapProviderRegistry` разделяет `LOCAL`, `OFFLINE` и `EXTERNAL` providers и
типизированные capabilities для map data, search, geocoding, routing и
offline packages. Local и установленные offline providers имеют приоритет.
External provider рассматривается только при явном разрешении соответствующей
операции (`allowExternalMapData`, `allowExternalSearch`,
`allowExternalGeocoding`, `allowExternalRouting`). Такая операция создаёт
узкую локальную audit-запись с provider, operation и location class, но не с
identity или history перемещений.

Output provider считается untrusted и проходит bounded validation до UI.
Plugin provider не может запросить `LocationService`, current-position или
movement-like capabilities. Credentials представлены host-resolved
references; raw keys не попадают в Maps. Restricted provider data не
rehostится и не redistributится Keystone. Website links проходят external-link
gateway и принимают только безопасные публичные HTTP(S) destinations.

## Offline packages и cache

Offline package устанавливается явно, является content-addressed и проходит
integrity check до сохранения. Manifest, размер, region и число packages
ограничены. Установленный package отделён от map cache: cache — вытесняемая
LRU-подобная проекция, а package state — durable и удаляется явно. Политика
offline-only запрещает внешние map, search, geocoding и routing requests.

## Routing и navigation

`GeographicRoute` отделён от connectivity routing. Поддерживаются walking,
driving и cycling, только если их объявляет выбранный provider;
неподдерживаемый mode завершается явной ошибкой. Geometry, legs, steps,
instructions, distance и duration проверяются и ограничиваются на provider
boundary.

Navigation использует validated geographic route и foreground fixes.
Fixes проверяются по precision и freshness. Rerouting ограничен deviation,
интервалом и retry count; ошибка reroute не вызывает незаметную смену
provider. Raw coordinates не сохраняются как navigation history.

## Host surfaces

Desktop и mobile предоставляют typed host adapters. UI может открыть Maps,
искать places, показать saved places/providers/offline state, построить manual
route и вызвать явное one-shot location action. При отсутствии adapter UI
показывает честное boundary state и не придумывает GPS или provider data.

Текущий validation host — **Omarchy (Arch Linux-based distribution)** с Node
`v22.23.2`, pnpm `9.15.0` и package engine `>=22 <23`. Omarchy — только
development/validation environment, не runtime dependency Keystone и не
заявление о platform support.

## Validation

Focused validation включает controlled provider, offline-only, permission,
plugin-boundary, route-bound, cache, 10k saved-place, 100 navigation-cycle и реальный
двухпроцессный Hyperswarm place-sharing proof. Network proof проверяет, что
получатель получил именно выбранный Place reference, а application wire
остался encrypted и не содержит plaintext place payload.

Maps не добавляет cloud sync, обязательный public provider, telemetry,
оптимизацию маршрутов connectivity, location advertising или новые support
claims для Windows/macOS/Android/iOS сверх существующих host contracts.
