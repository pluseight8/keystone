<div align="center">

<img src="branding/logos/logo+text-of-logo.png" alt="Keystone" width="560">

# Keystone

**A local-first P2P platform for identity, data, social computing and personal AI.**

[Get started](#development) · [Product](docs/product.md) · [Architecture](docs/architecture.md) · [Keystone Network](docs/connectivity.md) · [Security](docs/security.md) · [Русская документация](docs/ru/README.md) · [Contributing](CONTRIBUTING.md)

</div>

Keystone is your personal internet: a private layer for the things you do,
know, create and share across your own devices. You do not move your life into
Keystone. Keystone forms around your life.

It works with or without the Internet. Local data, identity, search, planning,
documents and AI remain useful on hardware you control; the Internet and other
providers are optional paths for the things that need them.

## What Keystone is

Keystone brings personal information and actions into one object-aware
product. A captured thought can become a task or a Vault note. A web page can
be kept as an offline archive. A PDF is a File viewed through Documents. A
photo remains a media asset, not a second copy in every album. The same
references can be opened from Search, Daily Layer, workspaces, devices or
explicit sharing flows.

The product is useful for one person first. Personal AI, Memory, Vault,
Browser, Web Library, Calendar, Tasks, Workboards, Files, Documents, Photos,
Contacts, Mail, Maps, Subscriptions, Search, Skills and device continuity do
not require another Keystone user. With other people or trusted devices,
Keystone adds messaging, calls, shared folders and spaces, collaboration,
Nearby Exchange and bounded agent interaction. Come for the product. Stay for
the network.

## What works today

- A local-first core for identity, signed objects, permissions, encrypted
  transport, durable state and offline reconciliation.
- Personal surfaces for Home/Daily Layer, Messages, Calls, external Mail,
  Contacts, Calendar, Tasks, Workboards, Files, Shared Folders, Vault,
  Documents, Photos, Browser, Web Library, Subscriptions, Maps and Capture.
- Local search, Personal Memory, optional local model runtimes, Agents,
  Skills, bounded automation and explicit owner approvals.
- Trusted-device Continuity, Nearby Exchange, collaboration, content-addressed
  transfer and a Keystone Network that can use direct, local, nearby or
  delayed paths when the host and policy allow them.
- Desktop, mobile, web and browser-companion host boundaries. Native capability
  availability is reported honestly; a validation result on one host is not a
  physical-support claim for every platform.

## Core principles

- **Models propose. Policy decides. The user authorizes consequences.** Model
  output, remote content and imported data are untrusted until the relevant
  policy and consent checks pass.
- **Transport is not authority.** A route, relay, content hash, path, Contact
  or nearby endpoint never grants identity, trust or access.
- **One object, one owner.** Surfaces project canonical objects instead of
  creating a new store for every feature.
- **Private by default.** Disclosure, external-provider access, publication,
  device placement and collaboration are explicit actions.
- **Native hosts have native authority.** The shared core is platform-neutral;
  Tauri, Expo and other hosts provide narrow OS capabilities and permissions.
- **Bounded participation.** Queues, caches, retries, relay work and background
  activity have resource limits. OS permission, battery and thermal policy are
  authoritative.
- **No mandatory Keystone service.** Keystone has no required Keystone cloud,
  account service, telemetry collector, model vendor or central social graph.

## Development

The validated development environment is **Omarchy (Arch Linux-based
distribution)** with Node `v22.23.2`, pnpm `9.15.0` and package engine
`>=22 <23`. The project does not require Omarchy at runtime. Check the actual
host before platform-specific work; do not assume GNOME, Flatpak, apt or dnf.

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile

pnpm tsc
pnpm test
pnpm build
pnpm docs:check
```

Run commands from the repository root. Use `pnpm dev` for the web shell. The
desktop host needs Rust and the Tauri prerequisites; mobile needs a native
development/production build, JDK/Android tooling for Android, and macOS/Xcode
for iOS. Expo Go is not a supported substitute for the custom native modules.

Focused suites, real-network evidence and platform release gates are described
in [Development](docs/development.md) and [Release and evidence](docs/release.md).

## Documentation

Start with the product model, then use the owner document for the area you are
working on:

| Area | Canonical document |
| --- | --- |
| Product and user model | [Product](docs/product.md) |
| System design and host boundaries | [Architecture](docs/architecture.md) |
| Keystone Network and delivery | [Connectivity](docs/connectivity.md) |
| Trust, authorization and hostile input | [Security](docs/security.md) |
| Local AI, agents and egress | [AI](docs/ai.md) |
| Plugins and Skills | [Plugins](docs/plugins.md) |
| Development and validation | [Development](docs/development.md) |
| Release evidence and readiness | [Release and evidence](docs/release.md) |
| Files, Documents, Photos, Web Library and Capture | [Files](docs/files.md), [Documents](docs/documents.md), [Photos](docs/photos.md), [Web Library](docs/web-library.md), [Capture](docs/capture.md) |
| Tasks, Workboards, Calendar and Inbox | [Tasks](docs/tasks.md), [Calendar](docs/calendar.md), [Universal Inbox](docs/inbox.md) |
| People and external communication | [Contacts](docs/contacts.md), [Mail](docs/mail.md), [Messaging](docs/messaging.md) |
| Maps, feeds and devices | [Maps](docs/maps.md), [Subscriptions](docs/subscriptions.md), [Continuity](docs/continuity.md), [Nearby Exchange](docs/nearby-exchange.md) |

Technical references are linked from those canonical pages. The [Russian
documentation index](docs/ru/README.md) follows the same structure.

## Status

This repository contains the current Release 0 development snapshot. Release
readiness is evidence-based and platform-specific; missing signing or provider
credentials remain release configuration, not product behavior. See
[Release and evidence](docs/release.md) for the current boundary. The next
release has not started.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting code, documentation,
tests or design changes. Keystone is source-available software under
[LICENSE.md](LICENSE.md); the license is not an Open Source license.
