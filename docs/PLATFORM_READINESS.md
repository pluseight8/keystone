# Platform readiness evidence

This generated matrix is derived from [`docs/platform-readiness.json`](platform-readiness.json). `PASS` is evidence from the current repository checks; `PARTIAL`, `BLOCKED`, `NOT TESTED`, and `NOT IMPLEMENTED` are deliberately not release claims. The Linux (Flatpak) row describes a packaging target, not the current development distribution.

| Platform | Architecture | Typecheck | Unit tests | Integration tests | Compile | Package | Install | Launch | Network/P2P | WebRTC | Secure storage | Permissions | Updater | Signing | Physical device | Release ready |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Linux (Flatpak) | PARTIAL | PASS | PASS | PARTIAL | NOT TESTED: Cargo is unavailable in this workspace | BLOCKED: flatpak-builder/GNOME SDK unavailable; manifest is statically checked | NOT TESTED | NOT TESTED | PARTIAL: shared core tests only | NOT TESTED | PARTIAL: host implementation required | PASS: static manifest least-privilege audit | BLOCKED: owner updater key and signing secret required for production | BLOCKED: owner signing key required | NOT TESTED | BLOCKED: package/install/launch evidence missing |
| Windows 11 | PARTIAL | PASS | PASS | PARTIAL | NOT TESTED: Windows CI has not reported in this audit | PARTIAL: MSI/NSIS workflow route exists | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | PARTIAL: platform host boundary exists | PARTIAL: Tauri IPC audited; WebView2 still untested | BLOCKED: owner updater key and release signing secret required | BLOCKED: requires owner Authenticode certificate | NOT TESTED | BLOCKED: CI/device/signing evidence missing |
| macOS | PARTIAL | PASS | PASS | PARTIAL | NOT TESTED: macOS CI has not reported in this audit | PARTIAL: .app/DMG workflow route exists | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED: keychain verification required | PARTIAL: config exists; Accessibility grant untested | BLOCKED: owner updater key and release signing secret required | BLOCKED: requires owner Apple Developer certificate | NOT TESTED | BLOCKED: signing/notarization/device evidence missing |
| Android | PARTIAL | PASS | PASS | PARTIAL | NOT TESTED: Android SDK/JDK build not run here | PARTIAL: native Gradle project and CI route exist | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | PARTIAL: native host validation required | PARTIAL: config audited; prompts not device-tested | PARTIAL: optional EAS OTA is disabled until owner project ID is supplied | BLOCKED: requires owner Android release keystore | NOT TESTED | BLOCKED: Android build/device/signing evidence missing |
| iOS (experimental/deferred) | PARTIAL | PASS | PASS | PARTIAL | NOT TESTED: requires macOS/Xcode simulator run | NOT IMPLEMENTED: no signed distribution process | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | PARTIAL: Expo config exists; device prompts untested | NOT IMPLEMENTED: no production iOS OTA policy verified | BLOCKED: requires owner Apple Developer credentials | NOT TESTED | BLOCKED: experimental/deferred pending native and device evidence |

## Release credential model

Development builds keep the Tauri updater and Expo OTA disabled unless configured. A production release requires KEYSTONE_TAURI_UPDATER_PUBLIC_KEY; signed desktop release also requires TAURI_SIGNING_PRIVATE_KEY, while Android signing requires an owner-provided keystore. See [Release and evidence](release.md).

## Security boundary

Desktop IPC has no arbitrary JavaScript execution, shell passthrough, or generic OS input. The typed automation contract is documented in [OS_AUTOMATION.md](../apps/desktop/src-tauri/OS_AUTOMATION.md).
