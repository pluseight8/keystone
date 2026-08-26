# Native network primitives / Сетевые primitives

Infrastructure Wi-Fi and Ethernet expose one `LocalNetworkTransport` with coarse online/LAN/metered state and bounded discovery. Bluetooth, Wi‑Fi Direct and USB remain separate typed transport primitives; they do not reveal social Identity, profile, GPS or routes and do not establish trust. Wi‑Fi Direct is honestly `UNSUPPORTED` in the generic Linux adapter. ConnectivityFabric remains responsible for route policy.

# Сетевые primitives

Infrastructure Wi-Fi и Ethernet используют единый `LocalNetworkTransport` с coarse online/LAN/metered state и bounded discovery. Bluetooth, Wi‑Fi Direct и USB остаются отдельными typed transport primitives; они не раскрывают social Identity, profile, GPS или routes и не создают trust. Wi‑Fi Direct честно `UNSUPPORTED` в generic Linux adapter. За route policy отвечает ConnectivityFabric.

`NativeLocalNetworkHost` is the runtime implementation. Its same-host
framed transport is a local validation primitive; it performs no route choice.

`LocalNetworkTransportProvider` wraps this primitive under the common
Connectivity Fabric. It does not make LAN peers trusted and does not expose
interface/hardware identifiers above the host boundary.
