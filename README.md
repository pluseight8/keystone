<div align="center">

<img src="branding/logos/logo+text-of-logo.png" alt="Keystone" width="560">

# The Ultimate Local-First AI & P2P Life Center

**Keystone turns your devices into one private, intelligent system: local AI, durable personal memory, encrypted peer-to-peer communication, autonomous workflows, and explicitly authorized automation.**

[![Source-Available](https://img.shields.io/badge/LICENSE-SOURCE--AVAILABLE-8B0000?style=for-the-badge&labelColor=090909)](LICENSE.md)
![Privacy First](https://img.shields.io/badge/PRIVACY-LOCAL--FIRST-DC143C?style=for-the-badge&labelColor=090909)
![P2P](https://img.shields.io/badge/NETWORK-P2P-8B0000?style=for-the-badge&labelColor=090909)
![TypeScript](https://img.shields.io/badge/CORE-TYPESCRIPT-DC143C?style=for-the-badge&labelColor=090909)

[Get started](#quick-start) · [Architecture](docs/ARCHITECTURE.md) · [Security](docs/security.md) · [Protocol](docs/protocol.md) · [Русская документация](docs/ru/README.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## One life. Every device. No mandatory cloud.

Keystone is a local-first life center for people who want capable AI without surrendering their data, identity, or authority to a hosted platform. It combines a synchronized Life Map, retrieval-augmented local memory, private calls and device handoff, voice and vision pipelines, and proactive automation behind one security model.

The system is designed around a strict division of responsibility:

- **Models propose; policy decides.** AI output is untrusted input and must match a known schema, node, field allowlist, and capability.
- **People authorize consequences.** Personal-data disclosure and external side effects pass through Double Confirmation.
- **Peers synchronize; no account owns the graph.** Trusted devices exchange signed state directly and converge through CRDTs.
- **Native hosts execute.** Tauri and Expo modules expose bounded platform capabilities; the shared core never receives ambient authority.

> Keystone is not another chatbot tab. It is the private coordination layer between your knowledge, your models, and your devices.

## Philosophy

### Non-commercial by design

Keystone has no payments, purchases, billing, advertising, marketplace, or
monetization features. It is a non-commercial local-first project; protocol
capabilities intentionally exclude financial actions.

### Zero dependency on a mandatory service

“Zero Dependency” means Keystone has no required Keystone-operated cloud, account, telemetry collector, model API, or message broker. Core workflows remain available on hardware you control. Optional relays and external model providers are replaceable adapters—not architectural owners of your data.

### Privacy first

Personal context is processed locally by default. Ed25519 identities, signed envelopes, scoped capabilities, expiry windows, and one-use nonces reduce implicit trust. Relay paths carry recipient-encrypted application payloads; sensitive addon requests require visible consent.

### Source-available, inspectable, accountable

The complete implementation is available for inspection and security review under the [Keystone Source-Available License](LICENSE.md). Source-available does **not** mean Open Source: modification, redistribution, commercial use, and public forks require prior permission unless the license explicitly allows them.

## Killer features

| Capability | What Keystone delivers | Why it matters |
| --- | --- | --- |
| **Local RAG** | Orama vector retrieval over notes, Life Map nodes, files, and Context Capsules; Yjs changes are indexed incrementally. | Your context stays near the model and remains useful offline. |
| **Private WebRTC** | Audio, video, screen sharing, and device handoff with signaling carried over authenticated Hyperswarm envelopes. | Real-time collaboration without making a central communications account the source of identity. |
| **Chronos** | Scheduled and event-driven AI workflows with audit history, cancellation, power-awareness, and delegation to another trusted Self device. | Automation continues across your personal device mesh without granting an agent unlimited authority. |
| **Local models** | Embedded llama.cpp inference, whisper.cpp speech recognition, and Piper speech synthesis, plus optional OpenAI-compatible adapters. | Text and voice can stay on-device; the runtime remains user-selectable. |
| **Cold Backups** | A single encrypted `.keystone` archive containing identity seed, Yjs state, configuration, and RAG assets, protected by a 12- or 24-word recovery phrase. | Recovery does not depend on a vendor account or a running Keystone service. |
| **P2P Life Map** | Hyperswarm discovery and Noise-encrypted transport with Yjs CRDT convergence across trusted devices. | Every authorized device can work offline and merge later. |
| **Browser Companion** | A Manifest V3 extension extracts readable pages and sends them to the loopback RAG boundary. | Turn the open web into private, searchable memory without uploading the page. |
| **Double Confirmation** | The data owner approves the exact disclosure; the requester approves the exact resulting action. | Consent is bound cryptographically to the action that will execute. |

## System at a glance

```text
┌────────────────────────────── PRODUCT SURFACES ──────────────────────────────┐
│  Web / React        Desktop / Tauri        Mobile / React Native + Expo     │
│  Browser Companion                         Android + iOS native modules      │
└──────────────┬───────────────────┬──────────────────────┬────────────────────┘
               │                   │                      │
          packages/ui      bounded native bridges   packages/browser-engine
               └───────────────────┴──────────────────────┘
                                   │
                         ┌─────────▼─────────┐
                         │  packages/core   │
                         │ policy · consent │
                         │ RAG · Chronos    │
                         │ sync · identity  │
                         └──────┬─────┬─────┘
                                │     │
                    Orama + local AI  Hyperswarm + Yjs
                    llama/whisper/    WebRTC media
                    Piper             relay fallback
```

Read the full design in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| [`apps/web`](apps/web) | React/Vite development shell. |
| [`apps/desktop`](apps/desktop) | Tauri 2 host, native desktop capabilities, updates, and automation boundaries. |
| [`apps/mobile`](apps/mobile) | Expo Router and React Native host with Android/iOS native modules. |
| [`apps/extension`](apps/extension) | Chromium/Firefox Browser Companion for local page ingestion. |
| [`apps/relay`](apps/relay) | Minimal HyperDHT rendezvous fallback for peers that cannot connect directly. |
| [`packages/core`](packages/core) | Framework-independent identity, transport, CRDT, consent, RAG, model, voice, WebRTC, backup, and Chronos logic. |
| [`packages/ui`](packages/ui) | Shared React Native primitives and product views. |
| [`packages/browser-engine`](packages/browser-engine) | Common Tauri, GeckoView, and WKWebView automation contract. |
| [`packages/addons`](packages/addons) | Addon manifests, capability checks, registration, and sandbox RPC contracts. |
| [`packages/theme`](packages/theme) | Validated data-only design tokens and themes. |

## Quick start

### Requirements

- Node.js 22
- Corepack and pnpm 9.15.0
- Rust stable plus the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for desktop builds
- JDK 17 and Android Studio/SDK for Android builds
- Xcode for iOS builds

### Install and verify

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

pnpm tsc
pnpm test
pnpm test:integration
pnpm test:network
pnpm build
pnpm release:check
```

Run commands from the repository root. Do not mix npm, Yarn, and pnpm lockfiles.
`release:check` runs the cross-platform static and available-host checks. It
reports production credentials as `BLOCKED` in development mode; use
`pnpm release:check -- --release` only in the owner-controlled release CI.
`test` is the fast unit suite; `test:integration` is the controlled distributed
failure suite; `test:network` starts independent processes over an isolated
real Hyperswarm/Noise network. See the [network guide](docs/testing/real-network.md).

AI tool and skill boundaries are documented in [AI tools](docs/ai-tools.md)
and [skills](docs/skills.md). Local-first agent sessions and bounded context
are documented in [agents](docs/agents.md), [agent sessions](docs/agent-sessions.md)
and [context engine](docs/context-engine.md). Safe scheduled and event-driven
jobs are documented in [Agent automation](docs/agent-automation.md) and
[Chronos + Agents](docs/chronos-agents.md). Signed P2P guest visits and
temporary multi-agent rooms are documented in [Agent visits](docs/agent-visits.md)
and [Agent Rooms](docs/agent-rooms.md).

### Run the web shell

```bash
pnpm dev
```

The web shell is the fastest UI feedback loop. Native automation, embedded runtimes, and mobile modules require their platform hosts.

### Run the desktop host

```bash
pnpm --filter @keystone/web build
pnpm --filter @keystone/desktop check
pnpm --filter @keystone/desktop tauri dev
```

Build distributable desktop artifacts with:

```bash
pnpm --filter @keystone/desktop tauri build
```

Browser form injection requires an explicit, double-confirmed action. Generic OS automation is currently unavailable pending platform-native adapters that can verify authorization at the native boundary; see [`apps/desktop/src-tauri/OS_AUTOMATION.md`](apps/desktop/src-tauri/OS_AUTOMATION.md).

### Run mobile

Keystone uses custom native modules, so **Expo Go is not supported**.

```bash
# Android device or emulator
pnpm --dir apps/mobile exec expo run:android

# iOS simulator or device on macOS
pnpm --dir apps/mobile exec expo run:ios
```

For JavaScript-only iteration after the native client is installed:

```bash
pnpm --filter @keystone/mobile start
```

### Build the Browser Companion

```bash
pnpm --filter @keystone/extension build
```

Load `apps/extension/dist` as an unpacked extension in a Chromium browser. For Firefox packaging, replace the generated manifest with `apps/extension/manifest.firefox.json`. The desktop loopback host must bind to `127.0.0.1` and validate the extension origin, subprotocol, payload size, and pairing token.

### Run a development relay

```bash
export RELAY_SEED="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
pnpm --filter @keystone/relay dev
```

Direct peer connections remain preferred. Store a stable production relay seed in a secret manager; never commit it.

## Install a release

On supported Linux and macOS systems, the helper resolves the latest release artifact and installs it locally:

```bash
./scripts/install.sh
```

Remove the installed application with:

```bash
./scripts/uninstall.sh
```

Review both scripts before execution. Release binaries, update signatures, and mobile distribution remain platform-specific.

## Security posture

Keystone follows least privilege and fail-closed validation, but it is still early-stage software and has not been represented as independently audited.

- Never commit identity seeds, recovery phrases, API keys, browser sessions, relay secrets, or real personal datasets.
- Treat every model response, remote envelope, addon message, imported archive, and browser payload as untrusted.
- Do not use the current release for irreversible financial actions, high-risk identities, or production secrets without completing an independent review.

Start with the [architecture](docs/ARCHITECTURE.md), [security protocol](docs/security.md), [threat model](docs/threat-model.md), [P2P protocol](docs/protocol.md), and [addon model](docs/addons.md).

## Documentation

| Document | Subject |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | End-to-end system design and trust boundaries. |
| [`docs/protocol.md`](docs/protocol.md) | Signed P2P envelopes, pairing, and CRDT synchronization. |
| [`docs/social-protocol.md`](docs/social-protocol.md) | Signed profiles and decentralized social graph foundation. |
| [`docs/communities.md`](docs/communities.md) | Signed community roles, channels, and moderation projection. |
| [`docs/content-addressing.md`](docs/content-addressing.md) | Immutable P2P content manifests, cache limits, and integrity checks. |
| [`docs/attachments.md`](docs/attachments.md) | Signed message attachments backed by resumable P2P content transfer. |
| [`docs/music.md`](docs/music.md) | Signed music catalog and local playback foundation. |
| [`docs/video.md`](docs/video.md) | Signed video metadata and range-aware playback foundation. |
| [`docs/short-videos.md`](docs/short-videos.md) | Signed vertical-video objects and range-prefetching short feed. |
| [`docs/streams.md`](docs/streams.md) | Signed live-broadcast lifecycle, live chat, and P2P distribution-tree contract. |
| [`docs/discovery.md`](docs/discovery.md) | Local-first unified feed, search, and opt-in scoped P2P discovery. |
| [`docs/hardening.md`](docs/hardening.md) | Phase 12 safety, storage, multi-device, and performance boundaries. |
| [`docs/PHASE12_REVIEW.md`](docs/PHASE12_REVIEW.md) | Source-level integration review and explicit host responsibilities. |
| [`docs/PLATFORM_READINESS.md`](docs/PLATFORM_READINESS.md) | Evidence-based Linux/Windows/macOS/Android/iOS readiness matrix and release blockers. |
| [`docs/release`](docs/release) | Platform-specific Android, Windows, macOS, and iOS release boundaries. |
| [`docs/i18n.md`](docs/i18n.md) | English/Russian language preference and translation contract. |
| [`docs/ru/README.md`](docs/ru/README.md) | Русский вход в документацию и обзор социальной/медиа-подсистемы. |
| [`docs/security.md`](docs/security.md) | Disclosure and execution authorization. |
| [`docs/threat-model.md`](docs/threat-model.md) | Assets, threats, assumptions, and mitigations. |
| [`docs/addons.md`](docs/addons.md) | Addon isolation and capability enforcement. |
| [`docs/ai.md`](docs/ai.md) | AI providers, constrained commands, and RAG. |
| [`docs/ai-runtime.md`](docs/ai-runtime.md) | Local runtime lifecycle, provider/model routing, and host boundaries. |
| [`docs/ai-privacy.md`](docs/ai-privacy.md) | External AI egress classes, firewall, tool intents, and audit semantics. |
| [`docs/ai-context.md`](docs/ai-context.md) | Unified local-first context resolver, provenance, permissions, scopes, and bounded citations. |
| [`docs/ai-search.md`](docs/ai-search.md) | Personal AI search UI, cross-object references, temporal queries, and source handling. |
| [`docs/personal-ai-mesh.md`](docs/personal-ai-mesh.md) | Trusted-device personal AI compute, streaming, routing, and privacy boundary. |
| [`docs/ai-orchestration.md`](docs/ai-orchestration.md) | Private-first planning, safe external subtasks, bounded delegation, and provenance. |
| [`docs/memory.md`](docs/memory.md) | Local Personal Memory entries, provenance, controls, privacy, and bounded retrieval. |
| [`docs/memory-consolidation.md`](docs/memory-consolidation.md) | Local-only consolidation, deduplication, conflicts, and Chronos adapter. |
| [`docs/agent-visits.md`](docs/agent-visits.md) | Signed, scoped and revocable P2P guest-agent visits. |
| [`docs/agent-rooms.md`](docs/agent-rooms.md) | Temporary rooms with explicitly shared safe context. |
| [`docs/shared-spaces.md`](docs/shared-spaces.md) | Signed P2P Shared Spaces, durable CRDT objects, roles, bounded agents, and explicit sharing. |
| [`docs/shared-workspaces.md`](docs/shared-workspaces.md) | Shared Space wire protocol, private epochs, replay checks, and production transport tests. |
| [`docs/webrtc-platform-permissions.md`](docs/webrtc-platform-permissions.md) | WebRTC capture permissions by platform. |
| [`docs/ci.md`](docs/ci.md) | CI/CD and release-signing targets. |

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening an issue or pull request. Contributions are governed by the Contributor Assignment Agreement described there. Community participation does not change Keystone's source-available licensing status.

## License

Copyright © 2026 Keystone copyright holder(s). All rights reserved.

Keystone is proprietary **source-available** software, not FOSS or Open Source. The [Keystone Source-Available License](LICENSE.md) permits inspection, security review, and limited unmodified non-commercial local use subject to its terms. It does not grant general rights to modify, fork, redistribute, host, or use the software commercially.

---

<div align="center">

**LOCAL INTELLIGENCE · USER-OWNED IDENTITY · EXPLICIT AUTHORITY**

</div>
