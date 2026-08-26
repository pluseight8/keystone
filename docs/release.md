# Release and evidence

This page owns release status, validation evidence and platform readiness. It
is intentionally separate from product and architecture documentation:
canonical product pages describe current behavior, while this page explains
what has been checked and what remains a release responsibility.

## Current boundary

The repository is a current Release 0 development snapshot. The product
surfaces described in [Product](product.md) are implemented as shared core
contracts and host projections where their evidence says so. No next-phase
feature work or Release 1 work is part of this documentation sweep.

Release readiness is not inferred from a successful typecheck or from one
development host. A platform claim needs the matching build, package, install,
launch, permission, runtime, network and physical evidence.

## Evidence vocabulary

Use these terms consistently:

| Status | Meaning |
| --- | --- |
| `DECLARED` | A contract or platform path is described, but not demonstrated by a runtime check. |
| `IMPLEMENTED` | The repository contains the code and deterministic checks for the behavior. |
| `RUNTIME_DETECTED` | The current host exposed the required runtime capability or tool. |
| `PHYSICALLY_VERIFIED` | The required physical device, permission and end-to-end path were exercised. |
| `BLOCKED_BY_ENVIRONMENT` | The check could not run because the required host, credential, device or tool was unavailable. |
| `UNAVAILABLE` | The selected host does not expose the capability at runtime. |
| `UNSUPPORTED` | The product does not promise that capability on the selected surface. |

`RUNTIME_DETECTED` is not `PHYSICALLY_VERIFIED`. A same-host loopback or
controlled provider test is evidence of its own boundary only.

The generated [platform readiness matrix](PLATFORM_READINESS.md) is the one
place for the detailed platform table. Platform-specific release instructions
remain in [release guides](release/).

## Development environment

The current development and validation distribution is **Omarchy (Arch
Linux-based distribution)**. The validated Node runtime is `v22.23.2`, pnpm is
`9.15.0`, and the package engine is `>=22 <23`.

Omarchy is a development host, not a Keystone runtime dependency. Before a
platform-specific check, inspect the real host and its available tools. The
project does not assume GNOME, Flatpak, apt or dnf and does not install or
modify system packages as part of the project gates. Optional decoder,
clipboard, browser and native tools are discovered at runtime and reported as
unavailable when absent.

## Validation commands

Run from the repository root with the required Node and pnpm versions:

```bash
pnpm tsc
pnpm test
pnpm test:integration
pnpm test:network
pnpm test:performance
pnpm test:security
pnpm build
pnpm docs:check
pnpm release:check
git diff --check
```

Focused suites include `test:media`, `test:web-library`, `test:inbox`,
`test:subscriptions`, `test:files`, `test:tasks`, `test:contacts`,
`test:documents` and `test:capture`. Use a focused suite while iterating and
the full release set before a release decision. Exact test counts and one-off
timings belong in transient evidence, not canonical product pages.

The real-network suite uses independent processes and an isolated
Hyperswarm/Noise path where the host permits it. Controlled and same-host
proofs do not establish physical Bluetooth, Android/iOS background behavior,
or a signed store release.

## Production configuration

Development builds keep update and external distribution paths disabled unless
the owner configures them. The current release preflight expects these
owner-controlled production values when their workflows are enabled:

- `KEYSTONE_TAURI_UPDATER_PUBLIC_KEY` for updater verification;
- `TAURI_SIGNING_PRIVATE_KEY` and its password for signed desktop artifacts;
- an owner Android release keystore for Android signing;
- `KEYSTONE_EXPO_PROJECT_ID` only when Expo/EAS OTA configuration is desired;
- platform signing, notarization, store and distribution accounts for the
  target platform.

Missing values are release configuration blockers, not product bugs. Never
commit credentials, keys, signing material or recovery phrases.

## Host integration checklist

Before a platform claim is promoted, the host must provide encrypted durable
stores for authoritative state, native MIME/container validation, secure key
storage, the required browser/media/transport adapters and explicit retention,
compaction and backup/restore behavior. In-memory stores and controlled
fixtures are development evidence only. Optional push, DHT/gossip discovery,
WebRTC, media and notification integrations remain adapter boundaries; their
absence must be reported as unavailable or blocked rather than simulated as
success.

## Platform boundaries

- Linux development and host evidence are scoped to the tools actually present
  on the current Omarchy host. Flatpak is a separate packaging target, not an
  assumption about the development desktop.
- Windows and macOS require their native Tauri build, signing and physical
  install evidence. A Linux typecheck does not provide it.
- Android requires a native build, permission and lifecycle checks on an
  Android-capable host or device. Expo Go is not evidence for custom modules.
- iOS is a native implementation and distribution concern. Web/PWA, “Web Node”
  or “Limited Node” is not the iOS strategy; web is a separate development
  surface, not a replacement for native iOS capability.

See [Android](release/android.md), [Windows](release/windows.md),
[macOS](release/macos.md) and [iOS](release/ios.md) for owner-controlled
release steps.

## Release 0 history

The current product grew in layers: identity and local objects first; then
encrypted peer delivery, content addressing, trusted devices and local AI;
then personal surfaces for knowledge, media, communication, planning, maps,
feeds, files, documents and capture; finally the cross-surface projections,
collaboration and host-boundary evidence that make those capabilities one
product.

That history is useful for release review, but it is not repeated in subsystem
pages. Future changes should update the canonical owner page and add a concise
entry here only when the release record needs it.
