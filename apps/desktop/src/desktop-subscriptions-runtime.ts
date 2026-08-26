/** Host-boundary projection for R0P89 Feeds, Subscriptions and Podcasts.
 * The shell receives safe local projections and invokes explicit service
 * actions; it never fetches an origin or reads enclosure storage itself. */

export type DesktopSubscriptionReadState = 'UNREAD' | 'READ';
export type DesktopSubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'ERROR' | 'AUTH_REQUIRED' | 'DISABLED';
export type DesktopSubscriptionEnclosureKind = 'AUDIO' | 'VIDEO' | 'OTHER';

export interface DesktopSubscription {
  readonly id: string;
  readonly title: string;
  readonly hostname: string;
  readonly canonicalUrl: string;
  readonly state: DesktopSubscriptionStatus;
  readonly folderIds: readonly string[];
  readonly format?: 'RSS_2_0' | 'ATOM_1_0' | 'JSON_FEED';
  readonly unreadCount: number;
  readonly notifyOnNewItems: boolean;
  readonly autoDownloadEpisodes: boolean;
  readonly lastSuccessfulRefreshAt?: string;
  readonly nextRefreshAt?: string;
  readonly lastError?: { readonly code: string; readonly message: string; readonly at: string };
}

export interface DesktopSubscriptionFolder { readonly id: string; readonly name: string; readonly subscriptionCount: number; }
export interface DesktopSubscriptionEnclosure { readonly id: string; readonly kind: DesktopSubscriptionEnclosureKind; readonly mimeType?: string; readonly title?: string; readonly durationMs?: number; readonly download?: { readonly state: string; readonly bytesDownloaded: number; readonly totalBytes?: number; readonly playbackPositionMs?: number }; }
export interface DesktopSubscriptionEntry { readonly id: string; readonly subscriptionId: string; readonly subscriptionTitle: string; readonly title: string; readonly url?: string; readonly author?: string; readonly publishedAt?: string; readonly firstSeenAt: string; readonly readState: DesktopSubscriptionReadState; readonly favorite: boolean; readonly categories: readonly string[]; readonly contentText: string; readonly hasHtml: boolean; readonly enclosures: readonly DesktopSubscriptionEnclosure[]; readonly savedWebLibraryEntryId?: string; }
export interface DesktopSubscriptionPage { readonly items: readonly DesktopSubscriptionEntry[]; readonly nextCursor?: string; readonly total: number; readonly unreadCount: number; }
export interface DesktopSubscriptionReader { readonly entry: DesktopSubscriptionEntry; readonly safeHtml: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0; }

export interface DesktopSubscriptionsRuntime {
  listSubscriptions(): Promise<readonly DesktopSubscription[]>;
  listFolders(): Promise<readonly DesktopSubscriptionFolder[]>;
  listEntries(input?: { readonly folderId?: string; readonly subscriptionId?: string; readonly readState?: DesktopSubscriptionReadState; readonly favorite?: boolean; readonly podcastsOnly?: boolean; readonly query?: string; readonly limit?: number; readonly cursor?: string }): Promise<DesktopSubscriptionPage>;
  search(query: string, options?: { readonly limit?: number }): Promise<readonly DesktopSubscriptionEntry[]>;
  reader(entryId: string): Promise<DesktopSubscriptionReader | undefined>;
  add?(input: { readonly url: string; readonly title?: string; readonly folderIds?: readonly string[]; readonly ownerConfirmed: true; readonly allowPrivateNetwork?: true }): Promise<DesktopSubscription>;
  refresh?(subscriptionId: string): Promise<unknown>;
  pause?(subscriptionId: string): Promise<DesktopSubscription>;
  resume?(subscriptionId: string): Promise<DesktopSubscription>;
  setNotificationPolicy?(subscriptionId: string, enabled: boolean): Promise<DesktopSubscription>;
  markRead?(entryId: string, read?: boolean): Promise<DesktopSubscriptionEntry>;
  setFavorite?(entryId: string, favorite: boolean): Promise<DesktopSubscriptionEntry>;
  openOriginal?(entryId: string): Promise<void>;
  shareEntry?(entryId: string): Promise<void>;
  saveArticle?(entryId: string): Promise<DesktopSubscriptionEntry>;
  continueEntry?(entryId: string, input: { readonly kind: 'ARTICLE' | 'PODCAST'; readonly enclosureId?: string; readonly positionMs?: number }): Promise<void>;
  downloadEnclosure?(entryId: string, enclosureId: string): Promise<DesktopSubscriptionEntry>;
  playEnclosure?(entryId: string, enclosureId: string): Promise<void>;
  setPlaybackPosition?(entryId: string, enclosureId: string, positionMs: number): Promise<DesktopSubscriptionEntry>;
  previewOpml?(input: string | Uint8Array): Promise<unknown> | unknown;
  importOpml?(input: unknown, ownerConfirmed: true): Promise<unknown>;
  exportOpml?(): Promise<string> | string;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopSubscriptionsRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopSubscriptionsRuntime(runtime: DesktopSubscriptionsRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopSubscriptionsRuntime(): DesktopSubscriptionsRuntime | undefined { return current; }
export function subscribeDesktopSubscriptionsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
