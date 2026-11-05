# Релиз и доказательства

Эта страница владеет статусом релиза, evidence и platform readiness. Она
отделена от product и architecture documentation: канонические страницы
описывают текущее поведение, а здесь фиксируется, что проверено и что остаётся
ответственностью релиза.

## Текущая граница

Репозиторий содержит текущий development snapshot Release 0. Поверхности из
[Продукта](product.md) реализованы как общие Core-контракты и host-projections
там, где это подтверждено evidence. Новая feature work и Release 1 не входят в
этот sweep.

Готовность не выводится из одного typecheck или одного development host. Для
platform claim нужны соответствующие build, package, install, launch,
permissions, runtime, network и physical evidence.

## Термины evidence

| Статус | Значение |
| --- | --- |
| `DECLARED` | Контракт или platform path описан, но runtime-проверка не выполнена. |
| `IMPLEMENTED` | В репозитории есть код и deterministic checks поведения. |
| `VERIFIED_AS_ARTIFACT` | Локальный binary существует и доступные structural checks пройдены; physical install или launch это не доказывает. |
| `RUNTIME_DETECTED` | Текущий host обнаружил нужную capability или tool. |
| `PHYSICALLY_VERIFIED` | Проверены physical device, permission и end-to-end path. |
| `BLOCKED_BY_ENVIRONMENT` | Проверка невозможна из-за отсутствующего host, credential, device или tool. |
| `UNAVAILABLE` | Выбранный host не предоставляет capability во время запуска. |
| `UNSUPPORTED` | Keystone не обещает capability на этой surface. |

`RUNTIME_DETECTED` не равен `PHYSICALLY_VERIFIED`. Same-host loopback и
controlled provider доказывают только собственную boundary.

Подробная [таблица готовности платформ](../PLATFORM_READINESS.md) — единственное
место для platform matrix. Инструкции по отдельным platform находятся в
[release guides](release/).

## Development environment

Текущая development/validation distribution — **Omarchy (Arch Linux-based
distribution)**. Проверенный Node — `v22.23.2`, pnpm — `9.15.0`, package engine —
`>=22 <23`.

Omarchy — development host, а не runtime dependency Keystone. Перед
platform-specific проверкой изучайте реальный host и его tools. Проект не
предполагает GNOME, Flatpak, apt или dnf и не устанавливает/не меняет system
packages в project gates. Optional decoder, clipboard, browser и native tools
обнаруживаются при запуске; при отсутствии показывается unavailable.

## Команды проверки

Запускайте из корня repository с нужными версиями Node и pnpm:

```bash
pnpm tsc
pnpm test
pnpm test:integration
pnpm test:network
pnpm test:performance
pnpm test:security
pnpm build
pnpm docs:check
pnpm release:check
git diff --check
```

Focused suites: `test:media`, `test:web-library`, `test:inbox`,
`test:subscriptions`, `test:files`, `test:tasks`, `test:contacts`,
`test:documents` и `test:capture`. Во время работы используйте focused suite,
а перед release decision — полный набор. Точные test counts и разовые timings
относятся к transient evidence, а не к product docs.

Real-network suite использует независимые процессы и Hyperswarm/Noise, когда
это позволяет host. Controlled и same-host proof не доказывают physical
Bluetooth, Android/iOS background behavior или signed store release.

## Локальные owner-test артефакты

Repository предоставляет повторяемый local-test путь для настоящих native
projects. На **Omarchy (Arch Linux-based distribution)** используйте
проверенные Node и pnpm:

Первый usable desktop build — обычное Tauri-окно примерно 1280x800 с
минимальным размером 900x600 и обычными resize/maximize/minimize controls.
Первый запуск создаёт local owner через Core `IdentityManager`, сохраняет имя
текущего устройства и preference локального AI без remote AI call, затем
открывает полезный локальный Home shell. Home, Search, Music, Video, Shorts,
Local AI, Connectivity, Capture, Tasks, Documents, Settings и Device — видимые
desktop surfaces. Music, Video и Shorts используют существующую typed media
boundary и без неё остаются пустыми или явно unavailable. Local AI работает
только с localhost и сохраняет core egress firewall. Synthetic peers,
messages, metrics и activity не используются.

```bash
mise exec node@22.23.2 -- pnpm install --frozen-lockfile
mise exec node@22.23.2 -- pnpm build:test:artifacts
```

Focused-команды — `pnpm build:test:appimage` и
`pnpm build:test:android` с тем же префиксом `mise exec`.
Команда записывает реальные outputs и evidence files в
`artifacts/local-test/`:
`Keystone-0.1.0-local-test-x86_64.AppImage`,
`Keystone-0.1.0-android-debug.apk`,
`SHA256SUMS.txt` и `build-manifest.json`.

Local profile — `LOCAL_TEST` с
`DEVELOPMENT_DISTRIBUTION`. Production updater, signing и Expo
project values удаляются из child build processes; fake credentials не
создаются, authorization, sandbox и AI policy не ослабляются. Android output
подписан как debug/test и не является production или store release. Runner
сохраняет существующий native Android project, когда он доступен, и не
устанавливает APK на device без явного
`KEYSTONE_ALLOW_ADB_INSTALL=1`.

Evidence классифицируется отдельно:

- binary с пройденными доступными structural checks —
  `VERIFIED_AS_ARTIFACT`;
- bounded AppImage launch или authorized Android install —
  `PHYSICALLY_VERIFIED`;
- отсутствие Rust/Cargo, JDK, Android SDK tools, AppImage packager или device —
  `BLOCKED_BY_ENVIRONMENT`;
- если requested binary создать нельзя, общий результат —
  `PARTIAL — TOOLCHAIN BLOCKED`.

На текущем Omarchy host дочерняя AppImage-сборка получает `NO_STRIP=1`, чтобы
обойти несовместимость cached linuxdeploy с Arch ELF `relr.dyn`. Переменная
ограничена этим build command и не является глобальной настройкой. Linux
binary сам задаёт `WEBKIT_DISABLE_DMABUF_RENDERER=1` внутри собственного
процесса до старта Tauri; shell-level workaround не нужен. Если launcher
Omarchy экспортирует `GDK_BACKEND=wayland`, но доступен XWayland, binary
выбирает GDK X11 только внутри собственного процесса; pure Wayland host без
`DISPLAY` сохраняет native backend choice.
`APPIMAGE_EXTRACT_AND_RUN=1` — только per-launch fallback при отсутствии
AppImage FUSE.

Desktop использует один native process и одно главное окно на каждый local
profile. Повторный запуск переводит фокус на существующее окно, не создавая
duplicate window или session tabs. Дополнительные окна открываются только
явным tear-off/new-window action. Settings → Layout → «Сбросить компоновку
окон и вкладок» меняет только presentation, закрывает secondary windows и
оставляет одно главное окно с одной вкладкой Home без удаления owner content
или identity.

Текущий Desktop shell хранит lightweight profile/preferences в WebView local
storage, а native extensions и models используют обычный platform app-local-data
directory. Local-test workflow не добавляет отдельный identity namespace и не
удаляет application state; перед тестом сделайте backup существующих данных
Keystone. Этот workflow не заменяет platform signing, store submission,
notarization, OTA configuration или physical lifecycle evidence.

Для повторного first-run reset очистите в WebView storage Keystone ключи
`keystone.onboarding.complete`, `keystone.local.identity.v1`,
`keystone.local-ai.preference`, `keystone.local.ai-settings.v1` и
`keystone.local.discovery.v1`, затем перезапустите приложение. Capture, Tasks
и Documents хранятся под owner-scoped keys; удаляйте эти записи только при
осознанном полном reset локальных данных. Renderer сохраняет public
owner/device metadata, но не secret identity seed. Для заявлений о signing и
device pairing нужен secure durable key storage.
## Production configuration

Development builds держат update и external distribution paths выключенными,
пока владелец их не настроит. Для включённых workflows нужны owner-controlled
значения:

- `KEYSTONE_TAURI_UPDATER_PUBLIC_KEY` для проверки updater;
- `TAURI_SIGNING_PRIVATE_KEY` и пароль для signed desktop artifacts;
- Android release keystore владельца;
- `KEYSTONE_EXPO_PROJECT_ID`, только если нужен Expo/EAS OTA;
- platform signing, notarization, store и distribution accounts.

Отсутствующие значения — release configuration blockers, а не product bugs.
Credentials, keys, signing material и recovery phrases нельзя коммитить.

## Чеклист host-интеграции

Перед заявлением поддержки платформы host должен предоставить зашифрованные
durable stores для authoritative state, native MIME/container validation,
secure key storage, необходимые browser/media/transport adapters и явные
правила retention, compaction и backup/restore. In-memory stores и controlled
fixtures — только development evidence. Отсутствующие push, DHT/gossip,
WebRTC, media или notification adapters должны показываться как unavailable или
blocked, а не как успешная симуляция.

## Границы платформ

- Linux development и host evidence ограничены tools, реально доступными на
  Omarchy. Flatpak — отдельный packaging target, а не свойство development
  desktop.
- Windows и macOS требуют native Tauri build, signing и physical install
  evidence. Linux typecheck этого не доказывает.
- Android требует native build, permission и lifecycle checks на Android host
  или device. Expo Go не является evidence для custom modules.
- iOS — native implementation и distribution concern. Web/PWA, «Web Node» и
  «Limited Node» не являются стратегией iOS; Web — отдельная development
  surface, а не замена native capabilities.

См. [Android](release/android.md), [Windows](release/windows.md),
[macOS](release/macos.md) и [iOS](release/ios.md).

## История Release 0

Продукт развивался слоями: сначала Identity и локальные objects; затем
зашифрованная peer-доставка, content addressing, trusted devices и local AI;
после этого — поверхности знаний, media, communication, planning, maps,
feeds, files, documents и capture; затем projections, collaboration и
host-boundary evidence, объединившие их в один продукт.

Эта история нужна для release review, но не повторяется в страницах подсистем.
Будущие изменения должны обновлять owner page и добавлять сюда краткую запись
только при необходимости release record.
