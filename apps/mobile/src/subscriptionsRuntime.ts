/** Mobile host boundary for R0P89. No origin request or media file access is
 * performed by the screen; the installed runtime owns the core service. */

export interface MobileSubscription { readonly id: string; readonly title: string; readonly hostname: string; readonly state: string; readonly unreadCount: number; readonly folderIds: readonly string[]; }
export interface MobileSubscriptionFolder { readonly id: string; readonly name: string; }
export interface MobileSubscriptionEnclosure { readonly id: string; readonly kind: 'AUDIO' | 'VIDEO' | 'OTHER'; readonly mimeType?: string; readonly title?: string; readonly downloadState?: string; readonly bytesDownloaded?: number; readonly totalBytes?: number; }
export interface MobileSubscriptionEntry { readonly id: string; readonly subscriptionId: string; readonly subscriptionTitle: string; readonly title: string; readonly url?: string; readonly author?: string; readonly contentText: string; readonly readState: 'UNREAD' | 'READ'; readonly favorite: boolean; readonly firstSeenAt: string; readonly publishedAt?: string; readonly enclosures: readonly MobileSubscriptionEnclosure[]; }
export interface MobileSubscriptionPage { readonly items: readonly MobileSubscriptionEntry[]; readonly total: number; readonly unreadCount: number; readonly nextCursor?: string; }
export interface MobileSubscriptionReader { readonly entry: MobileSubscriptionEntry; readonly text: string; readonly safeHtml: string; readonly externalRequestCount: 0; readonly scriptsExecuted: 0; readonly formsSubmitted: 0; }

export interface MobileSubscriptionsRuntime {
  listSubscriptions(): Promise<readonly MobileSubscription[]>;
  listFolders(): Promise<readonly MobileSubscriptionFolder[]>;
  listEntries(input?: { readonly readState?: 'UNREAD' | 'READ'; readonly favorite?: boolean; readonly podcastsOnly?: boolean; readonly query?: string; readonly limit?: number }): Promise<MobileSubscriptionPage>;
  reader(entryId: string): Promise<MobileSubscriptionReader | undefined>;
  add?(input: { readonly url: string; readonly ownerConfirmed: true; readonly allowPrivateNetwork?: true }): Promise<MobileSubscription>;
  refresh?(subscriptionId: string): Promise<unknown>;
  markRead?(entryId: string, read?: boolean): Promise<MobileSubscriptionEntry>;
  setFavorite?(entryId: string, favorite: boolean): Promise<MobileSubscriptionEntry>;
  openOriginal?(entryId: string): Promise<void>;
  saveArticle?(entryId: string): Promise<MobileSubscriptionEntry>;
  shareEntry?(entryId: string): Promise<void>;
  continueEntry?(entryId: string, input: { readonly kind: 'ARTICLE' | 'PODCAST'; readonly enclosureId?: string }): Promise<void>;
  downloadEnclosure?(entryId: string, enclosureId: string): Promise<MobileSubscriptionEntry>;
  playEnclosure?(entryId: string, enclosureId: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileSubscriptionsRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileSubscriptionsRuntime(runtime: MobileSubscriptionsRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileSubscriptionsRuntime(): MobileSubscriptionsRuntime | undefined { return current; }
export function subscribeMobileSubscriptionsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
