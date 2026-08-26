# Web Library, Read Later и offline archive

Web Library — это local-first индекс bookmark и явно сохранённых
страниц владельца. Это не central archive, browser history database, crawler,
origin proxy или автоматическая публикация.

## Core-контракт

Каноническая реализация находится в
[`packages/core/src/web-library.ts`](../../packages/core/src/web-library.ts).

```text
BrowserHostAdapter.capturePage (явное действие владельца)
    -> BrowserAgentRuntime.capturePage (origin/revision/budget boundary)
    -> BrowserRuntimeWebCaptureAdapter
    -> WebCaptureService (bounded queue)
    -> WebLibraryService (metadata + immutable revision)
    -> ContentCache / content manifests (private bytes)
    -> ReaderRenderer (static local HTML/text)
```

Только capture adapter получает representation origin. `WebLibraryService` не
вызывает `fetch`, не следует manifest, не открывает origin, не запускает
JavaScript и не отправляет формы. ConnectivityFabric не используется как Web
proxy.

Режимы явные:

- `BOOKMARK_ONLY` хранит только bounded URL metadata.
- `READER_SNAPSHOT` хранит детерминированные reader blocks и не сохраняет
  ресурсы страницы.
- `SAFE_PAGE_ARCHIVE` хранит reader representation и bounded image resources в
  private content-addressed cache.

Refresh всегда создаёт новую immutable revision и перемещает latest pointer;
старые версии остаются доступны для diff и provenance.

## Safe reader и offline policy

На capture boundary удаляются scripts, `javascript:` URLs, event attributes,
forms, iframe/object/embed/plugin, SVG scripting и CSS/chrome spoofing.
Relative links разрешаются относительно source URL без request. Reader строится
из typed `ReaderDocument`, а не из origin HTML.

Renderer не выдаёт live origin `src`, form, script или executable URL. Images
ссылаются на private content; отсутствующие assets становятся offline
placeholder. External links — только inert explicit links. Evidence-поля всегда
`externalRequestCount: 0`, `scriptsExecuted: 0`, `formsSubmitted: 0`.

Разрешены только HTTP(S)-URLs без embedded credentials. Распространённые
credential/session query keys redacted до persistence. В archive metadata нет
cookies, authorization headers, browser session, filesystem path или secrets.
Page text остаётся untrusted data и не получает authority Agent, Plugin,
NativeHost, Browser или publication.

## Organization, search и storage

Есть collections (включая `Read Later`), tags, favorites, read state, local
permission-aware search, immutable revisions, bounded line diff, highlights и
notes. Search возвращает matched fields: title, hostname, reader text, tag,
collection и annotation.

HTML и images используют SHA-256 content-addressed manifests с policy
`PRIVATE_NO_STRANGER_CACHE`. Metadata и content storage — разные
host-replaceable boundaries. Ограничены entries, revisions, collections,
annotations, HTML, blocks, resources и capture queue. Cloud archive account и
central Web Library server не требуются.

## Явные boundaries sharing

`WebLibraryShareBoundary` разделяет explicit destinations:
`OWNED_DEVICE`, `NEARBY`, `PERSONAL_WEB`.

- Continuity/owned-device передаёт archive bundle или typed document reference
  через существующую trusted-device/E2E boundary; cookies, browser session и
  remote-control command не передаются.
- Nearby — отдельная copy boundary; endpoint не становится Keystone identity,
  Contact или device enrollment.
- Vault export — явный note adapter с source URL, capture timestamp и revision
  provenance.
- Personal Web получает только intentional safe rendition через свой adapter;
  Web Library ничего не публикует и не становится origin proxy.
- Agents и plugins не получают implicit archive access; AI возможен только через
  bounded projection и существующую egress policy.

`createWebArchiveBundle`/`importWebArchiveBundle` — explicit owned-device/share
API. Import принимает content только через caller-supplied resolver, проверяет
manifest hashes, отклоняет public-cache policy и никогда не fetch-ит URL или
manifest самостоятельно.

## Host UI

Desktop projection
[`desktop-web-library-runtime.ts`](../../apps/desktop/src/desktop-web-library-runtime.ts)
показывает saved items, Read Later, collections, search, offline reader,
source/revision provenance, highlights/notes и явные share/Continuity/Vault
actions. Browser surface имеет отдельные `Save Reader` и `Save safe archive`.

Mobile использует
[`webLibraryRuntime.ts`](../../apps/mobile/src/webLibraryRuntime.ts) и route
`web-library`. UI не читает filesystem paths, browser cookies или origin pages.

## Evidence и gates

- unit/security tests проверяют bookmark/archive, sanitizer, revisions, diff,
  annotations, visibility, private manifest и integrity.
- `testing/web-library-browser-evidence.test.ts` делает capture через
  `BrowserAgentRuntime` с реальным local HTTP origin; после shutdown origin две
  offline renders не создают requests и не исполняют scripts/forms.
- `testing/web-library-scale.test.ts` проверяет 10 000 metadata, 10 000
  annotations, 100 captures и 1 000 offline reader opens.

Это loopback evidence для Browser-to-local archive; это не заявление о
физической Android/iOS browser verification. Production Browser host должен
предоставить optional typed `capturePage`; без него runtime fail-closed с
`HOST_UNAVAILABLE`.

Текущая validation environment: Omarchy (Arch Linux-based distribution), Node
v22.23.2, pnpm 9.15.0, engine `>=22 <23`. Системные пакеты не устанавливаются;
apt/dnf/GNOME/Flatpak не предполагаются.
