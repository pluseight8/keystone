# Готовность платформ (Phase 14)

Документ генерируется из [docs/platform-readiness.json](../platform-readiness.json). Статус «ПРОЙДЕНО» имеет подтверждение в текущих проверках; остальные статусы намеренно не являются заявлением готовности к релизу.

| Platform | Архитектура | Typecheck | Unit tests | Integration tests | Компиляция | Пакет | Установка | Запуск | Network/P2P | WebRTC | Secure storage | Permissions | Updater | Signing | Физическое устройство | Готовность релиза |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linux (Flatpak) | ЧАСТИЧНО | ПРОЙДЕНО | ПРОЙДЕНО | ЧАСТИЧНО | НЕ ТЕСТИРОВАЛОСЬ: Cargo is unavailable in this workspace | БЛОКЕР: flatpak-builder/GNOME SDK unavailable; manifest is statically checked | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | ЧАСТИЧНО: shared core tests only | НЕ ТЕСТИРОВАЛОСЬ | ЧАСТИЧНО: host implementation required | ПРОЙДЕНО: static manifest least-privilege audit | БЛОКЕР: owner updater key and signing secret required for production | БЛОКЕР: owner signing key required | НЕ ТЕСТИРОВАЛОСЬ | БЛОКЕР: package/install/launch evidence missing |
| Windows 11 | ЧАСТИЧНО | ПРОЙДЕНО | ПРОЙДЕНО | ЧАСТИЧНО | НЕ ТЕСТИРОВАЛОСЬ: Windows CI has not reported in this audit | ЧАСТИЧНО: MSI/NSIS workflow route exists | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | ЧАСТИЧНО: platform host boundary exists | ЧАСТИЧНО: Tauri IPC audited; WebView2 still untested | БЛОКЕР: owner updater key and release signing secret required | БЛОКЕР: requires owner Authenticode certificate | НЕ ТЕСТИРОВАЛОСЬ | БЛОКЕР: CI/device/signing evidence missing |
| macOS | ЧАСТИЧНО | ПРОЙДЕНО | ПРОЙДЕНО | ЧАСТИЧНО | НЕ ТЕСТИРОВАЛОСЬ: macOS CI has not reported in this audit | ЧАСТИЧНО: .app/DMG workflow route exists | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ: keychain verification required | ЧАСТИЧНО: config exists; Accessibility grant untested | БЛОКЕР: owner updater key and release signing secret required | БЛОКЕР: requires owner Apple Developer certificate | НЕ ТЕСТИРОВАЛОСЬ | БЛОКЕР: signing/notarization/device evidence missing |
| Android | ЧАСТИЧНО | ПРОЙДЕНО | ПРОЙДЕНО | ЧАСТИЧНО | НЕ ТЕСТИРОВАЛОСЬ: Android SDK/JDK build not run here | ЧАСТИЧНО: native Gradle project and CI route exist | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | ЧАСТИЧНО: native host validation required | ЧАСТИЧНО: config audited; prompts not device-tested | ЧАСТИЧНО: optional EAS OTA is disabled until owner project ID is supplied | БЛОКЕР: requires owner Android release keystore | НЕ ТЕСТИРОВАЛОСЬ | БЛОКЕР: Android build/device/signing evidence missing |
| iOS (experimental/deferred) | ЧАСТИЧНО | ПРОЙДЕНО | ПРОЙДЕНО | ЧАСТИЧНО | НЕ ТЕСТИРОВАЛОСЬ: requires macOS/Xcode simulator run | НЕ РЕАЛИЗОВАНО: no signed distribution process | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | НЕ ТЕСТИРОВАЛОСЬ | ЧАСТИЧНО: Expo config exists; device prompts untested | НЕ РЕАЛИЗОВАНО: no production iOS OTA policy verified | БЛОКЕР: requires owner Apple Developer credentials | НЕ ТЕСТИРОВАЛОСЬ | БЛОКЕР: experimental/deferred pending native and device evidence |

## Модель credentials

В development Tauri updater и Expo OTA отключены, пока не настроены. Для production нужны KEYSTONE_TAURI_UPDATER_PUBLIC_KEY, для desktop signing — TAURI_SIGNING_PRIVATE_KEY, для Android — keystore владельца. См. [docs/release](release).

## Security boundary

В desktop IPC нет arbitrary JavaScript, shell passthrough и generic OS input. Typed contract будущей автоматизации описан в [OS_AUTOMATION.md](../../apps/desktop/src-tauri/OS_AUTOMATION.md).
