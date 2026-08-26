# Проверка native WebRTC

WebRTC-сессия сама по себе не авторизует Keystone peer. В текущем Node/Linux
окружении нет native `RTCPeerConnection`, поэтому media path честно отмечается
`UNSUPPORTED`/`BLOCKED_BY_ENVIRONMENT`, а не как PASS.

В  `WebRTCCallMediaRuntime` — production host boundary для звонков. Он
требует `RTCPeerConnection` от host, ограничивает SDP/ICE, помещает ранние
trickle ICE в bounded queue до remote description и закрывает peer connection и
все tracks при завершении. `ControlledCallMediaRuntime` используется только в
deterministic тестах state, permissions и cleanup. На этом Linux Node host
реальное call signalling проверяется отдельно через Hyperswarm/Noise, а real
media negotiation остаётся `UNSUPPORTED`, пока host не предоставит native
WebRTC.
