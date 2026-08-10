<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Keystone architecture

## 1. Purpose and architectural principles

Keystone is a local-first AI and peer-to-peer life center. It presents one product across desktop, mobile, web, and a browser companion while keeping identity, personal knowledge, automation policy, and model execution under user control.

The architecture follows five invariants:

1. **No mandatory Keystone cloud.** Core operation cannot require a Keystone account, hosted database, telemetry endpoint, or model API.
2. **The core owns policy, not platform authority.** `packages/core` decides what may happen; native hosts provide narrowly scoped mechanisms for making it happen.
3. **AI output is untrusted.** Models emit proposals that must survive schema, target, capability, consent, expiry, and replay checks.
4. **Offline work is normal.** Each authorized node can update local state and reconcile later through Yjs.
5. **Security boundaries are explicit.** Renderers, native bridges, peers, relays, addons, browser content, models, and imported files are separate trust domains.

## 2. High-level topology

```text
┌──────────────────────────────── Interfaces ────────────────────────────────┐
│ React/Vite web │ Tauri desktop │ React Native + Expo │ Browser Companion │
└───────┬────────┴───────┬───────┴───────────┬─────────┴──────────┬────────┘
        │                │                   │                    │
        │       Rust/Tauri command ACL   Expo native modules   loopback WS
        │                │              GeckoView/WKWebView      │
        └─────────────── packages/ui + packages/browser-engine ──┘
                                  │
                         ┌────────▼────────┐
                         │ packages/core  │
                         │                │
                         │ identity       │
                         │ policy/consent │
                         │ Yjs sync       │
                         │ Orama RAG      │
                         │ Chronos        │
                         │ WebRTC control │
                         │ cold backup    │
                         └───┬────────┬───┘
                             │        │
           llama.cpp / whisper.cpp   Hyperswarm / HyperDHT
                    / Piper           signed envelopes + Noise
                             │        │
                             └── Yjs / WebRTC ── trusted peers
                                         │
                                  optional relay fallback
```

Dependencies point inward. Product surfaces may depend on shared packages; the domain core does not depend on React, Tauri, Expo, GeckoView, WKWebView, a keychain implementation, or a particular screen layout.

## 3. Product surfaces

### 3.1 Desktop: Tauri + React

The desktop application combines a React renderer with a Tauri 2 Rust host.

- **React** owns presentation and interaction state.
- **Tauri** owns the native process, command allowlist, filesystem dialogs, secure storage integration, update verification, global shortcuts, and OS automation bridges.
- **Rust commands** form a serialization boundary. The renderer receives purpose-built commands and copied values, never raw native handles or unrestricted process access.
- **Browser automation** runs through the `BrowserEngine` abstraction and confirmed payloads. It is not exposed as a generic remote-control API.
- **Local model runtimes** execute outside the renderer's event loop. Model loading, streaming, cancellation, and unload operations cross typed Tauri commands/events.

The renderer must be treated as compromisable web content. Tauri capabilities therefore remain deny-by-default, navigation is constrained, and every security-sensitive command validates its arguments again in the host.

### 3.2 Mobile: React Native + Expo

The mobile application uses React Native, Expo SDK, and Expo Router for the shared navigation and UI layer. Keystone also ships custom native modules, so it requires a development or production build rather than Expo Go.

- **Android** integrates GeckoView, Android permission flows, WebRTC capture, foreground services where required, and an explicitly enabled Accessibility Service for bounded UI automation.
- **iOS** integrates WKWebView and platform-specific capture and storage facilities within iOS background-execution limits.
- **Expo modules** implement the same host contracts used by the shared TypeScript layer. Native code validates confirmed tokens and consumes them once.
- **P2P lifecycle** is foreground-first. Mobile background execution is not modeled as an always-on DHT daemon; discovery is suspended and resumed according to platform lifecycle events.

React Native screens must not bypass the core to invoke sensitive native operations. A UI gesture starts a policy flow; only a successful authorization produces a native command.

### 3.3 Web: React + Vite

The web application is the fastest development and presentation shell. It uses React and Vite and shares UI and domain packages where browser capabilities permit. It does not pretend to provide desktop privileges: keychain, embedded inference, unrestricted filesystem access, and OS automation are host features, not browser fallbacks.

### 3.4 Browser Companion

`apps/extension` is a Manifest V3 companion for Chromium with a Firefox packaging manifest. It uses `@mozilla/readability` to extract the active page and submits a bounded RAG document to a loopback WebSocket endpoint.

The loopback boundary must:

- bind only to `127.0.0.1`;
- require the `keystone-companion-v1` subprotocol;
- validate origin, message shape, document size, and a paired random token;
- accept a fixed operation set rather than arbitrary core RPC;
- reject credentials, privileged URLs, and malformed content according to host policy.

Browser DOM content is attacker-controlled, even when it came from a page the user intentionally opened.

## 4. Shared packages and dependency direction

| Package | Architectural role |
| --- | --- |
| `@keystone/core` | Domain types, identity, crypto, signed transport, Yjs sync, consent, AI validation, RAG, Chronos, WebRTC coordination, model management, and backup. |
| `@keystone/ui` | Shared React Native-compatible primitives and feature views; contains no native authority. |
| `@keystone/browser-engine` | Host-neutral browser contract with Tauri, GeckoView, and WKWebView adapters. |
| `@keystone/addons` | Addon manifests, capabilities, lifecycle, validation, and sandbox RPC interfaces. |
| `@keystone/theme` | Versioned, validated, data-only design tokens. Themes cannot carry scripts or selectors. |

The core consumes interfaces for transport, secure persistence, clocks, notifications, capture, inference, and native execution. Hosts inject implementations. This arrangement keeps policy testable without launching a renderer or platform runtime.

## 5. P2P data plane: Hyperswarm + Yjs CRDT

### 5.1 Identity and pairing

Each profile begins with a 32-byte Master Seed held in platform secure storage. Device-specific Ed25519 signing and Curve25519 encryption material is derived deterministically with domain separation. Pairing transfers seed material only through a local, out-of-band flow represented by a `keystone://` QR payload.

The private Self swarm topic is derived from the Master Seed and is never published as a public identifier. The stable live-session peer identity is the Hyperswarm Noise public key. Trusted-node records and capabilities determine which messages a connected peer may send.

### 5.2 Transport

Hyperswarm and HyperDHT provide peer discovery and direct Noise-encrypted streams. Keystone frames versioned envelopes on top of those streams and applies application-level controls:

- sender and recipient identifiers;
- message type and schema version;
- creation and expiry timestamps;
- nonce and replay protection;
- detached signature;
- maximum frame and payload sizes;
- capability checks before dispatch.

Direct routes are preferred. `apps/relay` is a minimal rendezvous fallback for restrictive NAT or firewall conditions. A relay is not a trusted application endpoint: payloads requiring confidentiality must be encrypted for the final recipient, although the relay can still observe connection and volume metadata.

### 5.3 Yjs convergence

Yjs is the replicated state layer for the personal ecosystem. `CrdtSyncAdapter` binds a `Y.Doc` to the authenticated transport:

1. a local transaction produces a compact Yjs update;
2. the adapter sends the update only to authorized Self peers;
3. a joining peer supplies a state vector;
4. the sender computes and returns the missing diff;
5. remote updates are applied with a distinct origin to prevent echo loops.

CRDT convergence resolves concurrent structural edits without appointing a central database. It does not replace authorization: receiving a syntactically valid Yjs update is insufficient unless the sender is trusted for the document and operation.

### 5.4 WebRTC

WebRTC carries low-latency audio, video, screen-sharing, and data-channel sessions. Hyperswarm is the authenticated signaling path for offers, answers, and ICE candidates. The call manager uses perfect negotiation to handle glare and maintains an explicit one-call lifecycle.

Media capture remains a platform permission boundary. Browsers use standard media APIs and AudioWorklet where applicable; React Native uses `react-native-webrtc` and native capture facilities. On Android, screen sharing requires visible activity consent and a media-projection foreground service. See [`webrtc-platform-permissions.md`](webrtc-platform-permissions.md).

## 6. Local intelligence: Orama RAG + llama.cpp + whisper.cpp + Piper

### 6.1 RAG pipeline

`RAGManager` turns local knowledge into retrievable context:

```text
files / notes / Life Map / Context Capsules
                  │
        parse → normalize → chunk
                  │
       local embedding provider
                  │
          Orama vector index
                  │
         top-k bounded context
                  │
          selected model runtime
```

Orama supplies the in-process search index. The manager observes nested Yjs changes and updates documents incrementally. Credential-like private fields are excluded from indexed text and result metadata. Embeddings can be produced locally by Transformers.js, a local Ollama process, or a deterministic offline fallback when explicitly allowed by policy.

RAG results are context, not authority. Retrieved text may contain prompt injection and must never expand a model's tool set, capabilities, or native permissions.

### 6.2 llama.cpp

The local language-model adapter targets an embedded llama.cpp host runtime and GGUF assets. The native host owns model memory and hardware acceleration; TypeScript owns model selection and request orchestration.

- loading is explicit and tied to a user-selected model path;
- generation streams typed token events;
- every request has a unique identifier and cancellation path;
- model work runs off the async UI/runtime thread;
- unload releases native state deterministically;
- remote or OpenAI-compatible providers remain optional fallback adapters.

The React renderer never receives a raw llama context or filesystem authority.

### 6.3 whisper.cpp

The speech-to-text boundary streams normalized PCM chunks to an embedded whisper.cpp runtime. The adapter validates model descriptors, language options, session identifiers, and cancellation. Partial and final transcripts return as typed events and enter the same untrusted-input path as typed text.

### 6.4 Piper

Piper provides local text-to-speech. Voice model and configuration files are resolved by the host, then synthesis streams audio frames tagged with a request identifier. Cancellation, rate, speaker selection, and runtime errors are explicit. Text is synthesized locally unless the user deliberately chooses another provider.

### 6.5 Voice orchestration

The voice pipeline connects capture, voice-activity handling, whisper.cpp, constrained AI processing, and Piper without coupling these stages to a specific media transport. The same orchestration can consume local microphone frames or an authorized WebRTC audio source while each host retains ownership of capture and playback permission.

## 7. Chronos autonomous workflows

Chronos is the proactive scheduling and event engine. A rule contains a validated trigger, a bounded action, an enabled state, and an explicit delegation policy.

Supported trigger families include schedules, file creation, and Wi-Fi connection events. Actions include web digests, Life Map review, and constrained AI workflows. The engine:

- validates rules before storage;
- observes device power and background-execution state;
- supports cancellation with `AbortSignal`;
- appends started, succeeded, failed, skipped, and delegated audit entries;
- can delegate an eligible task to another active Self device over signed P2P envelopes;
- refuses delegation to arbitrary contacts or untrusted nodes.

Chronos does not create its own authority. A scheduled rule may exercise only capabilities explicitly granted when the rule was created, and consequential actions still enter the applicable confirmation flow.

## 8. Cold Backup and recovery

Cold Backup captures the minimum portable profile state:

- Master Seed;
- encoded Yjs document state;
- validated global configuration;
- serialized Orama assets.

The archive is encrypted into a versioned `.keystone` file with a key derived from a 12- or 24-word recovery mnemonic. The phrase is never embedded in the archive. Restore authenticates and fully validates the archive in a staging transaction before replacing live state; failure triggers rollback.

Hosts must write exports atomically, avoid logging the phrase, clear transient key material where the platform permits, and communicate that a lost recovery phrase cannot be recovered by Keystone.

## 9. Addon isolation

Addons are untrusted code. Installation never places addon JavaScript in the main React, Expo, or Tauri renderer context.

### 9.1 Runtime boundary

Production hosts implement `AddonSandboxRuntime` using a hardened separate runtime:

- desktop: isolated Tauri WebView, QuickJS, or Wasmtime with deny-all defaults;
- mobile: a separate native JS engine/runtime, not `eval`, `Function`, or the main Expo bridge.

The runtime receives no Node.js APIs, filesystem, sockets, process, environment, clipboard, native module registry, raw transport, CRDT object, credentials, or ambient `fetch`. Hosts verify signed bundles, safe relative entrypoints, and size limits, then enforce CPU, memory, and wall-clock quotas. Timeout or protocol violation destroys the runtime.

### 9.2 Capability model

The v1 capability allowlist is deliberately small:

| Capability | Scope | Consent |
| --- | --- | --- |
| `ai_prompt` | Submit a schema-constrained tool request through the host model path. | Declared permission plus schema validation. |
| `life_map_read` | Receive a host-filtered snapshot containing only approved fields. | Visible approval for every request. |
| `p2p_request` | Ask the host to perform one bounded peer operation. | Visible approval for every request. |

Unknown capabilities fail closed. A declared capability is not a standing grant for sensitive data. RPC handlers receive copied JSON, validate the operation again, and return the minimum result.

### 9.3 Extension surfaces

Addon tools are namespaced as `<addonId>:<toolId>` and validated immediately before execution. Custom Life Map nodes are metadata descriptors rendered by trusted host components. Widgets are declarative descriptions of host-owned primitives. Executable React components from addons are outside the v1 model.

## 10. Double Confirmation

Double Confirmation binds human intent to both disclosure and consequence.

```text
requester creates canonical action
              │
              ▼
core resolves trusted target, fields, audience, purpose, TTL
              │
              ▼
data owner reviews exact disclosure and signs approval #1
              │
              ▼
requester reviews final browser/OS/network action and signs approval #2
              │
              ▼
core verifies action hash + both signers + audience + nonce + expiry
              │
              ▼
native host atomically consumes token and executes once
```

The action is canonicalized and hashed before approval. Changing a URL, field, recipient, value, purpose, or expiry changes the hash and invalidates both signatures. A valid token is short-lived and one-use. Hosts persist consumed nonces where replay after restart would be consequential.

The two confirmations answer different questions:

1. **May this specific data leave its owner for this purpose and audience?**
2. **May this exact external side effect occur with the resulting data?**

Neither a model, addon, peer, nor renderer may synthesize either approval.

## 11. Trust boundaries and failure policy

| Boundary | Assumption | Required response |
| --- | --- | --- |
| Model output | May hallucinate or be prompt-injected. | Parse known schemas, resolve trusted identifiers, reject unknown fields. |
| Peer input | Authenticated peers can still be compromised. | Verify signature, capability, TTL, nonce, size, and message type. |
| Relay | Can observe metadata and tamper with transport bytes. | End-recipient encryption, signatures, direct-route preference. |
| Renderer | Web content may be compromised. | Narrow native commands, argument validation, CSP, no ambient native API. |
| Addon | Fully hostile. | Separate runtime, capability RPC, quotas, copied data, per-request consent. |
| Browser page | Attacker-controlled DOM and text. | Sanitize/extract, size-limit, treat indexed content as untrusted context. |
| Backup/import | Malformed or adversarial binary input. | Authenticate, bound allocation, validate every entry, stage and roll back. |
| Native host | Holds privileged mechanisms. | Minimize commands, audit use, consume authorization tokens atomically. |

When validation is ambiguous, Keystone fails closed. Availability fallbacks may reduce functionality, but they must not silently reduce consent, cryptographic, or isolation guarantees.

## 12. Build and verification boundaries

The pnpm workspace is the TypeScript verification unit. Every package exposing a `lint` script runs TypeScript with `--noEmit`; the root `pnpm tsc` command executes those checks recursively. Unit tests cover consent, AI validation, workflows, RAG, WebRTC signaling, themes, and addon behavior. Native hosts add Rust, Kotlin/Gradle, Swift/Xcode, permission, signing, and packaged-artifact checks.

Recommended release gate:

```bash
pnpm install --frozen-lockfile
pnpm tsc
pnpm test
pnpm build
pnpm --filter @keystone/desktop check
```

A successful web build is not evidence that native permission boundaries, updater signatures, media capture, addon sandboxing, or packaged local-model runtimes work. Each supported operating system must validate its final signed artifact.

## 13. Related documents

- [`protocol.md`](protocol.md) — message framing, pairing, identities, and synchronization.
- [`security.md`](security.md) — disclosure protocol and cryptographic checks.
- [`threat-model.md`](threat-model.md) — explicit threats and mitigations.
- [`addons.md`](addons.md) — addon runtime and capability details.
- [`ai.md`](ai.md) — model adapters and RAG behavior.
- [`webrtc-platform-permissions.md`](webrtc-platform-permissions.md) — capture constraints.
- [`relay.md`](relay.md) — relay deployment and trust assumptions.
