<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# WebRTC platform permissions

macOS uses `Info.plist` usage descriptions and signed camera/audio sandbox entitlements. The user must grant Screen Recording in System Settings. On Wayland install PipeWire, `xdg-desktop-portal`, and the compositor portal backend; expose Wayland/fallback-X11, audio, and the per-user PipeWire socket in Flatpak.

On Android use a native build, call `registerGlobals()` from `react-native-webrtc`, and inject `mediaDevices` into `ReactNativeMediaCaptureAdapter`. Request `getDisplayMedia()` from a visible Activity. After OS MediaProjection consent, start `ScreenShareService` before creating the projection (Android 14+), and stop it with the screen track. Merge the fragment through Expo prebuild/config plugin; Expo Go cannot load this native dependency.
