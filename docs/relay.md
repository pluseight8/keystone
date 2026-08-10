<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Relay routing

`HyperswarmTransport.connect()` first joins the target's discovery topic and
waits `directTimeoutMs` (8 seconds by default). If no peer connection is bound,
it opens a HyperDHT Noise stream to a configured public relay. Both endpoint
nodes send reciprocal `{source,target}` hello frames. The relay pairs them and
then pipes bytes with Node stream backpressure.

Production bootstrap configuration should contain several independently hosted
relay public keys and UDP addresses, be signed by Keystone release keys, and be
rotatable without an application update. Relay is a metadata-visible last
resort; confidential envelope bodies require recipient-key E2E encryption.
The source/target hello is routing metadata, not authentication: endpoints must
verify the first signed application handshake before accepting the tunnel.

`HyperswarmTransport.send()` enforces this invariant: a message routed through
its relay connection must use the `xchacha20poly1305` ciphertext envelope marker;
plain application bodies are rejected before they reach the relay.
