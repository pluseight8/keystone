# Real device runtime

`@keystone/native-host` now has an explicit device-runtime/evidence layer. A
TypeScript contract is not treated as hardware support. `PhysicalFeatureProbe`
records implementation, runtime detection and physical verification separately;
`PhysicalE2EHarness.simulated()` is intentionally marked `SIMULATED` and can
never produce `PHYSICALLY_VERIFIED` evidence.

`DeviceRuntimeService` creates a privacy-safe local snapshot with a stable
runtime identifier, an expiring runtime session, lifecycle/recovery state,
coarse power/thermal/network state and transport classes. Snapshots are local
only and do not contain MAC addresses, serial numbers, IP addresses or social
identity. Restart marks old live handles stale rather than resurrecting them.

## Evidence vocabulary

`DECLARED` and `IMPLEMENTED` describe code. `RUNTIME_DETECTED` describes a
facility observed on the host. `PHYSICALLY_VERIFIED` is reserved for a bounded
real exercise. `UNAVAILABLE`, `UNSUPPORTED` and `BLOCKED_BY_ENVIRONMENT` are
not failures of the protocol; they are honest capability outcomes.

## Linux boundary

Linux is the strongest runtime target in this release. Filesystem and child
process boundaries are exercised on the real host. The process boundary is not
claimed to be seccomp, namespace or a complete OS sandbox unless such evidence
is present. NativeHost still moves opaque bytes and keeps transport endpoints
separate from Keystone Identity.
