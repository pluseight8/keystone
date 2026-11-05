# Keystone Network

The **Keystone Network** is the product-wide, user-controlled connectivity
fabric. It is not one radio, server or provider. Keystone connects however it
can: directly between trusted devices, over a local network, through nearby
peers, through delayed custody or through an optional configured relay. Where
there is no path yet, durable local work can wait for one.

The Internet helps Keystone. Keystone does not depend on it for local work,
local search, planning, cached content, or communication between devices that
already have another path.

## The delivery model

Applications send objects and replication updates through one boundary:

```text
application object
      ↓
signed and encrypted transport-independent envelope
      ↓
KeystoneDeliveryInterface
      ↓
ConnectivityFabric
      ↓
Adaptive Route Optimizer and delivery profile
      ↓
transport provider
      ↓
NativeHost / operating-system primitive
```

Applications never choose Bluetooth, Wi-Fi, Hyperswarm, a gateway or delayed
delivery directly. `ConnectivityFabric` filters providers by security,
capability, resource policy and delivery requirement, then owns framing,
fragmentation, retry, deduplication and stale-route handling. `FabricTransport`
is a compatibility facade for services still moving to the same interface.

Providers receive opaque, already protected frames. They do not receive
plaintext application objects, identity keys, social policy or authorization.
Transport independence means that changing the path does not change identity,
confidentiality or who may read or write an object.

## Delivery is not one state

The Fabric can report local acceptance or provider acceptance. Neither is an
application delivery receipt. A useful end-to-end flow distinguishes:

1. local operation accepted and persisted;
2. work queued for a route;
3. a provider accepted an opaque frame;
4. the destination verified and applied the object;
5. the destination returned a protocol receipt.

Timeouts and route observations remain honest. A local outbox may continue
working while a route is unavailable, and retry uses bounded backoff. An
already applied operation is deduplicated instead of being executed again.

`FabricTransport` implements step 5 for every application envelope: the
destination answers with a signed `keystone.delivery.ack` naming the envelope
id. Until that arrives, the sender resends the same envelope on a bounded
schedule (2, 4, 8 and 16 seconds by default, never past its expiry); the
receiver's envelope-id deduplication keeps a resend from becoming a second
operation. Only the destination can clear a pending envelope. This covers
frames a provider accepted but the network lost, for example when Hyperswarm
replaces a duplicate connection after both peers restart. The receipt means
the envelope arrived, not that the application accepted its content, and a
lost first copy can still arrive after a later envelope.

## Delivery profiles

Profiles describe requirements, not technologies:

| Profile | Use |
| --- | --- |
| `CONTROL` | Small control and configuration messages. |
| `INTERACTIVE` | Bounded user-visible responses. |
| `REALTIME` | Short-lived calls and live signalling. |
| `EVENTUAL` | Durable retry until a policy deadline. |
| `DELAY_TOLERANT` | Explicitly deferred delivery through bounded custody. |
| `BULK` | Files, media and other bounded content transfer. |
| `BACKGROUND` / `BEST_EFFORT` | Low-priority local work. |

An eligible provider must satisfy the profile and the security policy before
route quality is considered. A faster insecure path is never a fallback for a
slower protected path.

## Paths and providers

### Direct P2P

Hyperswarm discovery and Noise-encrypted sessions provide the main direct
peer path. HyperDHT can assist rendezvous when direct connectivity is difficult.
The live session key is not a social identity; application messages still use
signed envelopes, expiry, replay protection and recipient-bound encryption.

### Local network

Infrastructure Wi-Fi and Ethernet use the same `LocalNetworkTransport`
semantics: bounded framing and opaque envelopes. Wi-Fi Direct is a separate
provider because its OS permission and lifecycle rules differ. Same-host
loopback evidence does not prove a physical multi-device exchange.

### Nearby and multi-hop

Nearby Exchange uses short-lived anonymous sessions and typed capabilities. It
can carry an explicitly reviewed copy or reference; it does not create a
Contact, trusted device or social relationship. Bounded multi-hop forwarding
can use anonymous nearby sessions without exposing application plaintext.

Unknown peers may participate in bounded anonymous relay without being friends,
Contacts or collaborators. The product does not expose relay helpers as
people nearby.

### Delay-tolerant delivery

Store-and-forward keeps an opaque parcel for a bounded TTL, copy budget, size
and resource class. Custody is not trust and possession is not authorization.
Expired or revoked work is removed according to local retention policy; a
relay is never told to decrypt or reinterpret a parcel.

### Gateway participation

A node with a wider Keystone path may expose a short-lived anonymous forwarding
capability to a nearby node. The gateway forwards the original opaque frame
back into its own Fabric; it cannot decrypt, re-sign, authorize or synthesize
a destination receipt.

The Gateway is not a VPN, generic web proxy, HTTP proxy, TCP/UDP forwarder,
open proxy or Internet access service. It accepts only Keystone opaque frames
and bounded delivery requirements.

### Distributed content delivery

Files and media use content-addressed manifests and verified chunks over the
same delivery authority. Metadata can arrive before bytes. Caches and source
sets are local, quota-bound and evictable where policy permits. A content hash
proves integrity and locates bytes; it is not authorization. Private bytes do
not become stranger-cacheable merely because a hash is known.

## Route selection

`AdaptiveRouteOptimizer` is owned by the Fabric. It considers a bounded set of
currently registered providers and evaluates hard eligibility first:

- envelope confidentiality and integrity;
- profile, live/eventual and metered-policy compatibility;
- resource and battery constraints;
- provider-composition loop prevention;
- fresh local measurements where available.

The optimizer keeps a small local route cache with one primary and limited
backups. Confidence decays with age, advertised hints do not outrank fresh
measurements, and hysteresis avoids flapping. A real failure can move work to
a secure backup without changing the original envelope or its authorization.
Route state contains coarse provider/path data and bounded anonymous
measurements. It is not telemetry, reputation, a social graph or a topology
database.

## Relay policy and resource profiles

Where the platform capability and permission permit it, bounded Keystone
Network participation and relay are protocol behavior. The normal product
does not advertise an ordinary switch to disable participation.

The resource profiles are:

- **Balanced** — normal background and relay budgets;
- **Battery Saver** — reduced intensity, timing and transfer budgets;
- **High Availability** — wider bounded opportunity within host limits.

Profiles control work intensity, storage, bandwidth and battery use. They do
not change whether a valid Keystone path is part of the protocol. OS permission,
battery, thermal and background restrictions are authoritative; Keystone does
not bypass them. If the host cannot participate, the UI reports the capability
as unavailable and durable local work remains intact.

Relay is mandatory as protocol behavior; unlimited resource sacrifice is not.
All relay, route, custody, replay and cache state has admission limits, TTLs,
quotas and cleanup. Owner outboxes and receipts are not evicted to make room
for stranger traffic.

## Anonymous transport plane

Anonymous nearby and relay sessions use rotating ephemeral transport identities,
minimal routing metadata, opaque encrypted payloads and bounded lifetime and
resource budgets. They do not create a social Identity, global topology, exact
GPS record or Contact. Intermediaries may still observe unavoidable timing,
approximate traffic size, encounter timing or endpoint metadata; Keystone makes
no absolute anonymity promise.

A transport endpoint, relay peer and nearby endpoint are not people. Social
identity, ownership and authorization are established by the application
envelope and local policy, not by a route.

## External network boundaries

Some product surfaces intentionally use their own provider boundary:

- Mail uses the owner's IMAP/SMTP or JMAP provider. Fabric is not a Mail proxy.
- RSS, Atom and JSON Feed refresh uses a bounded direct HTTP(S) request to the
  selected origin. There is no central feed aggregator.
- The Browser opens external web origins through its host boundary; Web Library
  archives selected static content instead of proxying a live page.
- Optional media providers remain external sources and are not copied into a
  Keystone CDN or rehosted by the Network.

External providers retain their own authority and can see the metadata required
by their protocol. They do not become Keystone identity, authorization or
storage authorities.

## Location is not connectivity

Location is a private typed capability supplied by an OS/native provider. It
requires a just-in-time owner-authorized scope and may be one-shot, foreground
or explicitly confirmed background, with approximate or precise resolution.
Denial is reported as unavailable. There is no IP, Wi-Fi fingerprint or relay
metadata fallback.

Maps uses geographic places and routes; the Network uses connectivity routes.
Neither route type is evidence of the other. Network participation does not
infer a current position, movement history, Home/Work location or nearby
people.

## Platform and evidence

The current development/validation distribution is **Omarchy (Arch Linux-based
distribution)**. It is not a Keystone dependency and does not turn a host
observation into support for another platform. The Network does not assume
GNOME, Flatpak, apt or dnf, and does not install system packages as part of
its project checks.

Evidence distinguishes controlled protocol tests, same-host/loopback runtime
checks and physical device verification. A detected controller is not proof of
bidirectional Bluetooth exchange; a real Hyperswarm process proof is not proof
of every radio or mobile background behavior. See [Release and evidence](release.md)
and [Development](development.md).

## User-facing language

Normal product copy should describe consequences: “Connected”, “Connection
quality”, “Nearby connection”, “Sync in background”, “Available on this
device” and “Waiting for a route”. Provider names, peer IDs, route scores and
topology belong in developer diagnostics.

In Russian, the broad product term is **Сеть Keystone**. The technical routing
concept is **Мэш-сеть**. Preferred terms include «Связь», «Подключение»,
«Локальная сеть», «Ретрансляция», «Шлюз», «Отложенная доставка» and «Качество
соединения».
