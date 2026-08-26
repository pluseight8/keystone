# Native network primitives / Сетевые primitives

LAN exposes only coarse online/LAN/metered state and bounded discovery endpoint IDs. Bluetooth, Wi‑Fi Direct and USB are typed transport primitives; they do not reveal social Identity, profile, GPS or routes and do not establish trust. Wi‑Fi Direct is honestly `UNSUPPORTED` in the generic Linux adapter. ConnectivityFabric remains responsible for route policy.

# Сетевые primitives

LAN exposes only coarse online/LAN/metered state and bounded discovery endpoint IDs. Bluetooth, Wi‑Fi Direct and USB are typed transport primitives; they do not reveal social Identity, profile, GPS or routes and do not establish trust. Wi‑Fi Direct is honestly `UNSUPPORTED` in the generic Linux adapter. ConnectivityFabric remains responsible for route policy.

`NativeLocalNetworkHost` — runtime-реализация. Framed same-host transport
служит локальной проверкой и не выбирает routes.

`LocalNetworkTransportProvider` оборачивает этот primitive в общий
Connectivity Fabric. LAN-peer не получает автоматического trust, а hardware и
interface identifiers не выходят за host boundary.
