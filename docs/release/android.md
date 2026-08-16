# Android release

## What is checked automatically

The mobile configuration fixes `org.keystone.app`, uses `minSdk 24`,
`compileSdk 35`, `targetSdk 34`, and lists arm and x86 development ABIs. The
release preflight validates the Expo configuration but does not claim an APK,
device, permission, or WebRTC test unless an Android job/device actually ran.

`KEYSTONE_EXPO_PROJECT_ID` is optional. It enables EAS OTA configuration only;
native/local development remains local-first without an Expo account.

## Owner-controlled release boundary

Before a store or signed APK/AAB release, the owner must provide an Android
upload/release keystore outside the repository, its alias/passwords through CI
secrets, the Play Console application, and (only if OTA is desired) the Expo
project ID. Never commit a keystore or passwords.

Run an unsigned/debug validation on an Android-capable host with:

```bash
pnpm --dir apps/mobile exec expo prebuild --platform android --non-interactive
cd apps/mobile/android && ./gradlew assembleDebug --no-daemon
```

Then physically verify install/launch, the `keystone://voice` link, camera and
microphone prompts only when the corresponding feature is used, notifications,
background behavior, WebRTC on a real network, and no unintended cleartext
traffic.
