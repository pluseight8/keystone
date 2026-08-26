export type InboxItemId = string & { readonly __inboxItemId: unique symbol };
export type InboxSourceKind = 'keystone' | 'mail' | 'calls' | 'collaboration' | 'continuity' | 'nearby' | 'agents' | 'approvals' | 'automation' | 'calendar' | 'workboard' | 'security' | 'system' | 'web' | 'plugin';
export type InboxItemKind = 'MESSAGE' | 'EMAIL' | 'CALL' | 'MENTION' | 'COMMENT' | 'INVITATION' | 'TRANSFER' | 'HANDOFF' | 'AGENT_RESULT' | 'APPROVAL' | 'AUTOMATION_ALERT' | 'CALENDAR' | 'TASK' | 'SECURITY' | 'SYSTEM_ATTENTION';
export type InboxActionKind = 'OPEN_SOURCE' | 'REPLY_MESSAGE' | 'REPLY_MAIL' | 'ACCEPT_INVITATION' | 'DECLINE_INVITATION' | 'ACCEPT_NEARBY' | 'REJECT_NEARBY' | 'OPEN_HANDOFF' | 'CALL_BACK' | 'APPROVE' | 'REJECT_APPROVAL' | 'OPEN_CALENDAR' | 'OPEN_TASK' | 'OPEN_AGENT_RESULT';
export type InboxView = 'ALL' | 'UNREAD' | 'NEEDS_ACTION' | 'SNOOZED' | 'ARCHIVE';
export interface InboxListOptions { readonly view?: InboxView; readonly sourceKind?: InboxSourceKind; readonly itemKind?: InboxItemKind; readonly query?: string; readonly groupKey?: string; readonly accountId?: string; readonly limit?: number; readonly cursor?: string; }
export interface DesktopInboxAction { readonly id: string; readonly kind: InboxActionKind; readonly label: string; readonly requiresOwnerConfirmation: boolean; }
export interface DesktopInboxItem { readonly id: InboxItemId; readonly kind: InboxItemKind; readonly sourceState: string; readonly presentation: { readonly badge: { readonly label: string }; readonly title: string; readonly snippet?: string; readonly sender?: string; readonly receivedAt: string; readonly reasons: readonly string[] }; readonly organization: { readonly read: boolean; readonly archived: boolean; readonly pinned: boolean; readonly saved: boolean }; readonly actions: readonly DesktopInboxAction[]; }
export interface InboxListResult { readonly items: readonly DesktopInboxItem[]; readonly nextCursor?: string; readonly total: number; readonly unreadCount: number; readonly actionRequiredCount: number; readonly groups: readonly { readonly id: string; readonly key: string; readonly count: number; readonly unreadCount: number; readonly actionCount: number }[]; }

export interface DesktopInboxService {
  list(options?: InboxListOptions): Promise<InboxListResult>;
  search(query: string, options?: Omit<InboxListOptions, 'query'>): Promise<InboxListResult>;
  markRead(itemId: InboxItemId, read?: boolean): Promise<boolean>;
  archive(itemId: InboxItemId): Promise<boolean>;
  restore(itemId: InboxItemId): Promise<boolean>;
  snooze(itemId: InboxItemId, until: string | Date): Promise<boolean>;
  pin(itemId: InboxItemId, pinned?: boolean): Promise<boolean>;
  save(itemId: InboxItemId, saved?: boolean): Promise<boolean>;
  executeAction(input: { readonly itemId: InboxItemId; readonly action: InboxActionKind; readonly ownerConfirmed?: boolean; readonly send?: boolean; readonly replyAll?: boolean; readonly bodyText?: string }): Promise<unknown>;
  openSource(itemId: InboxItemId): Promise<unknown>;
  subscribe(listener: () => void): () => void;
  diagnostics?(): { readonly itemCount: number; readonly unreadCount: number; readonly actionRequiredCount: number; readonly adapterCount: number; readonly healthyAdapters: number; readonly unavailableAdapters: readonly InboxSourceKind[] };
}

export interface DesktopInboxRuntime { readonly inbox: DesktopInboxService; }

let current: DesktopInboxRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopInboxRuntime(runtime: DesktopInboxRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopInboxRuntime(): DesktopInboxRuntime | undefined { return current; }
export function subscribeDesktopInboxRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
