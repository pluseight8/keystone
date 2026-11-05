# Development

Keystone is developed as a platform-neutral core with narrow host adapters.
Development and validation preserve signatures, authorization, end-to-end
encryption, durable state, replay protection and the [Keystone Network](connectivity.md)
delivery boundary. A performance improvement is not acceptable if it weakens a
security or lifecycle guarantee.

## Validated environment

The current development/validation distribution is **Omarchy (Arch Linux-based
distribution)**. The validated runtime is Node `v22.23.2`, pnpm is `9.15.0`,
and the package engine is `>=22 <23`.

Omarchy is not a Keystone dependency. Check the actual host before any
platform-specific work. Do not assume GNOME, Flatpak, apt or dnf. Do not
install or modify system packages as part of a project gate. Optional tools
such as Poppler, Tesseract, ImageMagick, ffmpeg or Wayland clipboard utilities
are discovered at runtime; missing tools produce honest unavailable or blocked
evidence.

## Setup and everyday commands

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

pnpm dev
pnpm tsc
pnpm test
pnpm build
pnpm docs:check
```

The web shell is the fastest UI loop. Desktop development additionally needs
Rust and the Tauri prerequisites. Mobile uses a native development or
production build because custom native modules are not available in Expo Go;
Android needs the Android SDK/JDK, and iOS needs macOS/Xcode.

## Local owner test artifacts

The local-test packaging workflow uses the real Tauri desktop project and the
native Android project. It does not create a production release, sign a store
artifact, publish an OTA update or change Keystone security behavior. Run it
with the validated runtime:

The first usable desktop build is a normal Tauri window rather than an overlay:
it opens at approximately 1280x800, can be resized/maximized/minimized, and
has a 900x600 minimum size. The initial launch presents a local-first welcome,
creates the owner through Core's `IdentityManager`, names the device, records a
local-AI preference without contacting a remote service, and then opens the
local Home shell. Home, Search, Music, Video, Shorts, Local AI, Connectivity,
Capture, Tasks, Documents, Settings and Device are visible desktop surfaces.
Music, Video and Shorts remain empty or unavailable until a real typed host
adapter supplies signed object storage, content providers and decoder-backed
playback; Local AI accepts only explicitly configured localhost providers and
never creates a remote fallback. No surface is treated as populated demo data.

```bash
mise exec node@22.23.2 -- pnpm install --frozen-lockfile
mise exec node@22.23.2 -- pnpm build:test:artifacts
```

Focused packaging commands are:

```bash
mise exec node@22.23.2 -- pnpm build:test:appimage
mise exec node@22.23.2 -- pnpm build:test:android
```

Outputs are written to `artifacts/local-test/`:

- `Keystone-0.1.0-local-test-x86_64.AppImage`;
- `Keystone-0.1.0-android-debug.apk`;
- `SHA256SUMS.txt` and `build-manifest.json`.

The runner uses the existing `apps/mobile/android` project when its
Gradle wrapper is present; it only runs Expo prebuild when that native project
is absent. Missing Rust/Cargo, a JDK, Android SDK tools, an AppImage packager,
or an authorized Android device are recorded in the manifest instead of being
replaced by a fake artifact. A run that cannot create a requested binary is
`PARTIAL — TOOLCHAIN BLOCKED`.

On the current Omarchy host, the runner passes `NO_STRIP=1` only to the Tauri
AppImage child build. This works around the cached linuxdeploy/Arch ELF
`relr.dyn` stripping mismatch without changing a shell profile or system
configuration. The Linux application sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` inside its own process before Tauri starts;
do not add that variable globally. It is an Omarchy/Wayland rendering
workaround, not a Keystone feature or a new platform dependency. When the
Omarchy launcher exports `GDK_BACKEND=wayland` and XWayland is available, the
binary also selects GDK X11 only inside its own process so the normal launcher
path opens a window; a pure Wayland host without `DISPLAY` keeps its native
backend choice.

For a locally created AppImage, run from the repository root:

```bash
chmod +x artifacts/local-test/Keystone-0.1.0-local-test-x86_64.AppImage
./artifacts/local-test/Keystone-0.1.0-local-test-x86_64.AppImage
```

If the host does not provide AppImage FUSE support, use
`APPIMAGE_EXTRACT_AND_RUN=1` for that launch only. It is a packaging fallback;
the WebKit workaround above is already internal to the application.

The desktop keeps one native process and one primary window per local profile.
Launching the same AppImage again focuses that window instead of creating a
duplicate window or session tabs. Additional windows are created only by an
explicit tear-off or new-window action. Settings → Layout → Reset Window & Tab
Layout is presentation-only: it closes secondary windows and returns to one
main window with one Home tab without deleting owner content or identity
state.

For a locally created debug APK, install only on an already authorized device:

```bash
adb install -r artifacts/local-test/Keystone-0.1.0-android-debug.apk
```

The packaging runner does not install to a device unless
`KEYSTONE_ALLOW_ADB_INSTALL=1` is explicitly set. The APK is a local
debug/test build, not a production or store artifact. The current shell
lightweight profile and preferences use WebView local storage; native
extensions and models use the normal platform app-local-data directory. No
local-test identity namespace is introduced, and packaging does not delete
application data, so back up existing Keystone state before testing.

To repeat first-run setup during development, clear these keys from the
Keystone WebView storage and restart the app:
`keystone.onboarding.complete`, `keystone.local.identity.v1`,
`keystone.local-ai.preference`, `keystone.local.ai-settings.v1` and
`keystone.local.discovery.v1`. Capture, task and document state is scoped by
the persisted owner ID under `keystone.local.capture.v1:<owner>`,
`keystone.local.tasks.v1:<owner>` and
`keystone.local.documents.metadata.v1:<owner>`; remove those owner-scoped
records only when a complete local-data reset is intended. The renderer keeps
public identity metadata, not the secret identity seed; a production secure
host must supply durable non-exportable key storage before signing or device
pairing is claimed.

Use the following smoke checklist after a successful build:

- launch, restart, onboarding or an existing profile, navigation and local
  offline reopen;
- inspect Vault, Tasks, Contacts, Files, Documents, Capture, Browser, Mail,
  Photos, Maps, Search, Settings, Security Center and the AI-disabled path;
- on Android, install, launch, restart, permissions, background/resume and
  share-in behavior on the authorized device;
- treat missing hardware, radios, decoders, permissions and device access as
  blocked or unavailable evidence, not as successful platform support.
## Test and evidence layers

Use focused checks while editing:

| Area | Command |
| --- | --- |
| Photos and media decoders | `pnpm test:media` |
| Web Library | `pnpm test:web-library` |
| Universal Inbox | `pnpm test:inbox` |
| Feeds and podcasts | `pnpm test:subscriptions` |
| Files and Shared Folders | `pnpm test:files` |
| Tasks | `pnpm test:tasks` |
| Contacts | `pnpm test:contacts` |
| Documents and scanner | `pnpm test:documents` |
| Capture | `pnpm test:capture` |

The broader gates are `pnpm test:integration`, `pnpm test:network`,
`pnpm test:performance`, `pnpm test:security`, `pnpm build` and
`pnpm release:check`. `pnpm test:network` uses independent processes and a
real Hyperswarm/Noise path where the host permits it. It is not a claim about
physical radios or every mobile lifecycle.

Evidence uses the vocabulary owned by [Release and evidence](release.md):
`DECLARED`, `IMPLEMENTED`, `RUNTIME_DETECTED`, `PHYSICALLY_VERIFIED`,
`BLOCKED_BY_ENVIRONMENT`, `UNAVAILABLE` and `UNSUPPORTED`. Do not promote a
runtime detection, controlled fixture or loopback proof to physical evidence.

## Runtime and resource rules

- Background and bulk work must not starve interactive or security-control
  work.
- Offline operations persist durable work and do not synchronously wait for
  discovery. Retries use bounded backoff and re-arm after restart.
- Model/KV/decoder caches are disposable. Identity, sessions, permissions,
  Memory and authoritative user data are not cache entries.
- Relay, route, replay, public-cache, watcher, parser and diagnostic state has
  admission limits, TTLs and cleanup. Private plaintext is not retained in a
  global performance cache.
- Every timer, listener, child process and native session has an owner and a
  shutdown path. A test harness owns the child processes it starts.
- Performance tests use synthetic data and stable seeds. Record bounds,
  cleanup and isolation; do not loosen timeouts just to improve a number.

## Host boundaries

The core receives interfaces for secure persistence, clocks, notifications,
clipboard, media, browser, files, model execution and transport. Hosts expose
only typed, scoped operations and validate the principal, capability, arguments
and expiry again at the native boundary.

The native host must report missing permissions, tools, background execution,
decoders or radios rather than substituting a successful fixture. Core remains
platform-neutral. Web/PWA is not an iOS strategy, and a desktop validation run
does not prove Android or iOS behavior.

## Documentation workflow

Each durable concept has one owner page. Product behavior belongs in
[Product](product.md); design and boundaries in [Architecture](architecture.md);
network behavior in [Connectivity](connectivity.md); security rules in
[Security](security.md); AI and egress in [AI](ai.md); plugin behavior in
[Plugins](plugins.md); status and readiness in [Release and evidence](release.md).
Subsystem pages link to those owners instead of copying their policies.

Run `pnpm docs:check` after moving a page. It checks local Markdown links,
canonical English/Russian pairs, forbidden phase-style filenames and the
Russian network terminology rule without network access or extra dependencies.

## Release handoff

`pnpm release:check` is a preflight, not a signing operation. The owner must
provide updater, signing, store and optional provider credentials through the
appropriate release environment. The current expected credential blockers are
kept in [Release and evidence](release.md), not in subsystem docs.

## Owner-controlled desktop settings

The desktop shell uses the versioned `keystone.desktop.settings.v2` registry as
the canonical source for presentation and behavior preferences. Settings are
typed, validated, and resolved in this order: defaults, global, device,
workspace, surface, then window. A narrower scope overrides a broader one; a
missing context leaves the value at its broader scope. Core data, identity,
credentials, permissions and immutable security policy are not user settings.

Appearance changes use semantic tokens for theme, accent, colors, typography,
density, geometry, radii, borders, shadows, transparency and motion. Layout,
Home section order/visibility, tabs, shell actions and shortcuts are persisted
through the same registry. The Settings surface exposes undo/redo, scoped
reset, presets, safe JSON export/import and a presentation-only custom CSS
editor. Custom CSS is local and opt-in: imports, `url()`, executable CSS and
security-policy changes are rejected. If custom CSS causes a bad presentation,
enable Safe UI mode in Settings or set
`keystone.desktop.safe-ui-mode=1` before restarting.

Stable local styling hooks use `data-keystone-shell`,
`data-keystone-region` and `data-keystone-component`. They are not a remote
extension API and do not grant access to Keystone data or actions.
