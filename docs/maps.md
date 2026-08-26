# Maps, Places and Navigation

Keystone Maps is a privacy-first, local-first surface for geographic data. It
is a domain service in `packages/core/src/maps.ts`, not a location authority,
transport selector, vendor SDK, or hosted map backend.

## Boundaries

- A map opens and renders without location permission. Current position is
  available only after an explicit owner action through the `LocationService`
  grant path.
- A one-shot grant is sufficient for “show my location” and location-aware
  search when precision permits it. A foreground precise grant is required for
  active turn-by-turn navigation.
- Navigation starts only after explicit owner confirmation, owns a bounded
  foreground watch, and releases it on end, revoke, interruption or shutdown.
  Active navigation is ephemeral and never auto-resumes after a crash.
- No IP, Wi-Fi fingerprint, browser geolocation, silent precise read, movement
  history, Home/Work inference, geofencing, people tracking, Find My feature,
  advertising or sponsored ranking is part of Maps.
- Maps receives only `LocationService` and `KeystoneDeliveryInterface`
  boundaries. It does not import raw transport, Hyperswarm, native location,
  or a central Keystone location service.

## Places and sharing

`Place` is a portable, provider-aware object with stable `placeId`, display
name, optional coordinates or approximate region, address/category, bounded
public metadata and explicit provenance. Provenance distinguishes local data,
offline data, external providers, user-created places, received Keystone
references and publication data.

Saved places and collections are local durable objects. They are separate from
live location and are never inferred from movement. A user-created or received
place can be represented as:

```text
keystone://place/<encoded-place-id>
```

The URI is a reference, not an authorization token. A place share is an
explicit application envelope. Private shares use recipient E2E encryption;
public shares still pass through the signed delivery boundary. A share carries
only the selected portable `PlaceReference`; the sender's current location,
location fix and movement history are rejected. Messages, Spaces, Calendar,
Collaboration, Workboard and Personal Web can carry the URI without copying
the underlying object.

## Provider policy

`MapProviderRegistry` separates `LOCAL`, `OFFLINE` and `EXTERNAL` providers
and exposes typed capabilities for map data, search, geocoding, routing and
offline packages. Local and installed offline providers are preferred. An
external provider is considered only when the caller explicitly enables the
matching policy operation (`allowExternalMapData`, `allowExternalSearch`,
`allowExternalGeocoding` or `allowExternalRouting`). Each such operation
creates a narrow local audit entry containing provider, operation and location
class, not identity or a movement trail.

Provider output is untrusted and bounded before it reaches a surface. A plugin
provider cannot request LocationService, current-position, or movement-like
capabilities. Provider credentials are represented by host-resolved references;
raw keys never enter Maps. Restricted provider data is not rehosted or
redistributed by Keystone. Website links pass through the external-link
gateway and accept only safe public HTTP(S) destinations.

## Offline packages and cache

Offline packages are explicitly installed, content-addressed and integrity
checked before storage. Their manifest, size, region and package count are
bounded. An installed package is distinct from a map cache entry: cache data
is an evictable LRU-like projection, while package state is durable and can be
removed explicitly. Offline-only policy is a hard prohibition on external map,
search, geocoding and routing requests.

## Routing and navigation

`GeographicRoute` is separate from connectivity routing. Supported modes are
walking, driving and cycling when the selected provider advertises them;
unsupported modes fail explicitly. Route geometry, legs, steps, instructions,
distance and duration all have bounds and are validated at the provider
boundary.

Navigation consumes a validated geographic route and foreground fixes from
`LocationService`.
Fixes are precision- and freshness-aware. Rerouting is bounded by deviation,
time interval and retry count; a failed reroute does not silently switch
providers. Raw coordinates are not persisted as a navigation history.

## Host surfaces

Desktop and mobile expose typed host adapters. The UI can open Maps, search
places, display saved places/providers/offline state, plan a manual route and
invoke the explicit one-shot location action. A missing adapter is shown as an
honest boundary state; the UI does not fabricate GPS or provider data.

The current validation host is **Omarchy (Arch Linux-based distribution)** with
Node `v22.23.2`, pnpm `9.15.0` and package engine `>=22 <23`. Omarchy is a
development/validation environment, not a Keystone runtime dependency or a
platform support claim.

## Validation

Focused validation includes controlled provider, offline-only, permission,
plugin-boundary, route-bound, cache, 10k saved-place, 100 navigation-cycle and
real two-process Hyperswarm place-sharing proofs. The real network proof verifies that the
recipient receives the intended Place reference while the application wire
remains encrypted and contains no plaintext place payload.

Maps does not add cloud sync, a mandatory public provider, telemetry, route
optimization for connectivity, location advertising, or support claims for
Windows/macOS/Android/iOS beyond the existing host contracts.
