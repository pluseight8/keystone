/**
 * Derived graph projections for Markdown-first Vaults.
 *
 * Notes and attachments remain owned by VaultService.  This module keeps only
 * bounded, rebuildable graph metadata and never becomes a second source of
 * truth for user content.
 */
import type { VaultAttachment, VaultIndex, VaultLinkReference, VaultNoteIndex, VaultService } from './vaults.js';
import type { CanvasDocument } from './vault-canvas.js';

export type GraphNodeKind = 'NOTE' | 'HEADING' | 'BLOCK' | 'ATTACHMENT' | 'TAG' | 'CANVAS' | 'KEYSTONE_OBJECT_REF';
export type GraphEdgeKind = 'WIKILINK' | 'MARKDOWN_LINK' | 'EMBED' | 'TRANSCLUSION' | 'HEADING_REF' | 'BLOCK_REF' | 'TAG_RELATION' | 'EXPLICIT_CANVAS_LINK' | 'RELATED_OBJECT';
export type GraphRelationClassification = 'EXPLICIT_RELATION' | 'DERIVED_RELATION_SUGGESTION';
export type GraphLayoutMode = 'FORCE' | 'RADIAL' | 'GRID';

/** Declaration-only extension points. Providers are not executed by core. */
export interface GraphNodeProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly nodeKinds?: readonly string[]; }
export interface GraphEdgeProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly edgeKinds?: readonly string[]; }
export interface GraphFilterProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly filterKeys?: readonly string[]; }
export class GraphExtensionRegistry {
  private readonly values = new Map<string, GraphNodeProvider | GraphEdgeProvider | GraphFilterProvider>();
  register(provider: GraphNodeProvider | GraphEdgeProvider | GraphFilterProvider): void { if (!safeExtension(provider)) throw new VaultGraphError('INVALID_ARGUMENT', 'Graph extension declaration is invalid'); this.values.set(provider.id, clone(provider)); }
  unregister(id: string): void { this.values.delete(id); }
  list(): readonly (GraphNodeProvider | GraphEdgeProvider | GraphFilterProvider)[] { return [...this.values.values()].map(clone); }
}

export interface GraphNode {
  readonly id: string;
  readonly vaultId: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly sourceId?: string;
  readonly path?: string;
  readonly modifiedAt?: string;
  readonly unresolved?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly id: string;
  readonly vaultId: string;
  readonly source: string;
  readonly target: string;
  readonly kind: GraphEdgeKind;
  readonly directed: boolean;
  readonly label?: string;
  readonly classification?: GraphRelationClassification;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A deterministic, non-persisted relation candidate.  Suggestions are kept
 * separate from `GraphEdge` instances so an AI or UI cannot accidentally
 * turn a heuristic into an explicit user relation.
 */
export interface GraphRelationSuggestion extends GraphEdge {
  readonly kind: 'RELATED_OBJECT';
  readonly classification: 'DERIVED_RELATION_SUGGESTION';
  readonly reason: 'SHARED_TAG' | 'SHARED_FOLDER' | 'COMMON_TARGET';
  readonly score: number;
}

export interface GraphFilter {
  readonly folders?: readonly string[];
  readonly tags?: readonly string[];
  readonly noteTypes?: readonly string[];
  readonly properties?: Readonly<Record<string, string | number | boolean>>;
  readonly modifiedFrom?: string;
  readonly modifiedUntil?: string;
  readonly includeUnresolved?: boolean;
  readonly includeAttachments?: boolean;
  readonly includeTags?: boolean;
  readonly hideUnresolved?: boolean;
  readonly hideAttachments?: boolean;
  readonly hideTags?: boolean;
  readonly orphanOnly?: boolean;
  readonly searchQuery?: string;
  readonly minDegree?: number;
  readonly nodeKinds?: readonly GraphNodeKind[];
}

export interface GraphQuery {
  readonly filter?: GraphFilter;
  readonly selectedNodeId?: string;
  readonly depth?: number;
  readonly limitNodes?: number;
  readonly limitEdges?: number;
  readonly cursor?: string;
}

export interface GraphProjection {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceRevision: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly selectedNodeId?: string;
  readonly orphanNodeIds: readonly string[];
  readonly unresolvedNodeIds: readonly string[];
  readonly ambiguousNodeIds: readonly string[];
  readonly truncated: boolean;
  readonly nextCursor?: string;
  readonly metrics: GraphMetrics;
}

export interface GraphMetrics {
  readonly buildMs: number;
  readonly queryMs: number;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly returnedNodes: number;
  readonly returnedEdges: number;
}

export interface GraphLayoutState {
  readonly mode: GraphLayoutMode;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly selectedNodeId?: string;
  readonly filters: GraphFilter;
}

export interface GraphViewportState {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface VaultGraphCache {
  read(vaultId: string): Promise<unknown | undefined>;
  write(vaultId: string, value: GraphCacheSnapshot): Promise<void>;
  delete?(vaultId: string): Promise<void>;
}

export interface GraphCacheSnapshot {
  readonly version: 1;
  readonly vaultId: string;
  readonly sourceRevision: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly generatedAt: string;
}

export interface GraphLayoutStateStore { read(vaultId: string): Promise<unknown | undefined>; write(vaultId: string, value: { readonly layout: GraphLayoutState; readonly viewport: GraphViewportState }): Promise<void>; }
export class InMemoryGraphLayoutStateStore implements GraphLayoutStateStore {
  private readonly values = new Map<string, unknown>();
  async read(vaultId: string): Promise<unknown | undefined> { return this.values.has(vaultId) ? clone(this.values.get(vaultId)) : undefined; }
  async write(vaultId: string, value: { readonly layout: GraphLayoutState; readonly viewport: GraphViewportState }): Promise<void> { this.values.set(vaultId, clone(value)); }
}

export class InMemoryVaultGraphCache implements VaultGraphCache {
  private readonly values = new Map<string, GraphCacheSnapshot | unknown>();
  async read(vaultId: string): Promise<unknown | undefined> { return this.values.has(vaultId) ? clone(this.values.get(vaultId)) : undefined; }
  async write(vaultId: string, value: GraphCacheSnapshot): Promise<void> { this.values.set(vaultId, clone(value)); }
  async delete(vaultId: string): Promise<void> { this.values.delete(vaultId); }
  corrupt(vaultId: string, value: unknown): void { this.values.set(vaultId, value); }
}

export interface VaultGraphServiceOptions {
  readonly vault: VaultService;
  readonly cache?: VaultGraphCache;
  readonly actor?: string;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly now?: () => number;
  readonly canvas?: { readonly list: (actor?: string) => Promise<readonly CanvasDocument[]> };
  readonly layoutStore?: GraphLayoutStateStore;
}

export class VaultGraphError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'UNAUTHORIZED' | 'CORRUPT_CACHE' | 'BOUNDS_EXCEEDED' | 'NOT_FOUND', message: string) { super(message); this.name = 'VaultGraphError'; }
}

/**
 * Builds global and bounded local graph projections from VaultService's
 * indexes.  A query refreshes the derived graph when the Vault revision
 * changes, so external edits and note creation resolve without a second
 * content database.
 */
export class VaultGraphService {
  private readonly vault: VaultService;
  private readonly cache?: VaultGraphCache;
  private readonly actor: string;
  private readonly maxNodes: number;
  private readonly maxEdges: number;
  private readonly now: () => number;
  private readonly canvas?: { readonly list: (actor?: string) => Promise<readonly CanvasDocument[]> };
  private readonly layoutStore?: GraphLayoutStateStore;
  private readonly listeners = new Set<(projection: GraphProjection) => void>();
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private sourceRevision = -1;
  private buildMs = 0;
  private readyPromise: Promise<void>;
  private layoutState: GraphLayoutState = { mode: 'FORCE', zoom: 1, panX: 0, panY: 0, filters: {} };
  private viewportState: GraphViewportState = { width: 0, height: 0, x: 0, y: 0, zoom: 1 };

  constructor(options: VaultGraphServiceOptions) {
    this.vault = options.vault;
    this.cache = options.cache;
    this.actor = options.actor ?? options.vault.identityId;
    this.maxNodes = clamp(options.maxNodes ?? 50_000, 1, 250_000);
    this.maxEdges = clamp(options.maxEdges ?? 200_000, 1, 1_000_000);
    this.now = options.now ?? Date.now;
    this.canvas = options.canvas;
    this.layoutStore = options.layoutStore;
    this.readyPromise = this.initialize();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  build(actor = this.actor): Promise<GraphProjection> { return this.rebuild(actor); }

  async rebuild(actor = this.actor): Promise<GraphProjection> {
    await this.vault.getVault(actor);
    const started = this.now();
    const index = this.vault.index;
    const nextNodes = new Map<string, GraphNode>();
    const nextEdges = new Map<string, GraphEdge>();
    await this.buildFromIndex(index, nextNodes, nextEdges, actor);
    this.nodes = nextNodes;
    this.edges = nextEdges;
    this.sourceRevision = index.revision;
    this.buildMs = Math.max(0, this.now() - started);
    await this.persistCache();
    const projection = this.projection({}, this.now() - started);
    for (const listener of this.listeners) listener(projection);
    return projection;
  }

  async refresh(actor = this.actor): Promise<void> {
    await this.vault.getVault(actor);
    if (this.sourceRevision !== this.vault.index.revision) await this.rebuild(actor);
  }

  async query(query: GraphQuery = {}, actor = this.actor): Promise<GraphProjection> {
    await this.vault.getVault(actor);
    await this.refresh(actor);
    const started = this.now();
    const projection = this.projection(query, Math.max(0, this.now() - started));
    return projection;
  }

  async localGraph(noteId: string, depth = 1, query: Omit<GraphQuery, 'selectedNodeId' | 'depth'> = {}, actor = this.actor): Promise<GraphProjection> {
    if (!noteId.trim()) throw new VaultGraphError('INVALID_ARGUMENT', 'A local graph note id is required');
    return this.query({ ...query, selectedNodeId: noteId, depth: clamp(depth, 0, 8) }, actor);
  }

  async globalGraph(query: GraphQuery = {}, actor = this.actor): Promise<GraphProjection> { return this.query({ ...query, selectedNodeId: undefined }, actor); }
  getGlobalGraph(query: GraphQuery = {}, actor = this.actor): Promise<GraphProjection> { return this.globalGraph(query, actor); }
  getLocalGraph(noteId: string, depth = 1, query: Omit<GraphQuery, 'selectedNodeId' | 'depth'> = {}, actor = this.actor): Promise<GraphProjection> { return this.localGraph(noteId, depth, query, actor); }

  async orphans(actor = this.actor): Promise<readonly GraphNode[]> { const projection = await this.query({ filter: { orphanOnly: true, includeAttachments: false, includeTags: false } }, actor); return projection.nodes.map(clone); }
  async unresolved(actor = this.actor): Promise<readonly GraphNode[]> { const projection = await this.query({ filter: { includeUnresolved: true, nodeKinds: ['NOTE'] } }, actor); return projection.nodes.filter(node => node.unresolved).map(clone); }
  async ambiguous(actor = this.actor): Promise<readonly GraphNode[]> { const projection = await this.query({ filter: { includeUnresolved: true, nodeKinds: ['NOTE'] } }, actor); return projection.nodes.filter(node => node.metadata?.resolution === 'ambiguous').map(clone); }
  listOrphans(actor = this.actor): Promise<readonly GraphNode[]> { return this.orphans(actor); }
  listUnresolved(actor = this.actor): Promise<readonly GraphNode[]> { return this.unresolved(actor); }
  listAmbiguous(actor = this.actor): Promise<readonly GraphNode[]> { return this.ambiguous(actor); }

  /**
   * Return local, deterministic relation suggestions without mutating the
   * graph cache.  Shared tags/folders are intentionally explainable and
   * bounded; explicit Markdown/Canvas relations remain the only persisted
   * edges.
   */
  async suggestRelations(nodeOrQuery?: string | GraphQuery, actor = this.actor): Promise<readonly GraphRelationSuggestion[]> {
    await this.refresh(actor);
    const query = typeof nodeOrQuery === 'string' ? { selectedNodeId: nodeOrQuery } : nodeOrQuery;
    const nodes = [...this.nodes.values()].filter(node => node.kind === 'NOTE' && !node.unresolved);
    const selected = query?.selectedNodeId ? nodes.filter(node => node.id === query.selectedNodeId) : nodes;
    const selectedIds = new Set(selected.map(node => node.id));
    const output: GraphRelationSuggestion[] = [];
    const seen = new Set<string>();
    for (const source of selected) {
      const sourceTags = new Set(((source.metadata?.tags as readonly string[] | undefined) ?? []).map(tag => tag.toLocaleLowerCase()));
      for (const target of nodes) {
        if (source.id === target.id || (query?.selectedNodeId && !selectedIds.has(source.id))) continue;
        const targetTags = new Set(((target.metadata?.tags as readonly string[] | undefined) ?? []).map(tag => tag.toLocaleLowerCase()));
        const sharedTag = [...sourceTags].find(tag => targetTags.has(tag));
        const sharedFolder = source.path && target.path ? folderOf(source.path) === folderOf(target.path) && folderOf(source.path) !== '' : false;
        if (!sharedTag && !sharedFolder) continue;
        const left = source.id < target.id ? source : target;
        const right = source.id < target.id ? target : source;
        const key = `${left.id}:${right.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const reason = sharedTag ? 'SHARED_TAG' : 'SHARED_FOLDER';
        const score = sharedTag ? 2 : 1;
        output.push({ id: `suggestion:${stableHash(`${this.vault.index.vaultId}:${key}:${reason}`)}`, vaultId: this.vault.index.vaultId, source: left.id, target: right.id, kind: 'RELATED_OBJECT', directed: false, classification: 'DERIVED_RELATION_SUGGESTION', reason, score, metadata: sharedTag ? { tag: sharedTag } : { folder: folderOf(left.path ?? '') } });
      }
    }
    return output.sort((left, right) => right.score - left.score || left.source.localeCompare(right.source) || left.target.localeCompare(right.target)).slice(0, 2_000).map(clone);
  }
  relatedSuggestions(nodeOrQuery?: string | GraphQuery, actor = this.actor): Promise<readonly GraphRelationSuggestion[]> { return this.suggestRelations(nodeOrQuery, actor); }

  getLayoutState(): GraphLayoutState { return clone(this.layoutState); }
  setLayoutState(next: Partial<GraphLayoutState>): GraphLayoutState { const mode = next.mode && ['FORCE', 'RADIAL', 'GRID'].includes(next.mode) ? next.mode : this.layoutState.mode; this.layoutState = normalizeLayout({ ...this.layoutState, ...next, mode, zoom: clampFloat(next.zoom ?? this.layoutState.zoom, 0.1, 8), panX: clampFloat(next.panX ?? this.layoutState.panX, -1_000_000, 1_000_000), panY: clampFloat(next.panY ?? this.layoutState.panY, -1_000_000, 1_000_000), filters: clone(next.filters ?? this.layoutState.filters) }); void this.persistLayout(); return this.getLayoutState(); }
  getViewportState(): GraphViewportState { return clone(this.viewportState); }
  setViewportState(next: Partial<GraphViewportState>): GraphViewportState { this.viewportState = normalizeViewport({ ...this.viewportState, ...next, zoom: clampFloat(next.zoom ?? this.viewportState.zoom, 0.1, 8) }); void this.persistLayout(); return this.getViewportState(); }
  subscribe(listener: (projection: GraphProjection) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private async initialize(): Promise<void> {
    await this.vault.ready();
    const vault = await this.vault.getVault(this.actor);
    const layout = await this.layoutStore?.read(vault.id).catch(() => undefined);
    if (layout && typeof layout === 'object' && isLayoutState((layout as { layout?: unknown }).layout) && isViewportState((layout as { viewport?: unknown }).viewport)) { this.layoutState = normalizeLayout((layout as { layout: GraphLayoutState }).layout); this.viewportState = normalizeViewport((layout as { viewport: GraphViewportState }).viewport); }
    const cached = await this.cache?.read(vault.id).catch(() => undefined);
    if (isCacheSnapshot(cached, vault.id)) {
      this.nodes = new Map(cached.nodes.map(node => [node.id, clone(node)]));
      this.edges = new Map(cached.edges.map(edge => [edge.id, clone(edge)]));
      this.sourceRevision = cached.sourceRevision;
      if (this.sourceRevision !== this.vault.index.revision) await this.rebuild(this.actor);
      return;
    }
    if (cached !== undefined && this.cache) await this.cache.delete?.(vault.id).catch(() => undefined);
    await this.rebuild(this.actor);
  }

  private async persistCache(): Promise<void> {
    if (!this.cache || !this.sourceRevision || !this.nodes.size && !this.edges.size) return;
    await this.cache.write(this.vault.index.vaultId, { version: 1, vaultId: this.vault.index.vaultId, sourceRevision: this.sourceRevision, nodes: [...this.nodes.values()].map(clone), edges: [...this.edges.values()].map(clone), generatedAt: new Date(this.now()).toISOString() }).catch(() => undefined);
  }
  private async persistLayout(): Promise<void> { if (this.layoutStore) { const vault = this.vault.index.vaultId; await this.layoutStore.write(vault, { layout: this.getLayoutState(), viewport: this.getViewportState() }).catch(() => undefined); } }

  private async buildFromIndex(index: VaultIndex, nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, actor: string): Promise<void> {
    const notes = Object.values(index.notes);
    const attachments = Object.values(index.attachments);
    const attachmentByPath = new Map(attachments.map(value => [value.path, value]));
    const addNode = (node: GraphNode) => { if (nodes.size < this.maxNodes || nodes.has(node.id)) nodes.set(node.id, node); };
    const addEdge = (edge: GraphEdge) => { if (edges.size < this.maxEdges || edges.has(edge.id)) edges.set(edge.id, edge); };
    for (const note of notes) {
      addNode({ id: note.id, vaultId: index.vaultId, kind: 'NOTE', label: note.title || note.name, sourceId: note.id, path: note.path, modifiedAt: note.modifiedAt, metadata: { tags: note.tags, aliases: note.aliases, properties: note.properties, noteType: note.mimeType ?? 'text/markdown' } });
      for (const heading of note.headings) {
        const id = headingNodeId(note.id, heading.id);
        addNode({ id, vaultId: index.vaultId, kind: 'HEADING', label: heading.text, sourceId: note.id, path: note.path, metadata: { level: heading.level, line: heading.line } });
        addEdge(edge(index.vaultId, note.id, id, 'HEADING_REF', true, heading.text));
      }
      for (const block of note.blocks) {
        const id = blockNodeId(note.id, block.id);
        addNode({ id, vaultId: index.vaultId, kind: 'BLOCK', label: `^${block.id}`, sourceId: note.id, path: note.path, metadata: { line: block.line } });
        addEdge(edge(index.vaultId, note.id, id, 'BLOCK_REF', true, block.id));
      }
      for (const tag of note.tags) {
        const id = tagNodeId(tag);
        addNode({ id, vaultId: index.vaultId, kind: 'TAG', label: `#${tag}`, sourceId: tag, metadata: { tag } });
        addEdge(edge(index.vaultId, note.id, id, 'TAG_RELATION', true, tag));
      }
      const outgoing = index.links.outgoing[note.id] ?? note.links;
      for (const link of outgoing) {
        const target = this.linkTargetId(index, link, attachmentByPath, addNode);
        const kind = link.kind === 'embed' ? (target.startsWith('attachment:') ? 'EMBED' : 'TRANSCLUSION') : link.heading ? 'HEADING_REF' : link.blockId ? 'BLOCK_REF' : link.kind === 'wikilink' ? 'WIKILINK' : 'MARKDOWN_LINK';
        addEdge(edge(index.vaultId, note.id, target, kind, true, link.alias ?? link.target, link.resolution === 'ambiguous' ? { resolution: 'ambiguous' } : undefined));
      }
    }
    for (const attachment of attachments) addNode({ id: attachmentNodeId(attachment.id), vaultId: index.vaultId, kind: 'ATTACHMENT', label: attachment.name, sourceId: attachment.id, path: attachment.path, modifiedAt: attachment.modifiedAt, metadata: { mimeType: attachment.mimeType, size: attachment.size, missing: attachment.missing ?? false } });
    if (this.canvas) {
      for (const canvas of await this.canvas.list(actor).catch(() => [] as readonly CanvasDocument[])) {
        const canvasNodeId = `canvas:${canvas.id}`;
        addNode({ id: canvasNodeId, vaultId: index.vaultId, kind: 'CANVAS', label: canvas.metadata.title, sourceId: canvas.id, metadata: { revision: canvas.revision, nodeCount: canvas.nodes.length, edgeCount: canvas.edges.length } });
        for (const node of canvas.nodes) {
          const reference = node.reference;
          if (!reference) continue;
          const target = reference.kind === 'vault_note' || reference.kind === 'note' ? reference.noteId : reference.kind === 'vault_attachment' || reference.kind === 'file' ? attachmentNodeId(reference.attachmentId) : `object:${reference.kind}:${'objectId' in reference ? reference.objectId : node.id}`;
          if (!nodes.has(target) && (reference.kind === 'keystone_object' || reference.kind === 'object')) addNode({ id: target, vaultId: index.vaultId, kind: 'KEYSTONE_OBJECT_REF', label: `${reference.objectType}:${reference.objectId}`, sourceId: reference.objectId, metadata: { objectType: reference.objectType } });
          if (nodes.has(target)) addEdge(edge(index.vaultId, canvasNodeId, target, 'EXPLICIT_CANVAS_LINK', true, node.title ?? node.kind, { canvasNodeId: node.id }));
        }
      }
    }
  }

  private linkTargetId(index: VaultIndex, link: VaultLinkReference, attachmentByPath: Map<string, VaultAttachment>, addNode: (node: GraphNode) => void): string {
    if (link.targetNoteId) {
      if (link.heading) { const target = index.notes[link.targetNoteId]?.headings.find(value => value.id === slug(link.heading!) || value.text === link.heading); if (target) return headingNodeId(link.targetNoteId, target.id); }
      if (link.blockId && index.notes[link.targetNoteId]?.blocks.some(value => value.id === link.blockId)) return blockNodeId(link.targetNoteId, link.blockId);
      return link.targetNoteId;
    }
    if (link.targetPath && attachmentByPath.has(link.targetPath)) return attachmentNodeId(attachmentByPath.get(link.targetPath)!.id);
    const id = unresolvedNodeId(link.target);
    addNode({ id, vaultId: index.vaultId, kind: 'NOTE', label: link.target, unresolved: true, metadata: { target: link.target, resolution: link.resolution } });
    return id;
  }

  private projection(query: GraphQuery, queryMs: number): GraphProjection {
    const filter = query.filter ?? {};
    const degree = new Map<string, number>();
    for (const edge of this.edges.values()) { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); }
    let nodes = [...this.nodes.values()].filter(node => this.matchesNode(node, filter, degree));
    const orphanIds = new Set(this.findOrphanIds());
    if (filter.orphanOnly) nodes = nodes.filter(node => orphanIds.has(node.id));
    if (query.selectedNodeId) {
      const depth = clamp(query.depth ?? 1, 0, 8);
      const distances = new Map<string, number>([[query.selectedNodeId, 0]]);
      let frontier = [query.selectedNodeId];
      while (frontier.length && Math.max(...frontier.map(id => distances.get(id) ?? 0)) < depth) {
        const next: string[] = [];
        for (const id of frontier) for (const edge of this.edges.values()) if (edge.source === id || edge.target === id) {
          const other = edge.source === id ? edge.target : edge.source;
          if (!distances.has(other)) { distances.set(other, (distances.get(id) ?? 0) + 1); next.push(other); }
          const relatedSource = this.nodes.get(other)?.kind !== 'NOTE' ? this.nodes.get(other)?.sourceId : undefined;
          if (relatedSource && !distances.has(relatedSource)) { distances.set(relatedSource, (distances.get(id) ?? 0) + 1); next.push(relatedSource); }
        }
        frontier = next;
      }
      nodes = nodes.filter(node => distances.has(node.id));
    }
    const offset = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
    const nodeLimit = clamp(query.limitNodes ?? Math.min(5_000, this.maxNodes), 1, this.maxNodes);
    const edgeLimit = clamp(query.limitEdges ?? Math.min(20_000, this.maxEdges), 1, this.maxEdges);
    const selectedIds = new Set(nodes.map(node => node.id));
    const selectedEdges = [...this.edges.values()].filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target));
    const pageNodes = nodes.slice(offset, offset + nodeLimit).map(clone);
    const pageIds = new Set(pageNodes.map(node => node.id));
    const pageEdges = selectedEdges.filter(edge => pageIds.has(edge.source) && pageIds.has(edge.target)).slice(0, edgeLimit).map(clone);
    const truncated = offset + pageNodes.length < nodes.length || pageEdges.length < selectedEdges.length;
    return { version: 1, vaultId: this.vault.index.vaultId, sourceRevision: this.sourceRevision, nodes: pageNodes, edges: pageEdges, ...(query.selectedNodeId ? { selectedNodeId: query.selectedNodeId } : {}), orphanNodeIds: [...orphanIds], unresolvedNodeIds: [...this.nodes.values()].filter(node => node.unresolved).map(node => node.id), ambiguousNodeIds: [...this.nodes.values()].filter(node => node.metadata?.resolution === 'ambiguous').map(node => node.id), truncated, ...(truncated ? { nextCursor: String(offset + pageNodes.length) } : {}), metrics: { buildMs: this.buildMs, queryMs, totalNodes: this.nodes.size, totalEdges: this.edges.size, returnedNodes: pageNodes.length, returnedEdges: pageEdges.length } };
  }

  private matchesNode(node: GraphNode, filter: GraphFilter, degree: Map<string, number>): boolean {
    if (node.unresolved && (filter.includeUnresolved === false || filter.hideUnresolved)) return false;
    if (node.kind === 'ATTACHMENT' && (filter.includeAttachments === false || filter.hideAttachments)) return false;
    if (node.kind === 'TAG' && (filter.includeTags === false || filter.hideTags)) return false;
    if (filter.nodeKinds?.length && !filter.nodeKinds.includes(node.kind)) return false;
    if (filter.folders?.length && node.path && !filter.folders.some(folder => node.path!.startsWith(folder))) return false;
    if (filter.searchQuery?.trim()) { const needle = filter.searchQuery.toLocaleLowerCase(); if (!`${node.label} ${node.path ?? ''} ${JSON.stringify(node.metadata ?? {})}`.toLocaleLowerCase().includes(needle)) return false; }
    if (filter.modifiedFrom && node.modifiedAt && Date.parse(node.modifiedAt) < Date.parse(filter.modifiedFrom)) return false;
    if (filter.modifiedUntil && node.modifiedAt && Date.parse(node.modifiedAt) > Date.parse(filter.modifiedUntil)) return false;
    if (filter.tags?.length && node.kind === 'NOTE') { const tags = (node.metadata?.tags as readonly string[] | undefined) ?? []; if (!filter.tags.some(tag => tags.includes(tag.replace(/^#/, '').toLocaleLowerCase()))) return false; }
    if (filter.noteTypes?.length && node.kind === 'NOTE' && !filter.noteTypes.includes(String(node.metadata?.noteType ?? ''))) return false;
    if (filter.properties && node.kind === 'NOTE') { const properties = node.metadata?.properties as Record<string, { value: unknown }> | undefined; if (!properties || Object.entries(filter.properties).some(([key, value]) => String(properties[key]?.value) !== String(value))) return false; }
    if (filter.minDegree !== undefined && (degree.get(node.id) ?? 0) < Math.max(0, filter.minDegree)) return false;
    return true;
  }

  private findOrphanIds(): string[] {
    const connected = new Set<string>();
    for (const edge of this.edges.values()) if (['WIKILINK', 'MARKDOWN_LINK', 'EMBED', 'TRANSCLUSION', 'HEADING_REF', 'BLOCK_REF'].includes(edge.kind)) {
      const source = this.nodes.get(edge.source); const target = this.nodes.get(edge.target); const sourceId = source?.kind === 'NOTE' ? source.id : source?.sourceId; const targetId = target?.kind === 'NOTE' ? target.id : target?.sourceId;
      if (sourceId && targetId && sourceId !== targetId) { connected.add(sourceId); connected.add(targetId); }
    }
    return [...this.nodes.values()].filter(node => node.kind === 'NOTE' && !node.unresolved && !connected.has(node.id)).map(node => node.id);
  }
}

function edge(vaultId: string, source: string, target: string, kind: GraphEdgeKind, directed: boolean, label?: string, metadata?: Readonly<Record<string, unknown>>): GraphEdge { return { id: `edge:${stableHash(`${vaultId}:${source}:${target}:${kind}:${label ?? ''}`)}`, vaultId, source, target, kind, directed, classification: 'EXPLICIT_RELATION', ...(label ? { label } : {}), ...(metadata ? { metadata } : {}) }; }
function headingNodeId(noteId: string, headingId: string): string { return `${noteId}#heading:${headingId}`; }
function blockNodeId(noteId: string, blockId: string): string { return `${noteId}#block:${blockId}`; }
function attachmentNodeId(id: string): string { return `attachment:${id}`; }
function tagNodeId(tag: string): string { return `tag:${tag.replace(/^#/, '').toLocaleLowerCase()}`; }
function unresolvedNodeId(target: string): string { return `unresolved:${stableHash(target.toLocaleLowerCase())}`; }
function slug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 120) || 'heading'; }
function folderOf(path: string): string { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index); }
function stableHash(value: string): string { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
function clampFloat(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min; }
function clone<T>(value: T): T { return structuredClone(value); }
function isLayoutState(value: unknown): value is GraphLayoutState { return Boolean(value && typeof value === 'object' && ['FORCE', 'RADIAL', 'GRID'].includes((value as GraphLayoutState).mode) && typeof (value as GraphLayoutState).zoom === 'number' && typeof (value as GraphLayoutState).panX === 'number' && typeof (value as GraphLayoutState).panY === 'number' && (value as GraphLayoutState).filters && typeof (value as GraphLayoutState).filters === 'object'); }
function isViewportState(value: unknown): value is GraphViewportState { return Boolean(value && typeof value === 'object' && typeof (value as GraphViewportState).width === 'number' && typeof (value as GraphViewportState).height === 'number' && typeof (value as GraphViewportState).x === 'number' && typeof (value as GraphViewportState).y === 'number' && typeof (value as GraphViewportState).zoom === 'number'); }
function normalizeLayout(value: GraphLayoutState): GraphLayoutState { return { mode: value.mode, zoom: clampFloat(value.zoom, 0.1, 8), panX: clampFloat(value.panX, -1_000_000, 1_000_000), panY: clampFloat(value.panY, -1_000_000, 1_000_000), ...(value.selectedNodeId ? { selectedNodeId: value.selectedNodeId } : {}), filters: clone(value.filters) }; }
function normalizeViewport(value: GraphViewportState): GraphViewportState { return { width: clampFloat(value.width, 0, 100_000), height: clampFloat(value.height, 0, 100_000), x: clampFloat(value.x, -1_000_000, 1_000_000), y: clampFloat(value.y, -1_000_000, 1_000_000), zoom: clampFloat(value.zoom, 0.1, 8) }; }
function isCacheSnapshot(value: unknown, vaultId: string): value is GraphCacheSnapshot { return Boolean(value && typeof value === 'object' && (value as GraphCacheSnapshot).version === 1 && (value as GraphCacheSnapshot).vaultId === vaultId && Number.isSafeInteger((value as GraphCacheSnapshot).sourceRevision) && Array.isArray((value as GraphCacheSnapshot).nodes) && Array.isArray((value as GraphCacheSnapshot).edges) && (value as GraphCacheSnapshot).nodes.every(node => isGraphNode(node) && node.vaultId === vaultId) && (value as GraphCacheSnapshot).edges.every(edge => isGraphEdge(edge) && edge.vaultId === vaultId)); }
function isGraphNode(value: unknown): value is GraphNode { return Boolean(value && typeof value === 'object' && typeof (value as GraphNode).id === 'string' && typeof (value as GraphNode).vaultId === 'string' && ['NOTE', 'HEADING', 'BLOCK', 'ATTACHMENT', 'TAG', 'CANVAS', 'KEYSTONE_OBJECT_REF'].includes((value as GraphNode).kind) && typeof (value as GraphNode).label === 'string'); }
function isGraphEdge(value: unknown): value is GraphEdge { return Boolean(value && typeof value === 'object' && typeof (value as GraphEdge).id === 'string' && typeof (value as GraphEdge).vaultId === 'string' && typeof (value as GraphEdge).source === 'string' && typeof (value as GraphEdge).target === 'string' && ['WIKILINK', 'MARKDOWN_LINK', 'EMBED', 'TRANSCLUSION', 'HEADING_REF', 'BLOCK_REF', 'TAG_RELATION', 'EXPLICIT_CANVAS_LINK', 'RELATED_OBJECT'].includes((value as GraphEdge).kind) && typeof (value as GraphEdge).directed === 'boolean'); }
function safeExtension(value: GraphNodeProvider | GraphEdgeProvider | GraphFilterProvider): boolean { return Boolean(value && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.id) && typeof value.version === 'string' && value.version.length <= 64 && typeof value.integrityHash === 'string' && value.integrityHash.length <= 512); }
