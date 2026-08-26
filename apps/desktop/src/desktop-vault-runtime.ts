/** Typed host boundary for the desktop Vault surface. The shell never touches
 * Node/Tauri filesystem APIs and stays usable before a host installs a runtime. */
export interface DesktopVaultNote {
  readonly id: string;
  readonly vaultId: string;
  readonly path: string;
  readonly title: string;
  readonly content: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly headings: readonly { readonly id: string; readonly level: number; readonly text: string; readonly line: number }[];
  readonly properties: Readonly<Record<string, { readonly type: string; readonly value: string | number | boolean | readonly string[] }>>;
  readonly revision: number;
  readonly modifiedAt: string;
}

export interface DesktopVaultSearchResult { readonly note: Pick<DesktopVaultNote, 'id' | 'path' | 'title' | 'tags' | 'modifiedAt'>; readonly score: number; readonly snippet: string; }
export interface DesktopVaultEntry { readonly id: string; readonly path: string; readonly kind: 'note' | 'attachment' | 'folder'; readonly name: string; readonly parentPath: string; readonly missing?: boolean; }
export interface DesktopVaultGraphNode { readonly id: string; readonly kind: string; readonly label: string; readonly path?: string; readonly unresolved?: boolean; readonly metadata?: Readonly<Record<string, unknown>>; }
export interface DesktopVaultGraphEdge { readonly id: string; readonly source: string; readonly target: string; readonly kind: string; readonly directed: boolean; readonly label?: string; }
export interface DesktopVaultGraphProjection { readonly nodes: readonly DesktopVaultGraphNode[]; readonly edges: readonly DesktopVaultGraphEdge[]; readonly selectedNodeId?: string; readonly orphanNodeIds: readonly string[]; readonly unresolvedNodeIds: readonly string[]; readonly truncated: boolean; readonly nextCursor?: string; }
export interface DesktopVaultGraphRuntime { readonly global: (vaultId: string, query?: { readonly text?: string; readonly depth?: number; readonly limitNodes?: number; readonly limitEdges?: number; readonly includeUnresolved?: boolean }) => Promise<DesktopVaultGraphProjection>; readonly local?: (vaultId: string, noteId: string, depth?: number) => Promise<DesktopVaultGraphProjection>; readonly orphans?: (vaultId: string) => Promise<readonly DesktopVaultGraphNode[]>; readonly unresolved?: (vaultId: string) => Promise<readonly DesktopVaultGraphNode[]>; }
export interface DesktopVaultCanvasNode { readonly id: string; readonly kind: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly title?: string; readonly text?: string; readonly reference?: Readonly<Record<string, unknown>>; }
export interface DesktopVaultCanvasEdge { readonly id: string; readonly sourceNodeId: string; readonly targetNodeId: string; readonly directed: boolean; readonly label?: string; }
export interface DesktopVaultCanvasDocument { readonly id: string; readonly vaultId: string; readonly revision: number; readonly metadata: { readonly title: string; readonly [key: string]: unknown }; readonly nodes: readonly DesktopVaultCanvasNode[]; readonly edges: readonly DesktopVaultCanvasEdge[]; readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number }; }
export interface DesktopVaultCanvasRuntime { readonly list: (vaultId: string) => Promise<readonly Pick<DesktopVaultCanvasDocument, 'id' | 'revision' | 'metadata'>[]>; readonly open: (vaultId: string, canvasId: string) => Promise<DesktopVaultCanvasDocument | undefined>; readonly create?: (vaultId: string, title: string) => Promise<DesktopVaultCanvasDocument>; readonly mutate?: (vaultId: string, canvasId: string, mutation: unknown) => Promise<DesktopVaultCanvasDocument>; readonly undo?: (vaultId: string, canvasId: string) => Promise<DesktopVaultCanvasDocument>; readonly redo?: (vaultId: string, canvasId: string) => Promise<DesktopVaultCanvasDocument>; }
export interface DesktopVaultTransclusionRender { readonly rendered: string; readonly truncated: boolean; readonly diagnostics: readonly string[]; readonly fragments: readonly { readonly id: string; readonly kind: string; readonly provenance: Readonly<Record<string, unknown>> }[]; }
/** Optional Phase 54 host adapters. These are declarations only; the shell
 * never evaluates templates, queries, CRDT updates or extension code itself. */
export interface DesktopAdvancedVaultRuntime {
  readonly daily?: { readonly openToday: (vaultId: string) => Promise<{ readonly noteId: string; readonly path: string }>; readonly open: (vaultId: string, date: string) => Promise<{ readonly noteId: string; readonly path: string }> };
  readonly templates?: { readonly list: (vaultId: string) => Promise<readonly { readonly id: string; readonly name: string }[]>; readonly expand: (vaultId: string, templateId: string, context: Readonly<Record<string, string>>) => Promise<{ readonly content: string; readonly diagnostics: readonly string[] }> };
  readonly bookmarks?: { readonly list: (vaultId: string) => Promise<readonly { readonly id: string; readonly title: string; readonly target: unknown; readonly pinned: boolean }[]>; readonly open: (vaultId: string, bookmarkId: string) => Promise<void> };
  readonly quickSwitcher?: { readonly search: (vaultId: string, query: string, limit?: number) => Promise<readonly { readonly id: string; readonly kind: string; readonly label: string; readonly score: number }[]> };
  readonly queries?: { readonly execute: (vaultId: string, query: string, options?: { readonly cursor?: string; readonly limit?: number }) => Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly nextCursor?: string; readonly total: number }>; readonly views: (vaultId: string) => Promise<readonly { readonly id: string; readonly name: string; readonly kind: 'LIST' | 'TABLE' | 'BOARD' }[]> };
  readonly tasks?: { readonly list: (vaultId: string) => Promise<readonly { readonly id: string; readonly noteId: string; readonly text: string; readonly completed: boolean; readonly due?: string }[]>; readonly toggle: (vaultId: string, taskId: string, completed: boolean) => Promise<void> };
  readonly shared?: { readonly list: () => Promise<readonly { readonly id: string; readonly title: string; readonly visibility: string; readonly epoch: number }[]>; readonly open: (vaultId: string) => Promise<void>; readonly status?: (vaultId: string) => Promise<{ readonly state: 'SYNCED' | 'SYNCING' | 'OFFLINE' | 'REVOKED' | 'CONFLICT'; readonly members: number }> };
}
export interface DesktopVaultRuntime {
  readonly listVaults: () => Promise<readonly { readonly id: string; readonly name: string; readonly visibility: string }[]>;
  readonly listNotes: (vaultId: string) => Promise<readonly Pick<DesktopVaultNote, 'id' | 'path' | 'title' | 'modifiedAt'>[]>;
  readonly listEntries?: (vaultId: string) => Promise<readonly DesktopVaultEntry[]>;
  readonly getNote: (vaultId: string, noteId: string) => Promise<DesktopVaultNote | undefined>;
  readonly search: (vaultId: string, query: string) => Promise<readonly DesktopVaultSearchResult[]>;
  readonly backlinks?: (vaultId: string, noteId: string) => Promise<readonly { readonly sourceNoteId: string; readonly sourcePath: string; readonly target: string }[]>;
  readonly createNote?: (vaultId: string, input: { readonly path: string; readonly title?: string; readonly content?: string }) => Promise<DesktopVaultNote>;
  readonly createFolder?: (vaultId: string, path: string) => Promise<void>;
  readonly updateNote?: (vaultId: string, noteId: string, input: { readonly content: string; readonly baseRevision?: number }) => Promise<DesktopVaultNote>;
  readonly renameNote?: (vaultId: string, noteId: string, path: string) => Promise<DesktopVaultNote>;
  readonly deleteNote?: (vaultId: string, noteId: string) => Promise<void>;
  readonly graph?: DesktopVaultGraphRuntime;
  readonly canvas?: DesktopVaultCanvasRuntime;
  readonly renderTransclusion?: (vaultId: string, noteId: string) => Promise<DesktopVaultTransclusionRender>;
  readonly advanced?: DesktopAdvancedVaultRuntime;
  readonly subscribe?: (listener: () => void) => () => void;
}

let current: DesktopVaultRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopVaultRuntime(runtime: DesktopVaultRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopVaultRuntime(): DesktopVaultRuntime | undefined { return current; }
export function subscribeDesktopVaultRuntime(listener: () => void): () => void { listeners.add(listener); const runtimeUnsubscribe = current?.subscribe?.(listener); return () => { listeners.delete(listener); runtimeUnsubscribe?.(); }; }
