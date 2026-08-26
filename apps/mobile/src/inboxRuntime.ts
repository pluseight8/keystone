import type {
  InboxActionKind,
  InboxItemId,
  InboxListOptions,
  InboxListResult,
  InboxSourceKind,
  UniversalInboxService,
} from '@keystone/core';

export interface MobileInboxService {
  list(options?: InboxListOptions): Promise<InboxListResult>;
  markRead(itemId: InboxItemId, read?: boolean): Promise<boolean>;
  archive(itemId: InboxItemId): Promise<boolean>;
  restore(itemId: InboxItemId): Promise<boolean>;
  pin(itemId: InboxItemId, pinned?: boolean): Promise<boolean>;
  snooze(itemId: InboxItemId, until: string | Date): Promise<boolean>;
  executeAction(input: { readonly itemId: InboxItemId; readonly action: InboxActionKind; readonly ownerConfirmed?: boolean; readonly send?: boolean; readonly replyAll?: boolean; readonly bodyText?: string }): Promise<unknown>;
  openSource(itemId: InboxItemId): Promise<unknown>;
  subscribe(listener: () => void): () => void;
  diagnostics?(): { readonly itemCount: number; readonly unreadCount: number; readonly actionRequiredCount: number; readonly adapterCount: number; readonly healthyAdapters: number; readonly unavailableAdapters: readonly InboxSourceKind[] };
}

export interface MobileInboxRuntime { readonly inbox: MobileInboxService; }

let current: MobileInboxRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileInboxRuntime(runtime: MobileInboxRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileInboxRuntime(): MobileInboxRuntime | undefined { return current; }
export function subscribeMobileInboxRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function createMobileInboxRuntime(inbox: UniversalInboxService): MobileInboxRuntime { return { inbox }; }
