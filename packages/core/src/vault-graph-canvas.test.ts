import { describe, expect, it } from 'vitest';
import {
  CanvasService,
  UnifiedContextResolver,
  createUnifiedContextSources,
  InMemoryVaultGraphCache,
  MemoryCanvasStorageAdapter,
  MemoryVaultStorageAdapter,
  VaultGraphService,
  VaultService,
  VaultCanvasStorageAdapter,
  VaultTransclusionService,
  type CanvasEdge,
  type CanvasNode,
} from './index.js';

const owner = 'identity-graph-owner';
const now = () => Date.parse('2026-08-17T12:00:00.000Z');

function setup() {
  const storage = new MemoryVaultStorageAdapter();
  const vault = new VaultService({ identityId: owner, rootReference: 'local://graph', name: 'Graph', storage, now });
  return { storage, vault };
}

describe('Vault Graph, Canvas and Transclusion', () => {
  it('builds a bounded graph from links, tags, headings, blocks and unresolved targets', async () => {
    const { vault } = setup(); await vault.ready();
    const target = await vault.createNote({ path: 'Target.md', content: '# Heading\nbody ^block', properties: { tags: { type: 'tags', value: ['project/trip'] } } });
    const source = await vault.createNote({ path: 'Source.md', content: '![[Target#Heading]]\n[[Missing]]\n#project/trip' });
    const graph = new VaultGraphService({ vault, cache: new InMemoryVaultGraphCache(), now }); await graph.ready();
    const global = await graph.globalGraph({ limitNodes: 100, limitEdges: 100 });
    expect(global.nodes.some(node => node.id === source.id && node.kind === 'NOTE')).toBe(true);
    expect(global.nodes.some(node => node.kind === 'HEADING' && node.label === 'Heading')).toBe(true);
    expect(global.nodes.some(node => node.unresolved && node.label === 'Missing')).toBe(true);
    expect(global.edges.some(edge => edge.kind === 'TRANSCLUSION')).toBe(true);
    expect(global.edges.some(edge => edge.kind === 'TAG_RELATION')).toBe(true);
    const local = await graph.localGraph(source.id, 1, { limitNodes: 100, limitEdges: 100 }); expect(local.selectedNodeId).toBe(source.id); expect(local.nodes.some(node => node.id === target.id)).toBe(true);
    expect((await graph.orphans()).some(node => node.id === source.id)).toBe(false);
    await vault.createNote({ path: 'Missing.md', content: '# Missing' }); await graph.refresh(); expect((await graph.unresolved()).some(node => node.label === 'Missing')).toBe(false);
  });

  it('filters global graph, exposes orphans, and rebuilds corrupt cache', async () => {
    const { vault } = setup(); await vault.ready(); const orphan = await vault.createNote({ path: 'Orphan.md', content: '# Orphan #solo' }); await vault.createNote({ path: 'Linked.md', content: '[[Orphan]] #solo' });
    const cache = new InMemoryVaultGraphCache(); const graph = new VaultGraphService({ vault, cache, now }); await graph.ready();
    expect((await graph.orphans()).map(node => node.id)).not.toContain(orphan.id);
    const filtered = await graph.query({ filter: { tags: ['solo'], includeTags: false, nodeKinds: ['NOTE'] } }); expect(filtered.nodes.every(node => node.kind === 'NOTE')).toBe(true);
    cache.corrupt((await vault.getVault()).id, { version: 99 }); const restarted = new VaultGraphService({ vault, cache, now }); await restarted.ready(); expect((await restarted.globalGraph()).nodes.length).toBeGreaterThan(0);
  });

  it('keeps deterministic relation suggestions separate from explicit graph edges', async () => {
    const { vault } = setup(); await vault.ready(); const first = await vault.createNote({ path: 'Trip/First.md', content: '# First #trip' }); const second = await vault.createNote({ path: 'Trip/Second.md', content: '# Second #trip' });
    const graph = new VaultGraphService({ vault, now }); await graph.ready(); const suggestions = await graph.suggestRelations(first.id); expect(suggestions).toHaveLength(1); expect(suggestions[0]).toMatchObject({ kind: 'RELATED_OBJECT', classification: 'DERIVED_RELATION_SUGGESTION', reason: 'SHARED_TAG' }); expect((await graph.globalGraph()).edges.some(edge => edge.kind === 'RELATED_OBJECT')).toBe(false);
    expect((await graph.suggestRelations()).map(value => value.id)).toEqual((await graph.suggestRelations()).map(value => value.id)); expect(second.id).toBeTruthy();
  });

  it('persists structured Canvas references, mutation history, groups and stale revision protection', async () => {
    const { vault } = setup(); await vault.ready(); const note = await vault.createNote({ path: 'CanvasNote.md', content: '# Canvas note' });
    const storage = new MemoryCanvasStorageAdapter(); const canvasService = new CanvasService({ vault, storage, now }); const canvas = await canvasService.create({ id: 'canvas-trip', title: 'Trip' });
    const noteNode: CanvasNode = { id: 'note-card', kind: 'NOTE_CARD', x: 0, y: 0, width: 240, height: 120, reference: { kind: 'vault_note', vaultId: canvas.vaultId, noteId: note.id } };
    const textNode: CanvasNode = { id: 'text-card', kind: 'TEXT_CARD', x: 300, y: 0, width: 200, height: 100, text: 'Ideas' };
    await canvasService.createNode(canvas.id, noteNode); await canvasService.createNode(canvas.id, textNode); const edge: CanvasEdge = { id: 'edge-1', sourceNodeId: noteNode.id, targetNodeId: textNode.id, directed: false, label: 'related' }; await canvasService.connect(canvas.id, edge);
    const group: CanvasNode = { id: 'group-1', kind: 'GROUP', x: -10, y: -10, width: 600, height: 300, title: 'Trip' }; const grouped = await canvasService.group(canvas.id, group, [noteNode.id, textNode.id]); expect(grouped.nodes.find(node => node.id === 'group-1')?.childIds).toEqual([noteNode.id, textNode.id]);
    expect((await canvasService.resolveReference(canvas.id, noteNode.id)).allowed).toBe(true); const copied = await canvasService.copy(canvas.id, [textNode.id]); expect(copied.nodes).toHaveLength(1); await canvasService.paste(canvas.id, copied); const undone = await canvasService.undo(canvas.id); expect(undone.nodes.some(node => node.id === textNode.id)).toBe(true);
    await expect(canvasService.save({ ...canvas, revision: 1 }, { baseRevision: grouped.revision })).rejects.toMatchObject({ code: 'CONFLICT' });
    const restarted = new CanvasService({ vault, storage, now }); await restarted.ready(); expect((await restarted.open(canvas.id))?.nodes.length).toBeGreaterThanOrEqual(3); expect((await restarted.history(canvas.id)).savedRevisions.length).toBeGreaterThan(0);
  });

  it('isolates unauthorized object cards and rejects unsafe web references', async () => {
    const { vault } = setup(); await vault.ready(); const storage = new MemoryCanvasStorageAdapter(); const service = new CanvasService({ vault, storage, objectPermission: { canRead: () => false }, now }); const canvas = await service.create({ id: 'canvas-secure', title: 'Secure' });
    await service.createNode(canvas.id, { id: 'object-card', kind: 'KEYSTONE_OBJECT_CARD', x: 0, y: 0, width: 100, height: 100, reference: { kind: 'keystone_object', objectType: 'profile', objectId: 'profile-public' } }); expect((await service.resolveReference(canvas.id, 'object-card')).allowed).toBe(false);
    await expect(service.createNode(canvas.id, { id: 'unsafe', kind: 'WEB_CARD', x: 0, y: 0, width: 100, height: 100, reference: { kind: 'web', url: 'javascript:alert(1)' } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  it('fits Canvas viewports and persists Canvas history through the Vault adapter', async () => {
    const { vault, storage } = setup(); await vault.ready(); const adapter = new VaultCanvasStorageAdapter(storage); const service = new CanvasService({ vault, storage: adapter, now }); const canvas = await service.create({ id: 'canvas-fit', title: 'Fit' }); await service.createNode(canvas.id, { id: 'fit-card', kind: 'TEXT_CARD', x: 2_000, y: 1_000, width: 240, height: 120, text: 'Fit me' }); const fitted = await service.fitCanvas(canvas.id, { width: 800, height: 600 }); expect(fitted.viewport.width).toBe(800); expect(fitted.viewport.height).toBe(600); expect(fitted.viewport.zoom).toBeGreaterThan(0); const restarted = new CanvasService({ vault, storage: adapter, now }); await restarted.ready(); expect((await restarted.history(canvas.id)).savedRevisions.length).toBeGreaterThan(1);
  });

  it('renders full, heading and block transclusions with provenance, missing and cycle bounds', async () => {
    const { vault } = setup(); await vault.ready(); const a = await vault.createNote({ path: 'A.md', content: '# A\n![[B]]\n![[asset.png]]' }); const b = await vault.createNote({ path: 'B.md', content: '# Heading\ntext ^block\n![[A]]' });
    const adapter = (await vault.getNote(a.id))!; expect(adapter.body).toContain('![[B]]');
    const transclusion = new VaultTransclusionService(vault); const rendered = await transclusion.render(a.id); expect(rendered.fragments.some(fragment => fragment.sourceNoteId === b.id)).toBe(true); expect(rendered.diagnostics.some(value => value.includes('cycle'))).toBe(true); expect(rendered.rendered).toContain('text');
    const bounded = await transclusion.render({ noteIdOrPath: a.id, maxDepth: 1 }); expect(bounded.truncated || bounded.diagnostics.length > 0).toBe(true);
  });

  it('exposes graph and selected Canvas context only to local AI', async () => {
    const { vault } = setup(); await vault.ready(); const note = await vault.createNote({ path: 'Scoped.md', content: '# Scoped #ai' }); const graph = new VaultGraphService({ vault, now }); await graph.ready(); const canvas = new CanvasService({ vault, storage: new MemoryCanvasStorageAdapter(), now }); const document = await canvas.create({ id: 'canvas-scope', title: 'Scope' }); await canvas.createNode(document.id, { id: 'card-1', kind: 'NOTE_CARD', x: 0, y: 0, width: 100, height: 100, reference: { kind: 'vault_note', vaultId: document.vaultId, noteId: note.id } });
    const sources = createUnifiedContextSources({ graph, canvas }, owner); const resolver = new UnifiedContextResolver({ viewerId: owner, sources }); await resolver.ready(); const local = await resolver.resolve({ text: 'Scoped', execution: 'local', currentCanvasId: document.id, selectedCanvasNodeIds: ['card-1'] }); expect(local.citations.some(value => value.sourceType === 'vault_graph')).toBe(true); expect(local.citations.some(value => value.sourceType === 'vault_canvas')).toBe(true); const external = await resolver.resolve({ text: 'Scoped', execution: 'external', currentCanvasId: document.id, selectedCanvasNodeIds: ['card-1'] }); expect(external.status).toBe('blocked_external'); expect(external.citations).toEqual([]);
  });
});
