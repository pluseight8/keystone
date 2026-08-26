# Devices

`DeviceService` is the local trusted-device registry. Each record contains a device ID, platform, display name, created/joined time, last-seen time, public signing/encryption keys and revocation state. The canonical Identity ID remains the cryptographic authority; display names are not a username registry.

Pairing requests and authorizations are signed with existing Keystone `DeviceSessionKeys`. `DeviceReplicationService` carries only the signed lifecycle object inside the authenticated production Transport envelope. Duplicate nonces and object IDs are rejected. Revocations are durable and are checked before privileged events are accepted.

The production network suite starts an independent `alice_device` process. Alice authorizes it over Hyperswarm/Noise, receives a signed privileged event, revokes it, and the revoked process is rejected after restart. Mallory's authority spoof is rejected.

Private keys and recovery phrases are never returned by the Settings Center. Recovery status is summary-only; an explicit, host-owned reveal flow is required for any future recovery UX.

## Continuity

Device Continuity reuses this same registry, enrollment, session keys, trust
epoch and revocation path. A device advertises a bounded continuity capability
set and coarse availability; these are hints for a picker, not a replacement
for the destination's authorization check. No second Continuity enrollment or
trust database is created. Revocation blocks new handoffs and rejects stale
epoch envelopes.
