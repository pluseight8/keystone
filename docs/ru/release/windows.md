# Релиз Windows

Нужны Node 22, pnpm 9.15.0, Rust stable, Tauri prerequisites и WebView2.
Development не включает updater. Production требует предоставленные владельцем
`KEYSTONE_TAURI_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY` и пароль в CI
secret store; preflight корректно блокирует релиз без них.

MSI/NSIS generation не равен Authenticode signing. До релиза физически
проверьте install, launch, WebView2, upgrade/uninstall, updater signature,
network/firewall и accessibility. Не объявляйте signing проверенным без
сертификата владельца.
