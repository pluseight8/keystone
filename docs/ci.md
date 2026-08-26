<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# CI/CD

`.github/workflows/build.yml` provides a fast core preflight on pull requests,
`main`, version tags (`v*.*.*`), and manual dispatch. Native desktop and mobile
jobs are dispatched manually or for a signed desktop tag release, so ordinary
pushes do not repeatedly download platform SDKs. A tagged release publishes
only signed desktop updater bundles and `updater.json` after strict preflight.

The bounded synthetic scale suite is an explicit, single-worker check rather
than a default CI soak:

```sh
pnpm test:performance
```

It uses generated data and no one-process-per-peer topology. Keep the serial
real-network job (`pnpm test:network`) as the production Hyperswarm/Noise
regression evidence; its harness startup/restart cost is reported separately
from product latency. Performance checks must use Node `>=22 <23` and must not
disable encryption, durability, retry, authorization, or resource limits.

- Linux: AppImage
- Windows: MSI and NSIS `.exe`
- macOS: `.app` and DMG
- Android: manual unsigned debug APK check; store signing is owner-controlled
- iOS: manual unsigned simulator `.app` check; experimental/deferred

A distributable `.ipa` cannot be produced without an Apple Developer identity,
provisioning profile and keychain setup. For release signing, configure EAS
credentials and replace the simulator command with
`eas build --platform ios --profile production --non-interactive`, or import a
certificate/profile and run `xcodebuild archive` plus `-exportArchive`.

The release job requires `KEYSTONE_TAURI_UPDATER_PUBLIC_KEY`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`,
`KEYSTONE_EXPO_PROJECT_ID`, and `ANDROID_KEYSTORE_PATH` only for a full
production release. The public updater key is supplied through the environment
and written to an ignored release-only Tauri config by
`pnpm release:prepare-desktop`; it is not hardcoded in development config.
CI installs with `--frozen-lockfile`.

### EAS OTA

Supply `KEYSTONE_EXPO_PROJECT_ID` to a release build to enable EAS OTA, then
publish `eas update --channel production`. Without it, OTA remains disabled and
development remains local-first. Only JS/assets are eligible for OTA; native
capability changes must ship as a new binary.
