# Background runtime / Фоновый runtime

`NativeBackgroundTaskHost` models bounded best-effort, transfer, sync and critical work with cancellation and lifecycle states. It is not a perpetual daemon and does not assume mobile background execution. Platform adapters must report suspension/denial; no background task grants new capabilities.

# Фоновый runtime

`NativeBackgroundTaskHost` models bounded best-effort, transfer, sync and critical work with cancellation and lifecycle states. It is not a perpetual daemon and does not assume mobile background execution. Platform adapters must report suspension/denial; no background task grants new capabilities.
