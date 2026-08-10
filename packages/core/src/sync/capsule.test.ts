import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { capsuleInvitationLink, createCapsuleInvitation, createContextCapsule, isolateLifeMapSubgraph, parseCapsuleInvitation } from './capsule.js';

describe('Context Capsules', () => {
  it('isolates selected public records in a subdocument', () => {
    const parent = new Y.Doc(); const lifeMap = parent.getMap('lifeMap'); const nodes = new Y.Map<unknown>(); const edges = new Y.Map<unknown>(); lifeMap.set('nodes', nodes); lifeMap.set('edges', edges);
    nodes.set('public', { id: 'public', title: 'Shared', secret: 'never' }); nodes.set('private', { id: 'private', title: 'Private' }); edges.set('edge', { source: 'public', target: 'private' });
    const capsule = createContextCapsule(parent, 'wedding'); isolateLifeMapSubgraph(parent, capsule, ['public']);
    expect(capsule.document).not.toBe(parent); expect(capsule.nodes.size).toBe(1); expect(capsule.nodes.get('public')).toEqual({ id: 'public', title: 'Shared' }); expect(capsule.edges.size).toBe(0);
  });

  it('round-trips an unguessable invitation and deep link', () => {
    const seed = new Uint8Array(32).fill(7); const publicKey = new Uint8Array(32).fill(9);
    const token = createCapsuleInvitation('capsule-1', publicKey, seed); const invitation = parseCapsuleInvitation(capsuleInvitationLink(token));
    expect(invitation.capsuleId).toBe('capsule-1'); expect(invitation.seed).toEqual(seed); expect(invitation.ephemeralPublicKey).toEqual(publicKey);
  });
});
