<p align="center"><img src="../branding/logos/logo+text-of-logo.png" alt="Keystone" width="420"></p>

# Architecture

```text
UI (React) -> application commands -> core domain
                         |             |
                   capability      encrypted P2P transport
                         |             +-- WebRTC adapter (MVP)
                         |             +-- Hypercore adapter (planned)
                         +-- policy/audit/event log
```

`packages/core` не зависит от React или конкретной сети. Адаптер транспорта реализует `Transport`, а host (Tauri/Expo/Web) предоставляет secure storage, browser automation bridge и OS capabilities.
