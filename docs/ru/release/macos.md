# Релиз macOS

Для unsigned `.app`/DMG нужны macOS, Node 22, pnpm 9.15.0, Rust stable, Xcode и
Tauri prerequisites. Для updater release предоставьте реальный public key и
signing secret, создайте конфиг `pnpm release:prepare-desktop` и собирайте с
`--features updater --config src-tauri/tauri.release.conf.json`.

Signing, hardened runtime, notarization и stapling требуют Apple Team,
certificate и credentials владельца. До этого нужны физические проверки launch,
tray/global shortcut, WKWebView, keychain, permissions, update и P2P/WebRTC.
