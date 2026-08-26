# Device Continuity and Handoff

Device Continuity is Keystone's explicit **Send to Device** and **Continue on
Device** layer. It moves a bounded, typed intent/reference between already
trusted personal devices. It is not a second synchronization protocol and it
does not create a second enrollment or trust authority.

## Contract

`ContinuityService` sits above the existing `PersonalDeviceMesh` and the
`KeystoneDeliveryInterface`/`ConnectivityFabric` boundary:

```text
host UI -> typed Continuity host adapter -> ContinuityService
        -> PersonalDeviceMesh trust + epochs
        -> KeystoneDeliveryInterface / Fabric
        -> authenticated, recipient-encrypted envelope
```

The service persists a local outbox and inbox before attempting delivery. A
route may be unavailable without blocking the local action. Retry uses bounded
backoff and resumes after restart. A provider acceptance is not an application
delivery receipt: the request remains pending until the destination verifies,
decrypts and acknowledges it.

Each request has a stable request ID, source and target device IDs, action,
expiry, attempt count and one of `QUEUED`, `SENDING`,
`DELIVERED_TO_DEVICE`, `OPENED`, `ACCEPTED`, `FAILED`, `EXPIRED` or
`CANCELLED`. Duplicate deliveries are deduplicated and old trust epochs,
revoked devices, stale requests and invalid capability claims are rejected.

## Typed references

The canonical object kinds are `file`, `vault`, `document`, `browser`,
`place`, `route`, `mail`, `publication`, `collaboration`, `messaging`,
`workspace` and explicit `clipboard`. A payload contains only the minimum
reference and optional bounded continuation context: document/canvas/workboard
position, map viewport, mail thread/message, publication revision, browser URL
and scroll position, or a bounded workspace layout. Secrets, provider
credentials, browser cookies/tokens, shell commands, executable content,
remote input, screen capture, live location, current navigation and arbitrary
plugin instructions are not valid fields.

File handoff transfers a signed/content-addressed reference. File bytes remain
separate and use `DistributedContentService`; a large byte blob is never
embedded in the handoff envelope. A browser handoff contains a safe URL only.
Maps carry a place or route snapshot, not current location or live navigation.
Mail carries account/thread/message identity and bounded subject metadata, not
credentials. Collaboration and publication references do not grant access,
edit rights or publication authority on the receiving device.

## Device selection and capabilities

Personal Device Mesh records advertise a bounded continuity capability set and a coarse
availability observation. The picker distinguishes trusted, revoked, pending,
offline and recently available devices. Capability absence is reported as
unsupported; unknown capability state is not presented as a guarantee. A
revocation immediately blocks new sends and invalidates old-epoch envelopes.

## Clipboard policy

Automatic clipboard continuity is **off by default**. A clipboard handoff is
short-lived, size-bounded and requires an explicit owner confirmation. The
receiving host may expose an explicit clipboard surface, but Continuity never
auto-pastes into a terminal, browser, form or message composer and does not
maintain a clipboard-history database.

## Host boundaries

Desktop and mobile expose only typed local projections: device picker, status,
inbox, open/cancel actions, retry and clipboard policy. Native hosts install
the adapters that own key material, OS storage, route setup and application
open handlers. Keystone remains platform-neutral; Omarchy (Arch Linux-based
distribution) is only the current development/validation environment, with
Node v22.23.2, pnpm 9.15.0 and package engine `>=22 <23`.

Continuity does not add a central cloud, gateway authority, remote shell,
remote desktop/input, screen capture, wipe, secret transfer or implicit
clipboard synchronization.

## Validation

Controlled tests cover E2E ciphertext, capability and revocation checks,
offline queue/restart, deduplication, hostile references, clipboard consent,
10,000 bounded requests and 1,000 endurance cycles. The real network harness
uses two independent Hyperswarm/Noise processes and covers online delivery,
offline queueing, reconnect and revocation. The full release gate remains the
repository's `tsc`, unit, integration, network, performance, security, build,
`release:check` and `git diff --check` suite.
