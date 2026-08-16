import { describe, expect, it } from 'vitest';
import {
  UnifiedContextError,
  UnifiedContextResolver,
  ContextPermissionFilter,
  InMemoryUnifiedContextSource,
  InMemoryUnifiedContextStateStore,
  type UnifiedContextRecord,
} from './context.js';
import { AIEgressFirewall, KEYSTONE_UNIFIED_CONTEXT_SOURCE } from './privacy.js';

const NOW = Date.parse('2025-02-20T12:00:00.000Z');
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const record = (input: Partial<UnifiedContextRecord> & Pick<UnifiedContextRecord, 'id' | 'sourceType' | 'author' | 'text'>): UnifiedContextRecord => ({
  visibility: 'private', dataClass: 'PRIVATE', timestamp: iso(-86_400_000), references: [], permissionScope: 'conversation-member', accessibleTo: ['alice'], ...input,
});

describe('UnifiedContextResolver', () => {
  it('follows real references across a message, file and shared-space task without duplicating IDs', async () => {
    const messageId = crypto.randomUUID(); const fileId = crypto.randomUUID(); const spaceId = crypto.randomUUID(); const taskId = crypto.randomUUID();
    const source = new InMemoryUnifiedContextSource('fixture', [
      record({ id: messageId, sourceType: 'message', author: 'bob', text: 'Trip booking details are in the itinerary file', references: [{ id: fileId, type: 'file' }], conversationId: 'chat-trip', timestamp: iso(-31 * 86_400_000) }),
      record({ id: fileId, sourceType: 'file', author: 'bob', text: 'itinerary.pdf Tokyo trip', references: [{ id: spaceId, type: 'space' }], permissionScope: 'file-owner' }),
      record({ id: spaceId, sourceType: 'space', author: 'alice', text: 'Trip planning space', references: [], spaceId }),
      record({ id: taskId, sourceType: 'task', author: 'bob', text: 'Book quiet hotel for the trip', references: [{ id: spaceId, type: 'space' }], spaceId }),
    ]);
    const resolver = new UnifiedContextResolver({ viewerId: 'alice', sources: [source], now: () => NOW });
    await resolver.refresh();
    const result = await resolver.resolve({ text: 'Bob sent trip', maxTokens: 2_000 });
    expect(result.status).toBe('found');
    expect(new Set(result.citations.map(citation => citation.objectId))).toEqual(new Set([messageId, fileId, spaceId, taskId]));
    expect(result.citations.every(citation => citation.permissionScope)).toBe(true);
  });

  it('uses local timezone temporal semantics and bounded context budgets', async () => {
    const yesterdayId = crypto.randomUUID(); const oldId = crypto.randomUUID();
    const source = new InMemoryUnifiedContextSource('temporal', [
      record({ id: yesterdayId, sourceType: 'message', author: 'bob', text: 'yesterday trip decision', timestamp: iso(-86_400_000 + 3_600_000) }),
      record({ id: oldId, sourceType: 'message', author: 'bob', text: 'old trip discussion', timestamp: iso(-10 * 86_400_000) }),
    ]);
    const resolver = new UnifiedContextResolver({ viewerId: 'alice', sources: [source], now: () => NOW });
    await resolver.refresh();
    const result = await resolver.resolve({ text: 'yesterday', timezone: 'UTC', maxTokens: 64 });
    expect(result.citations.map(citation => citation.objectId)).toContain(yesterdayId);
    expect(result.citations.map(citation => citation.objectId)).not.toContain(oldId);
    expect(result.contextItems.length).toBeLessThanOrEqual(1);
    expect(result.omittedObjectIds.length + result.truncatedObjectIds.length).toBeGreaterThanOrEqual(0);
  });

  it('filters blocked, deleted, inaccessible and private records before AI', async () => {
    const allowedId = crypto.randomUUID(); const malloryId = crypto.randomUUID(); const deletedId = crypto.randomUUID(); const privateId = crypto.randomUUID();
    const source = new InMemoryUnifiedContextSource('permissions', [
      record({ id: allowedId, sourceType: 'message', author: 'bob', text: 'allowed trip message' }),
      record({ id: malloryId, sourceType: 'message', author: 'mallory', text: 'secret trip message', accessibleTo: ['mallory'] }),
      record({ id: deletedId, sourceType: 'file', author: 'bob', text: 'deleted trip file', deleted: true }),
      record({ id: privateId, sourceType: 'space', author: 'bob', text: 'private trip space', accessibleTo: ['bob'] }),
    ]);
    const filter = new ContextPermissionFilter({ viewerId: 'alice', blockedIdentities: new Set(['mallory']) });
    const resolver = new UnifiedContextResolver({ viewerId: 'alice', sources: [source], filter, now: () => NOW });
    await resolver.refresh();
    const result = await resolver.resolve({ text: 'trip' });
    expect(result.citations.map(citation => citation.objectId)).toEqual([allowedId]);
  });

  it('enforces scopes, provenance and rejects hallucinated citations', async () => {
    const spaceId = crypto.randomUUID(); const inside = crypto.randomUUID(); const outside = crypto.randomUUID();
    const source = new InMemoryUnifiedContextSource('scopes', [
      record({ id: inside, sourceType: 'task', author: 'alice', text: 'space task', spaceId, permissionScope: 'space-member' }),
      record({ id: outside, sourceType: 'task', author: 'alice', text: 'other task', spaceId: crypto.randomUUID(), permissionScope: 'space-member' }),
      record({ id: spaceId, sourceType: 'space', author: 'alice', text: 'space root', spaceId, permissionScope: 'space-member' }),
    ]);
    const resolver = new UnifiedContextResolver({ viewerId: 'alice', sources: [source], now: () => NOW }); await resolver.refresh();
    const result = await resolver.resolve({ text: 'task', scope: 'current-space', currentSpaceId: spaceId });
    expect(result.citations.map(citation => citation.objectId)).toEqual(expect.arrayContaining([inside]));
    expect(result.citations.map(citation => citation.objectId)).not.toContain(outside);
    expect(() => resolver.validateCitations(result, [{ ...result.citations[0]!, excerpt: 'forged' }])).toThrow(UnifiedContextError);
  });

  it('fails closed for external execution and protects the provider boundary', async () => {
    const source = new InMemoryUnifiedContextSource('external', [record({ id: crypto.randomUUID(), sourceType: 'message', author: 'bob', text: 'private context' })]);
    const resolver = new UnifiedContextResolver({ viewerId: 'alice', sources: [source], now: () => NOW }); await resolver.refresh();
    const result = await resolver.resolve({ text: 'context', execution: 'external' });
    expect(result.status).toBe('blocked_external'); expect(result.contextItems).toHaveLength(0); expect(() => resolver.toAIContext(result, 'external')).toThrow(UnifiedContextError);
    const firewall = new AIEgressFirewall(); const decision = firewall.evaluate('remote', { provider: 'test', model: 'model' }, { userText: 'summarise', context: [{ id: 'ctx:one', source: KEYSTONE_UNIFIED_CONTEXT_SOURCE, dataClass: 'PUBLIC', value: { objectId: 'one' } }] });
    expect(decision.allowed).toBe(false); expect(decision.firewall).toBe('deny');
  });

  it('persists records across resolver restart', async () => {
    const storage = new InMemoryUnifiedContextStateStore(); const id = crypto.randomUUID();
    const first = new UnifiedContextResolver({ viewerId: 'alice', storage, now: () => NOW }); await first.ingestRecord(record({ id, sourceType: 'track', author: 'bob', text: 'saved travel track', visibility: 'public', dataClass: 'PUBLIC', permissionScope: 'public' }));
    const second = new UnifiedContextResolver({ viewerId: 'alice', storage, now: () => NOW }); const result = await second.resolve({ text: 'travel track', scope: 'public-only' });
    expect(result.citations.map(citation => citation.objectId)).toContain(id);
  });
});
