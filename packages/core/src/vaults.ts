/**
 * Markdown-first local knowledge vaults.
 *
 * Markdown and attachments in the host supplied root are the source of truth.
 * Everything in this module except the files themselves (indexes, history and
 * conflict state) is disposable derived state.  The core talks to a typed
 * storage boundary and never imports Node/Tauri/mobile filesystem APIs.
 */

export const VAULT_VERSION = 1 as const;
export const VAULT_INDEX_VERSION = 1 as const;
export const VAULT_HISTORY_VERSION = 1 as const;
export const VAULT_MAX_NOTE_BYTES = 4 * 1024 * 1024;
export const VAULT_MAX_ATTACHMENT_READ_BYTES = 64 * 1024 * 1024;
export const VAULT_MAX_INDEX_TEXT = 128 * 1024;
export const VAULT_MAX_SEARCH_RESULTS = 512;
export const VAULT_MAX_HISTORY_PER_NOTE = 100;

export type VaultEntryKind = 'note' | 'attachment' | 'folder';
export type VaultStorageKind = 'file' | 'folder';
export type VaultVisibility = 'private' | 'local';
export type VaultPermissionAction = 'read' | 'write' | 'delete' | 'rename' | 'index' | 'history';
export type VaultPropertyType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'list' | 'tags' | 'links';
export type VaultLinkKind = 'wikilink' | 'markdown' | 'embed';
export type VaultLinkResolution = 'resolved' | 'unresolved' | 'ambiguous';

export interface VaultSettings {
  readonly indexingEnabled?: boolean;
  readonly historyEnabled?: boolean;
  readonly historyRetention?: number;
  readonly followExternalChanges?: boolean;
  readonly defaultFolder?: string;
  readonly [key: string]: unknown;
}

export interface Vault {
  readonly version: 1;
  readonly id: string;
  readonly ownerIdentityId: string;
  readonly name: string;
  /** Host-owned root token/path. It is never treated as a permission. */
  readonly rootReference: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: VaultSettings;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly visibility: VaultVisibility;
}

export interface VaultEntry {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly kind: VaultEntryKind;
  readonly path: string;
  readonly name: string;
  readonly parentPath: string;
  readonly size: number;
  readonly mimeType?: string;
  readonly modifiedAt: string;
  readonly contentHash?: string;
  readonly missing?: boolean;
  readonly deleted?: boolean;
}

export interface VaultProperty {
  readonly type: VaultPropertyType;
  readonly value: string | number | boolean | readonly string[];
}
export type VaultProperties = Readonly<Record<string, VaultProperty>>;

export interface VaultHeading {
  readonly id: string;
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export interface VaultBlockReference {
  readonly id: string;
  readonly line: number;
}

export interface VaultLinkReference {
  readonly id: string;
  readonly sourceNoteId: string;
  readonly sourcePath: string;
  readonly kind: VaultLinkKind;
  readonly raw: string;
  readonly target: string;
  readonly targetPath?: string;
  readonly targetNoteId?: string;
  readonly alias?: string;
  readonly heading?: string;
  readonly blockId?: string;
  readonly resolution: VaultLinkResolution;
  readonly line: number;
}

export interface MarkdownNote extends VaultEntry {
  readonly kind: 'note';
  readonly title: string;
  readonly content: string;
  readonly body: string;
  readonly frontmatter: VaultProperties;
  readonly frontmatterError?: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly headings: readonly VaultHeading[];
  readonly blocks: readonly VaultBlockReference[];
  readonly links: readonly VaultLinkReference[];
  readonly revision: number;
  readonly untrusted: true;
}

export interface VaultAttachment extends VaultEntry {
  readonly kind: 'attachment';
  readonly mimeType: string;
  readonly extension: string;
  readonly linkedFrom: readonly string[];
}

export interface VaultLinkIndex {
  readonly outgoing: Readonly<Record<string, readonly VaultLinkReference[]>>;
  readonly backlinks: Readonly<Record<string, readonly VaultLinkReference[]>>;
  readonly unresolved: Readonly<Record<string, readonly VaultLinkReference[]>>;
  readonly aliases: Readonly<Record<string, readonly string[]>>;
  readonly headings: Readonly<Record<string, readonly VaultHeading[]>>;
  readonly blocks: Readonly<Record<string, readonly string[]>>;
  readonly mentions: Readonly<Record<string, readonly string[]>>;
}

export interface VaultTagIndex {
  readonly counts: Readonly<Record<string, number>>;
  readonly hierarchy: Readonly<Record<string, readonly string[]>>;
  readonly notes: Readonly<Record<string, readonly string[]>>;
}

export interface VaultNoteIndex {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly kind: 'note';
  readonly path: string;
  readonly name: string;
  readonly parentPath: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
  readonly properties: VaultProperties;
  readonly headings: readonly VaultHeading[];
  readonly blocks: readonly VaultBlockReference[];
  readonly links: readonly VaultLinkReference[];
  readonly modifiedAt: string;
  readonly size: number;
  readonly mimeType?: string;
  readonly contentHash?: string;
  readonly revision: number;
  readonly frontmatterError?: string;
  readonly searchText: string;
}

export interface VaultIndex {
  readonly version: 1;
  readonly vaultId: string;
  readonly revision: number;
  readonly entries: Readonly<Record<string, VaultEntry>>;
  readonly notes: Readonly<Record<string, VaultNoteIndex>>;
  readonly attachments: Readonly<Record<string, VaultAttachment>>;
  readonly links: VaultLinkIndex;
  readonly tags: VaultTagIndex;
  readonly generatedAt: string;
  readonly diagnostics: readonly string[];
}

export interface VaultStorageEntry {
  readonly path: string;
  readonly kind: VaultStorageKind;
  readonly size: number;
  readonly modifiedAt: string;
  readonly mimeType?: string;
  readonly isSymlink?: boolean;
}

/** All paths are relative to the host-selected vault root. */
export interface VaultStorageAdapter {
  read(path: string): Promise<Uint8Array>;
  writeAtomic(path: string, data: Uint8Array | string): Promise<void>;
  create(path: string, data?: Uint8Array | string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(path?: string): Promise<readonly VaultStorageEntry[]>;
  stat(path: string): Promise<VaultStorageEntry | undefined>;
  watch?(listener: (change: VaultStorageChange) => void): () => void;
}

export interface VaultStorageChange {
  readonly kind: 'create' | 'write' | 'rename' | 'move' | 'delete';
  readonly path: string;
  readonly previousPath?: string;
}

/** Separate keys let a corrupt index/history be discarded independently. */
export interface VaultStateStore {
  read(key: 'vault' | 'index' | 'history'): Promise<unknown | undefined>;
  write(key: 'vault' | 'index' | 'history', value: unknown): Promise<void>;
}

export class InMemoryVaultStateStore implements VaultStateStore {
  private readonly values = new Map<string, unknown>();
  async read(key: 'vault' | 'index' | 'history'): Promise<unknown | undefined> { const value = this.values.get(key); return value === undefined ? undefined : structuredClone(value); }
  async write(key: 'vault' | 'index' | 'history', value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  corrupt(key: 'vault' | 'index' | 'history', value: unknown): void { this.values.set(key, value); }
}

/** A host can map these paths to an encrypted sidecar or platform database. */
export class PersistentVaultStateStore implements VaultStateStore {
  constructor(private readonly storage: VaultStorageAdapter) {}
  async read(key: 'vault' | 'index' | 'history'): Promise<unknown | undefined> { try { const bytes = await this.storage.read(`.keystone/${key}.json`); return JSON.parse(new TextDecoder().decode(bytes)); } catch { return undefined; } }
  async write(key: 'vault' | 'index' | 'history', value: unknown): Promise<void> { await this.storage.createFolder('.keystone').catch(() => undefined); await this.storage.writeAtomic(`.keystone/${key}.json`, JSON.stringify(value)); }
}

export interface VaultPermissionBoundary {
  can(action: VaultPermissionAction, input: { readonly vault: Vault; readonly entry?: VaultEntry; readonly identityId: string }): Promise<boolean> | boolean;
}

/** Future extension declarations only. Registration does not execute code or grant capabilities. */
export interface VaultExtensionDescriptor {
  readonly id: string;
  readonly version: string;
  readonly integrityHash: string;
  readonly editorCommands?: readonly string[];
  readonly propertyTypes?: readonly string[];
  readonly renderers?: readonly string[];
  readonly indexProviders?: readonly string[];
  readonly views?: readonly string[];
}
export class VaultExtensionRegistry {
  private readonly values = new Map<string, VaultExtensionDescriptor>();
  register(descriptor: VaultExtensionDescriptor): void { if (!safeId(descriptor.id) || !descriptor.version || !descriptor.integrityHash) throw new VaultError('INVALID_ARGUMENT', 'Vault extension descriptor is invalid'); this.values.set(descriptor.id, clone(descriptor)); }
  unregister(id: string): void { this.values.delete(id); }
  list(): readonly VaultExtensionDescriptor[] { return [...this.values.values()].map(clone); }
}

export class OwnerVaultPermissionBoundary implements VaultPermissionBoundary {
  can(_action: VaultPermissionAction, input: { readonly vault: Vault; readonly entry?: VaultEntry; readonly identityId: string }): boolean { return input.identityId === input.vault.ownerIdentityId; }
}

export interface VaultHistoryRevision {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly noteId: string;
  readonly revision: number;
  readonly baseRevision?: number;
  readonly content: string;
  readonly contentHash: string;
  readonly sourceDevice?: string;
  readonly createdAt: string;
  readonly diff: { readonly addedLines: number; readonly removedLines: number };
  readonly action: 'create' | 'edit' | 'restore' | 'delete';
}

export interface VaultHistorySnapshot { readonly version: 1; readonly revisions: readonly VaultHistoryRevision[]; }

export interface VaultConflictState {
  readonly version: 1;
  readonly id: string;
  readonly vaultId: string;
  readonly noteId: string;
  readonly path: string;
  readonly baseRevision: number;
  readonly currentRevision: number;
  readonly incomingContentHash: string;
  readonly incomingContent?: string;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolution?: 'keep_current' | 'accept_incoming';
}

export interface VaultHistoryOptions { readonly retention?: number; readonly now?: () => number; }

export class VaultHistoryService {
  private readonly revisions = new Map<string, VaultHistoryRevision[]>();
  private readonly retention: number;
  private readonly now: () => number;
  constructor(options: VaultHistoryOptions = {}) { this.retention = clamp(options.retention ?? VAULT_MAX_HISTORY_PER_NOTE, 1, 1_000); this.now = options.now ?? Date.now; }
  hydrate(value: unknown): void { this.revisions.clear(); if (!isRecord(value) || value.version !== VAULT_HISTORY_VERSION || !Array.isArray(value.revisions)) throw new VaultError('CORRUPT_HISTORY', 'Vault history is corrupt'); for (const item of value.revisions) { if (!isHistoryRevision(item)) continue; const list = this.revisions.get(item.noteId) ?? []; list.push(clone(item)); this.revisions.set(item.noteId, list.sort((a, b) => a.revision - b.revision).slice(-this.retention)); } }
  snapshot(): VaultHistorySnapshot { return { version: 1, revisions: [...this.revisions.values()].flat().map(clone) }; }
  list(noteId?: string): readonly VaultHistoryRevision[] { return [...(noteId ? (this.revisions.get(noteId) ?? []) : [...this.revisions.values()].flat())].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(clone); }
  get(noteId: string, revision: number): VaultHistoryRevision | undefined { const value = this.revisions.get(noteId)?.find(item => item.revision === revision); return value ? clone(value) : undefined; }
  record(input: Omit<VaultHistoryRevision, 'version' | 'id' | 'createdAt' | 'contentHash' | 'diff'> & { readonly previousContent?: string; readonly now?: number }): VaultHistoryRevision { const value: VaultHistoryRevision = { version: 1, id: randomId('vault-revision'), vaultId: input.vaultId, noteId: input.noteId, revision: input.revision, ...(input.baseRevision === undefined ? {} : { baseRevision: input.baseRevision }), content: input.content, contentHash: stableContentHash(input.content), ...(input.sourceDevice ? { sourceDevice: input.sourceDevice } : {}), createdAt: new Date(input.now ?? this.now()).toISOString(), diff: lineDiff(input.previousContent ?? '', input.content), action: input.action }; const list = this.revisions.get(value.noteId) ?? []; list.push(value); this.revisions.set(value.noteId, list.slice(-this.retention)); return clone(value); }
  clear(noteId?: string): void { if (noteId) this.revisions.delete(noteId); else this.revisions.clear(); }
}

export interface VaultSearchQuery {
  readonly text?: string;
  readonly path?: string;
  readonly tag?: string;
  readonly property?: { readonly key: string; readonly value?: string };
  readonly linkTo?: string;
  readonly backlinkOf?: string;
  readonly from?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface VaultSearchResult {
  readonly note: VaultNoteIndex;
  readonly score: number;
  readonly snippet: string;
}

export class VaultSearchService {
  private readonly indexProvider: () => VaultIndex;
  constructor(index: VaultIndex | (() => VaultIndex)) { this.indexProvider = typeof index === 'function' ? index : () => index; }
  search(query: VaultSearchQuery = {}): readonly VaultSearchResult[] {
    const index = this.indexProvider(); const text = query.text?.trim().toLocaleLowerCase(); const from = query.from ? Date.parse(query.from) : -Infinity; const until = query.until ? Date.parse(query.until) : Infinity; if ((query.from && !Number.isFinite(from)) || (query.until && !Number.isFinite(until)) || (query.from && query.until && until < from)) throw new VaultError('INVALID_QUERY', 'Vault search date range is invalid');
    const target = query.linkTo ?? query.backlinkOf; const targetLinks = target ? new Set((index.links.backlinks[target] ?? []).map(value => value.sourceNoteId)) : undefined; const offset = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0; const output: VaultSearchResult[] = [];
    for (const note of Object.values(index.notes)) { if (query.path && !note.path.toLocaleLowerCase().includes(query.path.toLocaleLowerCase())) continue; if (query.tag && !note.tags.includes(normalizeTag(query.tag))) continue; if (query.property && (!note.properties[query.property.key] || (query.property.value !== undefined && !propertyText(note.properties[query.property.key]!).toLocaleLowerCase().includes(query.property.value.toLocaleLowerCase())))) continue; if (targetLinks && !targetLinks.has(note.id)) continue; const modified = Date.parse(note.modifiedAt); if (modified < from || modified > until) continue; const haystack = `${note.path} ${note.title} ${note.searchText} ${note.tags.join(' ')} ${Object.entries(note.properties).map(([key, value]) => `${key} ${propertyText(value)}`).join(' ')} ${note.links.map(value => value.target).join(' ')}`.toLocaleLowerCase(); if (text && !haystack.includes(text)) continue; const score = text ? scoreText(note, text) : 0; output.push({ note: clone(note), score, snippet: makeSnippet(note, text) }); }
    return output.sort((a, b) => b.score - a.score || a.note.modifiedAt.localeCompare(b.note.modifiedAt) * -1 || a.note.path.localeCompare(b.note.path)).slice(offset, offset + clamp(query.limit ?? 64, 1, VAULT_MAX_SEARCH_RESULTS));
  }
}

export interface VaultServiceOptions {
  readonly identityId: string;
  readonly rootReference: string;
  readonly storage: VaultStorageAdapter;
  readonly stateStore?: VaultStateStore;
  readonly vaultId?: string;
  readonly name?: string;
  readonly settings?: VaultSettings;
  readonly visibility?: VaultVisibility;
  readonly deviceId?: string;
  readonly permissionBoundary?: VaultPermissionBoundary;
  readonly now?: () => number;
}

export interface CreateVaultInput { readonly id?: string; readonly name: string; readonly rootReference?: string; readonly settings?: VaultSettings; readonly visibility?: VaultVisibility; }
export interface CreateNoteInput { readonly path: string; readonly content?: string; readonly properties?: VaultProperties; readonly title?: string; }
export interface UpdateNoteInput { readonly content?: string; readonly properties?: VaultProperties; readonly baseRevision?: number; /** Internal history label used by restore; callers cannot bypass revision checks. */ readonly historyAction?: 'edit' | 'restore'; }

export class VaultError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'CONFLICT' | 'CORRUPT_INDEX' | 'CORRUPT_HISTORY' | 'INVALID_QUERY' | 'BOUNDS_EXCEEDED' | 'STORAGE' | 'AMBIGUOUS' | 'MISSING_ATTACHMENT', message: string) { super(message); this.name = 'VaultError'; }
}

export class VaultService {
  private vault?: Vault;
  private currentIndex: MutableVaultIndex;
  private hasStoredVault = false;
  private readonly options: VaultServiceOptions;
  private readonly stateStore: VaultStateStore;
  private readonly historyService: VaultHistoryService;
  private readonly permissionBoundary: VaultPermissionBoundary;
  private readonly now: () => number;
  private readonly writeQueue: { value: Promise<void> } = { value: Promise.resolve() };
  private reindexQueue: Promise<void> = Promise.resolve();
  private readonly noteLocks = new Map<string, Promise<void>>();
  private readonly conflicts = new Map<string, VaultConflictState>();
  private readyPromise: Promise<void>;
  private unwatch?: () => void;
  private closed = false;
  readonly mutations: VaultMutationService;
  readonly searchService: VaultSearchService;

  constructor(options: VaultServiceOptions) {
    if (!safeIdentity(options.identityId) || !safeRootReference(options.rootReference)) throw new VaultError('INVALID_ARGUMENT', 'Vault identity or root reference is invalid');
    this.options = options; this.now = options.now ?? Date.now; this.stateStore = options.stateStore ?? new InMemoryVaultStateStore(); this.permissionBoundary = options.permissionBoundary ?? new OwnerVaultPermissionBoundary(); this.historyService = new VaultHistoryService({ now: this.now, retention: options.settings?.historyRetention }); this.currentIndex = emptyIndex(options.vaultId ?? randomId('vault')); this.searchService = new VaultSearchService(() => this.currentIndex); this.mutations = new VaultMutationService(this); this.readyPromise = this.initialize();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  close(): void { this.closed = true; this.unwatch?.(); this.unwatch = undefined; }
  /** Local identity used by host adapters when no explicit actor is supplied. */
  get identityId(): string { return this.options.identityId; }
  get history(): VaultHistoryService { return this.historyService; }
  get index(): VaultIndex { return cloneIndex(this.currentIndex); }
  get linkIndex(): VaultLinkIndex { return clone(this.currentIndex.links); }
  get tagIndex(): VaultTagIndex { return clone(this.currentIndex.tags); }
  get conflictStates(): readonly VaultConflictState[] { return [...this.conflicts.values()].map(clone); }
  async getVault(actor = this.options.identityId): Promise<Vault> { await this.ready(); await this.assert('read', actor); if (!this.vault) throw new VaultError('NOT_FOUND', 'Vault is not initialized'); return clone(this.vault); }

  async createVault(input: CreateVaultInput, actor = this.options.identityId): Promise<Vault> { await this.ready(); if (actor !== this.options.identityId) throw new VaultError('NOT_AUTHORIZED', 'Only the local identity can create a Vault'); if (this.hasStoredVault) return clone(this.vault!); const timestamp = iso(this.now); const id = input.id ?? this.currentIndex.vaultId; const rootReference = input.rootReference ?? this.options.rootReference; if (!safeId(id) || !safeRootReference(rootReference)) throw new VaultError('INVALID_ARGUMENT', 'Vault id or root reference is invalid'); this.vault = { version: 1, id, ownerIdentityId: this.options.identityId, name: bounded(input.name, 160, true), rootReference, createdAt: timestamp, updatedAt: timestamp, settings: { indexingEnabled: true, historyEnabled: true, followExternalChanges: true, ...input.settings }, revision: 1, schemaVersion: 1, visibility: input.visibility ?? 'private' }; this.currentIndex = emptyIndex(id); await this.rebuildIndexInternal(); await this.persistAll(); this.hasStoredVault = true; return clone(this.vault); }

  async rebuildIndex(actor = this.options.identityId): Promise<VaultIndex> { await this.ready(); await this.reindexQueue; await this.assert('index', actor); await this.rebuildIndexInternal(); this.touchVault(); await this.persistAll(); return cloneIndex(this.currentIndex); }
  async listNotes(actor = this.options.identityId): Promise<readonly VaultNoteIndex[]> { await this.ready(); await this.assert('read', actor); return Object.values(this.currentIndex.notes).sort((a, b) => a.path.localeCompare(b.path)).map(clone); }
  async listAttachments(actor = this.options.identityId): Promise<readonly VaultAttachment[]> { await this.ready(); await this.assert('read', actor); return Object.values(this.currentIndex.attachments).sort((a, b) => a.path.localeCompare(b.path)).map(clone); }
  async listEntries(actor = this.options.identityId): Promise<readonly VaultEntry[]> { await this.ready(); await this.assert('read', actor); return Object.values(this.currentIndex.entries).sort((a, b) => a.path.localeCompare(b.path)).map(clone); }
  async getNote(noteIdOrPath: string, actor = this.options.identityId): Promise<MarkdownNote | undefined> { await this.ready(); await this.assert('read', actor); const index = this.findNoteIndex(noteIdOrPath); if (!index) return undefined; const bytes = await this.readSafe(index.path); return parseMarkdownNote(index, decode(bytes)); }
  async getAttachment(attachmentIdOrPath: string, actor = this.options.identityId): Promise<VaultAttachment | undefined> { await this.ready(); await this.assert('read', actor); const byId = this.currentIndex.attachments[attachmentIdOrPath]; if (byId) return clone(byId); const path = safePath(attachmentIdOrPath); const value = Object.values(this.currentIndex.attachments).find(entry => entry.path === path); return value ? clone(value) : undefined; }
  async readAttachment(attachmentIdOrPath: string, maxBytes = VAULT_MAX_ATTACHMENT_READ_BYTES, actor = this.options.identityId): Promise<Uint8Array> { const attachment = await this.getAttachment(attachmentIdOrPath, actor); if (!attachment || attachment.missing) throw new VaultError('MISSING_ATTACHMENT', 'Vault attachment is missing'); const limit = clamp(maxBytes, 1, VAULT_MAX_ATTACHMENT_READ_BYTES); if (attachment.size > limit) throw new VaultError('BOUNDS_EXCEEDED', 'Vault attachment read exceeds the requested bound'); try { const bytes = await this.options.storage.read(attachment.path); if (bytes.byteLength > limit) throw new VaultError('BOUNDS_EXCEEDED', 'Vault attachment read exceeds the requested bound'); return bytes; } catch (error) { if (error instanceof VaultError) throw error; throw new VaultError('MISSING_ATTACHMENT', 'Vault attachment is missing'); } }
  async search(query: VaultSearchQuery = {}, actor = this.options.identityId): Promise<readonly VaultSearchResult[]> { await this.ready(); await this.assert('read', actor); return this.searchService.search(query); }
  async getBacklinks(noteId: string, actor = this.options.identityId): Promise<readonly VaultLinkReference[]> { await this.ready(); await this.assert('read', actor); return (this.currentIndex.links.backlinks[noteId] ?? []).map(clone); }
  async getOutgoingLinks(noteId: string, actor = this.options.identityId): Promise<readonly VaultLinkReference[]> { await this.ready(); await this.assert('read', actor); return (this.currentIndex.links.outgoing[noteId] ?? []).map(clone); }
  async getUnresolvedLinks(actor = this.options.identityId): Promise<readonly VaultLinkReference[]> { await this.ready(); await this.assert('read', actor); return Object.values(this.currentIndex.links.unresolved).flat().map(clone); }
  async resolveNote(target: string, actor = this.options.identityId): Promise<MarkdownNote | undefined> { await this.ready(); await this.assert('read', actor); const matches = this.resolveNoteCandidates(target); if (matches.length > 1) throw new VaultError('AMBIGUOUS', `Vault note reference is ambiguous: ${target}`); return matches[0] ? this.getNote(matches[0].id, actor) : undefined; }
  async createNote(input: CreateNoteInput, actor = this.options.identityId): Promise<MarkdownNote> { await this.ready(); await this.assert('write', actor); const path = safePath(input.path); if (!path.toLocaleLowerCase().endsWith('.md')) throw new VaultError('INVALID_ARGUMENT', 'Vault notes must be Markdown files'); if (await this.options.storage.stat(path)) throw new VaultError('INVALID_ARGUMENT', 'A Vault entry already exists at this path'); const id = randomId('note'); const title = input.title === undefined ? '' : bounded(input.title, 240); const body = title && !/^#{1,6}\s+/m.test(input.content ?? '') ? `# ${title}\n\n${input.content ?? ''}` : input.content ?? ''; const content = composeMarkdown(id, body, input.properties ?? {}); await this.options.storage.writeAtomic(path, content); await this.reindexPath(path); const note = await this.getNote(id, actor); if (!note) throw new VaultError('STORAGE', 'Created note could not be indexed'); this.historyService.record({ vaultId: this.vault!.id, noteId: id, revision: note.revision, content, ...(this.options.deviceId ? { sourceDevice: this.options.deviceId } : {}), action: 'create', now: this.now() }); await this.persistHistory(); return note; }
  async updateNote(noteId: string, input: UpdateNoteInput, actor = this.options.identityId): Promise<MarkdownNote> { await this.ready(); const release = await this.acquireNoteLock(noteId); try { return await this.updateNoteUnlocked(noteId, input, actor); } finally { release(); } }
  private async updateNoteUnlocked(noteId: string, input: UpdateNoteInput, actor = this.options.identityId): Promise<MarkdownNote> { await this.ready(); await this.assert('write', actor); const current = this.currentIndex.notes[noteId]; if (!current) throw new VaultError('NOT_FOUND', 'Vault note not found'); const baseRevision = input.baseRevision ?? current.revision; if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new VaultError('CONFLICT', 'Vault base revision is invalid'); if (baseRevision !== current.revision) { const incoming = await this.readSafe(current.path); const incomingContent = input.content ?? decode(incoming); const conflict: VaultConflictState = { version: 1, id: randomId('vault-conflict'), vaultId: this.vault!.id, noteId, path: current.path, baseRevision, currentRevision: current.revision, incomingContentHash: stableContentHash(incomingContent), incomingContent, createdAt: iso(this.now) }; this.conflicts.set(conflict.id, conflict); throw new VaultError('CONFLICT', `Vault note conflict: ${conflict.id}`); } const previous = decode(await this.readSafe(current.path)); const parsed = parseMarkdownSource(input.content ?? previous, input.properties ?? parseFrontmatter(previous).properties, noteId); const nextContent = input.properties ? composeMarkdown(noteId, parsed.body, input.properties) : ensureStableId(parsed, noteId); await this.options.storage.writeAtomic(current.path, nextContent); await this.reindexPath(current.path); const next = await this.getNote(noteId, actor); if (!next) throw new VaultError('STORAGE', 'Updated note could not be indexed'); this.historyService.record({ vaultId: this.vault!.id, noteId, revision: next.revision, baseRevision, content: nextContent, previousContent: previous, ...(this.options.deviceId ? { sourceDevice: this.options.deviceId } : {}), action: input.historyAction ?? 'edit', now: this.now() }); await this.persistHistory(); return next; }
  async renameNote(noteId: string, newPathOrName: string, actor = this.options.identityId): Promise<MarkdownNote> { await this.ready(); await this.assert('rename', actor); const current = this.currentIndex.notes[noteId]; if (!current) throw new VaultError('NOT_FOUND', 'Vault note not found'); const nextPath = safePath(newPathOrName.includes('/') || newPathOrName.includes('\\') ? newPathOrName : `${current.parentPath ? `${current.parentPath}/` : ''}${newPathOrName}`); if (!nextPath.toLocaleLowerCase().endsWith('.md')) throw new VaultError('INVALID_ARGUMENT', 'Vault notes must be Markdown files'); if (this.currentIndex.entries[nextPath]) throw new VaultError('INVALID_ARGUMENT', 'Target Vault path already exists'); const original = decode(await this.readSafe(current.path)); const stable = ensureStableId(parseMarkdownSource(original, undefined, noteId), noteId); await this.options.storage.rename(current.path, nextPath); if (stable !== original) await this.options.storage.writeAtomic(nextPath, stable); await this.reindexPath(current.path); await this.reindexPath(nextPath); const note = await this.getNote(noteId, actor); if (!note) throw new VaultError('STORAGE', 'Renamed note could not be indexed'); await this.persistIndex(); return note; }
  async moveNote(noteId: string, folder: string, actor = this.options.identityId): Promise<MarkdownNote> { const current = this.currentIndex.notes[noteId]; if (!current) throw new VaultError('NOT_FOUND', 'Vault note not found'); const name = current.name; const cleanFolder = safePath(folder, true); return this.renameNote(noteId, cleanFolder ? `${cleanFolder}/${name}` : name, actor); }
  async deleteNote(noteId: string, actor = this.options.identityId): Promise<void> { await this.ready(); await this.assert('delete', actor); const current = this.currentIndex.notes[noteId]; if (!current) throw new VaultError('NOT_FOUND', 'Vault note not found'); const content = decode(await this.readSafe(current.path)); await this.options.storage.delete(current.path); this.removeIndexPath(current.path); this.currentIndex.revision += 1; this.touchVault(); this.historyService.record({ vaultId: this.vault!.id, noteId, revision: current.revision + 1, baseRevision: current.revision, content, ...(this.options.deviceId ? { sourceDevice: this.options.deviceId } : {}), action: 'delete', now: this.now() }); await this.persistAll(); }
  async createFolder(path: string, actor = this.options.identityId): Promise<void> { await this.ready(); await this.assert('write', actor); await this.options.storage.createFolder(safePath(path)); await this.rebuildIndex(actor); }
  async renameEntry(path: string, newPath: string, actor = this.options.identityId): Promise<void> { await this.ready(); await this.assert('rename', actor); await this.options.storage.rename(safePath(path), safePath(newPath)); await this.rebuildIndex(actor); }
  async restoreRevision(noteId: string, revision: number, actor = this.options.identityId): Promise<MarkdownNote> { await this.ready(); await this.assert('history', actor); const entry = this.historyService.get(noteId, revision); if (!entry) throw new VaultError('NOT_FOUND', 'Vault history revision not found'); const current = this.currentIndex.notes[noteId]; if (!current) throw new VaultError('NOT_FOUND', 'Vault note not found'); return this.updateNote(noteId, { content: entry.content, baseRevision: current.revision, historyAction: 'restore' }, actor); }
  async resolveConflict(conflictId: string, resolution: 'keep_current' | 'accept_incoming', actor = this.options.identityId): Promise<void> { await this.ready(); await this.assert('write', actor); const conflict = this.conflicts.get(conflictId); if (!conflict) throw new VaultError('NOT_FOUND', 'Vault conflict not found'); if (resolution === 'accept_incoming') { if (conflict.incomingContent === undefined) throw new VaultError('CONFLICT', 'Incoming content is unavailable'); await this.updateNote(conflict.noteId, { content: conflict.incomingContent, baseRevision: this.currentIndex.notes[conflict.noteId]?.revision }, actor); } this.conflicts.set(conflictId, { ...conflict, resolvedAt: iso(this.now), resolution }); }

  private async initialize(): Promise<void> {
    const storedVault = await this.stateStore.read('vault').catch(() => undefined); if (storedVault && isVault(storedVault)) { this.vault = clone(storedVault); this.hasStoredVault = true; } else { this.hasStoredVault = false; this.vault = { version: 1, id: this.options.vaultId ?? this.currentIndex.vaultId, ownerIdentityId: this.options.identityId, name: bounded(this.options.name ?? 'Vault', 160, true), rootReference: this.options.rootReference, createdAt: iso(this.now), updatedAt: iso(this.now), settings: { indexingEnabled: true, historyEnabled: true, followExternalChanges: true, ...this.options.settings }, revision: 1, schemaVersion: 1, visibility: this.options.visibility ?? 'private' }; }
    const storedHistory = await this.stateStore.read('history').catch(() => undefined); if (storedHistory) { try { this.historyService.hydrate(storedHistory); } catch { this.historyService.clear(); } }
    const storedIndex = await this.stateStore.read('index').catch(() => undefined); if (storedIndex && isVaultIndex(storedIndex, this.vault.id)) this.currentIndex = cloneIndex(storedIndex); await this.rebuildIndexInternal(); await this.persistAll(); this.startWatch();
  }
  private startWatch(): void { if (!this.options.storage.watch || this.vault?.settings.followExternalChanges === false) return; this.unwatch = this.options.storage.watch(change => { if (this.closed || change.path.startsWith('.keystone/') || change.previousPath?.startsWith('.keystone/')) return; void Promise.all([this.reindexPath(change.path), ...(change.previousPath ? [this.reindexPath(change.previousPath)] : [])]).catch(() => undefined); }); }
  private async rebuildIndexInternal(): Promise<void> { if (!this.vault) return; const previous = this.currentIndex; const index = emptyIndex(this.vault.id); const walk = async (folder: string): Promise<void> => { for (const entry of await this.options.storage.list(folder)) { const path = safePath(entry.path); if (path === '.keystone' || path.startsWith('.keystone/')) continue; if (entry.isSymlink) { index.diagnostics.push(`Skipped symlink: ${path}`); continue; } if (entry.kind === 'folder') { index.entries[path] = makeFolderEntry(this.vault!.id, path, entry); await walk(path); } else await this.indexEntry(index, entry, previous); } }; await walk(''); for (const old of Object.values(previous.attachments)) if (!index.attachments[old.id] && !index.entries[old.path]) { const missing = { ...old, missing: true }; index.attachments[old.id] = missing; index.entries[old.path] = missing; } this.resolveAllLinks(index); index.revision = previous.revision + 1; this.currentIndex = index; }
  private async indexEntry(index: MutableVaultIndex, entry: VaultStorageEntry, previous: VaultIndex): Promise<void> { const path = safePath(entry.path); if (entry.kind === 'folder') { index.entries[path] = makeFolderEntry(this.vault!.id, path, entry); return; } if (entry.kind === 'file') { if (path.toLocaleLowerCase().endsWith('.md')) { if (entry.size > VAULT_MAX_NOTE_BYTES) { index.diagnostics.push(`Skipped oversized note: ${path}`); return; } try { const content = decode(await this.options.storage.read(path)); const old = previous.entries[path]; const parsed = parseMarkdownSource(content, undefined, undefined); if (parsed.frontmatterError) index.diagnostics.push(`Malformed frontmatter: ${path}`); let id = parsed.id ?? (old?.kind === 'note' ? old.id : findIdentityByHash(previous, stableContentHash(content)) ?? randomId('note')); if (index.notes[id] && index.notes[id]!.path !== path) { index.diagnostics.push(`Duplicate note identity: ${id}`); id = stablePathId(this.vault!.id, path); } const revision = old?.kind === 'note' ? (old as VaultNoteIndex).revision + (old.contentHash === stableContentHash(content) ? 0 : 1) : 1; const note = makeNoteIndex(this.vault!.id, id, path, entry, parsed, revision, stableContentHash(content)); index.entries[path] = note; index.notes[id] = note; return; } catch { index.diagnostics.push(`Skipped malformed note: ${path}`); return; } } const inferredMime = mimeForPath(path); if (entry.mimeType && inferredMime !== 'application/octet-stream' && entry.mimeType !== inferredMime) index.diagnostics.push(`MIME mismatch: ${path}`); const id = previous.entries[path]?.id ?? randomId('attachment'); const attachment: VaultAttachment = { version: 1, id, vaultId: this.vault!.id, kind: 'attachment', path, name: basename(path), parentPath: dirname(path), size: entry.size, mimeType: entry.mimeType ?? inferredMime, extension: extension(path), modifiedAt: entry.modifiedAt, linkedFrom: previous.attachments[id]?.linkedFrom ?? [] }; index.entries[path] = attachment; index.attachments[id] = attachment; } }
  private reindexPath(rawPath: string): Promise<void> { const run = this.reindexQueue.then(() => this.reindexPathUnlocked(rawPath), () => this.reindexPathUnlocked(rawPath)); this.reindexQueue = run.then(() => undefined, () => undefined); return run; }
  private async reindexPathUnlocked(rawPath: string): Promise<void> { await this.ready(); const path = safePath(rawPath); if (path.startsWith('.keystone/')) return; const entry = await this.options.storage.stat(path); const previous = this.currentIndex; const next = cloneIndex(previous); next.revision = previous.revision + 1; if (!entry) { const old = next.entries[path]; if (old?.kind === 'attachment') { const missing = { ...old, missing: true } as unknown as VaultAttachment; next.entries[path] = missing; next.attachments[old.id] = missing; } else this.removeIndexPath(path, next); this.updateLinksIncremental(next, previous, path); this.currentIndex = next; this.touchVault(); await this.persistAll(); return; } this.removeIndexPath(path, next); await this.indexEntry(next, entry, previous); this.updateLinksIncremental(next, previous, path); this.currentIndex = next; this.touchVault(); await this.persistAll(); }
  private removeIndexPath(path: string, index = this.currentIndex): void { const entry = index.entries[path]; if (!entry) return; delete index.entries[path]; if (entry.kind === 'note') delete index.notes[entry.id]; else if (entry.kind === 'attachment') delete index.attachments[entry.id]; }
  private updateLinksIncremental(index: MutableVaultIndex, previous: VaultIndex, changedPath: string): void {
    const before = previous.entries[changedPath]; const after = index.entries[changedPath]; const beforeNote = before?.kind === 'note' ? before as VaultNoteIndex : undefined; const afterNote = after?.kind === 'note' ? after as VaultNoteIndex : undefined; const impacted = new Set<string>();
    if (before?.kind === 'note') impacted.add(before.id); if (after?.kind === 'note') impacted.add(after.id);
    const targets = new Set([changedPath, basenameWithoutExtension(changedPath), ...(beforeNote ? [beforeNote.id, beforeNote.name, beforeNote.path, beforeNote.name.replace(/\.md$/i, '')] : []), ...(afterNote ? [afterNote.id, afterNote.name, afterNote.path, afterNote.name.replace(/\.md$/i, ''), afterNote.title, ...afterNote.aliases] : [])].map(value => value.toLocaleLowerCase()));
    for (const note of Object.values(index.notes)) if (note.links.some(link => targets.has(link.target.toLocaleLowerCase()) || link.targetPath === changedPath || (beforeNote && link.targetNoteId === beforeNote.id) || (afterNote && link.targetNoteId === afterNote.id))) impacted.add(note.id);
    for (const map of [index.links.backlinks, index.links.unresolved]) for (const [key, values] of Object.entries(map)) { const filtered = values.filter(value => !impacted.has(value.sourceNoteId)); if (filtered.length) map[key] = filtered; else delete map[key]; }
    for (const id of impacted) { delete index.links.outgoing[id]; delete index.links.aliases[id]; delete index.links.headings[id]; }
    for (const map of [index.links.blocks, index.links.mentions]) for (const [key, values] of Object.entries(map)) { const filtered = values.filter(value => !impacted.has(value)); if (filtered.length) map[key] = filtered; else delete map[key]; }
    const notes = Object.values(index.notes); for (const note of notes.filter(value => impacted.has(value.id))) { const resolved = note.links.map(link => resolveIndexedLink(link, notes, index.attachments)); index.links.outgoing[note.id] = resolved; index.links.aliases[note.id] = [...note.aliases]; index.links.headings[note.id] = [...note.headings]; for (const block of note.blocks) (index.links.blocks[block.id] ??= []).push(note.id); for (const mention of mentions(note.searchText)) (index.links.mentions[mention] ??= []).push(note.id); for (const link of resolved) { if (link.targetNoteId) (index.links.backlinks[link.targetNoteId] ??= []).push(link); else (index.links.unresolved[link.target.toLocaleLowerCase()] ??= []).push(link); } }
    index.tags = buildTagIndex(Object.values(index.notes));
    for (const [path, value] of Object.entries(index.entries)) if (value.kind === 'attachment') { const linkedFrom = Object.values(index.links.outgoing).flat().filter(link => link.targetPath === path).map(link => link.sourceNoteId); const updated = { ...value, linkedFrom } as unknown as VaultAttachment; index.entries[path] = updated; index.attachments[updated.id] = updated; }
  }
  private resolveAllLinks(index: MutableVaultIndex): void { const links = emptyLinkIndex(); const tags = emptyTagIndex(); const notes = Object.values(index.notes); for (const note of notes) { const resolved = note.links.map(link => { const candidate = resolveLink(link, notes); if (!candidate.targetNoteId) { const attachment = Object.values(index.attachments).find(value => value.path === (candidate.targetPath ?? candidate.target.replace(/^\.\//, ''))); if (attachment && !attachment.missing) return { ...candidate, targetPath: attachment.path, resolution: 'resolved' as const }; } return candidate; }); links.outgoing[note.id] = resolved; for (const link of resolved) { if (link.targetNoteId) (links.backlinks[link.targetNoteId] ??= []).push(link); else (links.unresolved[link.target.toLocaleLowerCase()] ??= []).push(link); } links.aliases[note.id] = [...note.aliases]; links.headings[note.id] = [...note.headings]; for (const block of note.blocks) (links.blocks[block.id] ??= []).push(note.id); for (const mention of mentions(note.searchText)) (links.mentions[mention] ??= []).push(note.id); for (const tag of note.tags) { const normalized = normalizeTag(tag); tags.counts[normalized] = (tags.counts[normalized] ?? 0) + 1; (tags.notes[normalized] ??= []).push(note.id); const parts = normalized.split('/'); for (let indexPart = 1; indexPart < parts.length; indexPart += 1) { const parent = parts.slice(0, indexPart).join('/'); const children = tags.hierarchy[parent] ??= []; if (!children.includes(normalized)) children.push(normalized); } } } index.links = links; index.tags = tags; for (const [path, entry] of Object.entries(index.entries)) if (entry.kind === 'attachment') { const linkedFrom = Object.values(links.outgoing).flat().filter(link => link.targetPath === path).map(link => link.sourceNoteId); const updated = { ...entry, linkedFrom } as unknown as VaultAttachment; index.entries[path] = updated; index.attachments[updated.id] = updated; } }
  private findNoteIndex(target: string): VaultNoteIndex | undefined { if (this.currentIndex.notes[target]) return this.currentIndex.notes[target]; const path = safePath(target); return Object.values(this.currentIndex.notes).find(note => note.path === path || note.title.toLocaleLowerCase() === target.toLocaleLowerCase() || note.aliases.some(alias => alias.toLocaleLowerCase() === target.toLocaleLowerCase())); }
  private resolveNoteCandidates(target: string): VaultNoteIndex[] { const clean = target.replace(/^!/, '').split('#', 1)[0]!.split('|', 1)[0]!.trim(); const byId = this.currentIndex.notes[clean]; if (byId) return [byId]; return Object.values(this.currentIndex.notes).filter(note => note.path === clean || basenameWithoutExtension(note.path).toLocaleLowerCase() === clean.toLocaleLowerCase() || note.title.toLocaleLowerCase() === clean.toLocaleLowerCase() || note.aliases.some(alias => alias.toLocaleLowerCase() === clean.toLocaleLowerCase())); }
  private async readSafe(path: string): Promise<Uint8Array> { try { const value = await this.options.storage.read(safePath(path)); if (value.byteLength > VAULT_MAX_NOTE_BYTES) throw new VaultError('BOUNDS_EXCEEDED', 'Vault note is too large'); return value; } catch (error) { if (error instanceof VaultError) throw error; throw new VaultError('STORAGE', `Unable to read Vault path: ${path}`); } }
  private async assert(action: VaultPermissionAction, identityId: string, entry?: VaultEntry): Promise<void> { if (!safeIdentity(identityId) || !this.vault || !(await this.permissionBoundary.can(action, { vault: this.vault, ...(entry ? { entry } : {}), identityId }))) throw new VaultError('NOT_AUTHORIZED', `Vault permission denied for ${action}`); }
  private async persistIndex(): Promise<void> { await this.stateStore.write('index', this.currentIndex); }
  private touchVault(): void { if (this.vault) this.vault = { ...this.vault, updatedAt: iso(this.now), revision: this.vault.revision + 1 }; }
  private async acquireNoteLock(noteId: string): Promise<() => void> { const previous = this.noteLocks.get(noteId) ?? Promise.resolve(); let releasePromise!: () => void; const current = new Promise<void>(resolve => { releasePromise = resolve; }); this.noteLocks.set(noteId, current); await previous; return () => { if (this.noteLocks.get(noteId) === current) this.noteLocks.delete(noteId); releasePromise(); }; }
  private async persistHistory(): Promise<void> { if (this.vault?.settings.historyEnabled !== false) await this.stateStore.write('history', this.historyService.snapshot()); }
  private async persistAll(): Promise<void> { if (!this.vault) return; await this.stateStore.write('vault', this.vault); await this.persistIndex(); await this.persistHistory(); }
}

/** Thin capability-scoped facade used by UI/agents; it does not add storage. */
export class VaultMutationService {
  constructor(private readonly service: VaultService) {}
  createNote(input: CreateNoteInput, actor?: string): Promise<MarkdownNote> { return this.service.createNote(input, actor); }
  updateNote(noteId: string, input: UpdateNoteInput, actor?: string): Promise<MarkdownNote> { return this.service.updateNote(noteId, input, actor); }
  renameNote(noteId: string, path: string, actor?: string): Promise<MarkdownNote> { return this.service.renameNote(noteId, path, actor); }
  moveNote(noteId: string, folder: string, actor?: string): Promise<MarkdownNote> { return this.service.moveNote(noteId, folder, actor); }
  deleteNote(noteId: string, actor?: string): Promise<void> { return this.service.deleteNote(noteId, actor); }
  createFolder(path: string, actor?: string): Promise<void> { return this.service.createFolder(path, actor); }
}

export class VaultRegistry {
  private readonly services = new Map<string, VaultService>();
  register(service: VaultService, vaultId: string): void { this.services.set(vaultId, service); }
  get(vaultId: string): VaultService | undefined { return this.services.get(vaultId); }
  list(): readonly VaultService[] { return [...this.services.values()]; }
  close(): void { for (const service of this.services.values()) service.close(); this.services.clear(); }
}

export function vaultLink(vaultId: string): string { if (!safeId(vaultId)) throw new VaultError('INVALID_ARGUMENT', 'Vault id is invalid'); return `keystone://vault/${encodeURIComponent(vaultId)}`; }
export function noteLink(vaultId: string, noteId: string): string { if (!safeId(vaultId) || !safeId(noteId)) throw new VaultError('INVALID_ARGUMENT', 'Vault note reference is invalid'); return `keystone://vault/${encodeURIComponent(vaultId)}/note/${encodeURIComponent(noteId)}`; }
export function parseVaultLink(value: string): { readonly vaultId: string; readonly noteId?: string } | undefined { try { const url = new URL(value); if (url.protocol !== 'keystone:' || url.hostname !== 'vault') return undefined; const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); if (!safeId(parts[0])) return undefined; if (!parts[1]) return { vaultId: parts[0]! }; if (parts[1] !== 'note' || !safeId(parts[2])) return undefined; return { vaultId: parts[0]!, noteId: parts[2]! }; } catch { return undefined; } }

export class MemoryVaultStorageAdapter implements VaultStorageAdapter {
  private readonly files = new Map<string, { bytes: Uint8Array; modifiedAt: string; mimeType?: string }>();
  private readonly folders = new Set<string>();
  private readonly listeners = new Set<(change: VaultStorageChange) => void>();
  async read(path: string): Promise<Uint8Array> { const value = this.files.get(safePath(path)); if (!value) throw new Error('File not found'); return new Uint8Array(value.bytes); }
  async writeAtomic(path: string, data: Uint8Array | string): Promise<void> { const clean = safePath(path); this.ensureParent(clean); this.files.set(clean, { bytes: toBytes(data), modifiedAt: new Date().toISOString(), mimeType: mimeForPath(clean) }); this.emit({ kind: 'write', path: clean }); }
  async create(path: string, data: Uint8Array | string = ''): Promise<void> { const clean = safePath(path); if (this.files.has(clean)) throw new Error('Path exists'); await this.writeAtomic(clean, data); this.emit({ kind: 'create', path: clean }); }
  async createFolder(path: string): Promise<void> { const clean = safePath(path); if (clean) { this.ensureParent(clean); this.folders.add(clean); } }
  async rename(from: string, to: string): Promise<void> { const source = safePath(from); const target = safePath(to); if (this.files.has(target) || this.folders.has(target)) throw new Error('Target exists'); const file = this.files.get(source); if (file) { this.files.delete(source); this.ensureParent(target); this.files.set(target, file); this.emit({ kind: 'rename', path: target, previousPath: source }); return; } if (this.folders.has(source)) { this.folders.delete(source); this.folders.add(target); for (const folder of [...this.folders]) if (folder.startsWith(`${source}/`)) { this.folders.delete(folder); this.folders.add(`${target}${folder.slice(source.length)}`); } for (const [path, value] of [...this.files]) if (path.startsWith(`${source}/`)) { this.files.delete(path); this.files.set(`${target}${path.slice(source.length)}`, value); } this.emit({ kind: 'rename', path: target, previousPath: source }); return; } throw new Error('Path not found'); }
  async move(from: string, to: string): Promise<void> { return this.rename(from, to); }
  async delete(path: string): Promise<void> { const clean = safePath(path); if (this.files.delete(clean)) { this.emit({ kind: 'delete', path: clean }); return; } if (this.folders.delete(clean)) { for (const file of [...this.files.keys()]) if (file.startsWith(`${clean}/`)) this.files.delete(file); for (const folder of [...this.folders]) if (folder.startsWith(`${clean}/`)) this.folders.delete(folder); this.emit({ kind: 'delete', path: clean }); } }
  async list(path = ''): Promise<readonly VaultStorageEntry[]> { const folder = path ? safePath(path) : ''; const prefix = folder ? `${folder}/` : ''; const names = new Map<string, VaultStorageEntry>(); for (const [file, value] of this.files) if (file.startsWith(prefix)) { const rest = file.slice(prefix.length); const child = rest.split('/')[0]!; const childPath = `${prefix}${child}`; if (rest.includes('/')) names.set(childPath, { path: childPath, kind: 'folder', size: 0, modifiedAt: value.modifiedAt }); else names.set(childPath, { path: childPath, kind: 'file', size: value.bytes.byteLength, modifiedAt: value.modifiedAt, mimeType: value.mimeType }); } for (const child of this.folders) if (child.startsWith(prefix) && child !== folder) { const rest = child.slice(prefix.length); const childName = rest.split('/')[0]!; names.set(`${prefix}${childName}`, { path: `${prefix}${childName}`, kind: 'folder', size: 0, modifiedAt: new Date().toISOString() }); } return [...names.values()].sort((a, b) => a.path.localeCompare(b.path)); }
  async stat(path: string): Promise<VaultStorageEntry | undefined> { const clean = safePath(path); const file = this.files.get(clean); if (file) return { path: clean, kind: 'file', size: file.bytes.byteLength, modifiedAt: file.modifiedAt, mimeType: file.mimeType }; if (this.folders.has(clean)) return { path: clean, kind: 'folder', size: 0, modifiedAt: new Date().toISOString() }; return undefined; }
  watch(listener: (change: VaultStorageChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  /** Test/host helper that models an edit made outside Keystone. */
  async externalWrite(path: string, data: string): Promise<void> { await this.writeAtomic(path, data); }
  private ensureParent(path: string): void { const parts = dirname(path).split('/'); let value = ''; for (const part of parts) { if (!part) continue; value = value ? `${value}/${part}` : part; this.folders.add(value); } }
  private emit(change: VaultStorageChange): void { for (const listener of this.listeners) listener(change); }
}

interface MutableVaultIndex { version: 1; vaultId: string; revision: number; entries: Record<string, VaultEntry>; notes: Record<string, VaultNoteIndex>; attachments: Record<string, VaultAttachment>; links: { outgoing: Record<string, VaultLinkReference[]>; backlinks: Record<string, VaultLinkReference[]>; unresolved: Record<string, VaultLinkReference[]>; aliases: Record<string, string[]>; headings: Record<string, VaultHeading[]>; blocks: Record<string, string[]>; mentions: Record<string, string[]> }; tags: { counts: Record<string, number>; hierarchy: Record<string, string[]>; notes: Record<string, string[]> }; generatedAt: string; diagnostics: string[]; }

function emptyIndex(vaultId: string): MutableVaultIndex { return { version: 1, vaultId, revision: 0, entries: {}, notes: {}, attachments: {}, links: emptyLinkIndex(), tags: emptyTagIndex(), generatedAt: new Date().toISOString(), diagnostics: [] }; }
function emptyLinkIndex(): MutableVaultIndex['links'] { return { outgoing: {}, backlinks: {}, unresolved: {}, aliases: {}, headings: {}, blocks: {}, mentions: {} }; }
function emptyTagIndex(): MutableVaultIndex['tags'] { return { counts: {}, hierarchy: {}, notes: {} }; }
function buildTagIndex(notes: readonly VaultNoteIndex[]): MutableVaultIndex['tags'] { const tags = emptyTagIndex(); for (const note of notes) for (const value of note.tags) { const tag = normalizeTag(value); tags.counts[tag] = (tags.counts[tag] ?? 0) + 1; (tags.notes[tag] ??= []).push(note.id); const parts = tag.split('/'); for (let index = 1; index < parts.length; index += 1) { const parent = parts.slice(0, index).join('/'); const children = tags.hierarchy[parent] ??= []; if (!children.includes(tag)) children.push(tag); } } return tags; }
function resolveIndexedLink(link: VaultLinkReference, notes: readonly VaultNoteIndex[], attachments: Readonly<Record<string, VaultAttachment>>): VaultLinkReference { const candidate = resolveLink(link, notes); if (!candidate.targetNoteId) { const attachment = Object.values(attachments).find(value => value.path === (candidate.targetPath ?? candidate.target.replace(/^\.\//, ''))); if (attachment && !attachment.missing) return { ...candidate, targetPath: attachment.path, resolution: 'resolved' }; } return candidate; }
function cloneIndex(value: VaultIndex): MutableVaultIndex { return structuredClone(value) as MutableVaultIndex; }
function clone<T>(value: T): T { return structuredClone(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isVault(value: unknown): value is Vault { return isRecord(value) && value.version === 1 && typeof value.id === 'string' && typeof value.ownerIdentityId === 'string' && typeof value.name === 'string' && typeof value.rootReference === 'string' && typeof value.revision === 'number'; }
function isVaultIndex(value: unknown, vaultId: string): value is VaultIndex { return isRecord(value) && value.version === 1 && value.vaultId === vaultId && isRecord(value.entries) && isRecord(value.notes) && isRecord(value.attachments) && isRecord(value.links) && isRecord(value.tags); }
function isHistoryRevision(value: unknown): value is VaultHistoryRevision { return isRecord(value) && value.version === 1 && typeof value.id === 'string' && typeof value.vaultId === 'string' && typeof value.noteId === 'string' && typeof value.revision === 'number' && typeof value.content === 'string' && typeof value.contentHash === 'string' && typeof value.createdAt === 'string'; }
function safeIdentity(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function safeId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeRootReference(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 4_096 && !/[\u0000-\u001f\u007f]/.test(value); }
function safePath(value: string, allowEmpty = false): string { if (typeof value !== 'string' || value.includes('\u0000')) throw new VaultError('INVALID_ARGUMENT', 'Vault path is invalid'); const normalized = value.replace(/\\/g, '/'); if ((!allowEmpty && !normalized.trim()) || normalized.startsWith('/') || normalized.endsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new VaultError('INVALID_ARGUMENT', 'Vault path must stay inside the selected root'); const parts = normalized.split('/').filter(Boolean); if (parts.some(part => part === '..' || part === '.' || /[\u0000-\u001f]/.test(part))) throw new VaultError('INVALID_ARGUMENT', 'Vault path traversal is not allowed'); return parts.join('/'); }
function bounded(value: unknown, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new VaultError('INVALID_ARGUMENT', 'Vault text is invalid'); return value; }
function iso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); if (!uuid) throw new Error('Secure randomness is unavailable'); return `${prefix}-${uuid}`; }
function basename(path: string): string { return path.split('/').pop() ?? path; }
function dirname(path: string): string { const index = path.lastIndexOf('/'); return index < 0 ? '' : path.slice(0, index); }
function extension(path: string): string { const name = basename(path); const index = name.lastIndexOf('.'); return index < 0 ? '' : name.slice(index).toLocaleLowerCase(); }
function basenameWithoutExtension(path: string): string { const name = basename(path); const ext = extension(path); return ext ? name.slice(0, -ext.length) : name; }
function mimeForPath(path: string): string { return ({ '.md': 'text/markdown', '.txt': 'text/plain', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' } as Record<string, string>)[extension(path)] ?? 'application/octet-stream'; }
function toBytes(value: Uint8Array | string): Uint8Array { return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); }
function decode(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: false }).decode(value); }
function stableContentHash(value: string): string { let a = 2166136261; let b = 2246822519; for (let i = 0; i < value.length; i += 1) { const code = value.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ (code + i), 2246822519); } return `hash-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }
function stablePathId(vaultId: string, path: string): string { return `note-${stableContentHash(`${vaultId}:${path}`).slice(5)}`; }
function findIdentityByHash(index: VaultIndex, hash: string): string | undefined { return Object.values(index.notes).find(note => note.contentHash === hash)?.id; }
function normalizeTag(value: string): string { return value.replace(/^#/, '').toLocaleLowerCase(); }
function propertyText(value: VaultProperty): string { return Array.isArray(value.value) ? value.value.join(' ') : String(value.value); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
function lineDiff(before: string, after: string): { addedLines: number; removedLines: number } { const oldLines = before.split('\n'); const newLines = after.split('\n'); let common = 0; const max = Math.min(oldLines.length, newLines.length); while (common < max && oldLines[common] === newLines[common]) common += 1; return { addedLines: Math.max(0, newLines.length - common), removedLines: Math.max(0, oldLines.length - common) }; }

interface ParsedMarkdown { readonly id?: string; readonly content: string; readonly body: string; readonly properties: VaultProperties; readonly aliases: readonly string[]; readonly tags: readonly string[]; readonly headings: readonly VaultHeading[]; readonly blocks: readonly VaultBlockReference[]; readonly links: readonly VaultLinkReference[]; readonly title: string; readonly frontmatterError?: string; }
function parseMarkdownSource(content: string, properties?: VaultProperties, noteId?: string): ParsedMarkdown { const parsed = parseFrontmatter(content); const body = parsed.body; const headings: VaultHeading[] = []; const blocks: VaultBlockReference[] = []; const lines = body.split('\n'); lines.forEach((line, index) => { const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line); if (heading) headings.push({ id: slug(heading[2]!), level: heading[1]!.length, text: heading[2]!, line: index + 1 }); for (const match of line.matchAll(/\^([A-Za-z0-9][A-Za-z0-9_-]{0,80})\b/g)) blocks.push({ id: match[1]!, line: index + 1 }); }); const aliases = propertyStrings(parsed.properties, 'aliases'); const tags = [...new Set([...propertyStrings(parsed.properties, 'tags').map(normalizeTag), ...scanTags(body)])]; const links = parseLinks(body, noteId ?? parsed.id ?? stablePathId('unbound', 'note'), ''); const title = headings[0]?.text ?? (noteId ? noteId : 'Untitled'); return { id: parsed.id, content, body, properties: properties ?? parsed.properties, aliases, tags, headings, blocks, links, title, ...(parsed.error ? { frontmatterError: parsed.error } : {}) }; }
function parseMarkdownNote(index: VaultNoteIndex, content: string): MarkdownNote { const parsed = parseMarkdownSource(content, index.properties, index.id); return { version: 1, id: index.id, vaultId: index.vaultId, kind: 'note', path: index.path, name: basename(index.path), parentPath: dirname(index.path), size: new TextEncoder().encode(content).byteLength, mimeType: 'text/markdown', modifiedAt: index.modifiedAt, contentHash: stableContentHash(content), title: parsed.title === index.id ? index.title : parsed.title, content, body: parsed.body, frontmatter: parsed.properties, ...(parsed.frontmatterError ? { frontmatterError: parsed.frontmatterError } : {}), aliases: parsed.aliases, tags: parsed.tags, headings: parsed.headings, blocks: parsed.blocks, links: index.links, revision: index.revision, untrusted: true }; }
function makeFolderEntry(vaultId: string, path: string, entry: VaultStorageEntry): VaultEntry { return { version: 1, id: stablePathId(vaultId, path), vaultId, kind: 'folder', path, name: basename(path), parentPath: dirname(path), size: 0, modifiedAt: entry.modifiedAt }; }
function makeNoteIndex(vaultId: string, id: string, path: string, entry: VaultStorageEntry, parsed: ParsedMarkdown, revision: number, contentHash: string): VaultNoteIndex { const title = parsed.title === 'Untitled' || parsed.title === id ? basenameWithoutExtension(path) : parsed.title; const searchText = `${title}\n${parsed.body.slice(0, VAULT_MAX_INDEX_TEXT)}\n${parsed.aliases.join(' ')}\n${parsed.tags.join(' ')}\n${Object.entries(parsed.properties).map(([key, value]) => `${key} ${propertyText(value)}`).join(' ')}`.slice(0, VAULT_MAX_INDEX_TEXT); const links = parsed.links.map(value => ({ ...value, sourceNoteId: id, sourcePath: path })); return { version: 1, id, vaultId, kind: 'note', path, name: basename(path), parentPath: dirname(path), size: entry.size, mimeType: entry.mimeType ?? 'text/markdown', modifiedAt: entry.modifiedAt, contentHash, title, aliases: parsed.aliases, tags: parsed.tags, properties: parsed.properties, headings: parsed.headings, blocks: parsed.blocks, links, revision, ...(parsed.frontmatterError ? { frontmatterError: parsed.frontmatterError } : {}), searchText }; }
function composeMarkdown(noteId: string, body: string, properties: VaultProperties): string { const merged: Record<string, VaultProperty> = { keystone_id: { type: 'string', value: noteId }, ...properties }; const keys = Object.keys(merged).filter(key => /^[A-Za-z_][A-Za-z0-9_-]{0,80}$/.test(key)); const lines = ['---']; for (const key of keys) { const property = merged[key]!; if (Array.isArray(property.value)) { lines.push(`${key}:`); for (const item of property.value) lines.push(`  - ${String(item)}`); } else lines.push(`${key}: ${serializeScalar(property.value as string | number | boolean)}`); } lines.push('---', ''); return `${lines.join('\n')}${body.replace(/^\n+/, '')}`; }
function ensureStableId(parsed: ParsedMarkdown, noteId: string): string { if (parsed.id === noteId) return parsed.content; return composeMarkdown(noteId, parsed.body, parsed.properties); }
function serializeScalar(value: string | number | boolean): string { if (typeof value === 'string' && /[:#\[\]{},]|^\s|\s$/.test(value)) return JSON.stringify(value); return String(value); }
function parseFrontmatter(content: string): { readonly body: string; readonly properties: VaultProperties; readonly id?: string; readonly error?: string } { const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); if (!normalized.startsWith('---\n')) return { body: normalized, properties: {} }; const close = normalized.indexOf('\n---', 4); if (close < 0) return { body: normalized, properties: {}, error: 'Frontmatter closing delimiter is missing' }; const raw = normalized.slice(4, close); const body = normalized.slice(close + 4).replace(/^\n/, ''); const values: Record<string, VaultProperty> = {}; let currentList: { key: string; values: string[] } | undefined; const errors: string[] = []; for (const line of raw.split('\n')) { const list = /^\s+-\s*(.*)$/.exec(line); if (list && currentList) { currentList.values.push(unquote(list[1]!)); continue; } const match = /^([A-Za-z_][A-Za-z0-9_-]{0,80}):\s*(.*)$/.exec(line); if (!match) { if (line.trim()) errors.push(`Invalid frontmatter line: ${line.slice(0, 120)}`); continue; } if (currentList) { values[currentList.key] = inferProperty(currentList.key, currentList.values); currentList = undefined; } const key = match[1]!; const value = match[2]!.trim(); if (!value) currentList = { key, values: [] }; else values[key] = inferProperty(key, parseScalar(value)); } if (currentList) values[currentList.key] = inferProperty(currentList.key, currentList.values); const idValue = values.keystone_id?.value; return { body, properties: values, ...(typeof idValue === 'string' && safeId(idValue) ? { id: idValue } : {}), ...(errors.length ? { error: errors.join('; ') } : {}) }; }
function parseScalar(value: string): string | number | boolean | readonly string[] { const unquoted = unquote(value); if (value === 'true' || value === 'false') return value === 'true'; if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value); if (/^\[.*\]$/.test(value)) return value.slice(1, -1).split(',').map(item => unquote(item.trim())).filter(Boolean); return unquoted; }
function inferProperty(key: string, value: string | number | boolean | readonly string[]): VaultProperty { if (Array.isArray(value)) { const values = value.map(String); const type: VaultPropertyType = key.toLocaleLowerCase() === 'tags' || values.every(item => item.startsWith('#')) ? 'tags' : key.toLocaleLowerCase() === 'links' || values.every(item => /^\[\[.*\]\]$/.test(item)) ? 'links' : 'list'; return { type, value: values }; } if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'date', value }; if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return { type: 'datetime', value }; return { type: typeof value as VaultPropertyType, value }; }
function unquote(value: string): string { return value.replace(/^(['"])(.*)\1$/, '$2').replace(/\\n/g, '\n').trim(); }
function propertyStrings(properties: VaultProperties, key: string): string[] { const value = properties[key]?.value; return value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)]; }
function scanTags(body: string): string[] { const values = new Set<string>(); for (const line of body.split('\n')) { const withoutHeading = line.replace(/^\s{0,3}#{1,6}\s+/, ' '); for (const match of withoutHeading.matchAll(/(?:^|[^\w])#([A-Za-z0-9][A-Za-z0-9_/-]*)/g)) values.add(match[1]!.toLocaleLowerCase()); } return [...values]; }
function mentions(text: string): string[] { return [...new Set([...text.matchAll(/(?:^|\s)@([A-Za-z0-9][A-Za-z0-9._-]{1,80})/g)].map(match => match[1]!.toLocaleLowerCase()))]; }
function slug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 120) || 'heading'; }
function parseLinks(body: string, sourceNoteId: string, sourcePath: string): VaultLinkReference[] { const links: VaultLinkReference[] = []; const add = (kind: VaultLinkKind, raw: string, target: string, line: number, alias?: string) => { const [withoutBlock, block] = target.split('#^'); const [base, heading] = withoutBlock!.split('#'); links.push({ id: randomId('vault-link'), sourceNoteId, sourcePath, kind, raw, target: base || target, ...(alias ? { alias } : {}), ...(heading ? { heading } : {}), ...(block ? { blockId: block } : {}), resolution: 'unresolved', line }); }; body.split('\n').forEach((line, index) => { for (const match of line.matchAll(/(!?)\[\[([^\]]+)\]\]/g)) { const raw = match[0]!; const value = match[2]!; const split = value.split('|'); add(match[1] ? 'embed' : 'wikilink', raw, split[0]!, index + 1, split[1]); } for (const match of line.matchAll(/(!?)\[([^\]]+)\]\(([^)]+)\)/g)) { const target = match[3]!; if (!/^(https?:|mailto:|keystone:)/i.test(target)) add(match[1] ? 'embed' : 'markdown', match[0]!, target, index + 1, match[2]); } }); return links; }
function resolveLink(link: VaultLinkReference, notes: readonly VaultNoteIndex[]): VaultLinkReference { const target = link.target.replace(/^\.\//, ''); const sourceDir = dirname(link.sourcePath); const targetPath = target.startsWith('/') ? target.slice(1) : target.includes('/') ? `${sourceDir ? `${sourceDir}/` : ''}${target}`.replace(/\/\.\//g, '/') : undefined; const matches = notes.filter(note => note.id === target || note.path === target || (targetPath && note.path === targetPath) || basenameWithoutExtension(note.path).toLocaleLowerCase() === target.toLocaleLowerCase() || note.title.toLocaleLowerCase() === target.toLocaleLowerCase() || note.aliases.some(alias => alias.toLocaleLowerCase() === target.toLocaleLowerCase())); if (matches.length === 1) { const note = matches[0]!; const validHeading = !link.heading || note.headings.some(value => value.id === slug(link.heading!) || value.text === link.heading); const validBlock = !link.blockId || note.blocks.some(value => value.id === link.blockId); return { ...link, targetPath: note.path, targetNoteId: note.id, resolution: validHeading && validBlock ? 'resolved' : 'unresolved' }; } if (matches.length > 1) return { ...link, resolution: 'ambiguous' }; return { ...link, targetPath, resolution: 'unresolved' }; }
function scoreText(note: VaultNoteIndex, query: string): number { let score = 0; if (note.title.toLocaleLowerCase().includes(query)) score += 10; if (note.path.toLocaleLowerCase().includes(query)) score += 6; if (note.tags.some(tag => tag.includes(query))) score += 5; if (note.searchText.toLocaleLowerCase().includes(query)) score += 2; return score; }
function makeSnippet(note: VaultNoteIndex, query?: string): string { const value = note.searchText.replace(/\s+/g, ' ').trim(); if (!query) return value.slice(0, 240); const index = value.toLocaleLowerCase().indexOf(query); return (index < 0 ? value : value.slice(Math.max(0, index - 80), index + 160)).slice(0, 240); }
