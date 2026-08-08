# CI/CD

`.github/workflows/build.yml` runs on `main` and manually. Checks gate all
platform jobs. pnpm store, Cargo target data and Gradle dependencies are cached.

- Linux: AppImage
- Windows: MSI and NSIS `.exe`
- macOS: `.app` and DMG
- Android: unsigned release AAB; add Gradle signing secrets before publishing
- iOS: unsigned simulator `.app`

A distributable `.ipa` cannot be produced without an Apple Developer identity,
provisioning profile and keychain setup. For release signing, configure EAS
credentials and replace the simulator command with
`eas build --platform ios --profile production --non-interactive`, or import a
certificate/profile and run `xcodebuild archive` plus `-exportArchive`.

After committing the generated `pnpm-lock.yaml`, replace
`--no-frozen-lockfile` with `--frozen-lockfile` and key pnpm caches on that file.
