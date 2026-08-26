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
