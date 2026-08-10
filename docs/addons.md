<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Addon security architecture

Keystone addons are untrusted code. Installation does not put their JavaScript in
the main web, Expo, or Tauri renderer context.

## Runtime boundary

`@keystone/addons` owns the manifest contract, namespaces extension hooks, and
enforces capability checks. Platform hosts implement `AddonSandboxRuntime`:

- **Desktop:** a separate Tauri WebView with deny-all navigation/CSP and one
  addon-RPC channel, or QuickJS/Wasmtime without Node, WASI filesystem, socket,
  process, environment, clipboard, or Tauri APIs.
- **Mobile:** a native module backed by a separate JS engine/runtime. Loading
  addon code with `eval`, `Function`, a hidden React component, or the main Expo
  bridge is forbidden.

Production adapters must verify a signed addon bundle, enforce bundle size limits,
load only the manifest's safe relative entrypoint, apply CPU/memory/time quotas, and
destroy the runtime on timeout or protocol violation. The TypeScript engine never
evaluates code itself; `createDesktopAddonRuntime` and `createMobileAddonRuntime`
adapt a hardened native provider to the common RPC contract.

## Capability model

The v1 allowlist is:

| Capability | Meaning | Confirmation |
| --- | --- | --- |
| `ai_prompt` | Run an addon-provided AI tool through the host's constrained model path | Declared permission and tool schema validation |
| `life_map_read` | Read a host-filtered Life Map snapshot | Swipe approval on every request |
| `p2p_request` | Ask the host to perform one bounded P2P operation | Swipe approval on every request |

Filesystem and network are deliberately absent. Unknown capabilities fail closed.
Even a declared sensitive capability is not a standing grant: the engine calls
`DoubleConfirmation.evaluateAddonAction`, then asks `AddonConfirmationGateway` to
display **“Аддон [Имя] запрашивает доступ...”** and awaits the swipe result.

Host handlers receive copied JSON only. They must validate the `operation`, return
the minimum necessary data, and never expose raw transports, CRDT objects, native
modules, filesystem handles, fetch, sockets, or credentials.

## Extension hooks

- `tools`: schema-constrained tools consumed by `AICommandProcessor`. Tool names are
  qualified as `<addonId>:<toolId>` and arguments are validated again immediately
  before execution.
- `customNodes`: metadata-only Life Map node descriptors. `LifeMapCanvas` uses the
  trusted host renderer; an addon cannot mount a component inside a node.
- `widgets`: declarative descriptors for host-owned UI primitives. Executable React
  widgets are not part of v1.

The addon activation response is validated, unknown fields are rejected, and all
registrations are removed atomically if installation fails or the addon is removed.
