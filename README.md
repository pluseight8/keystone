<div align="center">

# 🔑 Keystone

### Your AI should not live in a tab. It should work across your devices—on your terms.

**Keystone is a privacy-first, peer-to-peer AI superapp that can reason locally, coordinate trusted devices, and—with explicit approval—interact with the operating system and the browser.**

![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-7c3aed?style=flat-square)
![Node.js 22](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white&style=flat-square)
![pnpm 9.15](https://img.shields.io/badge/pnpm-9.15-F69220?logo=pnpm&logoColor=white&style=flat-square)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white&style=flat-square)
![Expo 52](https://img.shields.io/badge/Expo-52-000020?logo=expo&logoColor=white&style=flat-square)
![Status: early development](https://img.shields.io/badge/status-early_development-f59e0b?style=flat-square)

[Why Keystone](#-why-keystone) · [Features](#-what-makes-keystone-different) · [Architecture](#-architecture) · [Quick start](#-quick-start) · [Security](#-security-model) · [Contributing](CONTRIBUTING.md)

</div>

---

## 🧭 Why Keystone?

Most assistants stop at an answer. Keystone is designed to complete a user-approved workflow.

Ask Keystone to research a purchase, retrieve an address from a trusted family device, fill a checkout form, or operate an accessible UI. The model proposes a narrowly scoped action; Keystone validates the target and permissions, collects the required confirmations, and only then delegates execution to a native host.

That distinction matters:

- **The model proposes.** It cannot invent trusted nodes or grant itself capabilities.
- **The protocol verifies.** Actions are hashed, signed, scoped, time-limited, and replay-resistant.
- **The user authorizes.** Personal-data disclosure and external side effects require explicit confirmation.
- **The native host executes.** Tauri, GeckoView, WKWebView, and Android Accessibility APIs provide bounded bridges to the real device.

> Keystone is not a cloud account wrapped around a chatbot. It is a network of user-owned nodes with an AI command layer.

## ✨ What makes Keystone different

### 🌐 Decentralized by default

| Technology | What it does |
| --- | --- |
| **Hyperswarm + HyperDHT** | Discovers peers and establishes direct Noise-encrypted connections without a central message broker. |
| **Relay fallback** | Pairs peers behind restrictive NATs or firewalls when a direct route cannot be established. Direct connections remain preferred. |
| **Replaceable transport boundary** | Keeps domain logic independent from a specific network adapter so the protocol can evolve without rewriting the product. |

### 🛡️ Privacy by architecture, not by policy

| Technology | What it does |
| --- | --- |
| **libsodium** | Provides Ed25519 identities and signatures, secure nonces, and BLAKE2b action hashes. |
| **Double Confirmation** | Requires the data owner to approve the exact disclosure and the requester to approve the exact resulting action. |
| **Capabilities, TTLs, and one-use nonces** | Limit who may do what, for how long, and prevent an approved action from being replayed. |
| **Recipient encryption over relays** | Rejects plaintext application bodies on relay paths; the relay remains a metadata-visible fallback, not a trusted endpoint. |

### 🧠 Local AI and local memory

| Technology | What it does |
| --- | --- |
| **Ollama / OpenAI-compatible runtimes** | Runs tool-capable models locally through the `/v1/chat/completions` interface. Remote OAuth and API adapters remain optional. |
| **Local RAG boundary** | Retrieves trusted-node and memory context through a host-provided `ContextManager` instead of placing a central service inside the core. |
| **Schema-constrained tools** | Accepts only known action shapes, trusted nodes, and allowed fields. Invalid or hallucinated targets fail closed. |

### 🦾 OS-level and browser automation

| Host | Native automation surface |
| --- | --- |
| **Android** | A user-enabled Accessibility Service exposes a bounded UI tree, gestures, and focused-field input; GeckoView powers the embedded browser. |
| **Desktop** | Tauri commands bridge to `enigo` for keyboard and pointer input and to an isolated automation webview for confirmed field injection. |
| **iOS** | WKWebView implements the shared browser contract within iOS platform constraints. |

Automation is intentionally not a generic remote-control API. Browser injection uses fixed field mappings, HTTPS origins, short-lived confirmation tokens, and one-use execution paths.

## 🔐 How Double Confirmation works

```text
Requester proposes an action
          │
          ▼
Core resolves a trusted node and hashes the exact action
          │
          ▼
Data owner reviews fields, purpose, audience, and expiry ── signs approval #1
          │
          ▼
Requester reviews the final browser/OS action ───────────── signs approval #2
          │
          ▼
Core verifies both signatures + hash + nonce + TTL
          │
          ▼
Native host consumes the token once and executes
```

Any mismatch in the action hash, signer, audience, nonce, or expiry aborts the flow.

## 🏗️ Architecture

Keystone is a **pnpm workspace** with shared TypeScript packages and platform-specific hosts:

```text
┌──────────────────────────────── Product surfaces ────────────────────────────────┐
│  apps/web (React/Vite)   apps/desktop (Tauri)   apps/mobile (Expo/React Native) │
└───────────────┬──────────────────────┬──────────────────────┬────────────────────┘
                │                      │                      │
        packages/ui             Native OS bridges     packages/browser-engine
                │                enigo / A11y API      Tauri / GeckoView / WKWebView
                └──────────────────────┴──────────────────────┘
                                       │
                               packages/core
                       intent → policy → consent → audit
                          │                           │
                   Local model + RAG          Signed P2P envelopes
                    (for example, Ollama)             │
                                                Hyperswarm
                                                    │
                                            apps/relay fallback

                     packages/theme → validated data-only design tokens
```

### Repository map

| Path | Responsibility |
| --- | --- |
| [`packages/core`](packages/core) | Domain types, crypto provider, Double Confirmation, AI action validation, engine, and Hyperswarm transport. No React dependency. |
| [`packages/ui`](packages/ui) | Shared accessible React Native primitives used across product surfaces. |
| [`packages/theme`](packages/theme) | Versioned theme manifests and the built-in **Neumorphism** and **Frutiger Aero** presets. |
| [`packages/browser-engine`](packages/browser-engine) | Cross-platform boundary for Tauri, GeckoView, and WKWebView browser automation. |
| [`apps/web`](apps/web) | Vite-powered web UI shell and the fastest development feedback loop. |
| [`apps/desktop`](apps/desktop) | Tauri 2 host, Rust security boundary, desktop automation, and native bundles. |
| [`apps/mobile`](apps/mobile) | Expo Router host plus native Android/iOS browser modules and mobile P2P lifecycle. |
| [`apps/relay`](apps/relay) | Minimal HyperDHT rendezvous relay for otherwise unreachable peers. |
| [`docs`](docs) | Protocol, threat model, platform, security, AI, relay, and CI/CD design notes. |

The core depends on interfaces—not UI frameworks, keychains, or browser implementations. Each host supplies secure storage and platform capabilities while the core owns policy and consent.

## 🚀 Quick start

### Prerequisites

- **Node.js 22** (the version used by CI)
- **Corepack** and the repository-pinned **pnpm 9.15.0**
- **Rust stable** plus platform dependencies for the desktop host
- **JDK 17**, Android Studio/SDK, and ADB for Android development
- Optional: **Ollama** with a tool-capable local model

### 1. Install the workspace

From the repository root:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate

pnpm install
pnpm test
pnpm lint
```

> Use `pnpm` from the workspace root. Do not mix npm, Yarn, and pnpm lockfiles.

### 2. Start the web shell

```bash
pnpm dev
```

Vite prints the local URL. This is the quickest way to work on the UI, but a browser tab cannot provide Tauri or mobile native automation capabilities.

### 3. Connect a local model (optional)

Keystone's `OpenAICompatibleAdapter` can target Ollama's OpenAI-compatible endpoint:

```bash
ollama pull <tool-capable-model>
ollama serve
```

```ts
import { OpenAICompatibleAdapter } from '@keystone/core';

const model = new OpenAICompatibleAdapter({
  kind: 'local',
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: '<tool-capable-model>',
});
```

Choose a model that supports function/tool calling. See the [Ollama OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility).

## 🖥️ Run the desktop host

Install the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, including Rust and the platform webview toolchain. Then run:

```bash
pnpm --filter @keystone/web build
pnpm --filter @keystone/desktop check
pnpm --filter @keystone/desktop tauri dev
```

Create a native bundle with:

```bash
pnpm --filter @keystone/desktop tauri build
```

Desktop automation still requires the relevant user grant. Wayland compositors may restrict global input; macOS requires Accessibility permission; Windows automation is constrained by integrity level. See [`OS_AUTOMATION.md`](apps/desktop/src-tauri/OS_AUTOMATION.md).

### Atomic Linux: Bazzite, Fedora Atomic, Silverblue, and Kinoite

Image-based systems keep much of the host immutable. The cleanest development setup is a mutable **Distrobox** container with the repository directory shared from the host:

```bash
# On the host
distrobox create --name keystone-dev \
  --image registry.fedoraproject.org/fedora:latest
distrobox enter keystone-dev

# Inside the container
sudo dnf install -y \
  webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel \
  gcc gcc-c++ make pkgconf-pkg-config
sudo dnf group install -y c-development

# Install Node.js 22 and Rust stable in the container, then:
corepack enable
corepack prepare pnpm@9.15.0 --activate
cd /path/to/keystone
pnpm install
pnpm --filter @keystone/web build
pnpm --filter @keystone/desktop tauri dev
```

Distrobox forwards the desktop session and shares your home directory, so the Tauri window can run against the host display while build dependencies stay inside the container. If the packaged binary—not just `tauri dev`—is the artifact under test, validate it on its target distribution as well; CI builds remain the reproducible release path.

You can instead layer the official Tauri dependencies with `rpm-ostree`, but that modifies the deployment and requires a reboot. Prefer Distrobox for an iterative development environment.

## 📱 Run on a physical Android device

Keystone includes GeckoView and an Android Accessibility Service as custom native modules. **Expo Go cannot load them.** Build the native debug client through Expo CLI.

1. Install Android Studio, JDK 17, the Android SDK, and platform tools.
2. On the phone, enable **Developer options → USB debugging**.
3. Connect the device by USB, accept its RSA prompt, and verify it:

   ```bash
   adb devices
   ```

4. Build, install, and start Keystone on the selected device:

   ```bash
   corepack enable
   pnpm install
   pnpm --dir apps/mobile exec expo run:android --device
   ```

   This works on current arm64 Android hardware, including devices such as the Galaxy S24 Ultra. The first build generates the native Android project and downloads Gradle/GeckoView dependencies.

5. For later JavaScript/TypeScript-only changes, start Metro without rebuilding native code:

   ```bash
   adb reverse tcp:8081 tcp:8081   # reliable Metro access over USB
   pnpm --filter @keystone/mobile start
   ```

6. To test OS automation, explicitly enable **Keystone UI automation** in Android's Accessibility settings. On Samsung devices this is typically under **Settings → Accessibility → Installed apps**. Review the warning before granting access and disable the service when testing is complete.

Re-run `expo run:android --device` after changing Kotlin, Gradle, the native manifest, or Expo configuration. See Expo's [local app development guide](https://docs.expo.dev/guides/local-app-development/) for SDK setup and device selection.

## 🌉 Run a relay

Direct Hyperswarm connections are preferred. To run a development relay:

```bash
export RELAY_SEED="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
pnpm --filter @keystone/relay dev
```

The first JSON log line contains the relay public key and observed UDP address. Keep `RELAY_SEED` stable for a persistent relay identity and store production seeds in a secret manager. Deployment and firewall notes live in [`apps/relay/README.md`](apps/relay/README.md).

## ✅ Quality checks

```bash
pnpm lint       # TypeScript checks across the workspace
pnpm test       # Core consent/AI/workflow and theme tests
pnpm build      # Build every package that exposes a build script
```

Native checks:

```bash
pnpm --filter @keystone/desktop check
pnpm --dir apps/mobile exec expo prebuild --platform android
```

## 🔒 Security model

Keystone is built around least privilege, explicit consent, signed actions, short expiry windows, and auditable boundaries. Start with:

- [`docs/security.md`](docs/security.md) — the disclosure protocol
- [`docs/threat-model.md`](docs/threat-model.md) — assets, threats, and mitigations
- [`docs/protocol.md`](docs/protocol.md) — signed envelope format and framing
- [`docs/relay.md`](docs/relay.md) — direct routing and relay trust boundaries

> [!CAUTION]
> Keystone is in early development and has not been presented as independently security-audited. No software can promise absolute security or anonymity. Do not use the current code to protect high-risk identities, irreversible financial actions, or production secrets without completing the hardening work described in the threat model—especially encrypted persistence for consumed tokens and recipient-level encryption on relay paths.

Never commit identity seeds, API keys, real personal data, exported browser sessions, or relay secrets.

## 🤝 Contributing

Contributions are welcome across TypeScript, Rust, Kotlin, Swift, protocol design, accessibility, documentation, and themes.

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. It includes:

- the development and review workflow;
- direct and relay-backed P2P testing guidance;
- security-sensitive change requirements; and
- the `keystone.theme.v1` manifest format for community themes.

## 📚 Documentation

| Document | Topic |
| --- | --- |
| [`architecture.md`](docs/architecture.md) | Domain and adapter boundaries |
| [`platform-architecture.md`](docs/platform-architecture.md) | Desktop, mobile, and browser hosts |
| [`ai.md`](docs/ai.md) | Model providers and constrained commands |
| [`protocol.md`](docs/protocol.md) | P2P message envelopes |
| [`relay.md`](docs/relay.md) | Rendezvous fallback |
| [`ci.md`](docs/ci.md) | CI/CD targets and signing notes |

## 📄 License

Keystone is licensed under **AGPL-3.0-or-later**. Network-accessible modified versions must make their corresponding source available under the license terms.

---

<div align="center">

**Local intelligence. User-owned identity. Explicit authority.**

</div>
