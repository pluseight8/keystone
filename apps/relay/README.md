# Keystone Relay

Public HyperDHT rendezvous relay for peers behind symmetric NAT/firewalls.
Persist `RELAY_SEED` in a secret manager: changing it changes the relay public
key. The first log line publishes the public key and observed UDP address.

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
docker build -f apps/relay/Dockerfile -t keystone-relay .
docker run --restart unless-stopped --network host -e RELAY_SEED="$RELAY_SEED" keystone-relay
```

Use host networking because HyperDHT is UDP-heavy and the external port can be
selected dynamically. Allow the observed UDP port
in the VPS firewall. Run multiple relays and distribute their keys/addresses in
a signed Keystone bootstrap configuration.

The relay sees connection metadata. Application envelopes containing private
data must be E2E-encrypted to the recipient before entering the tunnel.
