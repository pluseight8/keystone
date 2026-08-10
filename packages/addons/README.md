# `@keystone/addons`

Capability-secured addon contracts and the host-side `AddonEngine`.

## Trust boundary

An addon bundle is untrusted input. `AddonEngine` validates its manifest and hook
descriptors, namespaces every registration, and exposes no ambient host objects.
Network and filesystem access are absent by default and are not valid v1
capabilities. All host access crosses `SandboxHostCall`, where the engine checks that
the capability was declared and routes only to a host-owned handler.

The TypeScript package deliberately does **not** evaluate addon JavaScript. Desktop
must implement `AddonSandboxRuntime` with a separate Tauri WebView whose CSP blocks
network navigation and whose IPC allowlist contains only the addon RPC channel, or
with a QuickJS/Wasmtime sidecar that exposes no WASI filesystem/socket imports.
Mobile must use a native isolated JS runtime (a separate JS engine/runtime, not
`eval`, a hidden React component, or the main Expo bridge) and expose the same RPC
contract. The production adapter must verify the signed bundle before `load`.

`life_map_read` and `p2p_request` are action-scoped capabilities: every attempt is
sent to `AddonConfirmationGateway` and must be approved with the Keystone swipe UI.
A successful prompt is not a permanent grant.

## Manifest

```json
{
  "schema": "keystone.addon.v1",
  "id": "org.example.week-review",
  "name": "Weekly Review",
  "version": "1.0.0",
  "entrypoint": "dist/addon.js",
  "permissions": ["ai_prompt", "life_map_read"]
}
```

See `manifest.schema.json` for the machine-readable contract.
