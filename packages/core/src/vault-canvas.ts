/** Structured, portable Canvas documents associated with a Markdown Vault. */
import type { VaultService, VaultStorageAdapter, VaultStorageEntry } from './vaults.js';

export const CANVAS_VERSION = 1 as const;
export const CANVAS_MAX_NODES = 5_000;
export const CANVAS_MAX_EDGES = 20_000;
export const CANVAS_MAX_TEXT = 256 * 1024;
export const CANVAS_MAX_HISTORY = 100;
export const CANVAS_MAX_GROUP_DEPTH = 8;

export type CanvasNodeKind = 'NOTE_CARD' | 'TEXT_CARD' | 'FILE_CARD' | 'IMAGE_CARD' | 'WEB_CARD' | 'GROUP' | 'KEYSTONE_OBJECT_CARD';
export type CanvasSemanticEdge = 'EXPLICIT_RELATION' | 'DERIVED_RELATION_SUGGESTION' | 'RELATED_OBJECT';
export type CanvasReferenceKind = 'vault_note' | 'vault_attachment' | 'keystone_object' | 'web' | 'note' | 'file' | 'object';

/** Future importer/renderer declarations. Core never evaluates plugin code. */
export interface CanvasNodeRenderer { readonly id: string; readonly version: string; readonly integrityHash: string; readonly nodeKinds: readonly string[]; }
export interface CanvasCommand { readonly id: string; readonly version: string; readonly integrityHash: string; readonly command: string; }
export interface CanvasImporterExporter { readonly id: string; readonly version: string; readonly integrityHash: string; readonly formats: readonly string[]; }
export class CanvasExtensionRegistry {
  private readonly values = new Map<string, CanvasNodeRenderer | CanvasCommand | CanvasImporterExporter>();
  register(value: CanvasNodeRenderer | CanvasCommand | CanvasImporterExporter): void { if (!safeExtension(value)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas extension declaration is invalid'); this.values.set(value.id, clone(value)); }
  unregister(id: string): void { this.values.delete(id); }
  list(): readonly (CanvasNodeRenderer | CanvasCommand | CanvasImporterExporter)[] { return [...this.values.values()].map(clone); }
}

export interface CanvasVaultNoteReference {
  readonly kind: 'vault_note' | 'note';
  readonly vaultId: string;
  readonly noteId: string;
  readonly heading?: string;
  readonly blockId?: string;
}

export interface CanvasVaultAttachmentReference {
  readonly kind: 'vault_attachment' | 'file';
  readonly vaultId: string;
  readonly attachmentId: string;
}

export interface CanvasKeystoneObjectReference {
  readonly kind: 'keystone_object' | 'object';
  readonly objectType: string;
  readonly objectId: string;
  readonly visibility?: 'public' | 'contacts' | 'community' | 'private';
}

export interface CanvasWebReference {
  readonly kind: 'web';
  readonly url: string;
  readonly title?: string;
  readonly preview?: Readonly<Record<string, string>>;
}

export type CanvasReference = CanvasVaultNoteReference | CanvasVaultAttachmentReference | CanvasKeystoneObjectReference | CanvasWebReference;

export interface CanvasNode {
  readonly id: string;
  readonly kind: CanvasNodeKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation?: number;
  readonly zIndex?: number;
  readonly text?: string;
  readonly title?: string;
  readonly reference?: CanvasReference;
  readonly parentId?: string;
  readonly childIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CanvasEdge {
  readonly id: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly directed: boolean;
  readonly label?: string;
  readonly semanticType?: CanvasSemanticEdge;
  readonly style?: Readonly<Record<string, string | number | boolean>>;
}

export interface CanvasViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly width?: number;
  readonly height?: number;
}

export interface CanvasSelection {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface CanvasMetadata {
  readonly title: string;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface CanvasDocument {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly viewport: CanvasViewport;
  readonly selection: CanvasSelection;
  readonly metadata: CanvasMetadata;
}

export interface CanvasHistory {
  readonly version: 1;
  readonly canvasId: string;
  readonly savedRevisions: readonly CanvasHistoryRevision[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface CanvasHistoryRevision {
  readonly version: 1;
  readonly revision: number;
  readonly createdAt: string;
  readonly document: CanvasDocument;
}

export type CanvasMutation =
  | { readonly type: 'create_node'; readonly node: CanvasNode; readonly baseRevision?: number }
  | { readonly type: 'move'; readonly nodeIds: readonly string[]; readonly dx: number; readonly dy: number; readonly baseRevision?: number }
  | { readonly type: 'resize'; readonly nodeId: string; readonly width: number; readonly height: number; readonly baseRevision?: number }
  | { readonly type: 'update_node'; readonly nodeId: string; readonly patch: Partial<CanvasNode>; readonly baseRevision?: number }
  | { readonly type: 'delete'; readonly nodeIds: readonly string[]; readonly edgeIds?: readonly string[]; readonly baseRevision?: number }
  | { readonly type: 'connect'; readonly edge: CanvasEdge; readonly baseRevision?: number }
  | { readonly type: 'disconnect'; readonly edgeIds: readonly string[]; readonly baseRevision?: number }
  | { readonly type: 'group'; readonly group: CanvasNode; readonly childIds: readonly string[]; readonly baseRevision?: number }
  | { readonly type: 'ungroup'; readonly groupId: string; readonly baseRevision?: number }
  | { readonly type: 'set_viewport'; readonly viewport: CanvasViewport; readonly baseRevision?: number }
  | { readonly type: 'set_selection'; readonly selection: CanvasSelection; readonly baseRevision?: number };

export interface CanvasClipboard {
  readonly version: 1;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
}

export interface CanvasStorageEntry { readonly id: string; readonly revision?: number; readonly modifiedAt?: string; readonly size?: number; }
export interface CanvasStorageAdapter {
  read(canvasId: string): Promise<Uint8Array | string | undefined>;
  writeAtomic(canvasId: string, data: Uint8Array | string): Promise<void>;
  delete?(canvasId: string): Promise<void>;
  list?(): Promise<readonly CanvasStorageEntry[]>;
  readHistory?(canvasId: string): Promise<unknown | undefined>;
  writeHistory?(canvasId: string, value: unknown): Promise<void>;
}

export interface CanvasReferencePermissionBoundary {
  canRead(reference: CanvasReference, actor: string): Promise<boolean> | boolean;
}

export interface CanvasServiceOptions {
  readonly vault: VaultService;
  readonly storage: CanvasStorageAdapter;
  readonly actor?: string;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
  readonly historyRetention?: number;
  readonly now?: () => number;
  readonly objectPermission?: CanvasReferencePermissionBoundary;
}

export interface CreateCanvasInput { readonly id?: string; readonly title: string; readonly description?: string; readonly metadata?: Readonly<Record<string, unknown>>; }
export interface CanvasSaveOptions { readonly baseRevision?: number; readonly actor?: string; }

export class CanvasError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'CORRUPT_CANVAS' | 'BOUNDS_EXCEEDED' | 'UNSUPPORTED_VERSION' | 'INVALID_REFERENCE', message: string) { super(message); this.name = 'CanvasError'; }
}

export class MemoryCanvasStorageAdapter implements CanvasStorageAdapter {
  private readonly values = new Map<string, string | Uint8Array>();
  private readonly history = new Map<string, unknown>();
  async read(canvasId: string): Promise<Uint8Array | string | undefined> { const value = this.values.get(canvasId); return value === undefined ? undefined : typeof value === 'string' ? value : new Uint8Array(value); }
  async writeAtomic(canvasId: string, data: Uint8Array | string): Promise<void> { this.values.set(canvasId, typeof data === 'string' ? data : new Uint8Array(data)); }
  async delete(canvasId: string): Promise<void> { this.values.delete(canvasId); this.history.delete(canvasId); }
  async list(): Promise<readonly CanvasStorageEntry[]> { return [...this.values].map(([id, value]) => ({ id, size: typeof value === 'string' ? value.length : value.byteLength })); }
  async readHistory(canvasId: string): Promise<unknown | undefined> { return this.history.get(canvasId) === undefined ? undefined : structuredClone(this.history.get(canvasId)); }
  async writeHistory(canvasId: string, value: unknown): Promise<void> { this.history.set(canvasId, structuredClone(value)); }
  corrupt(canvasId: string, value: unknown): void { this.values.set(canvasId, JSON.stringify(value)); }
}

/** Stores structured Canvas JSON in the existing host Vault storage boundary. */
export class VaultCanvasStorageAdapter implements CanvasStorageAdapter {
  private readonly prefix = '.keystone/canvases/';
  constructor(private readonly storage: VaultStorageAdapter) {}
  async read(canvasId: string): Promise<Uint8Array | undefined> { try { return await this.storage.read(`${this.prefix}${safeCanvasId(canvasId)}.json`); } catch { return undefined; } }
  async writeAtomic(canvasId: string, data: Uint8Array | string): Promise<void> { await this.storage.createFolder('.keystone').catch(() => undefined); await this.storage.createFolder('.keystone/canvases').catch(() => undefined); await this.storage.writeAtomic(`${this.prefix}${safeCanvasId(canvasId)}.json`, data); }
  async delete(canvasId: string): Promise<void> { const id = safeCanvasId(canvasId); await this.storage.delete(`${this.prefix}${id}.json`).catch(() => undefined); await this.storage.delete(`${this.prefix}${id}.history.json`).catch(() => undefined); }
  async list(): Promise<readonly CanvasStorageEntry[]> { const entries = await this.storage.list('.keystone/canvases'); return entries.filter(entry => entry.kind === 'file' && entry.path.endsWith('.json') && !entry.path.endsWith('.history.json')).map(entry => ({ id: entry.path.slice('.keystone/canvases/'.length, -5), size: entry.size, modifiedAt: entry.modifiedAt })); }
  async readHistory(canvasId: string): Promise<unknown | undefined> { try { return JSON.parse(new TextDecoder().decode(await this.storage.read(`${this.prefix}${safeCanvasId(canvasId)}.history.json`))); } catch { return undefined; } }
  async writeHistory(canvasId: string, value: unknown): Promise<void> { const id = safeCanvasId(canvasId); await this.storage.createFolder('.keystone').catch(() => undefined); await this.storage.createFolder('.keystone/canvases').catch(() => undefined); await this.storage.writeAtomic(`${this.prefix}${id}.history.json`, JSON.stringify(value)); }
}

export class CanvasService {
  private readonly vault: VaultService;
  private readonly storage: CanvasStorageAdapter;
  private readonly actor: string;
  private readonly maxNodes: number;
  private readonly maxEdges: number;
  private readonly retention: number;
  private readonly now: () => number;
  private readonly objectPermission?: CanvasReferencePermissionBoundary;
  private readonly listeners = new Set<(document: CanvasDocument) => void>();
  private readonly undoStacks = new Map<string, CanvasDocument[]>();
  private readonly redoStacks = new Map<string, CanvasDocument[]>();
  private readonly savedRevisions = new Map<string, CanvasHistoryRevision[]>();
  private readyPromise: Promise<void>;

  constructor(options: CanvasServiceOptions) {
    this.vault = options.vault; this.storage = options.storage; this.actor = options.actor ?? options.vault.identityId; this.maxNodes = clamp(options.maxNodes ?? CANVAS_MAX_NODES, 1, CANVAS_MAX_NODES); this.maxEdges = clamp(options.maxEdges ?? CANVAS_MAX_EDGES, 1, CANVAS_MAX_EDGES); this.retention = clamp(options.historyRetention ?? CANVAS_MAX_HISTORY, 1, CANVAS_MAX_HISTORY); this.now = options.now ?? Date.now; this.objectPermission = options.objectPermission; this.readyPromise = this.vault.ready();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  subscribe(listener: (document: CanvasDocument) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async create(input: CreateCanvasInput, actor = this.actor): Promise<CanvasDocument> {
    await this.assertVault(actor);
    const id = input.id ?? randomId('canvas'); safeCanvasId(id); const title = bounded(input.title, 240, true);
    const timestamp = new Date(this.now()).toISOString();
    const document: CanvasDocument = { version: 1, id, vaultId: (await this.vault.getVault(actor)).id, revision: 1, createdAt: timestamp, updatedAt: timestamp, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selection: { nodeIds: [], edgeIds: [] }, metadata: { title, ...(input.description ? { description: bounded(input.description, CANVAS_MAX_TEXT) } : {}), ...(input.metadata ?? {}) } };
    await this.saveDocument(document, { actor });
    this.savedRevisions.set(id, [{ version: 1, revision: document.revision, createdAt: document.updatedAt, document: clone(document) }]);
    await this.persistHistory(id);
    return clone(document);
  }

  createCanvas(input: CreateCanvasInput, actor = this.actor): Promise<CanvasDocument> { return this.create(input, actor); }
  getCanvas(canvasId: string, actor = this.actor): Promise<CanvasDocument | undefined> { return this.open(canvasId, actor); }
  saveCanvas(document: CanvasDocument, options: CanvasSaveOptions = {}): Promise<CanvasDocument> { return this.save(document, options); }
  applyMutation(canvasId: string, mutation: CanvasMutation, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, mutation, actor); }

  async list(actor = this.actor): Promise<readonly CanvasDocument[]> {
    await this.assertVault(actor);
    const entries = await this.storage.list?.() ?? [];
    const output: CanvasDocument[] = [];
    for (const entry of entries) { try { const value = await this.open(entry.id, actor); if (value) output.push(value); } catch { /* malformed canvases are isolated from linked Vault files */ } }
    return output.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async open(canvasId: string, actor = this.actor): Promise<CanvasDocument | undefined> {
    await this.assertVault(actor); safeCanvasId(canvasId); const raw = await this.storage.read(canvasId); if (raw === undefined) return undefined;
    let parsed: unknown; try { parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw)); } catch { throw new CanvasError('CORRUPT_CANVAS', 'Canvas JSON is corrupt'); }
    const document = migrateCanvasDocument(parsed); if (!document) throw new CanvasError('CORRUPT_CANVAS', 'Canvas document is invalid'); if (document.vaultId !== (await this.vault.getVault(actor)).id) throw new CanvasError('NOT_AUTHORIZED', 'Canvas belongs to another Vault');
    await this.hydrateHistory(document.id);
    return clone(document);
  }

  async save(document: CanvasDocument, options: CanvasSaveOptions = {}): Promise<CanvasDocument> { await this.assertVault(options.actor ?? this.actor); return this.saveDocument(document, options); }

  async mutate(canvasId: string, mutation: CanvasMutation, actor = this.actor): Promise<CanvasDocument> {
    await this.assertVault(actor); const current = await this.require(canvasId, actor); const baseRevision = mutation.baseRevision ?? current.revision; if (baseRevision !== current.revision) throw new CanvasError('CONFLICT', 'Canvas base revision is stale');
    const next = applyCanvasMutation(current, mutation, this.maxNodes, this.maxEdges);
    const saved = await this.commit(current, next, actor);
    return saved;
  }

  createNode(canvasId: string, node: CanvasNode, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'create_node', node }, actor); }
  move(canvasId: string, nodeIds: readonly string[], dx: number, dy: number, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'move', nodeIds, dx, dy }, actor); }
  resize(canvasId: string, nodeId: string, width: number, height: number, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'resize', nodeId, width, height }, actor); }
  delete(canvasId: string, nodeIds: readonly string[], actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'delete', nodeIds }, actor); }
  connect(canvasId: string, edge: CanvasEdge, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'connect', edge }, actor); }
  disconnect(canvasId: string, edgeIds: readonly string[], actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'disconnect', edgeIds }, actor); }
  group(canvasId: string, group: CanvasNode, childIds: readonly string[], actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'group', group, childIds }, actor); }
  ungroup(canvasId: string, groupId: string, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'ungroup', groupId }, actor); }
  setViewport(canvasId: string, viewport: CanvasViewport, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'set_viewport', viewport }, actor); }
  setSelection(canvasId: string, selection: CanvasSelection, actor = this.actor): Promise<CanvasDocument> { return this.mutate(canvasId, { type: 'set_selection', selection }, actor); }
  moveNode(canvasId: string, nodeId: string, dx: number, dy: number, actor = this.actor): Promise<CanvasDocument> { return this.move(canvasId, [nodeId], dx, dy, actor); }
  resizeNode(canvasId: string, nodeId: string, width: number, height: number, actor = this.actor): Promise<CanvasDocument> { return this.resize(canvasId, nodeId, width, height, actor); }
  deleteNode(canvasId: string, nodeId: string, actor = this.actor): Promise<CanvasDocument> { return this.delete(canvasId, [nodeId], actor); }
  connectNodes(canvasId: string, edge: CanvasEdge, actor = this.actor): Promise<CanvasDocument> { return this.connect(canvasId, edge, actor); }
  disconnectEdges(canvasId: string, edgeIds: readonly string[], actor = this.actor): Promise<CanvasDocument> { return this.disconnect(canvasId, edgeIds, actor); }
  duplicateNodes(canvasId: string, nodeIds: readonly string[], offset = { x: 32, y: 32 }, actor = this.actor): Promise<CanvasDocument> { return this.duplicate(canvasId, nodeIds, offset, actor); }
  undoCanvas(canvasId: string, actor = this.actor): Promise<CanvasDocument> { return this.undo(canvasId, actor); }
  redoCanvas(canvasId: string, actor = this.actor): Promise<CanvasDocument> { return this.redo(canvasId, actor); }

  /** Fit a bounded set of cards into the persisted viewport; no rendering is done in core. */
  async fitSelection(canvasId: string, nodeIds?: readonly string[], viewportSize: { readonly width: number; readonly height: number } = { width: 1_024, height: 768 }, actor = this.actor): Promise<CanvasDocument> {
    const document = await this.require(canvasId, actor);
    const ids = new Set(nodeIds ?? document.selection.nodeIds);
    const nodes = document.nodes.filter(node => ids.has(node.id));
    return this.setViewport(canvasId, fitViewport(nodes, viewportSize, document.viewport), actor);
  }

  async fitCanvas(canvasId: string, viewportSize: { readonly width: number; readonly height: number } = { width: 1_024, height: 768 }, actor = this.actor): Promise<CanvasDocument> {
    const document = await this.require(canvasId, actor);
    return this.setViewport(canvasId, fitViewport(document.nodes, viewportSize, document.viewport), actor);
  }

  async duplicate(canvasId: string, nodeIds: readonly string[], offset = { x: 32, y: 32 }, actor = this.actor): Promise<CanvasDocument> {
    const current = await this.require(canvasId, actor); const wanted = new Set(nodeIds); const sourceNodes = current.nodes.filter(node => wanted.has(node.id)); const ids = new Map(sourceNodes.map(node => [node.id, randomId('canvas-node')])); const copies = sourceNodes.map(node => ({ ...clone(node), id: ids.get(node.id)!, x: node.x + offset.x, y: node.y + offset.y, ...(node.parentId && ids.has(node.parentId) ? { parentId: ids.get(node.parentId)! } : { parentId: undefined }), ...(node.childIds ? { childIds: node.childIds.filter(id => ids.has(id)).map(id => ids.get(id)!) } : {}) })); const copiedEdges = current.edges.filter(edge => wanted.has(edge.sourceNodeId) && wanted.has(edge.targetNodeId)).map(edge => ({ ...clone(edge), id: randomId('canvas-edge'), sourceNodeId: ids.get(edge.sourceNodeId)!, targetNodeId: ids.get(edge.targetNodeId)! })); let next = current; for (const node of copies.filter(node => !node.parentId)) next = applyCanvasMutation(next, { type: 'create_node', node }, this.maxNodes, this.maxEdges); for (const node of copies.filter(node => node.parentId)) next = applyCanvasMutation(next, { type: 'create_node', node }, this.maxNodes, this.maxEdges); for (const edge of copiedEdges) next = applyCanvasMutation(next, { type: 'connect', edge }, this.maxNodes, this.maxEdges); return this.commit(current, next, actor);
  }

  async copy(canvasId: string, nodeIds: readonly string[], actor = this.actor): Promise<CanvasClipboard> { const current = await this.require(canvasId, actor); const wanted = new Set(nodeIds); return { version: 1, nodes: current.nodes.filter(node => wanted.has(node.id)).map(node => ({ ...clone(node), ...(node.childIds ? { childIds: node.childIds.filter(id => wanted.has(id)) } : {}), ...(node.parentId && wanted.has(node.parentId) ? {} : { parentId: undefined }) })), edges: current.edges.filter(edge => wanted.has(edge.sourceNodeId) && wanted.has(edge.targetNodeId)).map(clone) }; }
    async paste(canvasId: string, clipboard: CanvasClipboard, offset = { x: 32, y: 32 }, actor = this.actor): Promise<CanvasDocument> { if (!clipboard || clipboard.version !== 1) throw new CanvasError('INVALID_ARGUMENT', 'Canvas clipboard is invalid'); const current = await this.require(canvasId, actor); const ids = new Map(clipboard.nodes.map(node => [node.id, randomId('canvas-node')])); const nodes = clipboard.nodes.map(node => ({ ...clone(node), id: ids.get(node.id)!, x: node.x + offset.x, y: node.y + offset.y, ...(node.parentId && ids.has(node.parentId) ? { parentId: ids.get(node.parentId)! } : { parentId: undefined }), ...(node.childIds ? { childIds: node.childIds.filter(id => ids.has(id)).map(id => ids.get(id)!) } : {}) })); let next = current; for (const node of nodes) next = applyCanvasMutation(next, { type: 'create_node', node }, this.maxNodes, this.maxEdges); for (const edge of clipboard.edges) { const sourceNodeId = ids.get(edge.sourceNodeId); const targetNodeId = ids.get(edge.targetNodeId); if (sourceNodeId && targetNodeId) next = applyCanvasMutation(next, { type: 'connect', edge: { ...clone(edge), id: randomId('canvas-edge'), sourceNodeId, targetNodeId } }, this.maxNodes, this.maxEdges); } return this.commit(current, next, actor); }

  async undo(canvasId: string, actor = this.actor): Promise<CanvasDocument> { await this.assertVault(actor); const current = await this.require(canvasId, actor); const stack = this.undoStacks.get(canvasId) ?? []; const previous = stack.pop(); if (!previous) return current; const redo = this.redoStacks.get(canvasId) ?? []; redo.push(current); this.redoStacks.set(canvasId, redo.slice(-this.retention)); return this.commit(current, { ...previous, revision: current.revision + 1, updatedAt: new Date(this.now()).toISOString() }, actor, false); }
  async redo(canvasId: string, actor = this.actor): Promise<CanvasDocument> { await this.assertVault(actor); const current = await this.require(canvasId, actor); const stack = this.redoStacks.get(canvasId) ?? []; const next = stack.pop(); if (!next) return current; const undo = this.undoStacks.get(canvasId) ?? []; undo.push(current); this.undoStacks.set(canvasId, undo.slice(-this.retention)); return this.commit(current, { ...next, revision: current.revision + 1, updatedAt: new Date(this.now()).toISOString() }, actor, false); }
  async restoreRevision(canvasId: string, revision: number, actor = this.actor): Promise<CanvasDocument> { const history = await this.history(canvasId, actor); const target = history.savedRevisions.find(value => value.revision === revision); if (!target) throw new CanvasError('NOT_FOUND', 'Canvas revision not found'); const current = await this.require(canvasId, actor); return this.commit(current, { ...target.document, revision: current.revision + 1, updatedAt: new Date(this.now()).toISOString() }, actor, true); }

  async history(canvasId: string, actor = this.actor): Promise<CanvasHistory> { await this.assertVault(actor); await this.require(canvasId, actor); await this.hydrateHistory(canvasId); return { version: 1, canvasId, savedRevisions: (this.savedRevisions.get(canvasId) ?? []).map(clone), canUndo: (this.undoStacks.get(canvasId) ?? []).length > 0, canRedo: (this.redoStacks.get(canvasId) ?? []).length > 0 }; }
  async export(canvasId: string, actor = this.actor): Promise<string> { return JSON.stringify(await this.require(canvasId, actor), null, 2); }
  async import(value: string | unknown, actor = this.actor): Promise<CanvasDocument> { let parsed: unknown; try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw new CanvasError('CORRUPT_CANVAS', 'Canvas import is not valid JSON'); } const document = migrateCanvasDocument(parsed); if (!document) throw new CanvasError('CORRUPT_CANVAS', 'Canvas import is invalid'); const vault = await this.vault.getVault(actor); const imported = { ...document, id: randomId('canvas'), vaultId: vault.id, revision: 1, createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }; return this.saveDocument(imported, { actor }); }

  async resolveReference(canvasId: string, nodeId: string, actor = this.actor): Promise<{ readonly node: CanvasNode; readonly allowed: boolean; readonly noteId?: string; readonly attachmentId?: string }> {
    const document = await this.require(canvasId, actor); const node = document.nodes.find(value => value.id === nodeId); if (!node) throw new CanvasError('NOT_FOUND', 'Canvas node not found'); const reference = node.reference; if (!reference) return { node: clone(node), allowed: true };
    if (reference.kind === 'vault_note' || reference.kind === 'note') { const note = await this.vault.getNote(reference.noteId, actor); return { node: clone(node), allowed: Boolean(note), noteId: reference.noteId }; }
    if (reference.kind === 'vault_attachment' || reference.kind === 'file') { const attachment = await this.vault.getAttachment(reference.attachmentId, actor); return { node: clone(node), allowed: Boolean(attachment && !attachment.missing), attachmentId: reference.attachmentId }; }
    if (reference.kind === 'web') { validateWebUrl(reference.url); return { node: clone(node), allowed: true }; }
    return { node: clone(node), allowed: Boolean(this.objectPermission && await this.objectPermission.canRead(reference, actor)) };
  }

  async convertTextCardToNote(canvasId: string, nodeId: string, path: string, actor = this.actor): Promise<CanvasDocument> {
    const current = await this.require(canvasId, actor); const node = current.nodes.find(value => value.id === nodeId); if (!node || node.kind !== 'TEXT_CARD') throw new CanvasError('INVALID_ARGUMENT', 'Only a Text Card can be converted to a note'); const note = await this.vault.createNote({ path, content: node.text ?? '', title: node.title }, actor); return this.mutate(canvasId, { type: 'update_node', nodeId, patch: { kind: 'NOTE_CARD', text: undefined, reference: { kind: 'vault_note', vaultId: current.vaultId, noteId: note.id }, title: note.title } }, actor);
  }

  private async commit(previous: CanvasDocument, next: CanvasDocument, actor: string, recordUndo = true): Promise<CanvasDocument> { if (recordUndo) { const undo = this.undoStacks.get(previous.id) ?? []; undo.push(previous); this.undoStacks.set(previous.id, undo.slice(-this.retention)); this.redoStacks.delete(previous.id); } const saved = await this.saveDocument(next, { actor, baseRevision: previous.revision }); const history = this.savedRevisions.get(saved.id) ?? []; history.push({ version: 1, revision: saved.revision, createdAt: saved.updatedAt, document: clone(saved) }); this.savedRevisions.set(saved.id, history.slice(-this.retention)); await this.persistHistory(saved.id); for (const listener of this.listeners) listener(clone(saved)); return saved; }
  private async saveDocument(document: CanvasDocument, options: CanvasSaveOptions = {}): Promise<CanvasDocument> { const actor = options.actor ?? this.actor; await this.assertVault(actor); validateCanvasDocument(document, this.maxNodes, this.maxEdges); const vault = await this.vault.getVault(actor); if (document.vaultId !== vault.id) throw new CanvasError('NOT_AUTHORIZED', 'Canvas belongs to another Vault'); const current = await this.storage.read(document.id); if (options.baseRevision !== undefined && current !== undefined) { let parsed: CanvasDocument | undefined; try { parsed = migrateCanvasDocument(typeof current === 'string' ? JSON.parse(current) : JSON.parse(new TextDecoder().decode(current))); } catch { throw new CanvasError('CORRUPT_CANVAS', 'Existing Canvas JSON is corrupt'); } if (parsed && parsed.revision !== options.baseRevision) throw new CanvasError('CONFLICT', 'Canvas base revision is stale'); } await this.storage.writeAtomic(document.id, JSON.stringify(document)); return clone(document); }
  private async require(canvasId: string, actor: string): Promise<CanvasDocument> { const document = await this.open(canvasId, actor); if (!document) throw new CanvasError('NOT_FOUND', 'Canvas not found'); return document; }
  private async assertVault(actor: string): Promise<void> { await this.vault.getVault(actor); }
  private async hydrateHistory(canvasId: string): Promise<void> { if (this.savedRevisions.has(canvasId) || !this.storage.readHistory) return; const value = await this.storage.readHistory(canvasId).catch(() => undefined); if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { revisions?: unknown }).revisions)) return; const revisions = (value as { revisions: unknown[] }).revisions.map(item => isHistoryRevision(item) ? clone(item) : undefined).filter((item): item is CanvasHistoryRevision => Boolean(item)).slice(-this.retention); this.savedRevisions.set(canvasId, revisions); if (revisions.length > 1) this.undoStacks.set(canvasId, revisions.slice(0, -1).map(value => clone(value.document))); }
  private async persistHistory(canvasId: string): Promise<void> { if (this.storage.writeHistory) await this.storage.writeHistory(canvasId, { version: 1, revisions: this.savedRevisions.get(canvasId) ?? [] }); }
}

/**
 * Pure Canvas business-rule application used by both the local snapshot
 * service and the R0P81 CRDT adapter.  It deliberately has no storage or
 * transport side effects, so collaboration can validate a mutation before it
 * is committed to a Y.Doc.
 */
export function applyCanvasMutation(document: CanvasDocument, mutation: CanvasMutation, maxNodes = CANVAS_MAX_NODES, maxEdges = CANVAS_MAX_EDGES): CanvasDocument {
  const nodes = [...document.nodes]; const edges = [...document.edges]; const map = new Map(nodes.map(node => [node.id, node]));
  if (mutation.type === 'create_node') { validateCanvasNode(mutation.node); if (map.has(mutation.node.id)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas node id already exists'); if (nodes.length >= maxNodes) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas node limit reached'); nodes.push(clone(mutation.node)); }
  else if (mutation.type === 'move') { for (const id of mutation.nodeIds) { const node = map.get(id); if (!node) throw new CanvasError('NOT_FOUND', `Canvas node not found: ${id}`); replaceNode(nodes, { ...node, x: finite(mutation.dx + node.x), y: finite(mutation.dy + node.y) }); } }
  else if (mutation.type === 'resize') { const node = map.get(mutation.nodeId); if (!node) throw new CanvasError('NOT_FOUND', 'Canvas node not found'); replaceNode(nodes, { ...node, width: positive(mutation.width), height: positive(mutation.height) }); }
  else if (mutation.type === 'update_node') { const node = map.get(mutation.nodeId); if (!node) throw new CanvasError('NOT_FOUND', 'Canvas node not found'); const next = { ...node, ...mutation.patch, id: node.id }; validateCanvasNode(next); replaceNode(nodes, next); }
  else if (mutation.type === 'delete') { const ids = new Set(mutation.nodeIds); for (let index = nodes.length - 1; index >= 0; index -= 1) if (ids.has(nodes[index]!.id)) nodes.splice(index, 1); for (let index = edges.length - 1; index >= 0; index -= 1) if (ids.has(edges[index]!.sourceNodeId) || ids.has(edges[index]!.targetNodeId) || mutation.edgeIds?.includes(edges[index]!.id)) edges.splice(index, 1); for (let index = 0; index < nodes.length; index += 1) { const node = nodes[index]!; const childIds = node.childIds?.filter(id => !ids.has(id)); const parentId = node.parentId && ids.has(node.parentId) ? undefined : node.parentId; if (childIds || parentId !== node.parentId) nodes[index] = { ...node, ...(childIds ? { childIds } : {}), ...(parentId ? { parentId } : { parentId: undefined }) }; } }
  else if (mutation.type === 'connect') { validateCanvasEdge(mutation.edge, map); if (edges.some(edge => edge.id === mutation.edge.id)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas edge id already exists'); if (edges.length >= maxEdges) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas edge limit reached'); edges.push(clone(mutation.edge)); }
  else if (mutation.type === 'disconnect') { for (let index = edges.length - 1; index >= 0; index -= 1) if (mutation.edgeIds.includes(edges[index]!.id)) edges.splice(index, 1); }
  else if (mutation.type === 'group') { validateCanvasNode(mutation.group); if (mutation.group.kind !== 'GROUP') throw new CanvasError('INVALID_ARGUMENT', 'Canvas grouping requires a GROUP node'); if (nodes.length >= maxNodes) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas node limit reached'); const childIds = [...new Set(mutation.childIds)]; const children = childIds.map(id => map.get(id)); if (children.some(value => !value)) throw new CanvasError('NOT_FOUND', 'Canvas group child not found'); if (childIds.includes(mutation.group.id)) throw new CanvasError('INVALID_ARGUMENT', 'A Canvas group cannot contain itself'); const depth = Math.max(...childIds.map(id => groupDepth(id, map)), 0); if (depth >= CANVAS_MAX_GROUP_DEPTH) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas group nesting limit reached'); for (const node of nodes) if (node.kind === 'GROUP' && node.id !== mutation.group.id && node.childIds?.some(id => childIds.includes(id))) replaceNode(nodes, { ...node, childIds: node.childIds.filter(id => !childIds.includes(id)) }); for (const child of children) replaceNode(nodes, { ...child!, parentId: mutation.group.id }); nodes.push({ ...clone(mutation.group), childIds }); }
  else if (mutation.type === 'ungroup') { const group = map.get(mutation.groupId); if (!group || group.kind !== 'GROUP') throw new CanvasError('NOT_FOUND', 'Canvas group not found'); for (const node of nodes) if (node.parentId === mutation.groupId) replaceNode(nodes, { ...node, parentId: undefined }); const index = nodes.findIndex(node => node.id === mutation.groupId); if (index >= 0) nodes.splice(index, 1); }
  else if (mutation.type === 'set_viewport') { validateViewport(mutation.viewport); return { ...document, viewport: clone(mutation.viewport), revision: document.revision + 1, updatedAt: new Date().toISOString() }; }
  else if (mutation.type === 'set_selection') { const selection = { nodeIds: [...new Set(mutation.selection.nodeIds)].filter(id => map.has(id)), edgeIds: [...new Set(mutation.selection.edgeIds)].filter(id => edges.some(edge => edge.id === id)) }; return { ...document, selection, revision: document.revision + 1, updatedAt: new Date().toISOString() }; }
  const selection = { nodeIds: document.selection.nodeIds.filter(id => nodes.some(node => node.id === id)), edgeIds: document.selection.edgeIds.filter(id => edges.some(edge => edge.id === id)) };
  return { ...document, nodes, edges, selection, revision: document.revision + 1, updatedAt: new Date().toISOString() };
}

export function validateCanvasDocument(document: CanvasDocument, maxNodes = CANVAS_MAX_NODES, maxEdges = CANVAS_MAX_EDGES): void { if (!document || document.version !== 1 || !isSafeCanvasId(document.id) || !isSafeCanvasId(document.vaultId) || !Number.isSafeInteger(document.revision) || document.revision < 1 || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new CanvasError('CORRUPT_CANVAS', 'Canvas document shape is invalid'); if (document.nodes.length > maxNodes || document.edges.length > maxEdges) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas document exceeds configured bounds'); const nodeIds = new Set<string>(); for (const node of document.nodes) { validateCanvasNode(node); if (nodeIds.has(node.id)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas node ids must be unique'); nodeIds.add(node.id); } const map = new Map(document.nodes.map(node => [node.id, node])); for (const node of document.nodes) { if (node.parentId) { const parent = map.get(node.parentId); if (!parent || parent.kind !== 'GROUP') throw new CanvasError('INVALID_ARGUMENT', 'Canvas parent must reference a group'); } if (node.childIds) { if (node.kind !== 'GROUP' || new Set(node.childIds).size !== node.childIds.length) throw new CanvasError('INVALID_ARGUMENT', 'Canvas child references are invalid'); for (const childId of node.childIds) { const child = map.get(childId); if (!child || child.parentId !== node.id) throw new CanvasError('INVALID_ARGUMENT', 'Canvas group child reference is invalid'); } if (groupDepth(node.id, map) >= CANVAS_MAX_GROUP_DEPTH) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas group nesting limit reached'); } } const edgeIds = new Set<string>(); for (const edge of document.edges) { validateCanvasEdge(edge, map); if (edgeIds.has(edge.id)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas edge ids must be unique'); edgeIds.add(edge.id); } if (!document.selection || !Array.isArray(document.selection.nodeIds) || !Array.isArray(document.selection.edgeIds)) throw new CanvasError('CORRUPT_CANVAS', 'Canvas selection is invalid'); if (document.selection.nodeIds.some(id => !map.has(id)) || document.selection.edgeIds.some(id => !edgeIds.has(id))) throw new CanvasError('INVALID_ARGUMENT', 'Canvas selection points to missing items'); validateViewport(document.viewport); if (!document.metadata || typeof document.metadata.title !== 'string') throw new CanvasError('CORRUPT_CANVAS', 'Canvas metadata is invalid'); }
function validateCanvasNode(node: CanvasNode): void { if (!node || !isSafeCanvasId(node.id) || !['NOTE_CARD', 'TEXT_CARD', 'FILE_CARD', 'IMAGE_CARD', 'WEB_CARD', 'GROUP', 'KEYSTONE_OBJECT_CARD'].includes(node.kind)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas node is invalid'); finite(node.x); finite(node.y); positive(node.width); positive(node.height); if (node.text !== undefined) bounded(node.text, CANVAS_MAX_TEXT); if (node.kind === 'TEXT_CARD' && node.text === undefined) throw new CanvasError('INVALID_ARGUMENT', 'Text Card requires structured text'); if (node.kind === 'GROUP' && node.childIds && node.childIds.length > CANVAS_MAX_NODES) throw new CanvasError('BOUNDS_EXCEEDED', 'Canvas group is too large'); if (node.reference) validateReference(node.reference); }
function validateCanvasEdge(edge: CanvasEdge, nodes: Map<string, CanvasNode>): void { if (!edge || !isSafeCanvasId(edge.id) || !isSafeCanvasId(edge.sourceNodeId) || !isSafeCanvasId(edge.targetNodeId) || !nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas edge is invalid'); if (edge.label !== undefined) bounded(edge.label, 2_000); }
function validateReference(reference: CanvasReference): void { if (!reference || typeof reference.kind !== 'string') throw new CanvasError('INVALID_REFERENCE', 'Canvas reference is invalid'); if (reference.kind === 'web') { validateWebUrl(reference.url); return; } if (reference.kind === 'vault_note' || reference.kind === 'note') { safeCanvasId(reference.vaultId); safeCanvasId(reference.noteId); return; } if (reference.kind === 'vault_attachment' || reference.kind === 'file') { safeCanvasId(reference.vaultId); safeCanvasId(reference.attachmentId); return; } if (reference.kind === 'keystone_object' || reference.kind === 'object') { bounded(reference.objectType, 120, true); safeCanvasId(reference.objectId); return; } throw new CanvasError('INVALID_REFERENCE', 'Unknown Canvas reference kind'); }
function migrateCanvasDocument(value: unknown): CanvasDocument | undefined { if (!value || typeof value !== 'object') return undefined; const candidate = value as Partial<CanvasDocument>; if (candidate.version !== 1) { if (candidate.version !== undefined) throw new CanvasError('UNSUPPORTED_VERSION', 'Unsupported Canvas schema version'); return undefined; } try { validateCanvasDocument(candidate as CanvasDocument); return clone(candidate as CanvasDocument); } catch (error) { if (error instanceof CanvasError) throw error; return undefined; } }
function isHistoryRevision(value: unknown): value is CanvasHistoryRevision { return Boolean(value && typeof value === 'object' && (value as CanvasHistoryRevision).version === 1 && Number.isSafeInteger((value as CanvasHistoryRevision).revision) && (value as CanvasHistoryRevision).document); }
function replaceNode(nodes: CanvasNode[], next: CanvasNode): void { const index = nodes.findIndex(node => node.id === next.id); if (index < 0) throw new CanvasError('NOT_FOUND', 'Canvas node not found'); nodes[index] = clone(next); }
function groupDepth(id: string, map: Map<string, CanvasNode>): number { let depth = 0; let current = map.get(id); const seen = new Set<string>(); while (current?.parentId && !seen.has(current.parentId)) { seen.add(current.parentId); depth += 1; current = map.get(current.parentId); } return depth; }
function validateViewport(viewport: CanvasViewport): void { finite(viewport.x); finite(viewport.y); clampFloat(viewport.zoom, 0.05, 20); }
function fitViewport(nodes: readonly CanvasNode[], viewportSize: { readonly width: number; readonly height: number }, current: CanvasViewport): CanvasViewport {
  const width = clampFloat(viewportSize.width, 1, 20_000);
  const height = clampFloat(viewportSize.height, 1, 20_000);
  if (!nodes.length) return { ...current, width, height, x: 0, y: 0, zoom: 1 };
  const minX = Math.min(...nodes.map(node => node.x));
  const minY = Math.min(...nodes.map(node => node.y));
  const maxX = Math.max(...nodes.map(node => node.x + node.width));
  const maxY = Math.max(...nodes.map(node => node.y + node.height));
  const padding = 48;
  const contentWidth = Math.max(1, maxX - minX + padding * 2);
  const contentHeight = Math.max(1, maxY - minY + padding * 2);
  const zoom = clampFloat(Math.min(width / contentWidth, height / contentHeight), 0.05, 4);
  return { width, height, zoom, x: (width / zoom - contentWidth) / 2 - minX + padding, y: (height / zoom - contentHeight) / 2 - minY + padding };
}
function validateWebUrl(url: string): void { try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('unsafe'); } catch { throw new CanvasError('INVALID_REFERENCE', 'Canvas Web Card URL is unsafe'); } }
function safeCanvasId(value: unknown): asserts value is string { if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas id is invalid'); }
function isSafeCanvasId(value: unknown): value is string { return typeof value === 'string' && value.length >= 1 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function randomId(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); if (!uuid) throw new Error('Secure randomness is unavailable'); return `${prefix}-${uuid}`; }
function bounded(value: string, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new CanvasError('INVALID_ARGUMENT', 'Canvas text is invalid'); return value; }
function finite(value: number): number { if (!Number.isFinite(value)) throw new CanvasError('INVALID_ARGUMENT', 'Canvas coordinate must be finite'); return value; }
function positive(value: number): number { if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new CanvasError('INVALID_ARGUMENT', 'Canvas dimension is invalid'); return value; }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
function clampFloat(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min; }
function clone<T>(value: T): T { return structuredClone(value); }
function safeExtension(value: CanvasNodeRenderer | CanvasCommand | CanvasImporterExporter): boolean { return Boolean(value && typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value.id) && typeof value.version === 'string' && value.version.length <= 64 && typeof value.integrityHash === 'string' && value.integrityHash.length <= 512); }
