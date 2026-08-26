# Native platform support / Поддержка платформ

| Platform | Adapter contract | Verified in this workspace |
|---|---|---|
| Linux | `LinuxNativeHost` | TypeScript tests and real temp filesystem/process boundary; secure OS keychain, camera, microphone, Bluetooth, Wi‑Fi Direct, USB and native WebRTC not verified |
| Windows 11 | `WindowsNativeHost` contract | Not physically tested |
| macOS | `MacOSNativeHost` contract | Not physically tested; Keychain adapter remains boundary |
| Android | `AndroidNativeHost` contract | Not physically tested |
| iOS | `IOSNativeHost` contract | Not physically tested |

Текущая validation environment — Omarchy (Arch Linux-based distribution) с Node
v22.23.2, pnpm 9.15.0 и package engine >=22 <23. Нет утверждений о физическом
hardware или hardware-backed secrets.

# Поддержка платформ

| Платформа | Контракт adapter | Проверено в workspace |
|---|---|---|
| Linux | `LinuxNativeHost` | TypeScript tests и real temp filesystem/process boundary; OS keychain, camera, microphone, Bluetooth, Wi‑Fi Direct, USB и native WebRTC не проверены |
| Windows 11 | `WindowsNativeHost` contract | Физически не проверено |
| macOS | `MacOSNativeHost` contract | Физически не проверено; Keychain adapter остаётся boundary |
| Android | `AndroidNativeHost` contract | Физически не проверено |
| iOS | `IOSNativeHost` contract | Физически не проверено |

Для Photos текущая validation выполняется на Omarchy (Arch Linux-based
distribution) с Node v22.23.2 и pnpm 9.15.0. Typed camera-roll/file/decoder
boundaries не означают физическую Android/iOS проверку. Host tools `identify`,
`ffmpeg` и `ffprobe` обнаружены, но production Keystone decoder adapter и
physical Keystone media proof остаются `UNAVAILABLE`/
`BLOCKED_BY_ENVIRONMENT`.
