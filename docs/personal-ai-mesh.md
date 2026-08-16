# Personal AI Mesh

Phase 30 adds a private compute capability for trusted Keystone devices. A
model remains physically installed on the host (for example Ollama, LM Studio,
or llama.cpp); a phone or tablet receives only model metadata and the signed,
streamed inference result.

## Security boundary

`PersonalAIHost`, `RemoteLocalAIRuntime`, `AIComputeAdvertisement`,
`AIInferenceSession`, and `AIComputeRouter` use the existing signed Keystone
`Transport` envelope. Discovery is a direct request to a known trusted device;
there is no public AI-node topic, global registry, LAN port, or cloud relay.
The host checks trusted-device state and revocation on every request and while
streaming. A revoked device cannot continue an active session.

The personal-device class is `PERSONAL_TRUSTED_COMPUTE`, not `EXTERNAL`.
`PersonalAIContextPolicy` builds the request locally and permits only policy-
approved `PUBLIC`, `USER_EXPLICIT`, and `PRIVATE` context. `SECRET` data,
recovery material, identity keys, shell/filesystem sources, and unrelated
database state are rejected. The external `AIEgressFirewall` remains
unchanged: a private task never falls back to OpenAI-compatible providers.

## Host and routing

An advertisement contains only device identity, `AI_COMPUTE` capability, model
references, context limits, vision/tool flags, online/busy state, queue length,
and an expiry. It never contains model weights, prompts, context, API keys, or
private database records. The host may load/unload a model through its local
provider boundary; clients cannot call Ollama/LM Studio directly.

`AIComputeRouter` supports `this-device`, a specific trusted device, and
`automatic`. Automatic routing scores model availability, online state, queue
load, and the configured device preference. A private task may fall back only
to another trusted personal node (or this device); if no trusted/local node is
available it fails closed.

`AIInferenceSession` provides request IDs, bounded deduplication, bounded host
queue/concurrency, streaming tokens, cancellation, timeout, reconnect/replay,
and host crash recovery after a new discovery. Stream events are signed
envelopes with monotonic sequence numbers.

## Host adapter

Hosts inject an `AIProvider` (or `AIRuntime`) into `PersonalAIHost`. The same
boundary can wrap Ollama, LM Studio, llama.cpp, or the deterministic fake
provider used by integration tests. No product code opens the provider's
localhost API to another device.

The mobile AI settings screen separates:

- `LOCAL` — this device;
- `MY DEVICES` — `Trusted Personal Device` nodes discovered over Keystone P2P;
- `EXTERNAL` — providers with no access to private Keystone context.

No payments, ads, marketplace, compute economy, telemetry, mandatory cloud, or
public stranger access is part of this layer.
