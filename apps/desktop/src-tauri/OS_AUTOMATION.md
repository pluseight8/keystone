# OS automation permissions

Keystone currently does **not** expose generic OS input injection or arbitrary
browser script evaluation. Those capabilities are unavailable until each
platform has a native accessibility adapter that verifies a core-issued,
cryptographically bound Double Confirmation at the native boundary.

- Linux: a future AT-SPI/X11/Wayland-portal adapter must request only the
  required permission. `scan_windows` currently returns no data.
- Windows: a future UI Automation adapter must respect target integrity level.
- macOS: a future AXUIElement adapter must require the user’s Accessibility
  grant in System Settings → Privacy & Security.

Android accessibility integration is a separate native-module boundary. It
must require explicit system enablement and expose a bounded tree/API; it is
not validated by the desktop host review.

## Future adapter contract

Any future adapter must implement a typed, audited boundary such as:

```ts
type OsAutomationRequest =
  | { kind: 'openUrl'; url: string }
  | { kind: 'typeText'; target: AccessibilityTarget; text: string }
  | { kind: 'pressKey'; key: 'Enter' | 'Escape' | 'Tab' }
  | { kind: 'click'; target: AccessibilityTarget };

interface OsAutomationAdapter {
  authorize(request: OsAutomationRequest, confirmation: DoubleConfirmation): Promise<void>;
  execute(request: OsAutomationRequest): Promise<AuditRecord>;
}
```

`AccessibilityTarget` must be a platform-resolved element identity, never a
screen coordinate or executable selector supplied by a peer. `authorize` must
validate capability scope, expiry, the cryptographic Double Confirmation, and
the local OS permission before execution. The adapter must reject unsupported
platforms and record the approved action. It must not expose generic scripting,
shell execution, raw keyboard/mouse events, or arbitrary filesystem access.
