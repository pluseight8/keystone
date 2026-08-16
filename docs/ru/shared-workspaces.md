# Протокол общих рабочих пространств

Wire type: `social.shared_space` (`keystone.shared-space.v1`). Envelope использует обычные подписи `EnvelopeSecurity` и expiry; внутреннее сообщение также подписано actor/owner. Core отклоняет unknown member, forged signature, stale revision, старый private epoch, duplicate operation и malformed Yjs update.

Глобального workspace registry или coordinator нет. Public spaces отправляются active members через Hyperswarm/Noise. Private spaces передают только recipient-wrapped epoch keys и authenticated ciphertext. Content-addressed files остаются существующим Keystone layer.

Controlled transport suite проверяет partition/replay детерминированно, а real-network suite запускает независимые Keystone процессы и проверяет SharedSpace metadata и encrypted CRDT state через production Hyperswarm/Noise.
