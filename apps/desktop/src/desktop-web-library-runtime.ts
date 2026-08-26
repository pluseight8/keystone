/** Host-boundary projection for R0P87 Web Library.  The desktop shell never
 * reads archive storage or origin pages directly; a host installs this
 * adapter with WebLibraryService + BrowserRuntimeWebCaptureAdapter. */

export type DesktopWebLibraryMode = 'BOOKMARK_ONLY' | 'READER_SNAPSHOT' | 'SAFE_PAGE_ARCHIVE';
export type DesktopWebLibraryReadState = 'UNREAD' | 'READ';

export interface DesktopWebLibraryEntry {
  readonly id: string;
  readonly kind: 'BOOKMARK' | 'ARCHIVE';
  readonly title: string;
  readonly sourceUrl: string;
  readonly tags: readonly string[];
  readonly collectionIds: readonly string[];
  readonly favorite: boolean;
  readonly readState: DesktopWebLibraryReadState;
  readonly revisionCount: number;
  readonly latestRevisionId?: string;
  readonly offlineStatus: 'AVAILABLE' | 'PARTIAL' | 'BOOKMARK_ONLY' | 'UNAVAILABLE';
  readonly updatedAt: string;
}

export interface DesktopWebLibraryCollection { readonly id: string; readonly name: string; readonly isSystem: boolean; }
export interface DesktopWebLibraryRevision { readonly id: string; readonly revisionNumber: number; readonly capturedAt: string; readonly state: 'READY' | 'PARTIAL' | 'FAILED'; readonly title: string; readonly sourceUrl: string; readonly wordCount: number; }
export interface DesktopWebLibraryReader { readonly entry: DesktopWebLibraryEntry; readonly revision?: DesktopWebLibraryRevision; readonly text: string; readonly html: string; readonly externalLinks: readonly { readonly url: string; readonly label: string }[]; readonly missingResources: number; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0; }
export interface DesktopWebLibrarySearchResult { readonly entry: DesktopWebLibraryEntry; readonly score: number; readonly matchedFields: readonly string[]; readonly snippet: string; }

export interface DesktopWebLibraryRuntime {
  list(query?: { readonly collectionId?: string; readonly readState?: DesktopWebLibraryReadState; readonly favorite?: boolean }): Promise<readonly DesktopWebLibraryEntry[]>;
  search(query: string): Promise<readonly DesktopWebLibrarySearchResult[]>;
  collections(): Promise<readonly DesktopWebLibraryCollection[]>;
  reader(entryId: string, revisionId?: string): Promise<DesktopWebLibraryReader | undefined>;
  revisions?(entryId: string): Promise<readonly DesktopWebLibraryRevision[]>;
  saveBookmark?(input: { readonly url: string; readonly title?: string; readonly tags?: readonly string[]; readonly favorite?: boolean }): Promise<DesktopWebLibraryEntry>;
  captureFromBrowser?(input: { readonly url: string; readonly title?: string; readonly mode: Exclude<DesktopWebLibraryMode, 'BOOKMARK_ONLY'> }): Promise<DesktopWebLibraryEntry>;
  refresh?(entryId: string, mode?: Exclude<DesktopWebLibraryMode, 'BOOKMARK_ONLY'>): Promise<DesktopWebLibraryEntry>;
  setReadState?(entryId: string, state: DesktopWebLibraryReadState): Promise<DesktopWebLibraryEntry>;
  setFavorite?(entryId: string, favorite: boolean): Promise<DesktopWebLibraryEntry>;
  addHighlight?(input: { readonly entryId: string; readonly revisionId: string; readonly start: number; readonly end: number; readonly quote: string; readonly note?: string }): Promise<unknown>;
  addNote?(input: { readonly entryId: string; readonly revisionId: string; readonly body: string }): Promise<unknown>;
  shareArchive?(entryId: string, revisionId?: string): Promise<void>;
  continueOnDevice?(entryId: string, revisionId?: string): Promise<void>;
  exportToVault?(entryId: string, revisionId?: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

let runtime: DesktopWebLibraryRuntime | undefined;
const listeners = new Set<() => void>();

export function getDesktopWebLibraryRuntime(): DesktopWebLibraryRuntime | undefined { return runtime; }
export function setDesktopWebLibraryRuntime(next: DesktopWebLibraryRuntime | undefined): void { runtime = next; for (const listener of listeners) listener(); }
export function subscribeDesktopWebLibraryRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
