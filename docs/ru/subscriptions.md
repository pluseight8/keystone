# Ленты, подписки и подкасты

Subscriptions — это local-first reader для явно выбранных владельцем RSS 2.0,
Atom 1.0 и JSON Feed, а также явную работу с podcast/audio. Capability
реализована в `packages/core/src/subscriptions.ts` и доступна desktop/mobile
только через typed host projections. Это не central aggregator, crawler,
proxy, recommendation engine, рекламная поверхность или cloud inbox.

## Владение и lifecycle

Subscription — явная связь владельца с одним canonical HTTP(S) feed URL.
Keystone локально хранит subscription, folders, bounded feed metadata,
read/favorite state и явное состояние downloads. Внешний origin остаётся
authority для содержания. Subscribe, pause, resume, unsubscribe, refresh,
mark read, favorite, save в Web Library, открыть origin, share и
continue-on-device — отдельные действия.

Первый успешный refresh создаёт тихий baseline: существующие items получают
`READ` и не создают уведомлений. Позднее новые items получают `UNREAD`. 304
оставляет историю без изменений. Ошибка refresh сохраняет cached entries и
показывает typed error/backoff state; локальные данные не стираются.

Retention ограничен на feed и глобально. Favorites, ссылки Web Library и
явно скачанные episodes сохраняются при обычной очистке истории. Per-feed
timer не создаётся: `FeedRefreshScheduler` вычисляет bounded due set, а host
сам решает, когда его запускать.

## Direct fetch boundary

`FeedFetchClient` — единственная внешняя HTTP boundary для feeds:

- direct GET с фиксированным Keystone user agent, без cookies, Keystone
  identity, Authorization и credential material;
- bounded redirects; запрет credential-bearing URL, небезопасных schemes и
  downgrade HTTPS→HTTP;
- блокировка loopback, link-local, RFC1918, ULA и `.local`, пока владелец
  явно не разрешит private-network доступ для этой subscription;
- timeout, лимиты response/decompressed body и redirect count;
- ETag/Last-Modified conditional refresh и 304;
- typed local errors для 401/403, 429, 5xx, timeout, TLS, offline и malformed
  response.

Feed requests не идут через сервер Keystone. Link на feed внутри страницы не
вызывает ни subscribe, ни fetch автоматически.

## Parser и content safety

Bounded parser принимает RSS 2.0, Atom 1.0 и JSON Feed по response content.
URL проверяются на credentials и credential-like query parameters; ограничены
XML depth/elements/attributes/text, JSON nesting и item count. DTD, ENTITY,
NOTATION и другие unsafe XML declarations отклоняются. HTML summary/content
проходит Web Library sanitizer до попадания в durable state. Scripts, event
handlers, forms, unsafe links и live remote resource behavior не исполняются.
Reader evidence показывает ноль external requests, script executions и form
submissions.

OPML import — network-free bounded preview с последующим explicit owner
confirmation. Он показывает invalid/duplicate URLs, сохраняет nested folder
paths, отклоняет external entities и экспортирует subscriptions без secrets.
Feed discovery — только proposal: bounded page HTML превращается в typed
alternate-feed candidates; subscribe/fetch не выполняются.

## Podcasts и media

RSS enclosures, Atom enclosure links и JSON Feed attachments сначала являются
только metadata. Download выполняется только после явного выбора владельца.
Audio/video downloads используют ту же direct HTTP boundary, byte limits,
redirect/SSRF checks, Range/resume, content-addressed local storage и
integrity metadata. Executable MIME отклоняется. Auto-download выключен по
умолчанию; при включении на feed он ограничен числом episodes. Playback
доступен только для проверенного local content через host media runtime;
position — локальная metadata. Background microphone/camera/media indexing не
добавляются.

## Cross-surface projections

- Web Library получает только explicit `saveArticle`; immutable offline capture
  и safe reader revision принадлежат ему.
- Universal Inbox имеет optional `subscriptions` source badge и показывает
  только unread items feeds с включённой notification policy. Это metadata
  projection, а не authority источника.
- Daily Layer использует bounded `feed` source только при явном включении
  владельцем. Если изменений нет, правильный результат — тишина.
- Device Continuity передаёт typed article/podcast reference и optional
  position только после explicit action. Owned-device sync не превращается в
  central feed database.
- Desktop/mobile получают safe metadata/reader projections через host
  adapters; при отсутствии adapter UI показывает unavailable.

Feed content — untrusted source material, а не implicit AI context, memory
input, plugin authority или permission grant. Любое будущее AI-использование
должно быть explicit bounded local operation или пройти существующую egress
policy.

## Validation

```sh
pnpm test:subscriptions
pnpm --filter @keystone/core lint
```

Focused suite проверяет parser/security, persisted-state tampering,
conditional refresh, baseline/read semantics, Inbox policy, OPML/discovery,
podcast download и настоящий loopback HTTP server через production-shaped
`FetchFeedHttpTransport`. Scale proof проверяет 1 000 feed entries и 256
subscriptions без per-feed timers. Текущий validation host — **Omarchy (Arch
Linux-based distribution)**, Node v22.23.2, pnpm 9.15.0, engine `>=22 <23`;
apt, dnf, GNOME, Flatpak и установка системных пакетов не предполагаются.

Central aggregation, provider accounts, recommendations, ads, proxying и
background media ingestion остаются вне scope.
