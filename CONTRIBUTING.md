# Contributing to Keystone

Thank you for helping build a user-owned AI network. Keystone welcomes contributions to the protocol, core engine, desktop and mobile hosts, UI system, documentation, relay, and community themes.

This guide explains how to make changes that are reviewable, testable, and consistent with Keystone's security model.

## 📌 Contents

- [Ground rules](#-ground-rules)
- [Choose an area](#-choose-an-area)
- [Set up the workspace](#-set-up-the-workspace)
- [Development workflow](#-development-workflow)
- [Quality and testing](#-quality-and-testing)
- [Test P2P connections](#-test-p2p-connections)
- [Contribute a theme](#-contribute-a-theme)
- [Security-sensitive changes](#-security-sensitive-changes)
- [Open a pull request](#-open-a-pull-request)

## 🧭 Ground rules

Every contribution must preserve these invariants:

1. **The user remains the authority.** Models propose actions; they do not approve or execute them.
2. **Consent is explicit and scoped.** Personal data and external side effects require Double Confirmation.
3. **Untrusted input fails closed.** Reject unknown protocol versions, peers, fields, capabilities, origins, and tool calls.
4. **Secrets stay out of prompts and source control.** Use an OS keychain or a test-only fixture.
5. **Platform boundaries stay narrow.** Do not add a generic remote `eval`, shell, selector, or accessibility-control API.
6. **Privacy claims stay precise.** Relays can observe metadata; local processing does not automatically make a system anonymous.

Be constructive, assume good intent, and critique the change rather than the contributor. Harassment, discrimination, or disclosure of another person's private data is not acceptable.

## 🗺️ Choose an area

| Area | Start here | Typical changes |
| --- | --- | --- |
| Core and protocol | [`packages/core`](packages/core), [`docs/protocol.md`](docs/protocol.md) | Consent, crypto adapters, message framing, AI validation, transport |
| Shared UI | [`packages/ui`](packages/ui) | Accessible cross-platform primitives and interaction states |
| Themes | [`packages/theme`](packages/theme) | Manifests, presets, token validation, rendering tests |
| Desktop | [`apps/desktop`](apps/desktop) | Tauri commands, Rust boundary, `enigo`, packaging |
| Mobile | [`apps/mobile`](apps/mobile) | Expo Router, Kotlin/Swift modules, GeckoView/WKWebView, accessibility |
| Relay | [`apps/relay`](apps/relay) | HyperDHT routing, backpressure, deployment hardening |
| Documentation | [`docs`](docs) | Architecture decisions, threat model, guides, diagrams |

For a large feature or protocol change, open a design discussion before investing in implementation. Explain the user problem, trust boundary, compatibility impact, and rejected alternatives. Small fixes can go directly to a pull request.

## 🛠️ Set up the workspace

Keystone uses the package manager version declared in the root `package.json`.

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install
```

Run the baseline before editing:

```bash
pnpm lint
pnpm test
pnpm build
```

Additional platform prerequisites:

- Desktop: Rust stable and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/).
- Android: JDK 17, Android SDK/platform tools, and an emulator or USB-connected device.
- iOS: macOS, Xcode, and CocoaPods.
- Atomic Linux: use the Distrobox workflow in the [README](README.md#atomic-linux-bazzite-fedora-atomic-silverblue-and-kinoite).

## 🌿 Development workflow

1. Fork the repository and create a focused branch from the current default branch:

   ```bash
   git switch -c feat/short-description
   # Also useful: fix/, docs/, test/, refactor/, theme/
   ```

2. Keep the change small enough to review. Separate formatting-only work from behavior changes.
3. Add or update tests with the implementation.
4. Update the relevant document when changing a protocol, public contract, permission, environment variable, or setup command.
5. Run the checks for every affected package and host.
6. Write a pull request that explains behavior and risk, not only the files changed.

### Commit messages

Use a short, imperative subject. Conventional Commit prefixes are encouraged:

```text
feat(core): reject expired disclosure approvals
fix(relay): preserve backpressure while pairing peers
docs(mobile): explain physical-device debug builds
theme(aurora): add a high-contrast dark preset
```

Avoid bundling generated native projects, build output, credentials, logs, or unrelated dependency upgrades into the same commit.

### Dependency changes

- Add dependencies to the narrowest workspace package with `pnpm --filter <package> add <dependency>`.
- Explain why a new runtime dependency is needed and how it affects bundle size, native permissions, and the attack surface.
- Never replace libsodium primitives with ad hoc cryptography.
- Do not add analytics, telemetry, or remote model calls without an explicit opt-in design and threat-model update.

## ✅ Quality and testing

### Required checks

```bash
pnpm lint
pnpm test
pnpm build
```

Run targeted checks while iterating:

```bash
pnpm --filter @keystone/core test
pnpm --filter @keystone/theme test
pnpm --filter @keystone/desktop check
pnpm --filter @keystone/mobile lint
```

### What a good test covers

- the expected success path;
- malformed, missing, expired, and oversized input;
- replay of a consumed nonce or confirmation token;
- a changed action hash, signer, recipient, or origin;
- cleanup after disconnect, timeout, cancellation, and error;
- no real personal data, credentials, or persistent identity keys.

Use deterministic clocks, seeded fixtures, and bounded timeouts where possible. Do not make the default unit suite depend on the public DHT or arbitrary sleeps.

### Platform changes

Native changes need evidence from the relevant host:

- **Desktop:** state the OS, display server (Wayland/X11 where relevant), command run, permission state, and observed result.
- **Android:** state the device/emulator, Android version, ABI, whether Accessibility was enabled, and whether GeckoView was rebuilt.
- **iOS:** state the device/simulator, iOS version, and Xcode version.
- **UI:** include keyboard, screen-reader, reduced-motion, light/dark appearance, and narrow-screen checks when applicable.

Do not enable accessibility or automation permissions silently. Tests must leave the device in a safe state and tell the reviewer how to revoke any grant.

## 🌐 Test P2P connections

P2P changes require more than one kind of test. A loopback transport proves application flow; it does **not** prove discovery, framing, Noise connections, NAT behavior, or relay fallback.

### Test matrix

| Layer | Topology | Purpose | Default CI? |
| --- | --- | --- | --- |
| Unit | One process with fakes | Validation, framing, timeouts, replay, cleanup | Yes |
| Loopback | Two engines using `TestLoopbackTransport` | End-to-end domain workflow without a network | Yes |
| Direct transport | Two independent `HyperswarmTransport` nodes | Real discovery, connection, framing, disconnect | Opt-in |
| Relay transport | Two nodes with direct transport deliberately disabled | Reciprocal relay pairing and ciphertext-only enforcement | Opt-in |
| Device/network | Two machines or networks | NAT, firewall, Wi-Fi/cellular, lifecycle behavior | Manual |

### 1. Run deterministic tests

```bash
pnpm --filter @keystone/core test
```

Use `TestLoopbackTransport` from `packages/core/src/testing.ts` only in tests. Assert that the action still requires confirmation and that no side effect occurs before authorization.

### 2. Add a real direct-transport integration test

The repository exposes a transport library rather than a standalone node CLI, so a real local P2P test belongs in an opt-in integration fixture under `packages/core/src`.

Create **two independent nodes** with unique random 32-byte test identities. Do not reuse production identities or hard-code private keys.

```ts
import { randomBytes } from 'node:crypto';
import { HyperswarmTransport } from './transport.js';

const aliceKey = randomBytes(32);
const bobKey = randomBytes(32);
const aliceId = aliceKey.toString('hex');
const bobId = bobKey.toString('hex');

const alice = new HyperswarmTransport(aliceKey);
const bob = new HyperswarmTransport(bobKey);

try {
  await Promise.all([alice.start(), bob.start()]);
  await alice.connect(bobId);

  // Register bob.onMessage(...) before sending a signed test envelope.
  // Resolve on receipt and reject on a bounded timeout.
  await alice.send(bobId, testEnvelope);
} finally {
  await Promise.allSettled([alice.close(), bob.close()]);
}
```

The example shows topology, not a complete assertion: construct `testEnvelope` with a future expiry, unique nonce, correct sender/recipient, and a test-only signature. Application code must verify that signature before acting; a Noise connection alone does not authenticate the claimed Ed25519 sender.

For the closest production behavior, run the peers as separate Node processes. Prefix network-dependent test names with `p2p.integration`, guard them with an explicit environment flag such as `KEYSTONE_P2P_E2E=1`, and document the exact command in the test file. The test environment must allow outbound UDP for HyperDHT bootstrap/discovery.

Verify all of the following:

- both nodes advertise different IDs;
- the receiver gets exactly one complete envelope, including when a frame arrives in chunks;
- an oversized or malformed frame closes the connection;
- a disconnect removes the peer and does not leak handlers;
- `close()` completes for both nodes after failure as well as success;
- no test waits forever—use a descriptive bounded timeout.

### 3. Test relay fallback locally

Start the relay in a separate terminal:

```bash
export RELAY_SEED="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
pnpm --filter @keystone/relay dev
```

Save the `publicKey`, `host`, and UDP `port` from the `relay-listening` JSON line. Use a reachable address instead of `0.0.0.0` in client configuration.

Configure both integration-test nodes with reciprocal targets:

```ts
const relay = {
  relayPublicKey: '<publicKey from relay-listening>',
  relayAddresses: [{ host: '127.0.0.1', port: 12345 }],
  directTimeoutMs: 250,
};
```

Then:

1. Deliberately prevent the two test swarms from binding a direct peer while leaving the relay's UDP address reachable. Prefer an injected disconnected swarm fixture; do not depend on a timing race.
2. Call `connect()` for both directions concurrently so the relay receives reciprocal `{source, target}` registrations.
3. Wait for both clients to receive `keystone-relay/ready`.
4. Send an envelope whose body matches the `RelayCiphertext` marker (`algorithm: "xchacha20poly1305"`, nonce, ciphertext).
5. Assert that a plain object body is rejected locally with `Relay transport accepts only recipient-encrypted payloads`.
6. Stop one peer and assert that the other tunnel closes and pending relay state is cleaned up.

The ciphertext marker test checks routing policy, not cryptographic confidentiality. Add a separate encrypt/decrypt assertion when changing recipient-level encryption. Never put plaintext personal data in a relay test.

### 4. Test across real network boundaries

Before merging material transport changes, test at least two of these topologies when possible:

- two processes on one machine;
- two devices on the same LAN;
- peers on different networks, such as home Wi-Fi and a mobile hotspot;
- direct UDP restricted so the relay path is required;
- mobile app backgrounded and resumed.

Record whether the connection was **direct** or **relayed**, time to connect, OS/network topology, and cleanup behavior. A successful same-machine test is not evidence that symmetric NAT traversal works.

### P2P debugging checklist

- Confirm each peer uses the other peer's current advertised ID and not an Ed25519/Noise key in the wrong encoding.
- Accept only 64-character hex or valid base64url public keys.
- Check system time; expired envelopes and clock-skewed TTLs must fail.
- Check UDP firewall rules and the relay's observed address.
- Verify the application signature before trusting `envelope.sender`.
- Keep relay metadata limitations visible in test reports and documentation.
- Redact public keys if they identify a persistent personal node.

## 🎨 Contribute a theme

Keystone ships **Neumorphism** and **Frutiger Aero**, but the theme system is designed for community manifests. A theme is data, never executable code.

### Manifest format

Create a JSON document using the `keystone.theme.v1` schema:

```json
{
  "schema": "keystone.theme.v1",
  "id": "org.example.deep-ocean",
  "name": "Deep Ocean",
  "version": 1,
  "author": "Example Contributor",
  "license": "CC0-1.0",
  "tokens": {
    "mode": "dark",
    "colors": {
      "background": "#071a24",
      "surface": "#0d2835",
      "text": "#f4fbff",
      "muted": "#a8c1cc",
      "accent": "#55d6be",
      "border": "#31505d"
    },
    "radii": {
      "sm": 8,
      "md": 14,
      "lg": 22
    },
    "shadows": {
      "sm": "0 2px 8px rgba(0, 0, 0, 0.18)",
      "md": "0 10px 28px rgba(0, 0, 0, 0.24)",
      "lg": "0 24px 64px rgba(0, 0, 0, 0.32)"
    },
    "motion": {
      "durationFast": 120,
      "durationNormal": 220
    }
  }
}
```

Required metadata: `schema`, a globally distinctive `id`, `name`, integer `version: 1`, `author`, `license`, and `tokens`. All six semantic colors are currently required. Other token groups inherit safe base values when omitted, but bundled themes should define them deliberately.

Accepted color syntax includes hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`, and `oklch()`. Preserve a consistent notation within one palette.

### Theme safety rules

Theme contributions must contain:

- semantic token values only;
- no JavaScript, HTML, arbitrary selectors, or executable expressions;
- no `url()`, remote fonts, tracking pixels, data URLs, or external assets;
- no product names, trademarks, or artwork without redistribution rights;
- a clear SPDX-compatible license identifier.

Remote themes must be delivered over HTTPS. The current parser validates schema and token syntax; distribution trust and signature verification remain the responsibility of the host. Do not describe an unverified manifest as trusted merely because it contains a `signature` string.

### Design and accessibility checklist

- Use `background`, `surface`, `text`, `muted`, `accent`, and `border` by meaning—not by coincidental color value.
- Meet WCAG 2 AA contrast: at least **4.5:1** for normal text, **3:1** for large text, and **3:1** for essential UI boundaries and states.
- Check text on both `background` and `surface`, including muted copy and accent-colored controls.
- Do not rely on color alone to communicate success, warning, selection, or error.
- Keep focus indicators visible and primary actions distinguishable in the declared appearance.
- Check sRGB gamut when using OKLCH; avoid values that clip into a different hue.
- Test reduced motion. Token durations may shorten transitions but must not override the user's reduced-motion preference.
- If you provide light and dark variants, validate every foreground/background pair in each variant rather than mechanically inverting colors.

### Validate a manifest

Add a case to `packages/theme/src/index.test.ts` that passes the parsed JSON object to `parseThemeManifest()` and asserts the resolved tokens. Include rejection coverage when changing the schema or validator.

```bash
pnpm --filter @keystone/theme test
pnpm --filter @keystone/theme lint
```

For a new bundled preset:

1. Add the validated token set to `presets` in `packages/theme/src/index.ts`.
2. Extend the preset key type without weakening it to an arbitrary string.
3. Add parsing and resolved-token tests.
4. Render the shared UI primitives in web and mobile hosts.
5. Include screenshots of representative screens and list measured contrast pairs in the pull request.
6. Update `packages/theme/README.md` and the root README's preset list.

Themes that intentionally reproduce an established visual style are welcome; clones of proprietary interfaces or unlicensed asset packs are not.

## 🔐 Security-sensitive changes

Treat these areas as security boundaries:

- cryptographic providers and key encoding;
- Double Confirmation and nonce persistence;
- capabilities and trusted-node resolution;
- P2P identity binding and relay encryption;
- Tauri commands and mobile native modules;
- browser origins, field injection, and accessibility actions;
- theme parsing and remote distribution.

A security-sensitive pull request must include:

1. the asset and attacker being considered;
2. the trust-boundary change;
3. negative tests and replay/expiry behavior;
4. documentation updates to [`docs/security.md`](docs/security.md) or [`docs/threat-model.md`](docs/threat-model.md);
5. migration and rollback notes if persisted identities or protocol data change.

Do not log prompts containing personal data, private keys, access tokens, raw browser storage, full accessibility trees from real apps, or decrypted relay payloads.

### Report a vulnerability

Do not open a public issue containing exploit details, keys, or personal data. Use GitHub's private vulnerability reporting for the repository when available. If it is unavailable, open a minimal issue asking the maintainers for a private contact channel without revealing the vulnerability.

## 📝 Documentation changes

- Write user-facing documentation in English.
- Prefer direct steps, concrete commands, and relative repository links.
- Mark experimental, platform-limited, or planned behavior accurately.
- Keep `README.md`, package READMEs, and `docs/` consistent when terminology changes.
- Update [`docs/protocol.md`](docs/protocol.md) for wire-format changes and explain backward compatibility.
- Never claim absolute privacy, anonymity, security, or unattended autonomy.

## 🔎 Open a pull request

Use this checklist in the PR description:

```markdown
## What changed

<!-- Describe the user-visible behavior and motivation. -->

## Trust and compatibility

- Trust boundary changed: yes / no
- Protocol or persisted data changed: yes / no
- New permission or network access: yes / no

## Verification

- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Targeted native/package checks
- [ ] Direct P2P test, if transport changed
- [ ] Relay fallback test, if routing changed
- [ ] Documentation updated
- [ ] No secrets or real personal data included

## Evidence

<!-- Logs with secrets redacted, screenshots, devices/OS versions, test topology. -->
```

Reviewers may ask for a smaller change, threat-model clarification, cross-platform evidence, or a compatibility test. This is part of protecting a project that can act on a user's device.

## 📄 License

By contributing, you agree that your contribution is licensed under **AGPL-3.0-or-later**, the same license as Keystone. Only submit code, documentation, themes, and assets that you have the right to redistribute under compatible terms.

---

Thank you for helping make capable AI more local, accountable, and user-owned. 🔑
