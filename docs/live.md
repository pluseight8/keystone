# Keystone Live (Streams)

Keystone Live is a small, local-first livestream vertical slice. A `LiveBroadcastObject` is a normal signed Keystone object with a stable `broadcastId`; the same object can be referenced by direct messages and community messages (`live_broadcast`). Lifecycle revisions are `scheduled → live → ended` and carry creator/profile, visibility, optional community and Track references, recording URI, and source capabilities.

## Transport and topology

Public lifecycle and chat/reaction objects are replicated in signed `social.live_object` envelopes over the existing Transport. Contacts-only broadcasts fail closed until a group-encrypted object path exists. Community broadcasts require a community reference. There is no central stream server, CDN, account registry, or analytics service.

WebRTC signaling uses the existing `HyperswarmSignalingChannel` and the existing signed Noise envelope. `LiveSessionController` keeps a bounded distribution tree: a viewer has one upstream and a forwarder has a finite child limit. Join, duplicate-join, block, reconnect, disconnect subtree cleanup, stale-member cleanup, and broadcaster-stop transitions are handled locally. A future host may replace the tree policy with peer-assisted relay, but Live does not add a media protocol.

## Host media boundary

`LiveWebRtcMediaAdapter` is the typed boundary for native/browser `RTCPeerConnection` media. The host supplies capture, decoder, ICE and WebRTC lifecycle; core supplies signed objects, signaling, permissions and bounded session state. `LiveRecordingAdapter` may return a normal `VideoObject` after a host recording. Node/Linux CI validates production Hyperswarm discovery, signed lifecycle replication and signaling, but does not claim native WebRTC media playback when `RTCPeerConnection` is unavailable.

## Mobile surface

The mobile Live tab provides a list, broadcast page, host-provided player surface, approximate local viewer state, chat, reactions, sharing, now-playing Track link, and start/stop controls. It renders the installed runtime only; it never falls back to a central URL. Chat continues to use the unified social object model.

`PersistentLiveStorage` keeps accepted lifecycle and chat revisions in the host-provided local encrypted state boundary; `InMemoryLiveStorage` is reserved for focused tests.

## Verification

Controlled integration tests cover signatures, visibility, duplicate/block/stale cleanup, bounded reconnect and end propagation. The real network suite starts independent Alice, Bob and Charlie processes on a local HyperDHT bootstrap, exchanges the signed Live object, sends a live chat object, and exchanges offer/answer/end signals through Hyperswarm/Noise. The suite reports this as production signaling; native WebRTC media remains explicitly **not tested** unless a host adapter supplies a real peer connection.
