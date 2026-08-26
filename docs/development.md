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
