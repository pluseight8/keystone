# OS automation permissions

`ui_action` is deliberately fail-closed. The caller must obtain a short-lived
token after `DoubleConfirmation.authorize`; the Rust command consumes it once.

- Linux: grant the app access to the input/accessibility backend. X11 needs a
  display connection; Wayland compositors may deny global injection and require
  a compositor portal or explicit user action. `scan_windows` returns no data
  until a native AT-SPI adapter is installed.
- Windows: the packaged app must be granted the required UI Automation/input
  rights (and run at the same integrity level as the target where applicable).
- macOS: the user must enable Keystone in System Settings → Privacy & Security
  → Accessibility. Global events are unavailable until that grant exists.

Android users are sent to the system Accessibility settings by
`KeystoneAccessibility.requestPermission`; the service only receives events
after the user explicitly enables it. The service exposes a bounded JSON tree,
gesture injection, and focused-field text replacement.
