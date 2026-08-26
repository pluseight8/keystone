# Сеть Keystone

**Сеть Keystone** — общая управляемая пользователем граница связи продукта.
Это не одна радиосистема, сервер или provider. Keystone подключается тем
способом, который доступен: напрямую между доверенными устройствами, через
локальную сеть, через ближайшие точки, с отложенной доставкой или через
настроенный relay. Если маршрута пока нет, durable local work может подождать.

Интернет помогает Keystone, но не нужен для локальной работы, локального
поиска, планирования, cached content и связи между устройствами, у которых
есть другой путь.

## Модель доставки

Приложения отправляют objects и replication updates через одну границу:

```text
application object
      ↓
подписанный и зашифрованный transport-independent envelope
      ↓
KeystoneDeliveryInterface
      ↓
ConnectivityFabric
      ↓
Adaptive Route Optimizer и delivery profile
      ↓
transport provider
      ↓
NativeHost / OS primitive
```

Приложения не выбирают Bluetooth, Wi‑Fi, Hyperswarm, gateway или отложенную
доставку. `ConnectivityFabric` отбирает provider по security, capability,
resource policy и delivery requirement и владеет framing, fragmentation,
retry, deduplication и stale-route handling. `FabricTransport` — временная
compatibility facade для сервисов, которые переходят на тот же interface.

Provider получает только opaque уже защищённый frame. Он не получает plaintext,
Identity keys, social policy или authorization. Смена транспорта не меняет
Identity, confidentiality и права на объект.

## Доставка состоит из этапов

Fabric может сообщить local acceptance или provider acceptance. Ни одно из них
не является application receipt. Важны разные состояния:

1. локальная операция принята и сохранена;
2. работа поставлена в очередь;
3. provider принял opaque frame;
4. destination проверил и применил object;
5. destination вернул protocol receipt.

Timeout не становится автоматически «доставлено». Local outbox продолжает
работать при отсутствии маршрута, retry использует bounded backoff, а уже
применённая операция не исполняется повторно.

## Delivery profiles

Profile описывает требование, а не технологию:

| Profile | Назначение |
| --- | --- |
| `CONTROL` | Небольшие control/configuration messages. |
| `INTERACTIVE` | Ограниченный ответ, который видит пользователь. |
| `REALTIME` | Короткая сессия звонка или live signalling. |
| `EVENTUAL` | Durable retry до policy deadline. |
| `DELAY_TOLERANT` | Явно отложенная доставка через bounded custody. |
| `BULK` | Files, media и другой ограниченный content transfer. |
| `BACKGROUND` / `BEST_EFFORT` | Низкоприоритетная локальная работа. |

Сначала проверяются security, profile, resource и metered constraints, и только
потом качество маршрута. Быстрый небезопасный путь не является fallback.

## Пути и providers

### Прямой P2P

Hyperswarm discovery и Noise-encrypted sessions дают основной прямой путь.
HyperDHT может помочь rendezvous при сложном NAT/firewall. Live session key не
является социальной Identity; application messages по-прежнему используют
подписи, expiry, replay protection и шифрование для получателя.

### Локальная сеть

Infrastructure Wi‑Fi и Ethernet используют одинаковую семантику
`LocalNetworkTransport`: bounded framing и opaque envelopes. Wi‑Fi Direct —
отдельный provider со своими правилами ОС и lifecycle. Same-host loopback proof
не доказывает физический обмен между устройствами.

### Nearby и multi-hop

Nearby Exchange использует короткие anonymous sessions и typed capabilities.
Он переносит явно принятую копию или reference, но не создаёт Contact,
trusted device или social relationship. Ограниченная multi-hop forwarding может
использовать nearby sessions без раскрытия application plaintext.

Unknown peers могут ограниченно ретранслировать traffic, не будучи друзьями,
Contacts или collaborators. В интерфейсе они не показываются как люди рядом.

### Отложенная доставка

Store-and-forward хранит opaque parcel в пределах TTL, copy budget, размера и
resource class. Custody не означает trust, а possession не означает
authorization. Просроченная или отозванная работа удаляется по local retention
policy; relay не расшифровывает и не толкует parcel.

### Gateway

Узел с более широким путём Keystone может передать ближайшему узлу короткую
anonymous forwarding capability. Gateway пересылает исходный opaque frame в
собственный Fabric и не может расшифровать, подписать заново, авторизовать или
придумать destination receipt.

Gateway не является VPN, web/HTTP proxy, TCP/UDP forwarder, open proxy или
способом получить произвольный Internet. Он принимает только Keystone opaque
frames и ограниченные delivery requirements.

### Распределённая доставка контента

Files и media используют content-addressed manifests и проверенные chunks через
ту же delivery authority. Metadata может прийти раньше bytes. Cache и source
sets локальны, ограничены quota и могут очищаться по policy. Content hash
проверяет integrity и помогает найти bytes, но не выдаёт authorization.

## Выбор маршрута

`AdaptiveRouteOptimizer` принадлежит Fabric. Он работает с ограниченным набором
зарегистрированных providers и сначала проверяет:

- confidentiality и integrity envelope;
- совместимость profile, live/eventual и metered policy;
- resource и battery constraints;
- защиту от циклов composition;
- свежие локальные measurements, если они есть.

Route cache мал и локален: один primary и ограниченное число backups. Confidence
стареет, advertised hints не важнее свежих measurements, hysteresis не даёт
маршруту переключаться из-за шума. Реальная ошибка разрешает secure backup без
изменения исходного envelope или его authorization. Route state не является
telemetry, reputation, social graph или topology database.

## Relay и профили ресурсов

Если platform capability и permission позволяют, bounded participation в Сети
Keystone и relay являются поведением протокола. Обычный продукт не рекламирует
переключатель для отключения участия.

Профили ресурсов:

- **Сбалансированное** — обычные фоновые и relay budgets;
- **Экономия энергии** — меньшие интенсивность, расписание и transfer budgets;
- **Максимальная доступность** — более широкая, но ограниченная возможность
  принять участие в пределах host.

Профиль меняет интенсивность работы, storage, bandwidth и расход батареи, но
не меняет существование корректного сетевого пути. OS permission, battery,
thermal и background restrictions главнее; Keystone их не обходит. Если host
не может участвовать, UI показывает unavailable, а durable local work остаётся.

Relay обязателен как поведение протокола, но не требует неограниченной жертвы
ресурсами. Relay, route, custody, replay и cache state имеют admission limits,
TTL, quota и cleanup; outbox и receipts владельца не вытесняются чужим traffic.

## Anonymous transport plane

Anonymous nearby и relay sessions используют rotating ephemeral transport
identities, минимум routing metadata, opaque encrypted payloads и bounded
lifetime/resource budgets. Они не создают social Identity, global topology,
точную GPS-запись или Contact. Посредник всё же может видеть неизбежные timing,
примерный размер traffic, encounter timing или endpoint metadata; абсолютная
анонимность не обещается.

Transport endpoint, relay peer и nearby endpoint — не люди. Social Identity,
ownership и authorization устанавливаются application envelope и local policy,
а не маршрутом.

## Внешние сетевые границы

Некоторые поверхности намеренно используют собственные provider boundaries:

- Mail работает с IMAP/SMTP или JMAP владельца; Fabric не является Mail proxy.
- RSS, Atom и JSON Feed обновляются ограниченным прямым HTTP(S)-запросом к
  выбранному origin; центрального aggregator нет.
- Browser открывает внешний Web через host, а Web Library сохраняет выбранный
  статический content вместо proxy живой страницы.
- Optional media providers остаются внешними sources и не превращаются в CDN
  Keystone.

External provider сохраняет собственные authority и видит нужные его протоколу
metadata. Он не становится Identity, authorization или storage authority
Keystone.

## Location не является связью

Location — private typed capability от OS/native provider. Нужен just-in-time
owner-authorized scope: one-shot, foreground или явно подтверждённый background,
с approximate или precise resolution. Отказ показывается как unavailable. Нет
fallback через IP, Wi‑Fi fingerprint или relay metadata.

Maps использует geographic places и routes, а Network — connectivity routes.
Один тип маршрута не доказывает другой. Network participation не выводит текущую
позицию, историю перемещений, Home/Work или людей поблизости.

## Platform и evidence

Текущая development/validation distribution — **Omarchy (Arch Linux-based
distribution)**. Это не dependency Keystone и не превращает наблюдение на host
в поддержку другой платформы. Сеть не предполагает GNOME, Flatpak, apt или dnf
и не устанавливает system packages в project checks.

Evidence разделяет controlled tests, same-host/loopback runtime checks и
physical device verification. Обнаруженный controller не доказывает
двусторонний Bluetooth exchange, а реальный Hyperswarm proof не доказывает
каждое radio или mobile background behavior. См. [Релиз и доказательства](release.md)
и [Разработка](development.md).

## Язык интерфейса

В обычном интерфейсе используйте последствия: «Подключено», «Качество
соединения», «Связь поблизости», «Синхронизация в фоне», «Доступно на этом
устройстве», «Ожидание маршрута». Имена providers, peer IDs, route scores и
topology относятся к developer diagnostics.

Для технического английского термина *mesh network* используется **Мэш-сеть**;
для общего продукта — **Сеть Keystone**. Рекомендуемые термины: «Связь»,
«Подключение», «Локальная сеть», «Ретрансляция», «Шлюз», «Отложенная доставка»
и «Качество соединения».
