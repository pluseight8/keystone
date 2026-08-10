<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Cross-platform host architecture

## Shared layers

`packages/ui` contains React Native primitives using the RN style model. The
same primitives render in Expo and can be adapted to DOM/Tauri through the
`.web` entry point. `packages/theme` contains validated token manifests and
the built-in Neumorphism and Frutiger Aero presets. Themes are data-only:
remote code, selectors and scripts are never accepted.

## Desktop

Tauri owns OS integration, secure storage and a hidden automation webview.
Linux ships AppImage/deb/rpm, Windows ships MSI/NSIS, and macOS ships app/DMG.
Flatpak is maintained as a separate manifest because it is a distribution
format rather than a native Tauri bundle target.

## Mobile

Expo Router provides the shared navigation surface. Native modules are loaded
only in development/production builds, not Expo Go. Android uses GeckoView;
iOS uses WKWebView. Both expose the same `BrowserModule` contract and only
accept one-use, short-lived confirmed payloads.

P2P is foreground-first on mobile. iOS background execution is not a general
purpose DHT runtime; Android may use a foreground service with a visible user
notification. The `MobileP2PLifecycle` adapter therefore suspends discovery on
background and resumes from push/deep-link events.

## BrowserEngine boundary

`packages/browser-engine` is the only layer that knows whether the host is
Tauri, GeckoView or WKWebView. Core automation code depends on:

```ts
interface BrowserEngine {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  inject(payload: ConfirmedBrowserPayload): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
}
```

Arbitrary `evaluate` remains restricted by the native host and should be used
only for trusted first-party automation. P2P data always uses `inject()`.
