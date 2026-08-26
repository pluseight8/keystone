/**
 * Advanced Markdown-first Vault services.
 *
 * This module deliberately stays on top of VaultService.  Markdown remains
 * the durable, portable source of truth; templates, bookmarks, indexes and
 * saved views are bounded derived sidecar state.  Extension interfaces in
 * this file are declarations only: registering one never executes code or
 * grants a capability.
 */
import type {
  MarkdownNote,
  VaultIndex,
  VaultLinkReference,
  VaultNoteIndex,
  VaultProperties,
  VaultProperty,
  VaultPropertyType,
  VaultService,
  VaultStorageAdapter,
} from './vaults.js';
import { VaultError } from './vaults.js';

export const VAULT_ADVANCED_VERSION = 1 as const;
export const VAULT_ADVANCED_MAX_TEXT = 256 * 1024;
export const VAULT_ADVANCED_MAX_RESULTS = 512;
export const VAULT_ADVANCED_MAX_QUERY_COST = 20_000;
export const VAULT_ADVANCED_MAX_TEMPLATE_VARIABLES = 128;
export const VAULT_ADVANCED_MAX_BOOKMARKS = 2_000;
export const VAULT_ADVANCED_MAX_VIEWS = 512;
export const VAULT_ADVANCED_MAX_TASKS = 20_000;

export type VaultAdvancedStateKey = 'templates' | 'bookmarks' | 'views' | 'tasks' | 'shared';

/** Host-owned sidecar persistence boundary. It may be encrypted by the host. */
export interface VaultAdvancedStateStore {
  read(key: VaultAdvancedStateKey): Promise<unknown | undefined>;
  write(key: VaultAdvancedStateKey, value: unknown): Promise<void>;
}

export class InMemoryVaultAdvancedStateStore implements VaultAdvancedStateStore {
  private readonly values = new Map<VaultAdvancedStateKey, unknown>();
  async read(key: VaultAdvancedStateKey): Promise<unknown | undefined> { const value = this.values.get(key); return value === undefined ? undefined : structuredClone(value); }
  async write(key: VaultAdvancedStateKey, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  corrupt(key: VaultAdvancedStateKey, value: unknown): void { this.values.set(key, value); }
}

/** Stores advanced metadata in .keystone; Markdown itself is never replaced. */
export class PersistentVaultAdvancedStateStore implements VaultAdvancedStateStore {
  constructor(private readonly storage: VaultStorageAdapter) {}
  async read(key: VaultAdvancedStateKey): Promise<unknown | undefined> { try { return JSON.parse(new TextDecoder().decode(await this.storage.read(`.keystone/vault-${key}.json`))); } catch { return undefined; } }
  async write(key: VaultAdvancedStateKey, value: unknown): Promise<void> { await this.storage.createFolder('.keystone').catch(() => undefined); await this.storage.writeAtomic(`.keystone/vault-${key}.json`, JSON.stringify(value)); }
}

export interface DailyNotePolicy {
  readonly version?: 1;
  readonly folder: string;
  /** Date tokens: YYYY, MM, DD, YYYY-MM-DD. */
  readonly filenameFormat: string;
  readonly dateFormat?: string;
  readonly template?: string;
  readonly includeCalendarRefs?: boolean;
  readonly includeTaskRefs?: boolean;
  readonly includeActivityRefs?: boolean;
}

export interface DailyNoteContext {
  readonly date?: Date | string;
  readonly calendarRefs?: readonly string[];
  readonly taskRefs?: readonly string[];
  readonly activityRefs?: readonly string[];
}

export interface DailyNoteResult {
  readonly note: MarkdownNote;
  readonly date: string;
  readonly created: boolean;
  readonly path: string;
}

export const DEFAULT_DAILY_NOTE_POLICY: DailyNotePolicy = {
  version: 1,
  folder: 'Daily',
  filenameFormat: 'YYYY-MM-DD.md',
  dateFormat: 'YYYY-MM-DD',
  template: '# {{date}}\n\n',
  includeCalendarRefs: true,
  includeTaskRefs: true,
  includeActivityRefs: true,
};

export class DailyNoteService {
  private policy: DailyNotePolicy;
  constructor(private readonly vault: VaultService, policy: Partial<DailyNotePolicy> = {}, private readonly actor = vault.identityId) { this.policy = normalizeDailyPolicy(policy); }
  getPolicy(): DailyNotePolicy { return structuredClone(this.policy); }
  setPolicy(policy: Partial<DailyNotePolicy>): DailyNotePolicy { this.policy = normalizeDailyPolicy({ ...this.policy, ...policy }); return this.getPolicy(); }
  async open(date: Date | string = new Date(), context: DailyNoteContext = {}): Promise<DailyNoteResult> {
    const parsed = parseDate(date); const dateText = formatDate(parsed, this.policy.dateFormat ?? 'YYYY-MM-DD'); const filename = renderDate(this.policy.filenameFormat, parsed); const folder = cleanFolder(this.policy.folder); const path = folder ? `${folder}/${filename}` : filename;
    const existing = (await this.vault.listNotes(this.actor)).find(note => note.path === path);
    if (existing) { const note = await this.vault.getNote(existing.id, this.actor); if (!note) throw new VaultError('NOT_FOUND', 'Daily note disappeared during lookup'); return { note, date: dateText, created: false, path }; }
    let body = (this.policy.template ?? '').replace(/\{\{\s*date\s*\}\}/gi, dateText);
    body = appendDailyRefs(body, this.policy.includeCalendarRefs ? context.calendarRefs : undefined, 'Calendar');
    body = appendDailyRefs(body, this.policy.includeTaskRefs ? context.taskRefs : undefined, 'Tasks');
    body = appendDailyRefs(body, this.policy.includeActivityRefs ? context.activityRefs : undefined, 'Activity');
    const note = await this.vault.createNote({ path, content: body, title: '' }, this.actor);
    return { note, date: dateText, created: true, path };
  }
  openToday(context: DailyNoteContext = {}): Promise<DailyNoteResult> { return this.open(new Date(), context); }
  openPrevious(date: Date | string, context: DailyNoteContext = {}): Promise<DailyNoteResult> { const value = parseDate(date); value.setUTCDate(value.getUTCDate() - 1); return this.open(value, context); }
  openNext(date: Date | string, context: DailyNoteContext = {}): Promise<DailyNoteResult> { const value = parseDate(date); value.setUTCDate(value.getUTCDate() + 1); return this.open(value, context); }
  commands(): readonly string[] { return ['daily.open-today', 'daily.open-previous', 'daily.open-next', 'daily.set-policy']; }
}

export type TemplateVariableName = 'date' | 'time' | 'title' | 'filename' | 'selectedText' | 'currentNote' | 'currentFolder' | (string & {});
export interface TemplateVariable { readonly name: TemplateVariableName; readonly type: 'string' | 'date' | 'datetime' | 'note' | 'selection'; readonly required?: boolean; }
export interface VaultTemplate { readonly version: 1; readonly id: string; readonly name: string; readonly content: string; readonly variables: readonly TemplateVariable[]; readonly folder?: string; readonly createdAt: string; readonly updatedAt: string; }
export interface TemplateExpansion { readonly version: 1; readonly templateId?: string; readonly content: string; readonly variables: Readonly<Record<string, string>>; readonly diagnostics: readonly string[]; }
export interface TemplateExpansionContext { readonly date?: Date | string; readonly time?: Date | string; readonly title?: string; readonly filename?: string; readonly selectedText?: string; readonly currentNote?: string; readonly currentFolder?: string; readonly [key: string]: string | Date | undefined; }

export interface TemplateVariableProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly variables: readonly TemplateVariable[]; }
export interface QueryFunctionProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly functions: readonly string[]; }
export interface VaultViewRenderer { readonly id: string; readonly version: string; readonly integrityHash: string; readonly kinds: readonly VaultViewKind[]; }
export interface VaultCommandProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly commands: readonly string[]; }
export interface VaultIndexerExtension { readonly id: string; readonly version: string; readonly integrityHash: string; readonly fields: readonly string[]; }
export interface CollaborativeObjectProvider { readonly id: string; readonly version: string; readonly integrityHash: string; readonly objectTypes: readonly string[]; }

export class VaultAdvancedExtensionRegistry {
  private readonly values = new Map<string, TemplateVariableProvider | QueryFunctionProvider | VaultViewRenderer | VaultCommandProvider | VaultIndexerExtension | CollaborativeObjectProvider>();
  register(value: TemplateVariableProvider | QueryFunctionProvider | VaultViewRenderer | VaultCommandProvider | VaultIndexerExtension | CollaborativeObjectProvider): void { if (!safeExtension(value)) throw new VaultError('INVALID_ARGUMENT', 'Vault extension declaration is invalid'); this.values.set(value.id, structuredClone(value)); }
  unregister(id: string): void { this.values.delete(id); }
  list(): readonly (TemplateVariableProvider | QueryFunctionProvider | VaultViewRenderer | VaultCommandProvider | VaultIndexerExtension | CollaborativeObjectProvider)[] { return [...this.values.values()].map(value => structuredClone(value)); }
}

export class VaultTemplateService {
  private readonly templates = new Map<string, VaultTemplate>();
  private readonly state: VaultAdvancedStateStore;
  private readyPromise: Promise<void>;
  constructor(state: VaultAdvancedStateStore = new InMemoryVaultAdvancedStateStore(), private readonly now = Date.now) { this.state = state; this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async create(input: { id?: string; name: string; content: string; variables?: readonly TemplateVariable[]; folder?: string }): Promise<VaultTemplate> { await this.ready(); const id = input.id ?? randomId('template'); const value: VaultTemplate = { version: 1, id: safeId(id), name: bounded(input.name, 160, true), content: bounded(input.content, VAULT_ADVANCED_MAX_TEXT), variables: normalizeVariables(input.variables ?? inferVariables(input.content)), ...(input.folder ? { folder: cleanFolder(input.folder) } : {}), createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }; this.templates.set(id, value); await this.persist(); return structuredClone(value); }
  async upsert(template: VaultTemplate): Promise<void> { await this.ready(); if (template.version !== 1 || !safeId(template.id) || !template.name || typeof template.content !== 'string' || template.content.length > VAULT_ADVANCED_MAX_TEXT) throw new VaultError('INVALID_ARGUMENT', 'Invalid Vault template'); this.templates.set(template.id, structuredClone(template)); await this.persist(); }
  async list(): Promise<readonly VaultTemplate[]> { await this.ready(); return [...this.templates.values()].sort((a, b) => a.name.localeCompare(b.name)).map(value => structuredClone(value)); }
  async get(id: string): Promise<VaultTemplate | undefined> { await this.ready(); const value = this.templates.get(id); return value ? structuredClone(value) : undefined; }
  async remove(id: string): Promise<void> { await this.ready(); this.templates.delete(id); await this.persist(); }
  async expand(templateOrId: string | VaultTemplate, context: TemplateExpansionContext = {}): Promise<TemplateExpansion> { await this.ready(); const template = typeof templateOrId === 'string' ? this.templates.get(templateOrId) : templateOrId; if (!template) throw new VaultError('NOT_FOUND', 'Vault template not found'); const values = templateValueMap(context); const diagnostics: string[] = []; let count = 0; const content = template.content.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,80})\s*\}\}/g, (_match, name: string) => { count += 1; if (count > VAULT_ADVANCED_MAX_TEMPLATE_VARIABLES) { diagnostics.push('Template variable bound exceeded'); return ''; } const value = values[name] ?? values[name.replace(/[-_]/g, '')]; if (value === undefined) { diagnostics.push(`Unknown template variable: ${name}`); return ''; } return value; }); if (content.length > VAULT_ADVANCED_MAX_TEXT) throw new VaultError('BOUNDS_EXCEEDED', 'Expanded template exceeds the safe bound'); return { version: 1, templateId: template.id, content, variables: values, diagnostics }; }
  async render(templateOrId: string | VaultTemplate, context: TemplateExpansionContext = {}): Promise<string> { return (await this.expand(templateOrId, context)).content; }
  private async hydrate(): Promise<void> { const raw = await this.state.read('templates'); if (!raw || typeof raw !== 'object') return; const list = (raw as { templates?: unknown }).templates; if (!Array.isArray(list)) return; for (const item of list) if (isTemplate(item)) this.templates.set(item.id, structuredClone(item)); }
  private async persist(): Promise<void> { await this.state.write('templates', { version: 1, templates: [...this.templates.values()] }); }
}

export type VaultBookmarkTarget =
  | { readonly kind: 'note'; readonly noteId: string; readonly heading?: string; readonly blockId?: string }
  | { readonly kind: 'heading' | 'block'; readonly noteId: string; readonly value: string }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'graph'; readonly query: string }
  | { readonly kind: 'canvas'; readonly canvasId: string; readonly nodeId?: string }
  | { readonly kind: 'folder'; readonly path: string }
  | { readonly kind: 'object'; readonly objectType: string; readonly objectId: string };
export interface VaultBookmark { readonly version: 1; readonly id: string; readonly title: string; readonly target: VaultBookmarkTarget; readonly groupId?: string; readonly pinned: boolean; readonly workspace?: string; readonly createdAt: string; readonly updatedAt: string; readonly order: number; }
export interface VaultBookmarkGroup { readonly id: string; readonly name: string; readonly order: number; }
export interface VaultBookmarksSnapshot { readonly version: 1; readonly bookmarks: readonly VaultBookmark[]; readonly groups: readonly VaultBookmarkGroup[]; }

export class VaultBookmarksService {
  private readonly bookmarks = new Map<string, VaultBookmark>(); private readonly groups = new Map<string, VaultBookmarkGroup>(); private readonly state: VaultAdvancedStateStore; private readyPromise: Promise<void>;
  constructor(state: VaultAdvancedStateStore = new InMemoryVaultAdvancedStateStore(), private readonly now = Date.now) { this.state = state; this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  async snapshot(): Promise<VaultBookmarksSnapshot> { await this.ready(); return { version: 1, bookmarks: [...this.bookmarks.values()].sort((a, b) => a.order - b.order).map(value => structuredClone(value)), groups: [...this.groups.values()].sort((a, b) => a.order - b.order).map(value => structuredClone(value)) }; }
  async list(workspace?: string): Promise<readonly VaultBookmark[]> { const value = await this.snapshot(); return value.bookmarks.filter(item => workspace === undefined || item.workspace === workspace); }
  async add(input: { id?: string; title: string; target: VaultBookmarkTarget; groupId?: string; pinned?: boolean; workspace?: string }): Promise<VaultBookmark> { await this.ready(); if (this.bookmarks.size >= VAULT_ADVANCED_MAX_BOOKMARKS) throw new VaultError('BOUNDS_EXCEEDED', 'Bookmark limit reached'); const id = input.id ?? randomId('bookmark'); const now = new Date(this.now()).toISOString(); const value: VaultBookmark = { version: 1, id: safeId(id), title: bounded(input.title, 240, true), target: structuredClone(input.target), ...(input.groupId ? { groupId: safeId(input.groupId) } : {}), pinned: input.pinned === true, ...(input.workspace ? { workspace: bounded(input.workspace, 160) } : {}), createdAt: now, updatedAt: now, order: this.bookmarks.size }; this.bookmarks.set(id, value); await this.persist(); return structuredClone(value); }
  async create(input: Parameters<VaultBookmarksService['add']>[0]): Promise<VaultBookmark> { return this.add(input); }
  async get(id: string): Promise<VaultBookmark | undefined> { await this.ready(); const value = this.bookmarks.get(id); return value ? structuredClone(value) : undefined; }
  async open(id: string): Promise<VaultBookmark> { const value = await this.get(id); if (!value) throw new VaultError('NOT_FOUND', 'Bookmark not found'); return value; }
  async pin(id: string, pinned = true): Promise<VaultBookmark> { return this.update(id, { pinned }); }
  async rename(id: string, title: string): Promise<VaultBookmark> { return this.update(id, { title }); }
  async move(id: string, groupId?: string): Promise<VaultBookmark> { return this.update(id, groupId === undefined ? { groupId: undefined } : { groupId }); }
  async renameGroup(id: string, name: string): Promise<VaultBookmarkGroup> { await this.ready(); const current = this.groups.get(id); if (!current) throw new VaultError('NOT_FOUND', 'Bookmark group not found'); const value = { ...current, name: bounded(name, 160, true) }; this.groups.set(id, value); await this.persist(); return structuredClone(value); }
  async remove(id: string): Promise<void> { await this.ready(); this.bookmarks.delete(id); await this.persist(); }
  async update(id: string, patch: Partial<Pick<VaultBookmark, 'title' | 'groupId' | 'pinned' | 'workspace' | 'order'>>): Promise<VaultBookmark> { await this.ready(); const current = this.bookmarks.get(id); if (!current) throw new VaultError('NOT_FOUND', 'Bookmark not found'); const value = { ...current, ...patch, ...(patch.title === undefined ? {} : { title: bounded(patch.title, 240, true) }), updatedAt: new Date(this.now()).toISOString() }; this.bookmarks.set(id, value); await this.persist(); return structuredClone(value); }
  async reorder(ids: readonly string[]): Promise<void> { await this.ready(); if (ids.length > VAULT_ADVANCED_MAX_BOOKMARKS) throw new VaultError('BOUNDS_EXCEEDED', 'Bookmark order is too large'); ids.forEach((id, index) => { const item = this.bookmarks.get(id); if (item) this.bookmarks.set(id, { ...item, order: index, updatedAt: new Date(this.now()).toISOString() }); }); await this.persist(); }
  async group(name: string, id = randomId('bookmark-group')): Promise<VaultBookmarkGroup> { await this.ready(); const value = { id: safeId(id), name: bounded(name, 160, true), order: this.groups.size }; this.groups.set(id, value); await this.persist(); return structuredClone(value); }
  async groupsList(): Promise<readonly VaultBookmarkGroup[]> { await this.ready(); return [...this.groups.values()].sort((a, b) => a.order - b.order).map(value => structuredClone(value)); }
  private async hydrate(): Promise<void> { const raw = await this.state.read('bookmarks'); if (!raw || typeof raw !== 'object') return; const value = raw as Partial<VaultBookmarksSnapshot>; if (Array.isArray(value.bookmarks)) for (const item of value.bookmarks) if (isBookmark(item)) this.bookmarks.set(item.id, structuredClone(item)); if (Array.isArray(value.groups)) for (const item of value.groups) if (isBookmarkGroup(item)) this.groups.set(item.id, structuredClone(item)); }
  private async persist(): Promise<void> { await this.state.write('bookmarks', await this.snapshot()); }
}

export interface QuickSwitchResult { readonly id: string; readonly kind: 'note' | 'heading' | 'tag' | 'bookmark' | 'canvas' | 'folder'; readonly label: string; readonly path?: string; readonly noteId?: string; readonly score: number; readonly target?: unknown; }
export interface QuickSwitcherOptions { readonly limit?: number; readonly includeContent?: boolean; readonly bookmarks?: VaultBookmarksService; readonly canvases?: readonly { id: string; title: string }[]; }
export class VaultQuickSwitcherService {
  constructor(private readonly vault: VaultService) {}
  async search(query: string, options: QuickSwitcherOptions = {}, actor = this.vault.identityId): Promise<readonly QuickSwitchResult[]> { const needle = query.trim().toLocaleLowerCase(); if (!needle) return []; const notes = await this.vault.listNotes(actor); const output: QuickSwitchResult[] = []; for (const note of notes) { const fields = [note.title, note.path, ...note.aliases, ...note.tags, ...note.headings.map(value => value.text)]; const score = fuzzyScore(fields.join(' '), needle); if (score > 0) { output.push({ id: note.id, kind: 'note', label: note.title, path: note.path, noteId: note.id, score }); for (const heading of note.headings) { const headingScore = fuzzyScore(heading.text, needle); if (headingScore > 0) output.push({ id: `${note.id}#${heading.id}`, kind: 'heading', label: heading.text, path: note.path, noteId: note.id, score: headingScore - 0.01, target: heading }); } } for (const tag of note.tags) { const score = fuzzyScore(tag, needle); if (score > 0) output.push({ id: `tag:${tag}`, kind: 'tag', label: `#${tag}`, score: score - 0.02 }); } if (options.includeContent && note.searchText.toLocaleLowerCase().includes(needle)) output.push({ id: `${note.id}:content`, kind: 'note', label: note.title, path: note.path, noteId: note.id, score: 0.2 }); } if (options.bookmarks) for (const bookmark of await options.bookmarks.list()) { const score = fuzzyScore(bookmark.title, needle); if (score > 0) output.push({ id: bookmark.id, kind: 'bookmark', label: bookmark.title, score: score + (bookmark.pinned ? 0.5 : 0), target: bookmark.target }); } for (const canvas of options.canvases ?? []) { const score = fuzzyScore(canvas.title, needle); if (score > 0) output.push({ id: canvas.id, kind: 'canvas', label: canvas.title, score }); } return dedupeQuick(output).sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, clamp(options.limit ?? 64, 1, VAULT_ADVANCED_MAX_RESULTS)); }
  resolve(query: string, options?: QuickSwitcherOptions, actor?: string): Promise<readonly QuickSwitchResult[]> { return this.search(query, options, actor); }
}
export { VaultQuickSwitcherService as QuickSwitcherService };

export interface VaultTask { readonly version: 1; readonly id: string; readonly noteId: string; readonly path: string; readonly line: number; readonly text: string; readonly completed: boolean; readonly due?: string; readonly priority?: number; readonly tags: readonly string[]; readonly references: readonly string[]; readonly sourceRevision: number; }
export interface VaultTaskIndex { readonly version: 1; readonly revision: number; readonly generatedAt: string; readonly tasks: readonly VaultTask[]; }
export interface VaultWorkItemAdapter { create(input: { title: string; due?: string; priority?: number; sourceTaskId: string; sourceNoteId: string }): Promise<{ id: string }>; complete?(id: string): Promise<void>; }

export class VaultTaskIndexService {
  constructor(private readonly vault: VaultService, private readonly now = Date.now) {}
  async build(actor = this.vault.identityId): Promise<VaultTaskIndex> { const tasks: VaultTask[] = []; for (const note of await this.vault.listNotes(actor)) { const full = await this.vault.getNote(note.id, actor); if (!full) continue; full.body.split('\n').forEach((line, index) => { const match = /^\s*(?:[-*]|\d+\.)\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line); if (!match) return; const text = match[2]!; const due = /(?:due|📅)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i.exec(text)?.[1]; const priority = /(?:priority|prio)\s*[:=]\s*(\d+)/i.exec(text)?.[1]; const tags = [...new Set([...text.matchAll(/#([A-Za-z0-9][A-Za-z0-9_/-]*)/g)].map(value => value[1]!.toLocaleLowerCase()))]; const references = [...new Set([...text.matchAll(/\[\[([^\]|#^]+)/g)].map(value => value[1]!))]; tasks.push({ version: 1, id: stableTaskId(note.id, index + 1, text), noteId: note.id, path: note.path, line: index + 1, text, completed: match[1]!.toLocaleLowerCase() === 'x', ...(due ? { due } : {}), ...(priority ? { priority: Number(priority) } : {}), tags, references, sourceRevision: full.revision }); }); } return { version: 1, revision: this.vault.index.revision, generatedAt: new Date(this.now()).toISOString(), tasks: tasks.slice(0, VAULT_ADVANCED_MAX_TASKS) }; }
  index(actor?: string): Promise<VaultTaskIndex> { return this.build(actor); }
  list(actor?: string): Promise<readonly VaultTask[]> { return this.build(actor).then(value => value.tasks); }
  async toggle(task: VaultTask, completed: boolean, actor = this.vault.identityId): Promise<MarkdownNote> { const note = await this.vault.getNote(task.noteId, actor); if (!note) throw new VaultError('NOT_FOUND', 'Task note not found'); const lines = note.body.split('\n'); const line = lines[task.line - 1]; if (line === undefined) throw new VaultError('NOT_FOUND', 'Task line not found'); lines[task.line - 1] = line.replace(/\[([ xX])\]/, completed ? '[x]' : '[ ]'); return this.vault.updateNote(task.noteId, { content: lines.join('\n'), baseRevision: note.revision }, actor); }
  async convertToWorkItem(task: VaultTask, adapter: VaultWorkItemAdapter, actor = this.vault.identityId): Promise<{ id: string; sourceTaskId: string }> { const note = await this.vault.getNote(task.noteId, actor); if (!note) throw new VaultError('NOT_FOUND', 'Task note not found'); const item = await adapter.create({ title: task.text, ...(task.due ? { due: task.due } : {}), ...(task.priority === undefined ? {} : { priority: task.priority }), sourceTaskId: task.id, sourceNoteId: task.noteId }); const marker = `<!-- keystone-work-item:${item.id} -->`; if (!note.body.includes(marker)) await this.vault.updateNote(task.noteId, { content: `${note.body}\n${marker}`, baseRevision: note.revision }, actor); return { id: item.id, sourceTaskId: task.id }; }
}
export { VaultTaskIndexService as VaultTaskService };

export type VaultQuerySource = 'notes' | 'tasks';
export type VaultViewKind = 'LIST' | 'TABLE' | 'BOARD';
export type VaultQueryValue = string | number | boolean | readonly string[] | null;
export type VaultQueryField = 'id' | 'title' | 'path' | 'folder' | 'tags' | 'links' | 'backlinks' | 'modified' | 'created' | 'due' | 'priority' | 'completed' | 'status' | 'text' | `property.${string}` | (string & {});
export interface VaultQueryCondition { readonly op: 'comparison' | 'contains' | 'exists' | 'and' | 'or' | 'not'; readonly field?: VaultQueryField; readonly comparator?: '=' | '!=' | '>' | '>=' | '<' | '<='; readonly value?: VaultQueryValue; readonly left?: VaultQueryCondition; readonly right?: VaultQueryCondition; }
export interface VaultQueryAst { readonly version: 1; readonly source: VaultQuerySource; readonly select: readonly VaultQueryField[]; readonly where?: VaultQueryCondition; readonly sort?: { readonly field: VaultQueryField; readonly direction: 'asc' | 'desc' }; readonly limit: number; readonly groupBy?: VaultQueryField; }
export interface VaultQuery { readonly version: 1; readonly id?: string; readonly text?: string; readonly ast?: VaultQueryAst; readonly name?: string; }
export interface VaultQueryPlan { readonly version: 1; readonly ast: VaultQueryAst; readonly estimatedCost: number; readonly warnings: readonly string[]; }
export interface VaultQueryRow { readonly id: string; readonly source: VaultQuerySource; readonly values: Readonly<Record<string, VaultQueryValue>>; readonly noteId?: string; readonly taskId?: string; }
export interface VaultQueryResult { readonly version: 1; readonly rows: readonly VaultQueryRow[]; readonly total: number; readonly nextCursor?: string; readonly plan: VaultQueryPlan; readonly cancelled?: boolean; }
export interface VaultViewDefinition { readonly version?: 1; readonly id?: string; readonly name: string; readonly kind: VaultViewKind; readonly query: VaultQueryAst | string; readonly columns?: readonly VaultQueryField[]; readonly boardField?: VaultQueryField; readonly sort?: { readonly field: VaultQueryField; readonly direction: 'asc' | 'desc' }; readonly filters?: readonly VaultQueryCondition[]; }
export interface VaultView { readonly version: 1; readonly id: string; readonly name: string; readonly definition: VaultViewDefinition; readonly createdAt: string; readonly updatedAt: string; }

export class VaultQueryParser {
  parse(input: string): VaultQueryAst { const text = bounded(input, 16_384, true); const source = (/\bFROM\s+(tasks|notes)\b/i.exec(text)?.[1]?.toLocaleLowerCase() ?? 'notes') as VaultQuerySource; const selectMatch = /^\s*SELECT\s+(.+?)(?=\s+FROM\b|\s+WHERE\b|\s+SORT\b|\s+GROUP\s+BY\b|\s+LIMIT\b|$)/i.exec(text); const select = selectMatch ? selectMatch[1]!.split(',').map(value => safeField(value.trim())) : ['*']; const whereText = clause(text, 'WHERE', ['SORT', 'GROUP BY', 'LIMIT']); const sortText = clause(text, 'SORT', ['GROUP BY', 'LIMIT']); const groupText = clause(text, 'GROUP BY', ['LIMIT']); const limitText = /\bLIMIT\s+(\d+)\b/i.exec(text)?.[1]; const limit = clamp(limitText ? Number(limitText) : 64, 1, VAULT_ADVANCED_MAX_RESULTS); const ast: VaultQueryAst = { version: 1, source, select, ...(whereText ? { where: parseWhere(whereText) } : {}), ...(sortText ? { sort: parseSort(sortText) } : {}), ...(groupText ? { groupBy: safeField(groupText.trim()) } : {}), limit }; return ast; }
  static parse(input: string): VaultQueryAst { return new VaultQueryParser().parse(input); }
}

// Keep parsing deliberately token based. This override also accepts hosts that
// emit lowercase/multiline clauses without relying on regular-expression
// evaluation or any extension-provided code.
VaultQueryParser.prototype.parse = function parseSafeVaultQuery(input: string): VaultQueryAst {
  const text = bounded(input, 16_384, true); const upper = text.toLocaleUpperCase();
  const fromAt = upper.indexOf(' FROM '); const whereAt = upper.indexOf(' WHERE '); const sortAt = upper.indexOf(' SORT '); const groupAt = upper.indexOf(' GROUP BY '); const limitAt = upper.indexOf(' LIMIT ');
  const sourceText = fromAt >= 0 ? text.slice(fromAt + 6, [whereAt, sortAt, groupAt, limitAt, text.length].filter(value => value > fromAt).sort((a, b) => a - b)[0] ?? text.length).trim().split(/[ \t\r\n]+/)[0] : 'notes';
  const source: VaultQuerySource = sourceText.toLocaleLowerCase() === 'tasks' ? 'tasks' : 'notes';
  const selectStart = upper.indexOf('SELECT '); const selectEnd = [fromAt, whereAt, sortAt, groupAt, limitAt, text.length].filter(value => value >= 0).sort((a, b) => a - b)[0] ?? text.length; const select = selectStart >= 0 ? text.slice(selectStart + 7, selectEnd).split(',').map(value => safeField(value.trim())).filter(Boolean) : ['*'];
  const whereText = whereAt >= 0 ? text.slice(whereAt + 7, [sortAt, groupAt, limitAt, text.length].filter(value => value > whereAt).sort((a, b) => a - b)[0] ?? text.length).trim() : undefined;
  const sortText = sortAt >= 0 ? text.slice(sortAt + 6, [groupAt, limitAt, text.length].filter(value => value > sortAt).sort((a, b) => a - b)[0] ?? text.length).trim() : undefined;
  const groupText = groupAt >= 0 ? text.slice(groupAt + 10, [limitAt, text.length].filter(value => value > groupAt).sort((a, b) => a - b)[0] ?? text.length).trim() : undefined;
  const limitText = limitAt >= 0 ? text.slice(limitAt + 7).trim().split(/[ \t\r\n]+/)[0] : undefined; const limit = clamp(limitText ? Number(limitText) : 64, 1, VAULT_ADVANCED_MAX_RESULTS);
  return { version: 1, source, select: select.length ? select : ['*'], ...(whereText ? { where: parseWhere(whereText) } : {}), ...(sortText ? { sort: parseSort(sortText) } : {}), ...(groupText ? { groupBy: safeField(groupText.split(/[ \t\r\n]+/)[0]!) } : {}), limit };
};

export class VaultQueryPlanner {
  plan(ast: VaultQueryAst, options: { readonly maxCost?: number } = {}): VaultQueryPlan { const cost = estimateQueryCost(ast); const max = options.maxCost ?? VAULT_ADVANCED_MAX_QUERY_COST; if (cost > max) throw new VaultError('BOUNDS_EXCEEDED', `Vault query cost ${cost} exceeds bound ${max}`); const warnings: string[] = []; if (!ast.where) warnings.push('Query scans the complete local index'); if (ast.groupBy) warnings.push('Grouping is bounded to the result limit'); return { version: 1, ast: structuredClone(ast), estimatedCost: cost, warnings }; }
}

export interface VaultQueryExecuteOptions { readonly actor?: string; readonly cursor?: string; readonly limit?: number; readonly maxCost?: number; readonly signal?: AbortSignal; readonly timeoutMs?: number; }
export class VaultQueryService {
  private readonly parser = new VaultQueryParser(); private readonly planner = new VaultQueryPlanner(); private readonly views = new Map<string, VaultView>(); private readyPromise: Promise<void>;
  constructor(private readonly vault: VaultService, private readonly taskIndex = new VaultTaskIndexService(vault), private readonly state: VaultAdvancedStateStore = new InMemoryVaultAdvancedStateStore(), private readonly now = Date.now) { this.readyPromise = this.hydrateViews(); }
  async ready(): Promise<void> { await this.readyPromise; }
  parse(query: string | VaultQuery): VaultQueryAst { return typeof query === 'string' ? this.parser.parse(query) : query.ast ?? this.parser.parse(query.text ?? 'SELECT * FROM notes'); }
  plan(query: string | VaultQuery, options?: { readonly maxCost?: number }): VaultQueryPlan { return this.planner.plan(this.parse(query), options); }
  async execute(query: string | VaultQuery, options: VaultQueryExecuteOptions = {}): Promise<VaultQueryResult> { await this.ready(); const ast = this.parse(query); const plan = this.planner.plan(ast, { maxCost: options.maxCost }); const actor = options.actor ?? this.vault.identityId; const rows = ast.source === 'tasks' ? await this.taskRows(actor) : await this.noteRows(actor); const started = Date.now(); const filtered = rows.filter(row => !options.signal?.aborted && matchesCondition(row.values, ast.where) && (options.timeoutMs === undefined || Date.now() - started <= Math.max(1, options.timeoutMs!))); const sorted = ast.sort ? filtered.sort((a, b) => compareValues(a.values[ast.sort!.field], b.values[ast.sort!.field], ast.sort!.direction)) : filtered; const grouped = ast.groupBy ? groupRows(sorted, ast.groupBy) : sorted; const offset = options.cursor ? Math.max(0, Number(options.cursor) || 0) : 0; const limit = clamp(options.limit ?? ast.limit, 1, VAULT_ADVANCED_MAX_RESULTS); const page = grouped.slice(offset, offset + limit).map(row => ({ ...row, values: ast.select.includes('*') ? row.values : pickValues(row.values, ast.select) })); return { version: 1, rows: page, total: grouped.length, ...(offset + page.length < grouped.length ? { nextCursor: String(offset + page.length) } : {}), plan, ...(options.signal?.aborted || (options.timeoutMs !== undefined && Date.now() - started > options.timeoutMs) ? { cancelled: true } : {}) }; }
  async saveView(definition: VaultViewDefinition): Promise<VaultView> { await this.ready(); if (this.views.size >= VAULT_ADVANCED_MAX_VIEWS) throw new VaultError('BOUNDS_EXCEEDED', 'View limit reached'); const id = definition.id ?? randomId('view'); const now = new Date(this.now()).toISOString(); const value: VaultView = { version: 1, id: safeId(id), name: bounded(definition.name, 160, true), definition: structuredClone({ ...definition, id }), createdAt: now, updatedAt: now }; this.planner.plan(typeof definition.query === 'string' ? this.parser.parse(definition.query) : definition.query); this.views.set(id, value); await this.persistViews(); return structuredClone(value); }
  async listViews(): Promise<readonly VaultView[]> { await this.ready(); return [...this.views.values()].sort((a, b) => a.name.localeCompare(b.name)).map(value => structuredClone(value)); }
  viewsList(): Promise<readonly VaultView[]> { return this.listViews(); }
  async getView(id: string): Promise<VaultView | undefined> { await this.ready(); const value = this.views.get(id); return value ? structuredClone(value) : undefined; }
  async deleteView(id: string): Promise<void> { await this.ready(); this.views.delete(id); await this.persistViews(); }
  async executeView(id: string, options: VaultQueryExecuteOptions = {}): Promise<VaultQueryResult> { const view = await this.getView(id); if (!view) throw new VaultError('NOT_FOUND', 'Vault view not found'); return this.execute(typeof view.definition.query === 'string' ? view.definition.query : { version: 1, ast: view.definition.query }, options); }
  async updateProperty(noteId: string, key: string, value: VaultProperty, actor = this.vault.identityId): Promise<MarkdownNote> { const propertyKey = key.startsWith('property.') ? key.slice('property.'.length) : key; if (!/^[A-Za-z_][A-Za-z0-9_-]{0,80}$/.test(propertyKey)) throw new VaultError('INVALID_ARGUMENT', 'Vault property key is invalid'); const note = await this.vault.getNote(noteId, actor); if (!note) throw new VaultError('NOT_FOUND', 'Vault note not found'); return this.vault.updateNote(noteId, { properties: { ...note.frontmatter, [propertyKey]: structuredClone(value) }, baseRevision: note.revision }, actor); }
  async moveBoardCard(viewId: string, noteId: string, value: VaultProperty, actor = this.vault.identityId): Promise<MarkdownNote> { const view = await this.getView(viewId); if (!view || view.definition.kind !== 'BOARD' || !view.definition.boardField) throw new VaultError('INVALID_ARGUMENT', 'View is not a board with a property'); return this.updateProperty(noteId, view.definition.boardField, value, actor); }
  private async noteRows(actor: string): Promise<VaultQueryRow[]> { return (await this.vault.listNotes(actor)).map(note => ({ id: note.id, source: 'notes' as const, noteId: note.id, values: noteValues(note, this.vault.index) })); }
  private async taskRows(actor: string): Promise<VaultQueryRow[]> { return (await this.taskIndex.list(actor)).map(task => ({ id: task.id, source: 'tasks' as const, taskId: task.id, values: taskValues(task) })); }
  private async hydrateViews(): Promise<void> { const raw = await this.state.read('views'); if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { views?: unknown }).views)) return; for (const item of (raw as { views: unknown[] }).views) if (isView(item)) this.views.set(item.id, structuredClone(item)); }
  private async persistViews(): Promise<void> { await this.state.write('views', { version: 1, views: [...this.views.values()] }); }
}
export { VaultQueryService as VaultViewService };

// ---- internal, deliberately non-evaluating helpers ----------------------------------------
function normalizeDailyPolicy(value: Partial<DailyNotePolicy>): DailyNotePolicy { const result = { ...DEFAULT_DAILY_NOTE_POLICY, ...value }; return { version: 1, folder: cleanFolder(result.folder), filenameFormat: safeFilenameFormat(result.filenameFormat), dateFormat: safeFilenameFormat(result.dateFormat ?? 'YYYY-MM-DD').replace(/\.md$/i, ''), ...(result.template === undefined ? {} : { template: bounded(result.template, VAULT_ADVANCED_MAX_TEXT) }), includeCalendarRefs: result.includeCalendarRefs !== false, includeTaskRefs: result.includeTaskRefs !== false, includeActivityRefs: result.includeActivityRefs !== false }; }
function parseDate(value: Date | string): Date { const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value); if (!Number.isFinite(parsed.getTime())) throw new VaultError('INVALID_ARGUMENT', 'Date is invalid'); return parsed; }
function formatDate(date: Date, format: string): string { return format.replace(/YYYY|MM|DD/g, token => token === 'YYYY' ? String(date.getUTCFullYear()).padStart(4, '0') : token === 'MM' ? String(date.getUTCMonth() + 1).padStart(2, '0') : String(date.getUTCDate()).padStart(2, '0')); }
function renderDate(format: string, date: Date): string { return formatDate(date, format).replace(/\.md$/i, '') + (format.toLocaleLowerCase().endsWith('.md') ? '.md' : ''); }
function appendDailyRefs(body: string, refs: readonly string[] | undefined, heading: string): string { if (!refs?.length) return body; return `${body.replace(/\s*$/, '')}\n\n## ${heading}\n${refs.slice(0, 128).map(ref => `- ${ref}`).join('\n')}\n`; }
function cleanFolder(value: string): string { return value.replace(/\\/g, '/').split('/').filter(Boolean).filter(part => part !== '.' && part !== '..').join('/'); }
function safeFilenameFormat(value: string): string { const output = bounded(value, 240, true); if (/[\\/:*?"<>|]/.test(output) || output.includes('..')) throw new VaultError('INVALID_ARGUMENT', 'Filename format is invalid'); return output; }
function inferVariables(content: string): TemplateVariable[] { const names = [...new Set([...content.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,80})\s*\}\}/g)].map(value => value[1]!))]; return names.slice(0, VAULT_ADVANCED_MAX_TEMPLATE_VARIABLES).map(name => ({ name: name as TemplateVariableName, type: name === 'date' ? 'date' : name === 'time' ? 'datetime' : 'string' })); }
function normalizeVariables(values: readonly TemplateVariable[]): TemplateVariable[] { if (values.length > VAULT_ADVANCED_MAX_TEMPLATE_VARIABLES) throw new VaultError('BOUNDS_EXCEEDED', 'Template variable limit reached'); return values.map(value => { if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(value.name)) throw new VaultError('INVALID_ARGUMENT', 'Template variable name is invalid'); return { name: value.name, type: value.type, ...(value.required ? { required: true } : {}) }; }); }
function templateValueMap(context: TemplateExpansionContext): Record<string, string> { const now = context.time instanceof Date ? context.time : context.time ? new Date(context.time) : new Date(); const date = context.date instanceof Date ? context.date : context.date ? new Date(context.date) : now; const value: Record<string, string> = { date: formatDate(parseDate(date), 'YYYY-MM-DD'), time: parseDate(now).toISOString(), title: context.title ?? '', filename: context.filename ?? '', selectedText: context.selectedText ?? '', currentNote: context.currentNote ?? '', currentFolder: context.currentFolder ?? '' }; for (const [key, item] of Object.entries(context)) if (typeof item === 'string') value[key] = item; return value; }
function isTemplate(value: unknown): value is VaultTemplate { return Boolean(value && typeof value === 'object' && (value as VaultTemplate).version === 1 && safeId((value as VaultTemplate).id) && typeof (value as VaultTemplate).name === 'string' && typeof (value as VaultTemplate).content === 'string' && Array.isArray((value as VaultTemplate).variables)); }
function isBookmark(value: unknown): value is VaultBookmark { return Boolean(value && typeof value === 'object' && (value as VaultBookmark).version === 1 && safeId((value as VaultBookmark).id) && typeof (value as VaultBookmark).title === 'string' && typeof (value as VaultBookmark).order === 'number' && !!(value as VaultBookmark).target); }
function isBookmarkGroup(value: unknown): value is VaultBookmarkGroup { return Boolean(value && typeof value === 'object' && safeId((value as VaultBookmarkGroup).id) && typeof (value as VaultBookmarkGroup).name === 'string'); }
function safeExtension(value: { id: string; version: string; integrityHash: string }): boolean { try { safeId(value.id); return Boolean(value.version) && Boolean(value.integrityHash); } catch { return false; } }
function safeId(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) throw new VaultError('INVALID_ARGUMENT', 'Identifier is invalid'); return value; }
function bounded(value: string, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new VaultError('INVALID_ARGUMENT', 'Text is invalid'); return value; }
function randomId(prefix: string): string { const uuid = globalThis.crypto?.randomUUID?.(); if (!uuid) throw new Error('Secure randomness is unavailable'); return `${prefix}-${uuid}`; }
function fuzzyScore(value: string, query: string): number { const haystack = value.toLocaleLowerCase(); if (haystack === query) return 100; if (haystack.includes(query)) return 50 + query.length / Math.max(1, haystack.length); let cursor = 0; let score = 0; for (const char of query) { const index = haystack.indexOf(char, cursor); if (index < 0) return 0; score += index === cursor ? 3 : 1; cursor = index + 1; } return score / Math.max(1, value.length); }
function dedupeQuick(values: readonly QuickSwitchResult[]): QuickSwitchResult[] { const map = new Map<string, QuickSwitchResult>(); for (const value of values) { const old = map.get(value.id); if (!old || old.score < value.score) map.set(value.id, value); } return [...map.values()]; }
function stableTaskId(noteId: string, line: number, text: string): string { let hash = 2166136261; for (const char of `${noteId}:${line}:${text}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `task-${(hash >>> 0).toString(16)}`; }
function clause(text: string, name: string, stops: readonly string[]): string | undefined { const upper = text.toLocaleUpperCase(); const token = name.toLocaleUpperCase(); const start = upper.indexOf(token); if (start < 0) return undefined; const from = start + name.length; let end = text.length; for (const stop of stops) { const candidate = upper.indexOf(stop.toLocaleUpperCase(), from); if (candidate >= 0) end = Math.min(end, candidate); } return text.slice(from, end).trim(); }
function safeField(value: string): VaultQueryField { const clean = value.trim(); if (clean === '*') return '*'; if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,100}$/.test(clean)) throw new VaultError('INVALID_QUERY', `Invalid query field: ${clean}`); return clean as VaultQueryField; }
function parseSort(value: string): NonNullable<VaultQueryAst['sort']> { const parts = value.trim().split(/\s+/); return { field: safeField(parts[0]!), direction: parts[1]?.toLocaleLowerCase() === 'desc' ? 'desc' : 'asc' }; }
function tokenizeWhere(value: string): string[] { const normalized = value.replace(/[()]/g, ' $& ').replace(/>=|<=|!=|=|>|</g, ' $& '); return normalized.trim().split(/[ \t\r\n]+/).filter(Boolean); }
function parseWhere(value: string): VaultQueryCondition { const tokens = tokenizeWhere(value); let index = 0; const peek = () => tokens[index]?.toLocaleUpperCase(); const consume = () => tokens[index++]; const primary = (): VaultQueryCondition => { if (peek() === 'NOT') { consume(); return { op: 'not', left: primary() }; } if (peek() === '(') { consume(); const result = or(); if (consume() !== ')') throw new VaultError('INVALID_QUERY', 'Unclosed WHERE expression'); return result; } const field = safeField(consume() ?? ''); const op = consume()?.toLocaleUpperCase(); if (op === 'EXISTS') return { op: 'exists', field }; if (op === 'CONTAINS') return { op: 'contains', field, value: unquoteQuery(consume() ?? '') }; if (!op || !['=', '!=', '>', '>=', '<', '<='].includes(op)) throw new VaultError('INVALID_QUERY', 'Invalid WHERE comparator'); return { op: 'comparison', field, comparator: op as VaultQueryCondition['comparator'], value: parseQueryValue(unquoteQuery(consume() ?? '')) }; }; const and = (): VaultQueryCondition => { let result = primary(); while (peek() === 'AND') { consume(); result = { op: 'and', left: result, right: primary() }; } return result; }; const or = (): VaultQueryCondition => { let result = and(); while (peek() === 'OR') { consume(); result = { op: 'or', left: result, right: and() }; } return result; }; if (!tokens.length) throw new VaultError('INVALID_QUERY', 'WHERE expression is empty'); const result = or(); if (index !== tokens.length) throw new VaultError('INVALID_QUERY', 'Unexpected WHERE token'); return result; }
function unquoteQuery(value: string): string { return value.replace(/^(['"])(.*)\1$/, '$2'); }
function parseQueryValue(value: string): VaultQueryValue { if (value === 'true' || value === 'false') return value === 'true'; if (value === 'null') return null; if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value); return value; }
function estimateQueryCost(ast: VaultQueryAst): number { let cost = ast.limit * (ast.select.length + 1); const walk = (condition?: VaultQueryCondition): number => !condition ? 5_000 : condition.op === 'and' || condition.op === 'or' ? 2 + walk(condition.left) + walk(condition.right) : condition.op === 'not' ? 1 + walk(condition.left) : 8; return cost + walk(ast.where) + (ast.sort ? 2_000 : 0) + (ast.groupBy ? 2_000 : 0); }
function noteValues(note: VaultNoteIndex, index: VaultIndex): Readonly<Record<string, VaultQueryValue>> { const backlinks = index.links.backlinks[note.id]?.length ?? 0; return { id: note.id, title: note.title, path: note.path, folder: note.parentPath, tags: note.tags, links: note.links.map(value => value.target), backlinks, modified: note.modifiedAt, created: note.modifiedAt, text: note.searchText, status: 'note', completed: false, ...Object.fromEntries(Object.entries(note.properties).map(([key, value]) => [`property.${key}`, value.value])) }; }
function taskValues(task: VaultTask): Readonly<Record<string, VaultQueryValue>> { return { id: task.id, title: task.text, path: task.path, folder: task.path.includes('/') ? task.path.slice(0, task.path.lastIndexOf('/')) : '', tags: task.tags, links: task.references, backlinks: 0, modified: '', created: '', text: task.text, due: task.due ?? null, priority: task.priority ?? null, completed: task.completed, status: task.completed ? 'done' : 'todo' }; }
function matchesCondition(values: Readonly<Record<string, VaultQueryValue>>, condition?: VaultQueryCondition): boolean { if (!condition) return true; if (condition.op === 'and') return matchesCondition(values, condition.left) && matchesCondition(values, condition.right); if (condition.op === 'or') return matchesCondition(values, condition.left) || matchesCondition(values, condition.right); if (condition.op === 'not') return !matchesCondition(values, condition.left); const current = condition.field ? values[condition.field] : undefined; if (condition.op === 'exists') return current !== undefined && current !== null && current !== ''; if (condition.op === 'contains') return Array.isArray(current) ? current.some(value => String(value).toLocaleLowerCase().includes(String(condition.value).toLocaleLowerCase())) : String(current ?? '').toLocaleLowerCase().includes(String(condition.value ?? '').toLocaleLowerCase()); return compareScalar(current, condition.value, condition.comparator!); }
function compareScalar(left: VaultQueryValue | undefined, right: VaultQueryValue | undefined, op: NonNullable<VaultQueryCondition['comparator']>): boolean { const a = Array.isArray(left) ? left.join(' ') : left; const b = Array.isArray(right) ? right.join(' ') : right; if (op === '=') return String(a ?? '').toLocaleLowerCase() === String(b ?? '').toLocaleLowerCase(); if (op === '!=') return !compareScalar(left, right, '='); const an = typeof a === 'number' ? a : Date.parse(String(a)); const bn = typeof b === 'number' ? b : Date.parse(String(b)); const x = Number.isFinite(an) && Number.isFinite(bn) ? an : String(a ?? ''); const y = Number.isFinite(an) && Number.isFinite(bn) ? bn : String(b ?? ''); if (op === '>') return x > y; if (op === '>=') return x >= y; if (op === '<') return x < y; return x <= y; }
function compareValues(a: VaultQueryValue | undefined, b: VaultQueryValue | undefined, direction: 'asc' | 'desc'): number { const left = Array.isArray(a) ? a.join(' ') : a ?? ''; const right = Array.isArray(b) ? b.join(' ') : b ?? ''; const result = String(left).localeCompare(String(right), undefined, { numeric: true }); return direction === 'desc' ? -result : result; }
function pickValues(values: Readonly<Record<string, VaultQueryValue>>, fields: readonly VaultQueryField[]): Readonly<Record<string, VaultQueryValue>> { return Object.fromEntries(fields.filter(field => field !== '*').map(field => [field, values[field] ?? null])); }
function groupRows(rows: readonly VaultQueryRow[], field: VaultQueryField): VaultQueryRow[] { const groups = new Map<string, VaultQueryRow[]>(); for (const row of rows) { const value = row.values[field]; const key = Array.isArray(value) ? value.join(',') : value === null || value === undefined ? '' : String(value); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); } return [...groups.entries()].map(([key, group]) => { const first = group[0]!; return { ...first, values: { ...first.values, group: key, groupCount: group.length } }; }); }
function isView(value: unknown): value is VaultView { return Boolean(value && typeof value === 'object' && (value as VaultView).version === 1 && safeId((value as VaultView).id) && typeof (value as VaultView).name === 'string' && ['LIST', 'TABLE', 'BOARD'].includes((value as VaultView).definition?.kind)); }
function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min; }
