# Architecture

Keystone is a local-first platform whose shared core owns identity, policy,
data contracts and authorization. Hosts provide narrowly scoped operating
system capabilities. Providers and peers provide reachability, not authority.
The design keeps the product useful on one device and lets authorized devices
or people converge without a mandatory Keystone service.

## Invariants

1. There is no required Keystone cloud, account service, hosted database,
   telemetry collector or model vendor.
2. `packages/core` owns policy and domain state; it does not receive ambient
   filesystem, browser, process, radio or secure-storage authority.
3. Models, plugins, browser pages, imported files, remote peers and provider
   responses are untrusted inputs.
4. Local writes are durable and can continue when a route is unavailable.
   Authorized replicas reconcile later; reconciliation does not replace ACLs.
5. Identity, authorization and confidentiality are independent of transport.
   Changing a route cannot change who may read or write an object.
6. Every capability has a typed scope, resource bound, lifecycle and failure
   state. OS permission, battery, thermal and background rules remain final.

## System shape

```text
web / desktop / mobile / browser companion
                    │
        shared UI and host-boundary adapters
                    │
             packages/core
 identity · objects · policy · consent · search
 sync · content · AI · Chronos · WebRTC control
                    │
       typed host capabilities and providers
                    │
   OS storage/process/media/browser/network primitives
```

Dependencies point inward. The core does not depend on React, Tauri, Expo,
GeckoView, WKWebView, a particular desktop environment or a specific network
technology. Hosts inject implementations of the contracts that the core can
test without starting a renderer or hardware service.

## Application and host layers

### Desktop

The Tauri desktop app combines a React renderer with a native host. React owns
presentation and interaction state. Tauri/Rust owns command allowlists,
owner-selected filesystem dialogs, secure storage, update verification,
notifications, global shortcuts, browser-host integration and other OS
capabilities. Commands pass copied, purpose-built values; raw handles,
unrestricted process access and generic shell/input control do not cross into
the renderer.

The renderer is treated as potentially compromised web content. Navigation,
IPC arguments and sensitive actions are checked again in the native host. The
[desktop shell](desktop-shell.md) is a browser-style navigation layer over
canonical objects, not another domain store.

### Mobile

React Native and Expo provide shared navigation and UI, while custom native
modules implement capabilities that Expo Go cannot provide. Android and iOS
hosts expose the same typed contracts where their platform rules permit them;
they do not claim identical background execution, storage or permission
behavior. Mobile P2P is foreground-first and follows platform lifecycle rules.

### Web

The web shell is a useful development and presentation surface. It shares
domain and UI contracts where browser capabilities allow them but does not
pretend to provide keychain access, embedded inference, unrestricted files or
OS automation.

### Browser Companion

The extension extracts a bounded page projection and talks to a loopback
boundary. The host validates origin, subprotocol, pairing token, shape and
size. Browser DOM, URL content and extracted text are untrusted; the companion
does not expose cookies, authorization headers or arbitrary core RPC.

`packages/browser-engine` owns the host-specific browser contract. Tauri,
GeckoView and WKWebView adapters implement the same narrow operations, while
the native host restricts evaluation to trusted first-party automation:

```ts
interface BrowserEngine {
  open(url: string): Promise<void>;
  close(): Promise<void>;
  inject(payload: ConfirmedBrowserPayload): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
}
```

P2P data uses `inject()` and never becomes executable browser code. The
contract does not give Core, a plugin or a renderer unrestricted DOM, cookie,
session or process access.

## Core domain composition

The core is arranged around canonical authorities:

- Identity and OwnerAuthority sign objects, device claims and scoped actions.
- Object services own their records and revisions: Vault, Tasks, Files,
  Contacts, Calendar, Messages, Mail projections, Places, publications and
  media libraries.
- `ContentManifest` and the content cache own immutable, chunk-verified bytes.
  A feature index or album never becomes a second byte store.
- Yjs and typed replication adapters reconcile authorized durable state. A
  syntactically valid update still needs object authorization.
- Search and Daily Layer hold local projections and references, not source
  authority.
- Chronos schedules bounded notifications or approved actions; a reminder is
  not an implicit execution grant.

The main product boundaries are described in [Product](product.md) and in the
subsystem pages for [Files](files.md), [Documents](documents.md),
[Photos](photos.md), [Web Library](web-library.md) and [Capture](capture.md).

## Delivery and transport boundary

Applications send through `KeystoneDeliveryInterface`. The conceptual path is:

```text
application object or replication update
        ↓
signed, encrypted, transport-independent envelope
        ↓
Keystone delivery / ConnectivityFabric
        ↓
Adaptive Route Optimizer and delivery profile
        ↓
transport provider
        ↓
NativeHost or operating-system primitive
```

Applications do not select Bluetooth, Wi-Fi, Hyperswarm, a gateway or DTN.
`ConnectivityFabric` chooses an eligible provider and keeps route state local.
Providers carry opaque payloads and can observe only the metadata inherent in
their transport. [Connectivity](connectivity.md) is the owner of the complete
network architecture.

Reachability is an observation, not a receipt. Local acceptance, queueing,
provider acceptance, application verification and destination confirmation are
different stages. A timeout must not silently become “sent”, and retry must not
duplicate an already applied operation.

## Data, content and files

Files are metadata plus immutable revisions whose bytes use the shared
content-addressed layer. Shared Folders add membership, epochs, roles and
distributed sync around Files. Desktop filesystem binding is an explicit
owner-selected NativeHost capability using opaque handles, normalized paths,
bounded relative operations and atomic writes; mobile uses a picker or app
storage. A path or content hash is never authorization.

Documents read File revisions through bounded adapters. PDF, EPUB, Markdown and
plain text are rendered as data. OCR, thumbnails, video frames and edit
renditions are derived and disposable; they cannot mutate the source or grant
tool access. See [media decoder security](media-decoder-security.md).

Web Library archives are static, private representations of selected web
content. They do not execute scripts, submit forms or fetch live resources.
Capture is the intake boundary that proposes a destination; it does not own
another copy of the destination data.

## Identity, sharing and social state

Identity is cryptographic and device trust is explicit. Profiles, Contacts,
nearby endpoints, relay peers, collaborators and owned devices are different
objects with different authority. A Contact can help resolve a person, but it
does not authorize an operation. Shared-object membership is checked locally
against role and epoch; an invited member is not automatically a trusted
device.

Private communication uses recipient-bound encryption and local storage.
Public or shared objects use signed revisions and explicit visibility. A relay
can forward opaque traffic but cannot become the author, recipient or ACL
authority.

## AI and extension boundaries

Local AI is an optional host capability. Context is selected by scope and
filtered by object permission and data class. External AI is an explicit egress
adapter and never silently receives private Vault, Memory, Contacts, Mail,
Tasks, Documents, Capture, Location or Files.

Plugins run behind the [plugin capability and sandbox model](plugins.md).
Manifest requests are not grants; plugin output is untrusted; provider
integrations do not inherit core authority. Skills are declarative procedures,
not executable plugins. Both remain below OwnerAuthority, ToolPolicy,
SafetySurfaceGate and the native host boundary.

## Security boundaries

The principal trust boundaries are:

```text
renderer / browser content / model / plugin / imported file / remote peer
                              │ untrusted data
                              ▼
                 typed core policy and validators
                              │ scoped, confirmed intent
                              ▼
                 native host or selected provider
```

The [Security](security.md) document owns the high-level rules for secrets,
hostile input, E2E protection, relay privacy, content safety and authorization.
The implementation must fail closed when a required verifier, capability or
host adapter is absent; a test fixture is not a production fallback.

## Platform and evidence boundary

Platform support is an implementation and evidence question, not a consequence
of the current development machine. The current validation environment is
**Omarchy (Arch Linux-based distribution)**. It is not a Keystone dependency,
and it does not imply Windows, macOS, Android or iOS physical verification.

Use the evidence vocabulary and platform matrix in [Release and evidence](release.md).
The development/runtime workflow, including how optional native tools are
detected, is in [Development](development.md). The architecture does not
assume GNOME, Flatpak, apt or dnf.
