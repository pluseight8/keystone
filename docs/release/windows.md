# Windows release

Windows builds require Node 22, pnpm 9.15.0, Rust stable, the Tauri Windows
prerequisites, and WebView2 (normally present on supported Windows 11 systems).

Development builds do not load the updater. A release build needs the owner to
provide `KEYSTONE_TAURI_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and
its password through the CI secret store. The preflight deliberately blocks a
production release without them.

```powershell
pnpm install --frozen-lockfile
pnpm build:desktop
$env:KEYSTONE_TAURI_UPDATER_PUBLIC_KEY = '<owner supplied public key>'
pnpm release:prepare-desktop
pnpm --dir apps/desktop tauri build --features updater --config src-tauri/tauri.release.conf.json --bundles msi,nsis
```

Installer generation is distinct from Authenticode signing. Before release,
physically test install, launch, WebView2 availability, upgrade/uninstall,
updater signature verification, firewall/network behavior, and accessibility.
Do not claim Windows signing until it has run with the owner's certificate.
