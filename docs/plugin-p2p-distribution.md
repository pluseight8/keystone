# P2P plugin distribution

P2P peers advertise opaque content availability and may provide bounded package bytes/chunks. A peer is not a publisher and cannot grant authority. Chunks are size/count limited, deduplicated, individually hash-checked and finally validated against the package's immutable content address. Incomplete or corrupt transfers never become executable.

The API is `acquire(PluginPackageReference)`, not `download(url)`, so future Hyperswarm, LAN, USB, Bluetooth/store-and-forward and Personal Device Mesh transports can be added without changing identity or review semantics. Plugin delivery is `BACKGROUND`/`BULK` and has bounded concurrency.
