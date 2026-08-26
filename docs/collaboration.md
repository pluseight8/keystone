# Collaboration and shared editing

Collaboration provides first-class local-first shared editing in Keystone. It reuses the
existing Yjs foundation and the existing object business rules; it does not
introduce a second CRDT or a collaboration-specific transport stack.

The implementation lives in `packages/core/src/collaboration.ts` and is
exposed through `@keystone/core`. Applications install the service through a
typed host adapter. The service receives only `KeystoneDeliveryInterface` and
therefore cannot select Hyperswarm, a relay, a local route, or an alternate
provider. `FabricTransport` and `ConnectivityFabric` remain the delivery
boundary.

## Shared objects

`SharedObjectAdapter<TSnapshot, TEdit>` is the typed extension point:

| Object | Adapter behavior | Existing rule reused |
| --- | --- | --- |
| `document` / `note` | Y.Text content plus Y.Map metadata | bounded document normalization and safe text edits |
| `canvas` | bounded Yjs JSON state-vector deltas | `CanvasDocument` validation and `CanvasMutation` rules |
| `workboard` | canonical board/items projection | `Workboard`/`WorkItem` shape checks and an injected `AgentWorkboardService` rule hook |

The adapter owns initialization, local edit validation, snapshot projection,
and post-merge validation. A remote CRDT update never runs an Agent, ToolFlow,
plugin, model, browser action, or task graph. `shared-vault` and `calendar`
remain adapter-compatible object kinds; an application must explicitly install
their existing service-backed adapter rather than getting an implicit new
authority from collaboration.

## Durable protocol versus presence

Durable content and comments use signed Keystone envelopes and Yjs state-vector
delta updates. Each local edit is applied first, persisted, and then placed in
a bounded per-peer retry queue. A reconnect or the service's bounded retry
timer resends the queued operation; a state-vector sync closes gaps after
offline work and after restart. Duplicate operation IDs are ignored.

Presence is a separate best-effort channel. It is coalesced per peer, bounded
by `CollaborationPolicy`, expires after the configured TTL, is not persisted,
is not added to a Y.Doc, is never sent through durable/DTN custody, and is
never an authority or historical record. Presence is limited to active/idle/
editing state, cursor positions, and bounded selection identifiers. Location,
GPS, latitude/longitude, address, route, and similar fields are rejected.

The default policy is deliberately finite: 512 KiB live updates, 128 KiB
state vectors, an 8 MiB object bound, 10,000 comments, 256 participants,
8,192 queued updates, 512 pending presence entries, a 15-second presence TTL,
and a 100 ms presence minimum interval. Hosts may lower these limits, but may
not remove the bounds.

## Membership, roles, and epochs

Each object has one owner and explicit participant records. The role matrix is:

| Role | Read | Edit durable content | Comment | Manage members |
| --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes |
| editor | yes | yes | yes | no |
| commenter | yes | no | yes | no |
| viewer | yes | no | no | no |

Invitations are addressed to an existing Keystone identity, carry an explicit
role and expiry, and are accepted by the invitee before the owner activates the
participant. Pending, accepted, expired, and revoked states are persisted.
Role changes and revocation increment the object authorization epoch. Updates,
sync requests, membership messages, and presence all carry the epoch; stale
or unauthorized updates are rejected. Revocation is broadcast to the affected
peer as well as remaining collaborators so a disconnected peer cannot keep
using an old membership view after reconnect.

Comments are plain text records. Input is bounded and control characters are
normalized; rendering surfaces must use `renderSafeCommentText` or an
equivalent text-only renderer. Comments and annotations are untrusted user
content, not executable markup or instructions.

## Private objects and content references

Private collaboration requires an application E2E cipher. The current sodium
adapter wraps the existing recipient-keyed `SodiumDirectMessageCipher`; the
Fabric/provider sees only an opaque delivery envelope, and a collaboration
wire body is already marked `protected` before it reaches `FabricTransport`.
The owner, participant, epoch, and operation authorization checks still apply
after decryption. Relays and route providers cannot decrypt or authorize the
object.

Attachments are not embedded in a CRDT update. A shared object may contain
only validated  content-addressed references such as a content ID or
manifest reference. Bytes remain in the existing content layer, with its
integrity, quota, quarantine, and authorization rules. No collaboration edit
creates a new attachment store.

## Host integration and UI

Desktop and mobile expose a `CollaborationService` host-adapter boundary. When
the application bootstrap has not installed a service, the surface displays a
boundary state rather than fabricating shared objects. When installed, the
surface projects object metadata, participant roles, invitation states, epoch,
and durable queue status. The shell does not own CRDT state.

This is validated on **Omarchy (Arch Linux-based distribution)** with Node
`v22.23.2`, pnpm `9.15.0`, and package engine `>=22 <23`. Omarchy is the
development/validation distro only; Keystone remains platform-neutral and does
not make Omarchy a runtime dependency.

## Validation

Controlled tests cover note/document editing, Canvas and Workboard adapters,
roles, expiry and revocation, epoch rejection, forged/cross-object/oversized
updates, replay handling, safe comments, presence TTL/coalescing, restart
hydration, and the private cipher boundary. The real-network proof runs two
independent processes through `HyperswarmTransportProvider` →
`ConnectivityFabric` → `FabricTransport`, then checks invite/accept, durable
offline edits by both peers, automatic retry after reconnect, convergence,
private wire opacity, presence non-persistence, and restart recovery.

Run the focused proofs with the repository's pinned runtime:

```sh
mise exec node@22.23.2 -- pnpm --filter @keystone/core exec vitest run src/collaboration.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
mise exec node@22.23.2 -- pnpm --filter @keystone/core exec vitest run src/testing/collaboration-real-network.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --testTimeout=180000 --hookTimeout=180000
```

does not expand the current product boundary or create a separate release scope.
