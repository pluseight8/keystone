# Native WebRTC validation

NativeHost keeps WebRTC behind `NativeWebRTCHost`. A successful WebRTC session
never authenticates a Keystone peer by itself; Keystone protocol validation and
authorization remain mandatory. The current Node/Linux environment does not
provide a native `RTCPeerConnection` implementation, so the physical WebRTC
media path is recorded as `UNSUPPORTED`/`BLOCKED_BY_ENVIRONMENT`, not simulated
as PASS.

's `WebRTCCallMediaRuntime` is the production host boundary for calls. It
requires the host's `RTCPeerConnection`, bounds SDP/ICE, queues early trickle
ICE until a remote description exists, and closes the peer connection and all
tracks on teardown. `ControlledCallMediaRuntime` is used only for deterministic
state, permission and cleanup tests. On this Linux Node host, real Keystone
signalling is validated separately through Hyperswarm/Noise, while real media
negotiation remains `UNSUPPORTED` until a host supplies native WebRTC.
