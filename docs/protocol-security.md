# Protocol Security

Keystone treats every remote peer as a hostile implementation. Remote bytes are not a Keystone object and never carry authority merely because they contain `official`, `admin`, `trusted`, or `SAFE` fields.

The receive pipeline is fixed:

`RemoteTransportInput → BoundedFrame → ParsedEnvelope → CryptographicallyVerifiedEnvelope → ReplayCheckedEnvelope → ProtocolValidatedEnvelope → AuthorizedProtocolObject → subsystem validation`.

`BoundedFrameDecoder` rejects zero/oversized declared lengths before allocation. JSON parsing rejects duplicate keys, excessive depth, collection sizes, string sizes and node budgets. Envelope expiry is checked against the local clock and remote timestamps never change local trusted time.

`ProtocolSecurityProfile` is negotiated against the local minimum. Envelope versions, cryptographic suites, signatures, replay protection and monotonic revision semantics cannot be downgraded for legacy compatibility. Profile references belong to the immutable MandatoryPolicyRoot.

Signatures use an explicit domain containing the object/envelope type and protocol version. A signature for one type is not valid for another type. Authorization is based on cryptographic Identity IDs and trusted keys, never display names, handles or roles supplied by a peer.

`ReplayWindow`, `MonotonicStateGuard` and `ProtocolStateMachineGuard` provide reusable protection for idempotency, tombstones, revocations, epochs and legal lifecycle transitions. Replayed or stale inputs are rejected or harmlessly deduplicated; they never repeat a side effect.

`NetworkResourceGovernor` bounds connections, attempts, frames, bytes, objects, pending requests and transfers per peer. Unknown identities are not assumed to be unique humans and cannot create unbounded state. Strikes lead to rejection, disconnect or quarantine. Metrics stay local.

Safety and protocol validation remain separate. Protocol validation authenticates and bounds bytes; shared/public objects then pass the mandatory `SafetySurfaceGate`. Ciphertext is never submitted to the plaintext safety classifier.

The protocol has no compression today. Future compression must provide a declared output budget and ratio limit; otherwise it is rejected. File chunks remain bounded data transport with validated content ID, index, total size, hash and parallelism.

The production host may provide an envelope verifier/authorization callback to `HyperswarmTransport`. When configured, an envelope is not delivered to consumers until signature and authorization succeed. Without that callback, consumers still own identity authorization and must verify before applying state; the transport never exposes raw bytes, only bounded validated envelopes.
