# Устройства

`DeviceService` — локальный реестр доверенных устройств. Запись содержит device ID, платформу, имя, created/joined/last-seen, публичные signing/encryption keys и состояние отзыва. Канонический Identity ID остаётся криптографическим authority; имена не образуют центральный registry.

Pairing request и authorization подписываются существующими `DeviceSessionKeys`. `DeviceReplicationService` передаёт только подписанный lifecycle object внутри authenticated production Transport envelope. Повторные nonce/object ID отклоняются. Revocation сохраняется и проверяется до privileged events.

Production network suite запускает отдельный процесс `alice_device`: Alice authorizes его через Hyperswarm/Noise, получает подписанный privileged event, отзывает устройство, а после restart revoked process отклоняется. Spoof от Mallory отклоняется.

Private keys и recovery phrase никогда не возвращаются Settings Center. Recovery показывается только как status; для будущего показа нужен отдельный explicit host-owned reveal flow.

## Continuity

Device Continuity использует тот же registry, enrollment, session keys, trust
epoch и revocation path. Устройство рекламирует ограниченный набор continuity
capabilities и грубую availability; это подсказка для picker, а не замена
проверке authorization на стороне назначения. Второй Continuity enrollment или
trust database не создаётся. Revocation блокирует новые handoff и отклоняет
старые epoch envelopes.
