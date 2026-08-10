<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# CI/CD

`.github/workflows/build.yml` runs on `main`, semantic version tags (`v*.*.*`)
and manually. Checks gate all platform jobs. A version tag additionally
publishes a GitHub Release with desktop updater bundles, Android APK and
`updater.json` containing inline Tauri signatures.

- Linux: AppImage
- Windows: MSI and NSIS `.exe`
- macOS: `.app` and DMG
- Android: unsigned release APK in CI; configure EAS/Gradle signing for store distribution
- iOS: unsigned simulator `.app`

A distributable `.ipa` cannot be produced without an Apple Developer identity,
provisioning profile and keychain setup. For release signing, configure EAS
credentials and replace the simulator command with
`eas build --platform ios --profile production --non-interactive`, or import a
certificate/profile and run `xcodebuild archive` plus `-exportArchive`.

The release job requires `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Secrets. The public key belongs in
`apps/desktop/src-tauri/tauri.conf.json`. After committing the generated
`pnpm-lock.yaml`, replace `--no-frozen-lockfile` with `--frozen-lockfile` and key
pnpm caches on that file.

### EAS OTA

Run `pnpm exec eas update:configure` once in `apps/mobile`, set the project ID,
then publish `eas update --channel production`. Only JS/assets are eligible for
OTA; native capability changes must ship as a new binary.
