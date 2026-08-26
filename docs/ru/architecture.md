# Архитектура

Keystone — локальная платформа: общий Core владеет Identity, политикой,
контрактами данных и авторизацией, а host предоставляет узкие возможности
операционной системы. Провайдеры и peers дают доступность, но не полномочия.
Архитектура рассчитана на работу одного человека на одном устройстве и на
синхронизацию разрешённых устройств и людей без обязательного сервиса
Keystone.

## Инварианты

1. Keystone не требует собственного облака, сервиса аккаунтов, hosted-базы,
   сборщика telemetry или поставщика моделей.
2. `packages/core` владеет политикой и доменными данными, но не получает
   ambient-доступ к файлам, браузеру, процессам, радио или secure storage.
3. Models, plugins, страницы Web, imported files, remote peers и ответы
   провайдеров — недоверенные входы.
4. Локальная запись сохраняется, даже если маршрут недоступен. Разрешённые
   реплики догоняют состояние позже; репликация не заменяет ACL.
5. Identity, authorization и confidentiality независимы от транспорта.
6. Каждая capability имеет типизированный scope, лимиты, жизненный цикл и
   честное состояние ошибки. Правила ОС, батареи, температуры и background
   исполнения являются окончательными.

## Слои системы

```text
web / desktop / mobile / browser companion
                    │
        shared UI и host-boundary adapters
                    │
             packages/core
 Identity · objects · policy · consent · search
 sync · content · AI · Chronos · WebRTC control
                    │
       typed host capabilities и providers
                    │
   OS storage/process/media/browser/network primitives
```

Зависимости направлены внутрь. Core не зависит от React, Tauri, Expo,
GeckoView, WKWebView, конкретного desktop environment или сетевой технологии.
Host подключает реализации контрактов, которые можно тестировать без запуска
рендера и оборудования.

## Поверхности и host

### Desktop

Desktop на Tauri объединяет React renderer и native host. React отвечает за
отображение и состояние взаимодействия. Tauri/Rust владеет allowlist команд,
выбором папок, secure storage, проверкой обновлений, уведомлениями,
глобальными сочетаниями, браузером и другими OS-capabilities. Через команды
передаются только скопированные типизированные значения: raw handles,
произвольный процесс, shell и generic input не проходят в renderer.

Renderer считается потенциально скомпрометированным Web-контентом. Навигация,
IPC-аргументы и чувствительные действия повторно проверяются в native host.
[Desktop shell](desktop-shell.md) — слой навигации по каноническим объектам, а
не дополнительное доменное хранилище.

### Mobile

React Native и Expo дают общие navigation/UI, а custom native modules
реализуют возможности, которых нет в Expo Go. Android и iOS предоставляют
общие typed contracts там, где это допускают их правила, но не обещают
одинаковый background, storage или permission behavior. Mobile P2P учитывает
жизненный цикл платформы и работает прежде всего на переднем плане.

### Web и Browser Companion

Web-shell подходит для разработки и отображения, но не заменяет keychain,
embedded inference, свободный доступ к файловой системе или OS automation.
Browser Companion передаёт только ограниченную проекцию страницы через
loopback boundary. Host проверяет origin, subprotocol, pairing token, форму и
размер. DOM, URL и extracted text считаются недоверенными; cookies и
authorization headers в Core не передаются.

`packages/browser-engine` владеет узким host-контрактом браузера. Tauri,
GeckoView и WKWebView подключают одинаковые операции, а native host ограничивает
evaluate доверенной first-party automation:

```ts
interface BrowserEngine {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  inject(payload: ConfirmedBrowserPayload): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
}
```

P2P-данные используют `inject()` и не становятся исполняемым browser code.
Контракт не выдаёт Core, plugin или renderer свободный доступ к DOM, cookies,
session или процессам.

## Доменная композиция

Канонические владельцы данных разделены:

- Identity и OwnerAuthority подписывают объекты, claims устройств и scoped
  actions.
- Доменные сервисы владеют записями и ревизиями: Vault, Tasks, Files,
  Contacts, Calendar, Messages, Mail projections, Places, publications и
  media libraries.
- `ContentManifest` и content cache владеют неизменяемыми проверенными
  bytes. Индекс функции или album не становится второй byte store.
- Yjs и typed replication adapters согласуют разрешённое durable state.
  Формально корректный update всё равно проходит проверку объекта.
- Search и Daily Layer хранят локальные projections и references, но не
  source authority.
- Chronos планирует ограниченные notifications или одобренные действия;
  reminder не является неявным разрешением на выполнение.

Подробная модель продукта описана в [Продукте](product.md), а границы
хранилища — в [Files](files.md), [Documents](documents.md), [Photos](photos.md),
[Web Library](web-library.md) и [Capture](capture.md).

## Доставка и транспорт

Приложения отправляют objects и replication updates через
`KeystoneDeliveryInterface`:

```text
application object
        ↓
подписанный зашифрованный transport-independent envelope
        ↓
Keystone delivery / ConnectivityFabric
        ↓
Adaptive Route Optimizer и delivery profile
        ↓
transport provider
        ↓
NativeHost / OS primitive
```

Приложения не выбирают Bluetooth, Wi‑Fi, Hyperswarm, gateway или DTN.
`ConnectivityFabric` выбирает допустимый provider и хранит route state
локально. Provider переносит opaque payload; подробности см. в [Сети
Keystone](connectivity.md).

Reachability — наблюдение, а не receipt. Локальное принятие, постановка в
очередь, принятие provider, проверка и применение на destination — разные
этапы. Timeout не означает автоматически «доставлено», а retry не должен
повторять уже применённую операцию.

## Данные и файлы

Files — metadata и immutable revisions, bytes которых используют общее
content-addressed хранилище. Shared Folders добавляют membership, epochs,
roles и distributed sync вокруг Files. Desktop binding — явная capability
выбранной владельцем папки с bounded relative operations; mobile использует
picker или app storage. Path и content hash не являются authorization.

Documents читают ревизии File через ограниченные adapters. PDF, EPUB, Markdown
и plain text — данные. OCR, thumbnails, video frames и edit renditions —
производные, их нельзя использовать как permission или изменить source.
Web Library сохраняет статическое выбранное содержимое Web, а Capture только
предлагает destination и не создаёт вторую копию.

## Identity, sharing и social state

Identity криптографична, а доверие к устройству устанавливается явно. Profile,
Contact, nearby endpoint, relay peer, collaborator и owned device — разные
сущности. Contact помогает организовать людей, но не разрешает операцию.
Membership общей сущности проверяется по role, invitation и epoch; участник
папки не становится доверенным устройством автоматически.

Приватные сообщения используют шифрование для получателя и локальное
хранилище. Public/shared objects используют подписанные ревизии и явную
видимость. Relay может переслать opaque traffic, но не становится author,
recipient или ACL authority.

## AI и расширения

Local AI — необязательная host-capability. Context выбирается по scope и
фильтруется по permission и data class. External AI — явный egress adapter и
не получает неявно Vault, Memory, Contacts, Mail, Tasks, Documents, Capture,
Location или private Files.

[Plugins](plugins.md) работают за изолированной host boundary. Manifest request
не является grant, output недоверен, а provider integration не наследует Core
authority. Skills — декларативные процедуры, а не executable plugins. Обе
границы подчиняются OwnerAuthority, ToolPolicy, SafetySurfaceGate и NativeHost.

## Platform и evidence

Текущая development/validation distribution — **Omarchy (Arch Linux-based
distribution)**. Это не dependency Keystone и не доказательство физической
поддержки Windows, macOS, Android или iOS. Архитектура не предполагает GNOME,
Flatpak, apt или dnf.

Термины evidence и таблица platform readiness находятся в [Релизе и
доказательствах](release.md), а рабочий процесс — в [Разработке](development.md).
