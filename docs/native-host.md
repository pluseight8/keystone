# Native Host

NativeHost is the single controlled boundary between Keystone Core and the
operating system/device: `@keystone/native-host`. Core forms a typed
`NativeHostRequest` with principal, capability, scope and expiry; policy decides;
the platform adapter performs the operation. Plugins, Agents, Skills and remote
peers never receive a shared host handle.

Production hosts are selected explicitly by platform
(`LinuxNativeHost`, `WindowsNativeHost`, `MacOSNativeHost`, `AndroidNativeHost`,
`IOSNativeHost`). `TestNativeHost` and `TestSecureStorage` are test-only. If a
production adapter is missing, the operation reports `UNAVAILABLE` or
`UNSUPPORTED` without a permissive fallback.

The host provides coarse feature discovery, sessions, lifecycle, audit,
power/thermal state, filesystem, secure storage, process, background,
permission, notification, clipboard, media, WebRTC, LAN, Bluetooth, Wi-Fi
Direct and USB boundaries. `DeviceRuntimeService`, `PhysicalFeatureProbe` and
`PhysicalE2EHarness` keep typed contract, runtime detection and physical
verification as separate evidence. A transport endpoint never becomes a
Keystone Identity automatically.
