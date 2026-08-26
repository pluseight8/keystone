# Native platform support / Поддержка платформ

| Platform | Adapter contract | Verified in this workspace |
|---|---|---|
| Linux | `LinuxNativeHost` | Evidence harness: real filesystem/process and Secret Service when the session is reachable; LAN is same-host; Bluetooth/USB/media controller presence probes; Wi‑Fi Direct/WebRTC physical path not verified |
| Windows 11 | `WindowsNativeHost` contract | Not physically tested |
| macOS | `MacOSNativeHost` contract | Not physically tested; Keychain adapter remains boundary |
| Android | `AndroidNativeHost` contract | Not physically tested |
| iOS | `IOSNativeHost` contract | Not physically tested |

The current validation host is Omarchy (Arch Linux-based distribution) with Node v22.23.2, pnpm 9.15.0 and package engine >=22 <23. No physical hardware or hardware-backed secret claim is made.

# Поддержка платформ

| Платформа | Контракт adapter | Проверено в workspace |
|---|---|---|
| Linux | `LinuxNativeHost` | Evidence harness: real filesystem/process и Secret Service при доступной сессии; LAN — same-host; Bluetooth/USB/media — probes наличия; Wi‑Fi Direct/WebRTC physical path не проверен |
| Windows 11 | `WindowsNativeHost` contract | Физически не проверено |
| macOS | `MacOSNativeHost` contract | Физически не проверено; Keychain adapter остаётся boundary |
| Android | `AndroidNativeHost` contract | Физически не проверено |
| iOS | `IOSNativeHost` contract | Физически не проверено |

Текущий validation host — Omarchy (Arch Linux-based distribution), Node v22.23.2, pnpm 9.15.0, package engine >=22 <23. Нет утверждений о физическом hardware или hardware-backed secrets.
