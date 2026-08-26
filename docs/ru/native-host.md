# Нативный host

NativeHost — единственная контролируемая граница между Keystone Core и
операционной системой/устройством: `@keystone/native-host`. Core формирует
типизированный `NativeHostRequest` с principal, capability, scope и expiry;
policy принимает решение, а platform adapter выполняет операцию. Plugin, Agent,
Skill и remote peer не получают общий host handle.

Production host выбирается явно по платформе
(`LinuxNativeHost`, `WindowsNativeHost`, `MacOSNativeHost`, `AndroidNativeHost`,
`IOSNativeHost`). `TestNativeHost` и `TestSecureStorage` доступны только в
тестах. Если production adapter отсутствует, операция сообщает
`UNAVAILABLE`/`UNSUPPORTED` без permissive fallback.

Host предоставляет coarse feature discovery, sessions, lifecycle, audit,
power/thermal state, filesystem, secure storage, process, background,
permission, notification, clipboard, media, WebRTC, LAN, Bluetooth, Wi-Fi
Direct и USB boundaries. `DeviceRuntimeService`, `PhysicalFeatureProbe` и
`PhysicalE2EHarness` раздельно отражают typed contract, runtime detection и
physical verification. Transport endpoint не становится Identity автоматически.
