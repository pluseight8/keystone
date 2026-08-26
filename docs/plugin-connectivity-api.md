# Plugin connectivity API

Plugins receive only coarse state and delivery class: offline/device-only/nearby mesh/local or restricted network/global availability, quality and bounded realtime/bulk/eventual capability. They cannot select a person, route, hop, relay, IP, GPS location or anonymous Social Identity.

 maps Fabric states to this coarse surface (`DEVICE_ONLY`, `NEARBY`, `LOCAL_NETWORK`, `RESTRICTED_NETWORK`, `GLOBAL_NETWORK`) and exposes direct/eventual/unavailable reachability only. Provider IDs, endpoints and topology are intentionally withheld.

Network-dependent operations return typed `OFFLINE`, `WAITING_FOR_CONNECTIVITY`, `QUEUED` or provider health states; local tools/models can continue offline. Recovery is bounded and does not create exception/crash loops.
