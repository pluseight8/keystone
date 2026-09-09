# Разработка

Keystone разрабатывается как platform-neutral Core с узкими host adapters.
Разработка и проверка должны сохранять подписи, authorization, E2E-шифрование,
durable state, replay protection и границу доставки [Сети Keystone](connectivity.md).
Ускорение недопустимо, если оно ослабляет безопасность или жизненный цикл.

## Проверенное окружение

Текущая development/validation distribution — **Omarchy (Arch Linux-based
distribution)**. Проверенный runtime: Node `v22.23.2`, pnpm `9.15.0`, package
engine `>=22 <23`.

Omarchy не является dependency Keystone. Перед platform-specific проверкой
нужно изучить реальный host. Не следует предполагать GNOME, Flatpak, apt или
dnf. Project gate не устанавливает и не изменяет системные packages. Poppler,
Tesseract, ImageMagick, ffmpeg, Wayland clipboard utilities и другие optional
tools обнаруживаются при запуске; отсутствие даёт честный статус unavailable
или blocked.

## Установка и основные команды

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

pnpm dev
pnpm tsc
pnpm test
pnpm build
pnpm docs:check
```

Web-shell — самый быстрый цикл UI-разработки. Для Desktop нужны Rust и
предпосылки Tauri. Mobile использует development/production build, потому что
custom native modules недоступны в Expo Go; для Android нужны SDK/JDK, для iOS
— macOS/Xcode.

## Локальные owner-test артефакты

Локальный packaging workflow использует настоящий Tauri Desktop project и
native Android project. Он не создаёт production release, store-подпись или
OTA update и не меняет security behavior Keystone. Запускайте его с
проверенным runtime:

Первый usable desktop build — это обычное Tauri-окно, а не overlay: примерно
1280x800, с обычным resize/maximize/minimize и минимальным размером 900x600.
При первом запуске показывается local-first welcome, owner создаётся через
Core `IdentityManager`, сохраняется имя устройства и preference локального AI
без обращения к remote service, после чего открывается локальный Home shell.
Видимые desktop surfaces: Home, Search, Music, Video, Shorts, Local AI,
Connectivity, Capture, Tasks, Documents, Settings и Device. Music, Video и
Shorts остаются пустыми или unavailable до подключения typed host adapter со
signed object storage, content providers и decoder-backed playback; Local AI
принимает только явно настроенные localhost providers и не создаёт remote
fallback. Fake данные не используются.

```bash
mise exec node@22.23.2 -- pnpm install --frozen-lockfile
mise exec node@22.23.2 -- pnpm build:test:artifacts
```

Focused-команды:

```bash
mise exec node@22.23.2 -- pnpm build:test:appimage
mise exec node@22.23.2 -- pnpm build:test:android
```

Результаты записываются в `artifacts/local-test/`:

- `Keystone-0.1.0-local-test-x86_64.AppImage`;
- `Keystone-0.1.0-android-debug.apk`;
- `SHA256SUMS.txt` и `build-manifest.json`.

Runner использует существующий `apps/mobile/android`, если в нём есть
Gradle wrapper; Expo prebuild выполняется только при отсутствии native project.
Отсутствующие Rust/Cargo, JDK, Android SDK tools, AppImage packager или
authorized Android device записываются в manifest и не подменяются fake
артефактом. Если requested binary создать нельзя, итог —
`PARTIAL — TOOLCHAIN BLOCKED`.

На текущем Omarchy host runner передаёт `NO_STRIP=1` только дочерней Tauri
AppImage-сборке. Это обход несовместимости cached linuxdeploy с Arch ELF
`relr.dyn`, без изменения shell profile или system configuration. Linux binary
сам задаёт `WEBKIT_DISABLE_DMABUF_RENDERER=1` внутри собственного процесса до
старта Tauri; добавлять эту переменную глобально не нужно. Это workaround для
Omarchy/Wayland, а не новая Keystone dependency. Если launcher Omarchy
экспортирует `GDK_BACKEND=wayland`, но доступен XWayland, binary также выбирает
GDK X11 только внутри собственного процесса, поэтому обычный launcher path
открывает окно без shell-level override; pure Wayland host без `DISPLAY`
сохраняет native backend choice.

Для созданного AppImage запускайте из корня repository:

```bash
chmod +x artifacts/local-test/Keystone-0.1.0-local-test-x86_64.AppImage
./artifacts/local-test/Keystone-0.1.0-local-test-x86_64.AppImage
```

Если host не предоставляет AppImage FUSE, используйте
`APPIMAGE_EXTRACT_AND_RUN=1` только для этого запуска. Это packaging fallback;
Wayland/WebKit workaround уже встроен в приложение.

Desktop использует один native process и одно главное окно для каждого local
profile. Повторный запуск того же AppImage переводит фокус на существующее
окно и не создаёт duplicate window или session tabs. Дополнительные окна
появляются только после явного tear-off или new-window action. В Settings →
Layout → «Сбросить компоновку окон и вкладок» меняет только presentation:
закрывает secondary windows и оставляет одно главное окно с одной вкладкой
Home без удаления owner content или identity state.

Созданный debug APK устанавливайте только на уже authorized device:

```bash
adb install -r artifacts/local-test/Keystone-0.1.0-android-debug.apk
```

Runner не устанавливает APK на device без явного
`KEYSTONE_ALLOW_ADB_INSTALL=1`. APK является local debug/test build,
а не production/store artifact. Lightweight profile и preferences текущего
shell используют WebView local storage; native extensions и models используют
обычный platform app-local-data directory. Отдельный local-test identity
namespace не добавляется, packaging не удаляет application data; перед тестом
сделайте backup существующего состояния Keystone.

Чтобы повторить first-run setup, очистите в WebView storage Keystone ключи
`keystone.onboarding.complete`, `keystone.local.identity.v1`,
`keystone.local-ai.preference`, `keystone.local.ai-settings.v1` и
`keystone.local.discovery.v1`, затем перезапустите приложение. Capture, Tasks
и Documents хранятся под owner-scoped keys
`keystone.local.capture.v1:<owner>`, `keystone.local.tasks.v1:<owner>` и
`keystone.local.documents.metadata.v1:<owner>`; удаляйте их только при полном
осознанном reset локальных данных. Renderer хранит public identity metadata,
но не secret identity seed; для signing и device pairing нужен production
secure host с durable non-exportable key storage.

После успешной сборки проверьте launch/restart, onboarding или existing
profile, navigation и offline reopen; затем Vault, Tasks, Contacts, Files,
Documents, Capture, Browser, Mail, Photos, Maps, Search, Settings, Security
Center и AI-disabled path. На Android отдельно проверьте install, permissions,
background/resume и share-in. Отсутствующее hardware, radio, decoder,
permission или device access фиксируйте как blocked/unavailable evidence.
## Слои проверок

Для работы над отдельной областью используйте focused checks:

| Область | Команда |
| --- | --- |
| Photos и media decoders | `pnpm test:media` |
| Web Library | `pnpm test:web-library` |
| Universal Inbox | `pnpm test:inbox` |
| Feeds и podcasts | `pnpm test:subscriptions` |
| Files и Shared Folders | `pnpm test:files` |
| Tasks | `pnpm test:tasks` |
| Contacts | `pnpm test:contacts` |
| Documents и scanner | `pnpm test:documents` |
| Capture | `pnpm test:capture` |

Полный набор: `pnpm test:integration`, `pnpm test:network`,
`pnpm test:performance`, `pnpm test:security`, `pnpm build` и
`pnpm release:check`. `pnpm test:network` использует независимые процессы и
реальный путь Hyperswarm/Noise, если это позволяет host. Это не доказательство
физического radio или любого mobile lifecycle.

Термины evidence принадлежат [Релизу и доказательствам](release.md):
`DECLARED`, `IMPLEMENTED`, `RUNTIME_DETECTED`, `PHYSICALLY_VERIFIED`,
`BLOCKED_BY_ENVIRONMENT`, `UNAVAILABLE` и `UNSUPPORTED`. Runtime detection,
controlled fixture и loopback proof нельзя повышать до physical evidence.

## Runtime и ресурсы

- Background и BULK-работа не должна вытеснять interactive и security-control.
- Offline-операция сохраняет durable work и не ждёт discovery синхронно. Retry
  использует bounded backoff и восстанавливается после restart.
- Cache модели/KV/decoder можно удалить. Identity, sessions, permissions,
  Memory и authoritative user data не являются cache.
- Relay, route, replay, public-cache, watcher, parser и diagnostic state имеют
  лимиты, TTL и cleanup. Private plaintext не хранится в общем performance
  cache.
- У timer, listener, child process и native session есть owner и shutdown path.
- Performance tests используют synthetic data и стабильные seeds; важны bounds,
  cleanup и isolation, а не красивое число после ослабления timeout.

## Host boundaries

Core получает interfaces для secure persistence, clocks, notifications,
clipboard, media, browser, files, model execution и transport. Host выдаёт
только typed scoped operations и повторно проверяет principal, capability,
arguments и expiry на native boundary.

Native host должен сообщать об отсутствии permissions, tools, background
execution, decoders или radios, а не подменять их успешным fixture. Core
остаётся platform-neutral. Web/PWA не является стратегией iOS, а Desktop-проверка
не доказывает поведение Android или iOS.

## Документационный workflow

У каждого устойчивого понятия есть одна owner page. Product behavior находится
в [Продукте](product.md), дизайн и boundaries — в [Архитектуре](architecture.md),
сеть — в [Сети Keystone](connectivity.md), security rules — в
[Безопасности](security.md), AI и egress — в [ИИ](ai.md), plugin behavior — в
[Plugins](plugins.md), status и readiness — в [Релизе и доказательствах](release.md).
Subsystem pages ссылаются на владельцев, а не копируют их политику.

После перемещения страницы запускайте `pnpm docs:check`. Проверка работает
без сети и зависимостей и ищет local Markdown links, обязательные EN/RU пары,
phase-style filenames и запрещённую русскую формулировку для mesh network.

## Передача в релиз

`pnpm release:check` — preflight, а не операция подписи. Владелец передаёт
updater, signing, store и optional provider credentials через release
environment. Ожидаемые credential blockers собраны в [Релизе и
доказательствах](release.md), а не в документах отдельных подсистем.

## Настройки Desktop под контролем владельца

Desktop shell использует версионированный registry
`keystone.desktop.settings.v2` как canonical source для настроек оформления и
поведения. Значения типизированы и проверяются; разрешение идёт в порядке:
defaults, global, device, workspace, surface, window. Более узкая область
переопределяет широкую, а без нужного context сохраняется более широкое
значение. Core data, identity, credentials, permissions и immutable security
policy не являются пользовательскими настройками.

Оформление использует semantic tokens для темы, акцента, цветов, typography,
density, геометрии, radii, borders, shadows, transparency и motion. В том же
registry сохраняются layout, порядок и видимость секций Home, tabs, shell
actions и shortcuts. Экран Settings предоставляет undo/redo, scoped reset,
presets, безопасный JSON export/import и editor для custom CSS только для
presentation. Custom CSS локален и включается явно: imports, `url()` и
исполняемый CSS отклоняются; security policy изменить нельзя. Если custom CSS
испортил представление, включите Safe UI mode в Settings или задайте
`keystone.desktop.safe-ui-mode=1` перед перезапуском.

Стабильные локальные styling hooks используют `data-keystone-shell`,
`data-keystone-region` и `data-keystone-component`. Это не remote extension
API и они не дают доступа к данным или действиям Keystone.
