# Streams (Phase 10)

Русский обзор: [музыка, видео, короткие видео и streams](ru/social-media.md#музыка-видео-короткие-видео-и-стримы).

`LiveBroadcast` is a signed immutable lifecycle object: a creator first publishes `scheduled`, then creates signed revisions for `live` and `ended`. Revisions retain the stable `broadcastId` and point to the previous revision through `supersedes`. The public signalling identifier is an opaque rendezvous value, not a stream key or a Keystone-owned media endpoint. Broadcasts can reference a Community and may optionally point at a completed content-addressed recording.

`LiveChatMessage` is independently signed, bounded to 4 KiB, and references the concrete live-broadcast revision. It is accepted only while the local client considers the broadcast live. Community visibility is available for community broadcasts; no live-chat service is required.

## P2P topology

`LiveSessionController` is a small-session coordinator, not a media server. It maps each viewer to exactly one upstream and permits an explicitly elected forwarder to carry a bounded number of downstream viewers. It selects the eligible upstream with the fewest children, supports reconnecting a viewer to a new candidate, and refuses a forwarder to leave while it still has children. A host implements `LiveMediaAdapter` using the existing WebRTC signalling/call layer for microphone, camera, and optional screen tracks.

This creates a bounded peer-assisted distribution tree rather than one broadcaster upload connection per viewer. Candidate discovery and relay fallback remain transport concerns: an optional relay may help peers rendezvous or forward when a willing peer cannot be found, but it is never the owner of the broadcast, membership state, chat, or recording. The present core provides a functional multi-peer session contract and deterministic topology projection; NAT traversal policy, SFU interoperability, global audience discovery, abuse controls, and native Stream UI follow in later phases.
