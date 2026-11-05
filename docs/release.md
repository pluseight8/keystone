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
| `VERIFIED_AS_ARTIFACT` | A local binary exists and its available structural checks pass; this does not prove physical install or launch. |
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

## Local owner-test artifacts

The repository provides a repeatable local-test path for the real native
projects. On **Omarchy (Arch Linux-based distribution)**, use the validated
Node and pnpm runtime:

The first usable desktop build is a normal Tauri window, approximately
1280x800 with a 900x600 minimum, and supports ordinary resize/maximize/minimize
controls. First launch creates the local owner through Core's
`IdentityManager`, names the current device, stores the local-AI preference
without a remote AI call, and opens a useful local Home shell. Home, Search,
Music, Video, Shorts, Local AI, Connectivity, Capture, Tasks, Documents,
Settings and Device are visible desktop surfaces. Music, Video and Shorts are
backed by the existing typed host media boundary; without that boundary they
remain empty or explicitly unavailable. Local AI is localhost-only and
preserves the core egress firewall. No surface is represented by synthetic
peers, messages, metrics or activity.

```bash
mise exec node@22.23.2 -- pnpm install --frozen-lockfile
mise exec node@22.23.2 -- pnpm build:test:artifacts
```

The focused commands are `pnpm build:test:appimage` and
`pnpm build:test:android` under the same `mise exec` prefix.
The command writes the real outputs and evidence files to
`artifacts/local-test/`:
`Keystone-0.1.0-local-test-x86_64.AppImage`,
`Keystone-0.1.0-android-debug.apk`,
`SHA256SUMS.txt` and `build-manifest.json`.

The local profile is `LOCAL_TEST` with
`DEVELOPMENT_DISTRIBUTION`. Production updater, signing and Expo
project values are removed from child build processes; no fake credential is
written and no authorization, sandbox or AI policy is weakened. The Android
output is debug/test signed and must not be called a production or store
release. The runner preserves the existing native Android project when
available and does not install to a device without explicit
`KEYSTONE_ALLOW_ADB_INSTALL=1` opt-in.

Evidence is classified separately:

- a real binary with passing available structural checks is
  `VERIFIED_AS_ARTIFACT`;
- an AppImage bounded launch or authorized Android install is
  `PHYSICALLY_VERIFIED`;
- missing Rust/Cargo, JDK, Android SDK tools, AppImage packager or device is
  `BLOCKED_BY_ENVIRONMENT`;
- if a requested binary cannot be produced, the overall local-test result is
  `PARTIAL — TOOLCHAIN BLOCKED`.

The AppImage child build receives `NO_STRIP=1` on the current Omarchy host to
avoid the cached linuxdeploy/Arch ELF `relr.dyn` mismatch. This environment
variable is scoped to that build command and is not a required global setting.
The Linux binary sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` inside its own process
before Tauri starts, so users do not need a shell-level rendering workaround.
When the Omarchy launcher exports `GDK_BACKEND=wayland` while XWayland is
available, the binary selects GDK X11 only inside its own process; a pure
Wayland host without `DISPLAY` keeps its native backend choice.
`APPIMAGE_EXTRACT_AND_RUN=1` is only a per-launch fallback where AppImage FUSE
is unavailable.

The desktop uses one native process and one primary window per local profile.
A second launch focuses the existing window instead of creating a duplicate
window or session tabs. Extra windows are explicit tear-off/new-window
actions. Settings → Layout → Reset Window & Tab Layout changes presentation
only; it closes secondary windows and returns to one main window with one Home
tab without deleting owner content or identity.

The current desktop shell stores lightweight profile/preferences in WebView
local storage, while native extensions and models use the normal platform
app-local-data directory. The local-test workflow adds no separate identity
namespace and does not delete application state; back up existing Keystone
data before testing. This workflow is not a substitute for platform signing,
store submission, notarization, OTA configuration or physical lifecycle
evidence.

For a first-run reset, clear `keystone.onboarding.complete`,
`keystone.local.identity.v1`, `keystone.local-ai.preference`,
`keystone.local.ai-settings.v1` and `keystone.local.discovery.v1` from the
Keystone WebView storage, then restart. Capture, Tasks and Documents are
stored under owner-scoped keys; delete those records only for a deliberate
full local-data reset. The renderer persists public owner/device metadata, not
the secret identity seed. Secure durable key storage remains a prerequisite
for signing and device pairing claims.
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
