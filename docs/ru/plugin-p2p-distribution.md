# P2P-распространение плагинов

P2P peer передаёт только opaque content availability и bounded bytes/chunks. Peer не становится publisher и не выдаёт authority. Chunks ограничиваются по размеру/числу, deduplicate и проверяются по hash; итоговый пакет сверяется с immutable content address. Неполный или corrupt transfer не может исполняться.

API использует `acquire(PluginPackageReference)`, а не `download(url)`, поэтому будущие Hyperswarm, LAN, USB, Bluetooth/store-and-forward и Personal Device Mesh не меняют identity/review. Доставка имеет класс `BACKGROUND`/`BULK` и bounded concurrency.
