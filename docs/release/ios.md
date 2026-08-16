# iOS release (experimental/deferred)

iOS configuration exists through Expo Router and the native prebuild route, but
iOS is not a release-ready Keystone platform. The Linux workspace cannot
compile an iOS simulator application. The CI route may compile an unsigned
simulator app on macOS; this is not a physical-device or signing result.

An actual release requires an owner Apple Developer account, Team ID,
certificates, provisioning profiles, App Store Connect setup, a macOS/Xcode
host, and physical-device verification of keychain, permissions, background
limits, WebRTC, deep links, and lifecycle recovery. Do not invent any of these
values or call iOS supported before those checks pass.
