# Desktop host (Tauri)

Здесь будет Tauri 2 host: secure storage через OS keychain, WebView browser sandbox и bridge к OS capabilities. UI переиспользует `@keystone/web`/`@keystone/ui`.
## Desktop browser bridge

The Tauri v2 command `inject_confirmed_data` accepts a short-lived, one-use
confirmation token and a small field allowlist. It never accepts arbitrary CSS
selectors or JavaScript from a peer. The frontend calls it through
`src/browserBridge.ts` only after `DoubleConfirmation.authorize()` succeeds.

Install the native dependencies and initialize the Tauri shell:

```sh
pnpm --filter @keystone/desktop add @tauri-apps/api
cd apps/desktop/src-tauri
cargo check
```

If the Tauri CLI is not installed yet:

```sh
pnpm add -Dw @tauri-apps/cli
pnpm exec tauri info
```

Build targets configured in `tauri.conf.json`: Linux `AppImage/deb/rpm`,
Windows `MSI/NSIS`, macOS `.app/DMG`. Flatpak is distributed through a
separate Flatpak manifest because it is not a native Tauri bundle target.

Tauri uses the operating system WebView (WebView2 on Windows, WebKitGTK on
Linux, WKWebView on macOS). Firefox/GeckoView is not a drop-in desktop Tauri
backend. If Firefox is mandatory, implement the same `BrowserEngine` contract
as a GeckoView Android module or run Firefox as a separately sandboxed
automation sidecar; do not label the native Tauri WebView as Firefox.

## Автообновление

Development builds do not load the Tauri updater and require no production
credential. For a production release, the owner first creates the signing key:

```bash
pnpm tauri signer generate -w ~/.tauri/keystone.key
```

Set the public content of `~/.tauri/keystone.key.pub` as
`KEYSTONE_TAURI_UPDATER_PUBLIC_KEY`, then generate the ignored release-only
configuration with `pnpm release:prepare-desktop`. The private key **must never
be committed**: store it in GitHub Secret
`TAURI_SIGNING_PRIVATE_KEY`, а пароль — в
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Workflow создаёт `.sig` и
`updater.json` only for a configured signed release.
