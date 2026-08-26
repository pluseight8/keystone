# Nearby Exchange

Nearby Exchange is a first-class, anonymous one-hop exchange surface. It lets
an owner offer a typed object to a nearby endpoint without a central directory,
server or Internet requirement. Discovery does not identify a person, create a
contact, enroll a device or establish trust. The recipient must explicitly
choose what to receive.

## Architecture boundary

The application path is:

```text
Desktop/mobile projection
        -> NearbyExchangeService
        -> AnonymousNearbyTransportProvider / NearbyLinkAdapter
        -> ConnectivityFabric
        -> selected transport provider
```

`NearbyExchangeService` reuses the existing anonymous nearby provider. It does not
create a Bluetooth stack, choose BLE/Wi-Fi/Hyperswarm, or expose a route picker.
The Fabric remains the only high-level delivery authority. Nearby frames are
encrypted opaque envelopes; endpoint handles, session keys and raw native
transport identifiers stay below the host boundary.

The desktop and mobile surfaces receive endpoint, offer and transfer
projections only. They never receive private keys, transport handles,
manifests, chunks or received bytes. A missing native/core adapter is shown as
unavailable rather than replaced with a UI-only implementation.

## Objects and consent

The typed exchange objects are:

- `file`: a bounded copy, never source access. Files use the
  `DistributedContentService` manifest/chunk/resume path and are verified by
  content and chunk hashes before they become `RECEIVED`.
- `text`, `url`, `place`, `route`, `publication`: bounded previews or
  references. A place or route is a shared snapshot, not a live location fix,
  proximity measurement or movement history.
- `contact`: only the selected fields are disclosed. Contact creation is a
  separate explicit owner action.
- `collaboration` and `document`: `COPY` and `GRANT_ACCESS` are distinct modes;
  copying an object never grants access and an access grant is not silently
  converted into a copy.

An offer is visible before acceptance and has a short TTL. The receiving owner
can use `NOT_ACCEPTING`, `CONTACTS_ONLY`, `TEMPORARILY_VISIBLE` or
`ASK_EVERY_TIME`. The default user flow is an explicit offer followed by
accept/reject. Transfer states distinguish consent, route waiting, verification,
receipt, cancellation and failure.

Receive QR is a short-lived, one-time scoped bootstrap context. It contains no
Profile QR data, private key, password, secret, social graph or general device
enrollment authority. A Profile QR remains a separate feature and protocol.

## Privacy and safety rules

Nearby discovery intentionally does not expose exact GPS, RSSI distance,
encounter history, Bluetooth address, public identity or a global “people
nearby” graph. A visible endpoint has an ephemeral local session identifier,
capabilities, a short verification code and an expiry. Identity disclosure is
field-selected and can be followed by an explicit Add Contact action.

Receiving never automatically opens a URL, executes a file, installs a plugin,
runs a command, imports a contact, enrolls a device, invokes an agent or
publishes content. URL and contact links are validated as external URLs and
remain user actions. File names are sanitized; previews, MIME labels, EXIF and
other metadata are untrusted and must not be treated as authority. A received
file remains a local copy and does not become executable merely because it was
accepted.

State is bounded: endpoints, sessions, pending offers, deduplication, fragment
reassembly, active transfers, content bytes, batch size and explicit transfer
history have independent limits. Terminal live projections are compacted while
bounded history remains available. Durable state stores only validated,
bounded offer/transfer projections and history; it is not an anonymous peer or
encounter database.

## Evidence and platform boundary

Nearby evidence has separate meanings:

| Evidence | Meaning |
| --- | --- |
| Controlled | Deterministic in-process protocol, consent, hostile-input and scale tests. |
| Hybrid / implemented | Two independent localhost processes exercise the real anonymous-session cryptography and Nearby Exchange over a framed loopback adapter; this is not physical Bluetooth evidence. |
| Physical Bluetooth | Requires a powered, permissioned native controller, a production BlueZ data adapter and a second physical Keystone peer. If those are unavailable, the result is `BLOCKED_BY_ENVIRONMENT`, not a simulated success. |

The current development/validation host is **Omarchy (Arch Linux-based
distribution)** with Node v22.23.2, pnpm 9.15.0 and package engine `>=22 <23`.
The host description does not make Omarchy a Keystone dependency. Validation
does not assume apt, dnf, GNOME or Flatpak and does not install system packages
as part of Nearby Exchange.

## Implementation references

- Core contract and service: [`packages/core/src/nearby-exchange.ts`](../packages/core/src/nearby-exchange.ts)
- Controlled fixture and integration/scale suites: [`packages/core/src/testing/nearby-exchange-fixture.ts`](../packages/core/src/testing/nearby-exchange-fixture.ts), [`packages/core/src/testing/nearby-exchange-scale.test.ts`](../packages/core/src/testing/nearby-exchange-scale.test.ts)
- Hybrid two-process proof: [`packages/core/src/testing/nearby-exchange-real-network.test.ts`](../packages/core/src/testing/nearby-exchange-real-network.test.ts)
- Physical evidence boundary: [`packages/core/src/testing/nearby-physical-evidence.test.ts`](../packages/core/src/testing/nearby-physical-evidence.test.ts)
- Desktop projection: [`apps/desktop/src/desktop-nearby-exchange-runtime.ts`](../apps/desktop/src/desktop-nearby-exchange-runtime.ts)
- Mobile projection/surface: [`apps/mobile/src/nearbyExchangeRuntime.ts`](../apps/mobile/src/nearbyExchangeRuntime.ts), [`apps/mobile/app/nearby.tsx`](../apps/mobile/app/nearby.tsx)
