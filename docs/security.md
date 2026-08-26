# Security

This is the canonical high-level security model. It describes the security
boundaries that product features must preserve; it is not an independent
penetration test or a promise that an early development build is suitable for
high-risk production use.

## Principles

- A malicious person may control their own Keystone. They must never control
  yours.
- Models, plugins, remote peers, browser content, imported files, provider
  responses and user-generated text are untrusted until validated for the
  operation that will use them.
- A transport provides reachability. It never provides trust, identity,
  authorization or confidentiality.
- A path is not authority. A content hash proves integrity, not access. A
  relay is not a collaborator. A Contact is not an authorization principal.
- Security is a constraint, not a route-scoring trade-off. An insecure fast
  path is not a valid fallback for a slower protected path.
- Transport can change; identity, authorization and application
  confidentiality do not.
- The system fails closed when a required verifier, capability, permission or
  host adapter is absent. Resource limits are part of the security boundary.

## Identity and device trust

Each Keystone Identity has cryptographic signing and encryption material. A
device becomes part of the owner's personal system only through an explicit
trusted-device flow. Device claims are scoped, epoch-bound and revocable.
Revocation blocks new operations and stale-epoch state; it does not pretend to
erase bytes that another device already received.

Contacts, Profiles, email addresses, phone numbers, nearby endpoints, relay
peers, collaborators and owned devices are different concepts. A Contact helps
the owner organise and resolve people; it does not grant trust. Linking a
Contact to an Identity is explicit and any verification state remains separate
from the Contact record.

## Owner authority and consent

Every sensitive action is evaluated against the owner, target, fields, purpose,
data class, capability, expiry and current policy. Disclosure and consequential
execution use the existing Double Confirmation pattern:

```text
scoped request → owner reviews disclosure → owner approves
              → requester/owner reviews exact consequence → action executes
```

The approval is bound to the exact action hash, audience, nonce and expiry. A
new destination, broader field set, changed URL or changed side effect needs a
new decision. Reading a projection, receiving a deep link or possessing a
reference is not approval.

## Transport and end-to-end protection

The [Keystone Network](connectivity.md) carries signed, encrypted,
transport-independent envelopes. The Fabric and its providers can frame,
fragment, retry, deduplicate and route opaque data, but they cannot decrypt it
or change its authorization. Application acknowledgements are distinct from
local or provider acceptance; “sent” is not automatically “delivered”.

Private conversations, shared objects and device handoffs use recipient- or
membership-bound protection appropriate to their object. Shared membership is
checked against role, invitation and epoch for every write and remote change.
Yjs convergence handles concurrent authorized edits; it does not bypass the
ACL. A shared object is not public merely because it has a stable ID.

Relays and anonymous forwarding peers may see unavoidable connection timing,
approximate traffic size or endpoint metadata. The anonymous transport plane
uses rotating ephemeral transport identities, minimal routing metadata and
opaque payloads, but Keystone makes no zero-metadata or absolute-anonymity
claim. Unknown peers may relay bounded traffic without becoming social
contacts, people in a directory or trusted collaborators.

## Secrets and native hosts

Identity seeds, device keys, recovery phrases, provider credentials, browser
cookies/tokens and signing keys stay behind host secure-storage boundaries.
They are not placed in prompts, URLs, logs, ordinary state, plugin context,
remote envelopes or test reports. Native hosts receive one scoped operation at
a time and validate the capability, principal, arguments and expiry again.

The renderer and mobile UI do not receive raw filesystem paths, process handles,
transport handles, secret-store handles or unrestricted shell/input authority.
Owner-selected file roots use opaque handles, relative bounded operations,
traversal and symlink checks, and atomic writes. OS permission, battery,
thermal and background limits are authoritative; Keystone does not bypass them.

## Untrusted content and media

Imported files, PDFs, EPUBs, HTML, SVG, images, audio/video, MIME metadata,
archive names, OCR output, feed entries, mail bodies and browser pages are
data, not programs or policy. Parsers and decoders enforce size, nesting,
memory, dimensions, duration, path, decompression and timeout bounds. Previews
are derived non-active representations.

The Reader does not execute PDF/EPUB scripts, macros, launch actions, forms,
embedded commands or automatic external fetches. Mail and feed HTML is
sanitized; remote images and tracking resources are not fetched by default.
Photos keeps originals separate from derived thumbnails and renditions. Capture
stores bounded metadata or an opaque file handle rather than arbitrary bytes.
See [media decoder security](media-decoder-security.md), [Documents](documents.md),
[Photos](photos.md), [Mail](mail.md) and [Capture](capture.md).

## Links, browser and external providers

External links go through the typed `ExternalLinkGateway`. A URL, deep link,
feed origin or provider response cannot invoke a command, access a credential,
open a private network target or grant a plugin capability. The Browser
Companion accepts only its bounded loopback protocol and does not expose
cookies, authorization headers or arbitrary JavaScript execution to the core.

Mail, feeds, web origins and optional media providers retain their own server
or provider authority. Keystone does not turn the ConnectivityFabric into an
HTTP proxy, a mail server, a generic cloud backend or a source of provider
credentials. Provider data is clearly attributed and is not silently copied
into Memory, Vault, Contacts, Tasks or external AI.

## Plugins, Skills and AI

Plugins are untrusted code behind an isolated host runtime. A manifest request
is not a grant; capabilities are narrow, scoped, revocable and reviewed.
Plugins cannot access identity/device/recovery secrets, raw transports,
filesystem paths, arbitrary network or the core database. Plugin output,
provider registrations and Skills remain subject to OwnerAuthority, ToolPolicy,
SafetySurfaceGate and egress policy. See [Plugins](plugins.md).

Skills are declarative instructions, not executable authority. Their text,
examples and dependencies are untrusted. Installation, update, enablement and
new permissions require explicit review.

Local AI is optional and always untrusted compute. It receives only the
selected, bounded context allowed by current object permission and data class.
External AI is an explicit egress and never receives private Vault, Memory,
Contacts, Mail, Tasks, Documents, Capture, Location or Files implicitly.
Models may propose; policy decides; the user authorizes consequences. Remote
content never expands a model's tools or permissions. See [AI](ai.md).

## Location privacy

Location is a private typed capability supplied by an OS/native provider. A
feature requests a just-in-time one-shot, foreground or explicitly confirmed
background scope with approximate or precise resolution. Denial is surfaced as
unavailable. There is no IP, Wi-Fi fingerprint, Contact, Maps, Task, Document,
Capture or relay-metadata fallback, and no movement history by default.

Maps places and geographic routes are not evidence of where a person visited,
lives or works. A geographic route is not a Keystone Network route.

## Product-facing security state

The Security Center should show human consequences: what is private, what is
shared, which device or provider is involved, what permission is missing and
what will happen next. Raw capability IDs, route scores, peer topology and
internal error codes belong in developer diagnostics. A missing capability is
an honest unavailable or blocked state, not a simulated success.

Technical references for protocol validation, immutable policy, secret
isolation, hostile input and native host responsibilities are linked from the
[Architecture](architecture.md), [Development](development.md) and
[Threat model](threat-model.md) pages.
