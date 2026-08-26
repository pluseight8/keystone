/**
 * R0P88 Universal Inbox, Communications Hub and Action Center.
 *
 * Inbox is a bounded local projection.  Source services remain authoritative
 * for content, permissions and source mutations.  This module stores only a
 * safe presentation snapshot plus owner-local organization state; it never
 * introduces a transport, central notification server or source database.
 */

import type { NotificationRecord, NotificationService } from './social/notifications.js';
import type { MailMessage, MailService } from './mail.js';
import type { CallHistoryEntry } from './webrtc/calls.js';
import type { CollaborationComment, CollaborationInvitation } from './collaboration.js';
import type { ContinuityService, DeviceInboxItem } from './continuity.js';
import type { NearbyExchangeService, NearbyOffer, NearbyTransfer } from './nearby-exchange.js';
import type { DailyContextItem, DailyContextSource, DailyContextWindow, DailyContextOwnerContext } from './daily-layer.js';

export const INBOX_PROTOCOL = 'keystone.inbox.r0p88' as const;
export const INBOX_VERSION = 1 as const;
export const INBOX_MAX_ITEMS = 100_000;
export const INBOX_MAX_PAGE = 128;
export const INBOX_MAX_SNIPPET = 280;
export const INBOX_MAX_TITLE = 998;
export const INBOX_MAX_SOURCE_ID = 512;
export const INBOX_MAX_GROUP_KEY = 256;
export const INBOX_MAX_SNOOZE_MS = 30 * 24 * 60 * 60_000;
export const INBOX_MAX_ACTIONS = 12;
export const INBOX_MAX_BULK_ITEMS = 1_000;

export type InboxItemId = string & { readonly __inboxItemId: unique symbol };
export type InboxGroupId = string & { readonly __inboxGroupId: unique symbol };
export type InboxActionId = string & { readonly __inboxActionId: unique symbol };

export type InboxSourceKind =
  | 'keystone'
  | 'mail'
  | 'calls'
  | 'collaboration'
  | 'continuity'
  | 'nearby'
  | 'agents'
  | 'approvals'
  | 'automation'
  | 'calendar'
  | 'workboard'
  | 'security'
  | 'system'
  | 'web'
  | 'files'
  | 'subscriptions'
  | 'plugin';

export type InboxItemKind =
  | 'MESSAGE'
  | 'EMAIL'
  | 'CALL'
  | 'MENTION'
  | 'COMMENT'
  | 'INVITATION'
  | 'TRANSFER'
  | 'HANDOFF'
  | 'AGENT_RESULT'
  | 'APPROVAL'
  | 'AUTOMATION_ALERT'
  | 'CALENDAR'
  | 'TASK'
  | 'SECURITY'
  | 'FEED_ITEM'
  | 'FILE_CONFLICT'
  | 'SYSTEM_ATTENTION';

export type InboxPriority = 'security' | 'approval' | 'time-sensitive' | 'communication' | 'completion' | 'informational';
export type InboxDataClass = 'public' | 'private' | 'sensitive' | 'security';
export type InboxSourceState = 'available' | 'unavailable' | 'stale' | 'revoked' | 'removed';
export type InboxView = 'ALL' | 'UNREAD' | 'NEEDS_ACTION' | 'SNOOZED' | 'ARCHIVE';
export type InboxOrganizationAction = 'READ' | 'UNREAD' | 'ARCHIVE' | 'RESTORE' | 'DISMISS' | 'SNOOZE' | 'UNSNOOZE' | 'PIN' | 'UNPIN' | 'SAVE' | 'UNSAVE';
export type InboxActionKind =
  | 'OPEN_SOURCE'
  | 'REPLY_MESSAGE'
  | 'REPLY_MAIL'
  | 'ACCEPT_INVITATION'
  | 'DECLINE_INVITATION'
  | 'ACCEPT_NEARBY'
  | 'REJECT_NEARBY'
  | 'OPEN_HANDOFF'
  | 'CALL_BACK'
  | 'APPROVE'
  | 'REJECT_APPROVAL'
  | 'OPEN_CALENDAR'
  | 'OPEN_TASK'
  | 'OPEN_AGENT_RESULT'
  | 'OPEN_SUBSCRIPTION'
  | 'ACCEPT_FOLDER_INVITATION'
  | 'OPEN_FOLDER_CONFLICT';

export type InboxSourceRef =
  | { readonly source: 'keystone'; readonly id: string; readonly notificationId: string; readonly objectId: string; readonly objectType: string }
  | { readonly source: 'mail'; readonly id: string; readonly accountId: string; readonly messageId: string; readonly threadId: string }
  | { readonly source: 'calls'; readonly id: string; readonly callId: string; readonly sessionId: string }
  | { readonly source: 'collaboration'; readonly id: string; readonly recordId: string; readonly recordKind: 'invitation' | 'comment'; readonly objectId: string; readonly spaceId?: string }
  | { readonly source: 'continuity'; readonly id: string; readonly requestId: string; readonly sourceDeviceId: string }
  | { readonly source: 'nearby'; readonly id: string; readonly recordId: string; readonly recordKind: 'offer' | 'transfer'; readonly endpointId: string; readonly offerId?: string }
  | { readonly source: 'agents'; readonly id: string; readonly runId: string; readonly sessionId?: string }
  | { readonly source: 'approvals'; readonly id: string; readonly runId: string; readonly toolId: string; readonly step: number }
  | { readonly source: 'automation'; readonly id: string; readonly runId: string; readonly automationId?: string }
  | { readonly source: 'calendar'; readonly id: string; readonly eventId: string; readonly calendarId: string; readonly inviteId?: string }
  | { readonly source: 'workboard'; readonly id: string; readonly boardId: string; readonly itemId: string }
  | { readonly source: 'security'; readonly id: string; readonly eventId: string }
  | { readonly source: 'system'; readonly id: string; readonly eventId: string }
  | { readonly source: 'web'; readonly id: string; readonly archiveId: string }
  | { readonly source: 'files'; readonly id: string; readonly folderId: string; readonly recordKind: 'invitation' | 'conflict' }
  | { readonly source: 'subscriptions'; readonly id: string; readonly subscriptionId: string; readonly entryId: string; readonly feedUrl: string }
  | { readonly source: 'plugin'; readonly id: string; readonly pluginId: string; readonly eventId: string };

export interface InboxSourceBadge {
  readonly source: InboxSourceKind;
  readonly label: string;
  readonly trusted: boolean;
}

export interface InboxPresentation {
  readonly badge: InboxSourceBadge;
  readonly title: string;
  readonly snippet?: string;
  readonly sender?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
  readonly dueAt?: string;
  readonly groupKey?: string;
  readonly reasons: readonly string[];
  readonly priority: InboxPriority;
  readonly requiresAction: boolean;
  readonly dataClass: InboxDataClass;
}

export interface InboxOrganizationState {
  readonly read: boolean;
  readonly archived: boolean;
  readonly dismissed: boolean;
  readonly snoozedUntil?: string;
  readonly pinned: boolean;
  readonly saved: boolean;
  readonly changedAt: string;
  readonly revision: { readonly clock: number; readonly deviceId: string };
}

export interface InboxActionDescriptor {
  readonly id: InboxActionId;
  readonly kind: InboxActionKind;
  readonly label: string;
  readonly requiresOwnerConfirmation: boolean;
  readonly sourceVersion: string;
}

export interface InboxItem {
  readonly version: 1;
  readonly id: InboxItemId;
  readonly source: InboxSourceRef;
  readonly sourceKind: InboxSourceKind;
  readonly kind: InboxItemKind;
  readonly sourceVersion: string;
  readonly sourceState: InboxSourceState;
  readonly presentation: InboxPresentation;
  readonly organization: InboxOrganizationState;
  readonly actions: readonly InboxActionDescriptor[];
}

export interface InboxSourceProjection {
  readonly source: InboxSourceRef;
  readonly kind: InboxItemKind;
  readonly sourceVersion: string;
  readonly presentation: Omit<InboxPresentation, 'badge'> & { readonly badge?: Pick<InboxSourceBadge, 'label'> };
  readonly actions?: readonly InboxActionDescriptor[];
  readonly sourceState?: InboxSourceState;
}

export interface InboxAdapterListInput {
  readonly limit: number;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface InboxSourceActionInput {
  readonly item: InboxItem;
  readonly source: InboxSourceProjection;
  readonly action: InboxActionKind;
  readonly ownerConfirmed: boolean;
  readonly send?: boolean;
  readonly replyAll?: boolean;
  readonly bodyText?: string;
  readonly idempotencyKey: string;
}

export type InboxActionResult =
  | { readonly status: 'OPENED' | 'NOOP' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED' | 'QUEUED' }
  | { readonly status: 'DRAFT_CREATED'; readonly draftId: string }
  | { readonly status: 'SENT'; readonly outboxId?: string };

export type InboxAdapterEvent<TSource> =
  | { readonly kind: 'UPSERT'; readonly source: TSource; readonly eventId?: string }
  | { readonly kind: 'REMOVE'; readonly ref: InboxSourceRef; readonly eventId?: string }
  | { readonly kind: 'UNAVAILABLE'; readonly source: InboxSourceRef; readonly reason: string; readonly eventId?: string };

export type InboxAdapterTrust = 'CORE' | 'OWNED_HOST' | 'PLUGIN';

export interface InboxProjectionAdapter<TSource = any> {
  readonly sourceKind: InboxSourceKind;
  readonly trust: InboxAdapterTrust;
  readonly list: (input: InboxAdapterListInput) => Promise<readonly TSource[]> | readonly TSource[];
  readonly project: (source: TSource) => InboxSourceProjection | undefined;
  readonly refOf?: (source: TSource) => InboxSourceRef | undefined;
  readonly subscribe?: (listener: (event: InboxAdapterEvent<TSource>) => void) => () => void;
  readonly refresh?: (ref: InboxSourceRef) => Promise<TSource | undefined> | TSource | undefined;
  readonly resolve?: (ref: InboxSourceRef) => Promise<unknown> | unknown;
  readonly execute?: (input: InboxSourceActionInput) => Promise<InboxActionResult> | InboxActionResult;
  readonly close?: () => Promise<void> | void;
}

export interface InboxListOptions {
  readonly view?: InboxView;
  readonly sourceKind?: InboxSourceKind;
  readonly itemKind?: InboxItemKind;
  readonly query?: string;
  readonly groupKey?: string;
  readonly accountId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface InboxGroup {
  readonly id: InboxGroupId;
  readonly key: string;
  readonly sourceKind: InboxSourceKind;
  readonly title: string;
  readonly count: number;
  readonly unreadCount: number;
  readonly actionCount: number;
}

export interface InboxListResult {
  readonly items: readonly InboxItem[];
  readonly nextCursor?: string;
  readonly total: number;
  readonly unreadCount: number;
  readonly actionRequiredCount: number;
  readonly groups: readonly InboxGroup[];
}

export interface InboxPreview {
  readonly id: InboxItemId;
  readonly badge: InboxSourceBadge;
  readonly kind: InboxItemKind;
  readonly title: string;
  readonly snippet?: string;
  readonly sender?: string;
  readonly receivedAt: string;
  readonly sourceState: InboxSourceState;
  readonly organization: InboxOrganizationState;
  readonly actions: readonly InboxActionDescriptor[];
}

export interface InboxWhyItem {
  readonly itemId: InboxItemId;
  readonly reasons: readonly string[];
  readonly ordering: readonly ['priority', 'pinned', 'action-required', 'received-at', 'id'];
}

export interface InboxDiagnostics {
  readonly itemCount: number;
  readonly unreadCount: number;
  readonly actionRequiredCount: number;
  readonly adapterCount: number;
  readonly healthyAdapters: number;
  readonly unavailableAdapters: readonly InboxSourceKind[];
  readonly listenerCount: number;
  readonly pendingProjectionEvents: number;
  readonly snoozedCount: number;
  readonly snoozeWakeIndexSize: number;
  readonly queuedWrites: number;
}

export interface InboxChange {
  readonly kind: 'projection' | 'organization' | 'source-health';
  readonly itemIds: readonly InboxItemId[];
  readonly sourceKind?: InboxSourceKind;
}

export interface InboxStateBackend {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryInboxStateStore implements InboxStateBackend {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface InboxOrganizationChange {
  readonly version: 1;
  readonly itemId: InboxItemId;
  readonly state: InboxOrganizationState;
  readonly originDeviceId: string;
}

export interface InboxOrganizationSync {
  readonly publish: (change: InboxOrganizationChange) => Promise<void> | void;
  readonly subscribe?: (listener: (change: InboxOrganizationChange) => void) => () => void;
}

export interface InboxServiceOptions {
  readonly store?: InboxStateBackend;
  readonly adapters?: readonly InboxProjectionAdapter<any>[];
  readonly maxItems?: number;
  readonly hydrationLimit?: number;
  readonly now?: () => number;
  readonly deviceId?: string;
  readonly organizationSync?: InboxOrganizationSync;
}

export class InboxError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'SOURCE_UNAVAILABLE' | 'ACTION_UNAVAILABLE' | 'STALE_SOURCE' | 'POLICY_DENIED' | 'BOUNDS_EXCEEDED' | 'CORRUPT_STATE' | 'DUPLICATE_SOURCE', message: string) {
    super(message);
    this.name = 'InboxError';
  }
}

const PRIVILEGED_SOURCES = new Set<InboxSourceKind>(['keystone', 'mail', 'calls', 'collaboration', 'continuity', 'nearby', 'agents', 'approvals', 'automation', 'calendar', 'workboard', 'security', 'system', 'files', 'subscriptions']);
const SOURCE_LABELS: Readonly<Record<InboxSourceKind, string>> = {
  keystone: 'Keystone', mail: 'Mail', calls: 'Calls', collaboration: 'Collaboration', continuity: 'Continuity', nearby: 'Nearby', agents: 'Agents', approvals: 'Approvals', automation: 'Automation', calendar: 'Calendar', workboard: 'Workboard', security: 'Security', system: 'System', web: 'Web', files: 'Files', subscriptions: 'Subscriptions', plugin: 'Plugin',
};
const ALLOWED_ACTIONS = new Set<InboxActionKind>(['OPEN_SOURCE', 'REPLY_MESSAGE', 'REPLY_MAIL', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'ACCEPT_NEARBY', 'REJECT_NEARBY', 'OPEN_HANDOFF', 'CALL_BACK', 'APPROVE', 'REJECT_APPROVAL', 'OPEN_CALENDAR', 'OPEN_TASK', 'OPEN_AGENT_RESULT', 'OPEN_SUBSCRIPTION', 'ACCEPT_FOLDER_INVITATION', 'OPEN_FOLDER_CONFLICT']);
const PRIORITY_ORDER: Readonly<Record<InboxPriority, number>> = { security: 0, approval: 1, 'time-sensitive': 2, communication: 3, completion: 4, informational: 5 };
const PRIORITIES = new Set<InboxPriority>(Object.keys(PRIORITY_ORDER) as InboxPriority[]);
const ITEM_KINDS = new Set<InboxItemKind>(['MESSAGE', 'EMAIL', 'CALL', 'MENTION', 'COMMENT', 'INVITATION', 'TRANSFER', 'HANDOFF', 'AGENT_RESULT', 'APPROVAL', 'AUTOMATION_ALERT', 'CALENDAR', 'TASK', 'SECURITY', 'FEED_ITEM', 'FILE_CONFLICT', 'SYSTEM_ATTENTION']);

export class InboxAdapterRegistry {
  private readonly adapters = new Map<InboxSourceKind, InboxProjectionAdapter<any>>();

  register(adapter: InboxProjectionAdapter<any>): void {
    if (!adapter || !adapter.sourceKind || !adapter.trust || typeof adapter.list !== 'function' || typeof adapter.project !== 'function') throw new InboxError('INVALID_ARGUMENT', 'Inbox adapter is incomplete');
    if (adapter.trust === 'PLUGIN' && adapter.sourceKind !== 'plugin') throw new InboxError('POLICY_DENIED', 'Plugins cannot claim a canonical Inbox source');
    if (adapter.sourceKind === 'plugin' && adapter.trust !== 'PLUGIN') throw new InboxError('POLICY_DENIED', 'Plugin source requires plugin trust');
    if (this.adapters.has(adapter.sourceKind)) throw new InboxError('DUPLICATE_SOURCE', `Inbox source ${adapter.sourceKind} is already registered`);
    this.adapters.set(adapter.sourceKind, adapter);
  }

  get(sourceKind: InboxSourceKind): InboxProjectionAdapter | undefined { return this.adapters.get(sourceKind); }
  values(): readonly InboxProjectionAdapter<any>[] { return [...this.adapters.values()]; }
}

interface PersistedInboxState {
  readonly version: 1;
  readonly items: Readonly<Record<string, unknown>>;
  readonly clock: number;
}

export class UniversalInboxService {
  readonly registry: InboxAdapterRegistry;
  private readonly store: InboxStateBackend;
  private readonly maxItems: number;
  private readonly hydrationLimit: number;
  private readonly now: () => number;
  private readonly deviceId: string;
  private readonly organizationSync?: InboxOrganizationSync;
  private readonly items = new Map<InboxItemId, InboxItem>();
  private readonly listeners = new Set<(change: InboxChange) => void>();
  private readonly adapterUnsubscribers: (() => void)[] = [];
  private readonly queuedEvents = new Map<string, { readonly adapter: InboxProjectionAdapter; readonly event: InboxAdapterEvent<unknown> }>();
  private readonly eventIds = new Set<string>();
  private readonly snoozeWakeIndex = new Map<InboxItemId, number>();
  private clock = 0;
  private readyPromise: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWrites = 0;
  private flushScheduled = false;
  private closed = false;
  private organizationUnsubscribe?: () => void;

  constructor(options: InboxServiceOptions = {}) {
    this.registry = new InboxAdapterRegistry();
    for (const adapter of options.adapters ?? []) this.registry.register(adapter);
    this.store = options.store ?? new InMemoryInboxStateStore();
    this.maxItems = clampInt(options.maxItems, 1_000, INBOX_MAX_ITEMS, INBOX_MAX_ITEMS);
    this.hydrationLimit = clampInt(options.hydrationLimit, 1, INBOX_MAX_PAGE, 64);
    this.now = options.now ?? Date.now;
    this.deviceId = safeText(options.deviceId ?? 'local-device', 128) || 'local-device';
    this.organizationSync = options.organizationSync;
    this.readyPromise = this.hydrate();
    if (this.organizationSync?.subscribe) this.organizationUnsubscribe = this.organizationSync.subscribe(change => { void this.applyOrganizationChange(change); });
  }

  async ready(): Promise<void> { await this.readyPromise; }

  subscribe(listener: (change: InboxChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async registerAdapter(adapter: InboxProjectionAdapter<any>): Promise<void> {
    await this.ready();
    this.registry.register(adapter);
    this.installAdapterSubscription(adapter);
    await this.hydrateAdapter(adapter);
  }

  async list(options: InboxListOptions = {}): Promise<InboxListResult> {
    await this.ready();
    await this.wakeSnoozed(this.now());
    const filtered = [...this.items.values()].filter(item => this.matches(item, options));
    const sorted = filtered.sort(compareInboxItems);
    const start = options.cursor ? Math.max(0, sorted.findIndex(item => item.id === options.cursor) + 1) : 0;
    const limit = clampInt(options.limit, 1, INBOX_MAX_PAGE, 64);
    const page = sorted.slice(start, start + limit).map(clone);
    const groups = buildGroups(filtered);
    return { items: page, ...(start + limit < sorted.length && page.length ? { nextCursor: page.at(-1)!.id } : {}), total: sorted.length, unreadCount: filtered.filter(item => !item.organization.read).length, actionRequiredCount: filtered.filter(item => item.presentation.requiresAction).length, groups };
  }

  async search(query: string, options: Omit<InboxListOptions, 'query'> = {}): Promise<InboxListResult> { return this.list({ ...options, query }); }

  async preview(itemId: InboxItemId): Promise<InboxPreview> {
    await this.ready();
    const item = this.requireItem(itemId);
    return { id: item.id, badge: item.presentation.badge, kind: item.kind, title: item.presentation.title, ...(item.presentation.snippet ? { snippet: item.presentation.snippet } : {}), ...(item.presentation.sender ? { sender: item.presentation.sender } : {}), receivedAt: item.presentation.receivedAt, sourceState: item.sourceState, organization: clone(item.organization), actions: clone(item.actions) };
  }

  async openSource(itemId: InboxItemId): Promise<unknown> {
    await this.ready();
    const item = this.requireItem(itemId);
    if (item.sourceState !== 'available') throw new InboxError('SOURCE_UNAVAILABLE', 'Inbox source is no longer available');
    const adapter = this.registry.get(item.sourceKind);
    if (!adapter?.resolve) throw new InboxError('SOURCE_UNAVAILABLE', `No source navigation boundary is installed for ${item.sourceKind}`);
    return adapter.resolve(item.source);
  }

  async executeAction(input: { readonly itemId: InboxItemId; readonly action: InboxActionKind; readonly ownerConfirmed?: boolean; readonly send?: boolean; readonly replyAll?: boolean; readonly bodyText?: string }): Promise<InboxActionResult> {
    await this.ready();
    if (!ALLOWED_ACTIONS.has(input.action)) throw new InboxError('ACTION_UNAVAILABLE', 'Unknown Inbox action');
    const item = this.requireItem(input.itemId);
    const adapter = this.registry.get(item.sourceKind);
    if (!adapter?.execute) throw new InboxError('ACTION_UNAVAILABLE', `No action boundary is installed for ${item.sourceKind}`);
    const currentRaw = adapter.refresh ? await adapter.refresh(item.source) : undefined;
    const currentProjection = currentRaw === undefined ? undefined : adapter.project(currentRaw);
    const current = currentProjection ? { ...currentProjection, actions: normalizeActions(currentProjection.actions ?? [], currentProjection.source, currentProjection.sourceVersion, adapter.trust) } : undefined;
    if (!current) throw new InboxError('STALE_SOURCE', 'The source object is unavailable or changed');
    if (current.source.source !== item.source.source || current.source.id !== item.source.id) throw new InboxError('STALE_SOURCE', 'The source reference changed');
    if (!current.actions?.some(action => action.kind === input.action)) throw new InboxError('ACTION_UNAVAILABLE', 'This source no longer exposes the requested action');
    const result = await adapter.execute({ item, source: current, action: input.action, ownerConfirmed: input.ownerConfirmed === true, ...(input.send !== undefined ? { send: input.send } : {}), ...(input.replyAll !== undefined ? { replyAll: input.replyAll } : {}), ...(input.bodyText !== undefined ? { bodyText: safeText(input.bodyText, 32_000) } : {}), idempotencyKey: `inbox:${item.id}:${item.sourceVersion}:${input.action}` });
    const refreshed = adapter.refresh ? await adapter.refresh(item.source) : currentRaw;
    if (refreshed !== undefined) { this.applyProjection(adapter, refreshed); await this.persist(); this.emit({ kind: 'projection', itemIds: [item.id], sourceKind: item.sourceKind }); }
    else { this.items.delete(item.id); this.snoozeWakeIndex.delete(item.id); await this.persist(); this.emit({ kind: 'projection', itemIds: [item.id], sourceKind: item.sourceKind }); }
    return result;
  }

  async markRead(itemId: InboxItemId, read = true): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, read })); }
  async markAllRead(options: Omit<InboxListOptions, 'limit' | 'cursor'> = {}): Promise<number> { await this.ready(); const values = [...this.items.values()].filter(item => this.matches(item, options) && !item.organization.read); return this.bulk({ itemIds: values.map(item => item.id), action: 'READ' }); }
  async archive(itemId: InboxItemId): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, archived: true, dismissed: false })); }
  async restore(itemId: InboxItemId): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, archived: false, dismissed: false })); }
  async dismiss(itemId: InboxItemId): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, dismissed: true, archived: true })); }
  async pin(itemId: InboxItemId, pinned = true): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, pinned })); }
  async save(itemId: InboxItemId, saved = true): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, saved })); }
  async unsnooze(itemId: InboxItemId): Promise<boolean> { return this.updateOrganization(itemId, state => ({ ...state, snoozedUntil: undefined })); }

  async snooze(itemId: InboxItemId, until: string | Date): Promise<boolean> {
    await this.ready();
    const value = typeof until === 'string' ? Date.parse(until) : until.getTime();
    if (!Number.isFinite(value) || value <= this.now() || value > this.now() + INBOX_MAX_SNOOZE_MS) throw new InboxError('INVALID_ARGUMENT', 'Snooze time is outside the bounded local window');
    return this.updateOrganization(itemId, state => ({ ...state, snoozedUntil: new Date(value).toISOString() }));
  }

  async bulk(input: { readonly itemIds: readonly InboxItemId[]; readonly action: Extract<InboxOrganizationAction, 'READ' | 'UNREAD' | 'ARCHIVE' | 'RESTORE' | 'DISMISS' | 'PIN' | 'UNPIN' | 'SAVE' | 'UNSAVE'> }): Promise<number> {
    await this.ready();
    if (input.itemIds.length > INBOX_MAX_BULK_ITEMS) throw new InboxError('BOUNDS_EXCEEDED', 'Bulk Inbox action exceeds its bound');
    let changed = 0;
    const changedIds: InboxItemId[] = [];
    const changes: InboxOrganizationChange[] = [];
    for (const itemId of input.itemIds) {
      const current = this.items.get(itemId);
      if (!current) continue;
      const nextBase = ((state: InboxOrganizationState) => {
        if (input.action === 'READ') return { ...state, read: true };
        if (input.action === 'UNREAD') return { ...state, read: false };
        if (input.action === 'ARCHIVE') return { ...state, archived: true, dismissed: false };
        if (input.action === 'RESTORE') return { ...state, archived: false, dismissed: false };
        if (input.action === 'DISMISS') return { ...state, archived: true, dismissed: true };
        if (input.action === 'PIN' || input.action === 'UNPIN') return { ...state, pinned: input.action === 'PIN' };
        return { ...state, saved: input.action === 'SAVE' };
      })(current.organization);
      if (sameOrganization(current.organization, nextBase)) continue;
      const next: InboxOrganizationState = { ...nextBase, changedAt: new Date(this.now()).toISOString(), revision: { clock: ++this.clock, deviceId: this.deviceId } };
      this.items.set(itemId, { ...current, organization: next });
      this.indexSnooze(this.items.get(itemId)!);
      changed += 1;
      changedIds.push(itemId);
      changes.push({ version: 1, itemId, state: clone(next), originDeviceId: this.deviceId });
    }
    if (changedIds.length) { await this.persist(); this.emit({ kind: 'organization', itemIds: changedIds }); if (this.organizationSync) for (const change of changes) void Promise.resolve(this.organizationSync.publish(change)).catch(() => undefined); }
    return changed;
  }

  async wakeSnoozed(at = this.now()): Promise<number> {
    await this.ready();
    const due = [...this.snoozeWakeIndex.entries()].filter(([, value]) => value <= at).sort((a, b) => a[1] - b[1]);
    if (!due.length) return 0;
    const changed: InboxItemId[] = [];
    for (const [itemId] of due) {
      const item = this.items.get(itemId);
      this.snoozeWakeIndex.delete(itemId);
      if (!item?.organization.snoozedUntil || Date.parse(item.organization.snoozedUntil) > at) continue;
      this.items.set(itemId, { ...item, organization: { ...item.organization, snoozedUntil: undefined, changedAt: new Date(at).toISOString() } });
      changed.push(itemId);
    }
    if (changed.length) { await this.persist(); this.emit({ kind: 'organization', itemIds: changed }); }
    return changed.length;
  }

  whyThisItem(itemId: InboxItemId): InboxWhyItem {
    const item = this.requireItem(itemId);
    const reasons = [...item.presentation.reasons];
    if (item.presentation.requiresAction && !reasons.includes('Action required')) reasons.push('Action required');
    if (!reasons.length) reasons.push(`From ${item.presentation.badge.label}`);
    return { itemId, reasons: reasons.slice(0, 8), ordering: ['priority', 'pinned', 'action-required', 'received-at', 'id'] };
  }

  diagnostics(): InboxDiagnostics {
    const unavailable = this.registry.values().filter(adapter => [...this.items.values()].some(item => item.sourceKind === adapter.sourceKind && item.sourceState === 'unavailable')).map(adapter => adapter.sourceKind);
    return { itemCount: this.items.size, unreadCount: [...this.items.values()].filter(item => !item.organization.read).length, actionRequiredCount: [...this.items.values()].filter(item => item.presentation.requiresAction).length, adapterCount: this.registry.values().length, healthyAdapters: this.registry.values().length - unavailable.length, unavailableAdapters: [...new Set(unavailable)], listenerCount: this.listeners.size, pendingProjectionEvents: this.queuedEvents.size, snoozedCount: this.snoozeWakeIndex.size, snoozeWakeIndexSize: this.snoozeWakeIndex.size, queuedWrites: this.pendingWrites };
  }

  async flush(): Promise<void> { await this.writeChain; }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.organizationUnsubscribe?.();
    for (const unsubscribe of this.adapterUnsubscribers.splice(0)) unsubscribe();
    await Promise.all(this.registry.values().map(adapter => Promise.resolve(adapter.close?.()).catch(() => undefined)));
    await this.flush();
  }

  /** Explicit, owner-controlled local-AI selection.  It never sends data to an external AI provider. */
  async selectForLocalAi(itemIds: readonly InboxItemId[], ownerConfirmed: boolean): Promise<readonly { readonly id: InboxItemId; readonly title: string; readonly snippet?: string; readonly source: InboxSourceKind }[]> {
    if (!ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Selecting Inbox context for local AI requires explicit owner confirmation');
    await this.ready();
    if (itemIds.length > 64) throw new InboxError('BOUNDS_EXCEEDED', 'Local AI Inbox context is bounded');
    return itemIds.map(id => { const item = this.requireItem(id); return { id: item.id, title: item.presentation.title, ...(item.presentation.snippet ? { snippet: item.presentation.snippet } : {}), source: item.sourceKind }; });
  }

  private async hydrate(): Promise<void> {
    const raw = await this.store.read().catch(() => undefined);
    if (raw && isRecord(raw) && raw.version === 1 && isRecord(raw.items)) {
      this.clock = typeof raw.clock === 'number' && Number.isSafeInteger(raw.clock) && raw.clock >= 0 ? raw.clock : 0;
      for (const [key, value] of Object.entries(raw.items).slice(0, this.maxItems)) {
        const normalized = normalizePersistedItem(value, key, this.now, this.deviceId);
        if (normalized) { this.items.set(normalized.id, normalized); this.indexSnooze(normalized); }
      }
    }
    for (const adapter of this.registry.values()) { this.installAdapterSubscription(adapter); await this.hydrateAdapter(adapter); }
  }

  private installAdapterSubscription(adapter: InboxProjectionAdapter<any>): void {
    if (!adapter.subscribe) return;
    const unsubscribe = adapter.subscribe(event => {
      if (event.kind === 'UPSERT') {
        const projection = adapter.project(event.source);
        if (projection) this.queueAdapterEvent(adapter, event, projection);
        else { const ref = adapter.refOf?.(event.source); if (ref) this.queueAdapterEvent(adapter, { kind: 'REMOVE', ref, ...(event.eventId ? { eventId: `${event.eventId}:remove` } : {}) }); }
      } else this.queueAdapterEvent(adapter, event);
    });
    this.adapterUnsubscribers.push(unsubscribe);
  }

  private async hydrateAdapter(adapter: InboxProjectionAdapter<any>): Promise<void> {
    try {
      const values = await adapter.list({ limit: this.hydrationLimit });
      for (const value of values.slice(0, this.hydrationLimit)) this.applyProjection(adapter, value);
      if (values.length) { await this.persist(); this.emit({ kind: 'projection', itemIds: values.flatMap(value => { const projection = adapter.project(value); return projection ? [itemIdFor(projection.source)] : []; }), sourceKind: adapter.sourceKind }); }
    } catch {
      this.markAdapterUnavailable(adapter.sourceKind);
    }
  }

  private queueAdapterEvent(adapter: InboxProjectionAdapter<any>, event: InboxAdapterEvent<unknown>, projection?: InboxSourceProjection): void {
    if (event.eventId) { if (this.eventIds.has(event.eventId)) return; this.eventIds.add(event.eventId); if (this.eventIds.size > 8_192) this.eventIds.delete(this.eventIds.values().next().value as string); }
    const key = projection ? String(itemIdFor(projection.source)) : event.kind === 'REMOVE' ? String(itemIdFor(event.ref)) : event.kind === 'UNAVAILABLE' ? String(itemIdFor(event.source)) : `${adapter.sourceKind}:event`;
    this.queuedEvents.set(key, { adapter, event });
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => { this.flushScheduled = false; void this.flushAdapterEvents(); });
  }

  private async flushAdapterEvents(): Promise<void> {
    const events = [...this.queuedEvents.values()];
    this.queuedEvents.clear();
    const changed: InboxItemId[] = [];
    for (const entry of events) {
      const { adapter, event } = entry;
      if (event.kind === 'UPSERT') { const projection = adapter.project(event.source); if (projection) { this.applyProjection(adapter, event.source); changed.push(itemIdFor(projection.source)); } }
      else if (event.kind === 'REMOVE') { const id = itemIdFor(event.ref); if (this.items.delete(id)) { this.snoozeWakeIndex.delete(id); changed.push(id); } }
      else { const id = itemIdFor(event.source); const current = this.items.get(id); if (current) { this.items.set(id, { ...current, sourceState: 'unavailable', presentation: { ...current.presentation, reasons: [...current.presentation.reasons, `Source unavailable: ${safeText(event.reason, 180)}`].slice(0, 8) } }); changed.push(id); } }
    }
    if (changed.length) { await this.persist(); this.emit({ kind: 'projection', itemIds: [...new Set(changed)] }); }
  }

  private applyProjection(adapter: InboxProjectionAdapter<any>, sourceValue: unknown): void {
    const projection = adapter.project(sourceValue);
    if (!projection || !isRecord(projection) || !isRecord(projection.source) || projection.source.source !== adapter.sourceKind) return;
    const source = normalizeSourceRef(projection.source);
    if (!source) return;
    const id = itemIdFor(source);
    const current = this.items.get(id);
    const organization = current?.organization ?? defaultOrganization(this.now, this.deviceId);
    const presentation = normalizePresentation(projection.presentation, adapter);
    const actions = normalizeActions(projection.actions ?? [], projection.source, projection.sourceVersion, adapter.trust);
    const item: InboxItem = { version: 1, id, source, sourceKind: adapter.sourceKind, kind: projection.kind, sourceVersion: safeText(projection.sourceVersion, 128) || '1', sourceState: projection.sourceState ?? 'available', presentation, organization, actions };
    this.items.set(id, item);
    this.indexSnooze(item);
    this.trimItems();
  }

  private markAdapterUnavailable(sourceKind: InboxSourceKind): void {
    const changed: InboxItemId[] = [];
    for (const [id, item] of this.items) if (item.sourceKind === sourceKind && item.sourceState === 'available') { this.items.set(id, { ...item, sourceState: 'unavailable' }); changed.push(id); }
    if (changed.length) { void this.persist(); this.emit({ kind: 'source-health', itemIds: changed, sourceKind }); }
  }

  private matches(item: InboxItem, options: InboxListOptions): boolean {
    const snoozed = Boolean(item.organization.snoozedUntil && Date.parse(item.organization.snoozedUntil) > this.now());
    if (options.view === 'ARCHIVE' ? !item.organization.archived && !item.organization.dismissed : item.organization.archived || item.organization.dismissed) return false;
    if (options.view === 'SNOOZED' ? !snoozed : snoozed) return false;
    if (options.view === 'UNREAD' && item.organization.read) return false;
    if (options.view === 'NEEDS_ACTION' && !item.presentation.requiresAction) return false;
    if (options.sourceKind && item.sourceKind !== options.sourceKind) return false;
    if (options.itemKind && item.kind !== options.itemKind) return false;
    if (options.groupKey && item.presentation.groupKey !== options.groupKey) return false;
    if (options.accountId && (!('accountId' in item.source) || item.source.accountId !== options.accountId)) return false;
    const query = normalizeQuery(options.query);
    if (query.length) { const haystack = [item.presentation.title, item.presentation.snippet ?? '', item.presentation.sender ?? '', item.presentation.badge.label, ...item.presentation.reasons].join(' ').toLocaleLowerCase(); if (!query.every(term => haystack.includes(term))) return false; }
    return true;
  }

  private async updateOrganization(itemId: InboxItemId, update: (state: InboxOrganizationState) => InboxOrganizationState): Promise<boolean> {
    await this.ready();
    const current = this.requireItem(itemId);
    const nextBase = update(current.organization);
    const next: InboxOrganizationState = { ...nextBase, changedAt: new Date(this.now()).toISOString(), revision: { clock: ++this.clock, deviceId: this.deviceId } };
    if (sameOrganization(current.organization, next)) return false;
    const item = { ...current, organization: next };
    this.items.set(itemId, item);
    this.indexSnooze(item);
    await this.persist();
    this.emit({ kind: 'organization', itemIds: [itemId] });
    if (this.organizationSync) void Promise.resolve(this.organizationSync.publish({ version: 1, itemId, state: clone(next), originDeviceId: this.deviceId })).catch(() => undefined);
    return true;
  }

  private async applyOrganizationChange(change: InboxOrganizationChange): Promise<void> {
    if (change.version !== 1 || change.originDeviceId === this.deviceId || !isSafeId(change.itemId) || !validOrganization(change.state)) return;
    const item = this.items.get(change.itemId);
    if (!item || compareRevision(change.state.revision, item.organization.revision) <= 0) return;
    this.clock = Math.max(this.clock, change.state.revision.clock);
    this.items.set(change.itemId, { ...item, organization: clone(change.state) });
    this.indexSnooze(this.items.get(change.itemId)!);
    await this.persist();
    this.emit({ kind: 'organization', itemIds: [change.itemId] });
  }

  private indexSnooze(item: InboxItem): void { const value = item.organization.snoozedUntil ? Date.parse(item.organization.snoozedUntil) : NaN; if (Number.isFinite(value)) this.snoozeWakeIndex.set(item.id, value); else this.snoozeWakeIndex.delete(item.id); }
  private trimItems(): void { if (this.items.size <= this.maxItems) return; const values = [...this.items.values()].sort(compareInboxItems); for (const item of values.slice(this.maxItems)) { this.items.delete(item.id); this.snoozeWakeIndex.delete(item.id); } }
  private requireItem(itemId: InboxItemId): InboxItem { const item = this.items.get(itemId); if (!item) throw new InboxError('NOT_FOUND', 'Inbox item was not found'); return item; }
  private async persist(): Promise<void> {
    const snapshot: PersistedInboxState = { version: 1, clock: this.clock, items: Object.fromEntries([...this.items.entries()].map(([id, item]) => [id, item])) };
    this.pendingWrites += 1;
    const operation = this.writeChain.then(() => this.store.write(structuredClone(snapshot))).finally(() => { this.pendingWrites = Math.max(0, this.pendingWrites - 1); });
    this.writeChain = operation.catch(() => undefined);
    await operation;
  }
  private emit(change: InboxChange): void { const snapshot = { ...change, itemIds: [...change.itemIds] }; for (const listener of this.listeners) listener(snapshot); }
}

export interface KeystoneNotificationInboxAdapterOptions { readonly notificationService: NotificationService; }

export function createKeystoneNotificationInboxAdapter(options: KeystoneNotificationInboxAdapterOptions): InboxProjectionAdapter<NotificationRecord> {
  const service = options.notificationService;
  return {
    sourceKind: 'keystone', trust: 'CORE',
    list: async input => service.list({ limit: Math.min(100, input.limit) }),
    refOf: notification => ({ source: 'keystone', id: notification.id, notificationId: notification.id, objectId: notification.objectId, objectType: notification.objectType }),
    project: notification => {
      const source: InboxSourceRef = { source: 'keystone', id: notification.id, notificationId: notification.id, objectId: notification.objectId, objectType: notification.objectType };
      const kind: InboxItemKind = notification.category === 'community_mention' ? 'MENTION' : notification.category === 'community_invite' ? 'INVITATION' : notification.category === 'comment' ? 'COMMENT' : ['dm', 'reply'].includes(notification.category) ? 'MESSAGE' : 'SYSTEM_ATTENTION';
      return { source, kind, sourceVersion: notification.createdAt, presentation: { title: safeText(notification.title, INBOX_MAX_TITLE) || 'Keystone notification', ...(notification.preview ? { snippet: safeText(notification.preview, INBOX_MAX_SNIPPET) } : {}), sender: safeText(notification.actor, 256), receivedAt: validDate(notification.createdAt), updatedAt: validDate(notification.createdAt), groupKey: `keystone:${notification.category}`, reasons: [notification.category === 'community_mention' ? 'You were mentioned' : notification.category === 'dm' || notification.category === 'reply' ? 'New Keystone message' : 'Keystone activity'], priority: kind === 'INVITATION' ? 'time-sensitive' : 'communication', requiresAction: kind === 'INVITATION', dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open in Keystone', requiresOwnerConfirmation: false, sourceVersion: notification.createdAt }] };
    },
    subscribe: listener => service.subscribe(() => { void service.list({ limit: 100 }).then(items => { for (const item of items) listener({ kind: 'UPSERT', source: item, eventId: `keystone:${item.id}:${item.createdAt}` }); }).catch(() => undefined); }),
    refresh: async ref => { const values = await service.list({ limit: 100 }); return values.find(item => item.id === ref.id); },
    resolve: ref => service.list({ limit: 100 }).then(values => values.find(item => item.id === ref.id)),
    execute: input => { if (input.action !== 'OPEN_SOURCE') throw new InboxError('ACTION_UNAVAILABLE', 'Keystone Inbox supports navigation only'); return { status: 'OPENED' }; },
  };
}

export interface InboxMailPort {
  readonly ready?: () => Promise<void>;
  readonly listMessages: (options?: { readonly accountId?: string; readonly unreadOnly?: boolean; readonly limit?: number; readonly cursor?: string }) => { readonly items: readonly MailMessage[]; readonly nextCursor?: string };
  readonly folders?: (accountId?: string) => readonly { readonly id: string; readonly role: string }[];
  readonly getMessage?: (messageId: string) => MailMessage | undefined;
  readonly createReplyDraft: (messageId: string, replyAll?: boolean) => Promise<{ readonly id: string }>;
  readonly updateDraft?: (draftId: string, patch: { readonly bodyText?: string }) => Promise<unknown>;
  readonly sendDraft: (draftId: string, ownerConfirmed?: boolean) => Promise<{ readonly id?: string }>;
}

export function createMailInboxAdapter(mail: InboxMailPort | MailService): InboxProjectionAdapter<MailMessage> {
  const port = mail as InboxMailPort;
  return {
    sourceKind: 'mail', trust: 'CORE',
    list: async input => { await port.ready?.(); const values = port.listMessages({ limit: Math.min(100, input.limit) }).items; const inboxFolders = new Set((port.folders?.() ?? []).filter(folder => folder.role === 'INBOX').map(folder => folder.id)); return inboxFolders.size ? values.filter(message => inboxFolders.has(message.folderId)) : values; },
    refOf: message => ({ source: 'mail', id: `${message.accountId}:${message.id}`, accountId: message.accountId, messageId: message.id, threadId: message.threadId }),
    project: message => {
      const source: InboxSourceRef = { source: 'mail', id: `${message.accountId}:${message.id}`, accountId: message.accountId, messageId: message.id, threadId: message.threadId };
      const unread = !message.flags.includes('SEEN');
      return { source, kind: 'EMAIL', sourceVersion: message.updatedAt, presentation: { title: safeText(message.subject || message.from.address, INBOX_MAX_TITLE) || 'Mail', snippet: safeText(message.snippet, INBOX_MAX_SNIPPET), sender: safeText(message.from.name ? `${message.from.name} <${message.from.address}>` : message.from.address, 320), receivedAt: validDate(message.receivedAt), updatedAt: validDate(message.updatedAt), groupKey: `mail:${message.threadId}`, reasons: [unread ? 'Unread mail' : 'Mail'], priority: 'communication', requiresAction: false, dataClass: 'sensitive' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open mail', requiresOwnerConfirmation: false, sourceVersion: message.updatedAt }, { id: actionId(source, 'REPLY_MAIL'), kind: 'REPLY_MAIL', label: 'Reply', requiresOwnerConfirmation: true, sourceVersion: message.updatedAt }] };
    },
    refresh: async ref => { await port.ready?.(); return ref.source === 'mail' ? port.getMessage?.(ref.messageId) : undefined; },
    resolve: async ref => { await port.ready?.(); return ref.source === 'mail' ? port.getMessage?.(ref.messageId) : undefined; },
    execute: async input => {
      if (input.action !== 'REPLY_MAIL') { if (input.action === 'OPEN_SOURCE') return { status: 'OPENED' }; throw new InboxError('ACTION_UNAVAILABLE', 'Mail Inbox supports reply or navigation'); }
      const ref = input.source.source;
      if (ref.source !== 'mail') throw new InboxError('STALE_SOURCE', 'Mail source reference is invalid');
      const draft = await port.createReplyDraft(ref.messageId, input.replyAll === true);
      if (input.bodyText !== undefined && port.updateDraft) await port.updateDraft(draft.id, { bodyText: input.bodyText });
      if (input.send !== true) return { status: 'DRAFT_CREATED', draftId: draft.id };
      if (!input.ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Sending mail requires explicit owner confirmation');
      const sent = await port.sendDraft(draft.id, true);
      return { status: 'SENT', ...(sent.id ? { outboxId: sent.id } : {}) };
    },
  };
}

export interface InboxCallPort {
  readonly history: () => readonly CallHistoryEntry[] | Promise<readonly CallHistoryEntry[]>;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly startCall?: (peerId: string, mode: CallHistoryEntry['mode']) => Promise<unknown>;
}

export function createCallInboxAdapter(port: InboxCallPort): InboxProjectionAdapter<CallHistoryEntry> {
  return {
    sourceKind: 'calls', trust: 'CORE',
    list: async () => (await port.history()).filter(entry => entry.outcome === 'missed' || entry.outcome === 'failed'),
    refOf: entry => ({ source: 'calls', id: `${entry.callId}:${entry.sessionId}`, callId: entry.callId, sessionId: entry.sessionId }),
    project: entry => {
      const source: InboxSourceRef = { source: 'calls', id: `${entry.callId}:${entry.sessionId}`, callId: entry.callId, sessionId: entry.sessionId };
      return { source, kind: 'CALL', sourceVersion: entry.endedAt, presentation: { title: entry.outcome === 'missed' ? 'Missed call' : 'Call failed', sender: safeText(entry.participant, 256), receivedAt: validDate(entry.endedAt), updatedAt: validDate(entry.endedAt), reasons: [entry.outcome === 'missed' ? 'Missed call' : 'Call needs attention'], priority: 'communication', requiresAction: entry.outcome === 'missed', dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open call history', requiresOwnerConfirmation: false, sourceVersion: entry.endedAt }, ...(port.startCall ? [{ id: actionId(source, 'CALL_BACK'), kind: 'CALL_BACK' as const, label: 'Call back', requiresOwnerConfirmation: true, sourceVersion: entry.endedAt }] : [])] };
    },
    subscribe: port.subscribe ? listener => port.subscribe!(() => { void Promise.resolve(port.history()).then(values => { for (const value of values.filter(entry => entry.outcome === 'missed' || entry.outcome === 'failed')) listener({ kind: 'UPSERT', source: value }); }).catch(() => undefined); }) : undefined,
    refresh: async ref => { if (ref.source !== 'calls') return undefined; return (await Promise.resolve(port.history())).find(entry => entry.callId === ref.callId && entry.sessionId === ref.sessionId); },
    execute: async input => { if (input.action === 'OPEN_SOURCE') return { status: 'OPENED' }; const ref = input.source.source; if (input.action !== 'CALL_BACK' || ref.source !== 'calls' || !port.startCall) throw new InboxError('ACTION_UNAVAILABLE', 'Call-back is not available'); if (!input.ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Calling back requires explicit owner confirmation'); await port.startCall(ref.callId, 'audio'); return { status: 'COMPLETED' }; },
  };
}

export interface InboxCollaborationPort {
  readonly listInvitations: () => readonly CollaborationInvitation[] | Promise<readonly CollaborationInvitation[]>;
  readonly listComments?: () => readonly CollaborationComment[] | Promise<readonly CollaborationComment[]>;
  readonly subscribe?: (listener: () => void) => () => void;
  readonly acceptInvitation: (invitationId: string) => Promise<void>;
  readonly declineInvitation?: (invitationId: string) => Promise<void>;
}

export function createCollaborationInboxAdapter(port: InboxCollaborationPort): InboxProjectionAdapter<CollaborationInvitation | CollaborationComment> {
  const list = async (): Promise<readonly (CollaborationInvitation | CollaborationComment)[]> => [...await port.listInvitations(), ...(port.listComments ? await port.listComments() : [])];
  return {
    sourceKind: 'collaboration', trust: 'CORE', list,
    refOf: value => 'invitee' in value ? { source: 'collaboration', id: value.id, recordId: value.id, recordKind: 'invitation', objectId: value.objectId, ...(value.spaceId ? { spaceId: value.spaceId } : {}) } : { source: 'collaboration', id: value.id, recordId: value.id, recordKind: 'comment', objectId: value.objectId },
    project: value => {
      if ('invitee' in value) {
        if (value.status !== 'pending') return undefined;
        const source: InboxSourceRef = { source: 'collaboration', id: value.id, recordId: value.id, recordKind: 'invitation', objectId: value.objectId, ...(value.spaceId ? { spaceId: value.spaceId } : {}) };
        return { source, kind: 'INVITATION', sourceVersion: value.expiresAt, presentation: { title: `Invitation to ${value.objectKind}`, snippet: `Role: ${value.role}`, sender: safeText(value.inviter, 256), receivedAt: validDate(value.createdAt), updatedAt: validDate(value.createdAt), ...(value.expiresAt ? { dueAt: validDate(value.expiresAt) } : {}), groupKey: `collaboration:${value.objectId}`, reasons: ['Shared object invitation'], priority: 'time-sensitive', requiresAction: true, dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open invitation', requiresOwnerConfirmation: false, sourceVersion: value.expiresAt }, { id: actionId(source, 'ACCEPT_INVITATION'), kind: 'ACCEPT_INVITATION', label: 'Accept', requiresOwnerConfirmation: true, sourceVersion: value.expiresAt }, ...(port.declineInvitation ? [{ id: actionId(source, 'DECLINE_INVITATION'), kind: 'DECLINE_INVITATION' as const, label: 'Decline', requiresOwnerConfirmation: true, sourceVersion: value.expiresAt }] : [])] };
      }
      const source: InboxSourceRef = { source: 'collaboration', id: value.id, recordId: value.id, recordKind: 'comment', objectId: value.objectId };
      return { source, kind: 'COMMENT', sourceVersion: value.createdAt, presentation: { title: 'New collaboration comment', snippet: safeText(value.body, INBOX_MAX_SNIPPET), sender: safeText(value.authorId, 256), receivedAt: validDate(value.createdAt), updatedAt: validDate(value.createdAt), groupKey: `collaboration:${value.objectId}`, reasons: ['Collaboration comment'], priority: 'communication', requiresAction: false, dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open collaboration', requiresOwnerConfirmation: false, sourceVersion: value.createdAt }] };
    },
    subscribe: port.subscribe ? listener => port.subscribe!(() => { void list().then(values => { for (const value of values) listener({ kind: 'UPSERT', source: value }); }).catch(() => undefined); }) : undefined,
    refresh: async ref => { if (ref.source !== 'collaboration') return undefined; return (await list()).find(value => ('id' in value) && value.id === ref.recordId); },
    execute: async input => { const ref = input.source.source; if (input.action === 'OPEN_SOURCE') return { status: 'OPENED' }; if (ref.source !== 'collaboration' || ref.recordKind !== 'invitation') throw new InboxError('ACTION_UNAVAILABLE', 'Only invitations have Inbox actions'); if (!input.ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Invitation decisions require explicit owner confirmation'); if (input.action === 'ACCEPT_INVITATION') { await port.acceptInvitation(ref.recordId); return { status: 'ACCEPTED' }; } if (input.action === 'DECLINE_INVITATION' && port.declineInvitation) { await port.declineInvitation(ref.recordId); return { status: 'DECLINED' }; } throw new InboxError('ACTION_UNAVAILABLE', 'Invitation action is unavailable'); },
  };
}

export function createContinuityInboxAdapter(service: Pick<ContinuityService, 'inbox' | 'get' | 'openIncoming' | 'subscribe'>): InboxProjectionAdapter<DeviceInboxItem> {
  return {
    sourceKind: 'continuity', trust: 'CORE', list: () => service.inbox(),
    refOf: item => ({ source: 'continuity', id: item.requestId, requestId: item.requestId, sourceDeviceId: item.sourceDeviceId }),
    project: item => {
      if (['OPENED', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(item.status)) return undefined;
      const source: InboxSourceRef = { source: 'continuity', id: item.requestId, requestId: item.requestId, sourceDeviceId: item.sourceDeviceId };
      return { source, kind: 'HANDOFF', sourceVersion: item.updatedAt, presentation: { title: `Handoff: ${item.payload.type}`, sender: safeText(item.sourceLabel, 256), receivedAt: validDate(item.receivedAt), updatedAt: validDate(item.updatedAt), dueAt: validDate(item.payload.expiresAt), groupKey: `continuity:${item.payload.type}`, reasons: ['Sent from an owned device'], priority: 'completion', requiresAction: true, dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_HANDOFF'), kind: 'OPEN_HANDOFF', label: 'Open handoff', requiresOwnerConfirmation: true, sourceVersion: item.updatedAt }] };
    },
    subscribe: listener => service.subscribe(() => { void service.inbox().then(values => { for (const value of values) listener({ kind: 'UPSERT', source: value }); }).catch(() => undefined); }),
    refresh: async ref => ref.source === 'continuity' ? (await service.inbox()).find(value => value.requestId === ref.requestId) : undefined,
    execute: async input => { const ref = input.source.source; if (input.action !== 'OPEN_HANDOFF' || ref.source !== 'continuity') throw new InboxError('ACTION_UNAVAILABLE', 'Continuity action is unavailable'); if (!input.ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Opening a handoff requires explicit owner confirmation'); await service.openIncoming(ref.requestId); return { status: 'OPENED' }; },
    resolve: ref => ref.source === 'continuity' ? service.get(ref.requestId) : undefined,
  };
}

export function createNearbyInboxAdapter(service: Pick<NearbyExchangeService, 'incomingOffers' | 'history' | 'acceptOffer' | 'rejectOffer' | 'subscribe'>): InboxProjectionAdapter<NearbyOffer | NearbyTransfer> {
  const list = async (): Promise<readonly (NearbyOffer | NearbyTransfer)[]> => [...await service.incomingOffers(), ...(await service.history()).filter(value => value.direction === 'INCOMING' && value.status === 'RECEIVED')];
  return {
    sourceKind: 'nearby', trust: 'CORE', list,
    refOf: value => 'preview' in value ? { source: 'nearby', id: value.offerId, recordId: value.offerId, recordKind: 'offer', endpointId: value.endpointId, offerId: value.offerId } : { source: 'nearby', id: value.transferId, recordId: value.transferId, recordKind: 'transfer', endpointId: value.endpointId, offerId: value.offerId },
    project: value => {
      if ('preview' in value) {
        if (value.direction !== 'INCOMING' || value.status !== 'OFFERED') return undefined;
        const source: InboxSourceRef = { source: 'nearby', id: value.offerId, recordId: value.offerId, recordKind: 'offer', endpointId: value.endpointId, offerId: value.offerId };
        return { source, kind: 'TRANSFER', sourceVersion: value.updatedAt, presentation: { title: safeText(value.preview.title, INBOX_MAX_TITLE) || 'Nearby offer', snippet: safeText(value.preview.textPreview ?? value.preview.subtitle ?? '', INBOX_MAX_SNIPPET), sender: 'Nearby device', receivedAt: validDate(value.createdAt), updatedAt: validDate(value.updatedAt), dueAt: validDate(value.expiresAt), groupKey: `nearby:${value.objectType}`, reasons: ['Nearby transfer awaiting consent'], priority: 'time-sensitive', requiresAction: true, dataClass: 'private' }, actions: [{ id: actionId(source, 'ACCEPT_NEARBY'), kind: 'ACCEPT_NEARBY', label: 'Accept', requiresOwnerConfirmation: true, sourceVersion: value.updatedAt }, { id: actionId(source, 'REJECT_NEARBY'), kind: 'REJECT_NEARBY', label: 'Reject', requiresOwnerConfirmation: true, sourceVersion: value.updatedAt }] };
      }
      if (value.direction !== 'INCOMING' || value.status !== 'RECEIVED') return undefined;
      const source: InboxSourceRef = { source: 'nearby', id: value.transferId, recordId: value.transferId, recordKind: 'transfer', endpointId: value.endpointId, offerId: value.offerId };
      return { source, kind: 'TRANSFER', sourceVersion: value.createdAt, presentation: { title: 'Nearby transfer received', snippet: value.objectType, sender: 'Nearby device', receivedAt: validDate(value.createdAt), updatedAt: validDate(value.createdAt), groupKey: `nearby:${value.objectType}`, reasons: ['Nearby transfer completed'], priority: 'completion', requiresAction: false, dataClass: 'private' }, actions: [{ id: actionId(source, 'OPEN_SOURCE'), kind: 'OPEN_SOURCE', label: 'Open transfer', requiresOwnerConfirmation: false, sourceVersion: value.createdAt }] };
    },
    subscribe: listener => service.subscribe(() => { void list().then(values => { for (const value of values) listener({ kind: 'UPSERT', source: value }); }).catch(() => undefined); }),
    refresh: async ref => { if (ref.source !== 'nearby') return undefined; return (await list()).find(value => ('preview' in value ? value.offerId : value.transferId) === ref.recordId); },
    resolve: async ref => { if (ref.source !== 'nearby') return undefined; return (await list()).find(value => ('preview' in value ? value.offerId : value.transferId) === ref.recordId); },
    execute: async input => { const ref = input.source.source; if (input.action === 'OPEN_SOURCE') return { status: 'OPENED' }; if (ref.source !== 'nearby' || ref.recordKind !== 'offer') throw new InboxError('ACTION_UNAVAILABLE', 'Nearby action is unavailable'); if (!input.ownerConfirmed) throw new InboxError('POLICY_DENIED', 'Nearby transfer decisions require explicit owner confirmation'); if (input.action === 'ACCEPT_NEARBY') { await service.acceptOffer(ref.recordId); return { status: 'ACCEPTED' }; } if (input.action === 'REJECT_NEARBY') { await service.rejectOffer(ref.recordId); return { status: 'DECLINED' }; } throw new InboxError('ACTION_UNAVAILABLE', 'Nearby action is unavailable'); },
  };
}

/**
 * Typed bridge for the remaining canonical subsystems (agents, approvals,
 * automation, calendar, workboard, security and system events).  The source
 * owns the projection and revalidates any action; Inbox only supplies a
 * discriminated canonical reference.  This avoids a source switch or a
 * generic serialized callback/action descriptor.
 */
export interface InboxCanonicalProjectionPort {
  readonly sourceKind: Exclude<InboxSourceKind, 'plugin'>;
  readonly trust: Exclude<InboxAdapterTrust, 'PLUGIN'>;
  readonly list: (input: InboxAdapterListInput) => Promise<readonly InboxSourceProjection[]> | readonly InboxSourceProjection[];
  readonly subscribe?: (listener: (event: InboxAdapterEvent<InboxSourceProjection>) => void) => () => void;
  readonly execute?: (input: InboxSourceActionInput) => Promise<InboxActionResult> | InboxActionResult;
  readonly resolve?: (ref: InboxSourceRef) => Promise<unknown> | unknown;
}

export function createCanonicalInboxAdapter(port: InboxCanonicalProjectionPort): InboxProjectionAdapter<InboxSourceProjection> {
  return {
    sourceKind: port.sourceKind,
    trust: port.trust,
    list: port.list,
    project: value => value,
    refOf: value => value.source,
    subscribe: port.subscribe,
    refresh: async ref => (await port.list({ limit: INBOX_MAX_PAGE })).find(value => value.source.source === port.sourceKind && value.source.id === ref.id),
    resolve: port.resolve,
    execute: port.execute ?? (input => input.action === 'OPEN_SOURCE' ? { status: 'OPENED' } : Promise.reject(new InboxError('ACTION_UNAVAILABLE', `No ${port.sourceKind} action boundary is installed`))),
  };
}

export interface InboxNotificationBoundary { readonly deliver: (input: { readonly groupKey: string; readonly sourceKind: InboxSourceKind; readonly itemIds: readonly InboxItemId[]; readonly count: number; readonly actionRequired: boolean }) => Promise<void> | void; }

/** OS delivery is a separate ephemeral boundary; durable Inbox state remains local. */
export class InboxNotificationProjection {
  private readonly unsubscribe: () => void;
  private scheduled = false;
  constructor(private readonly inbox: UniversalInboxService, private readonly boundary: InboxNotificationBoundary, private readonly maxItems = 8) {
    this.unsubscribe = inbox.subscribe(() => this.schedule());
  }
  close(): void { this.unsubscribe(); }
  private schedule(): void { if (this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; void this.deliver().catch(() => undefined); }); }
  private async deliver(): Promise<void> { const result = await this.inbox.list({ view: 'UNREAD', limit: this.maxItems }); const grouped = new Map<string, InboxItem[]>(); for (const item of result.items) { const key = `${item.sourceKind}:${item.presentation.groupKey ?? item.sourceKind}`; const group = grouped.get(key) ?? []; group.push(item); grouped.set(key, group); } for (const [key, items] of grouped) await this.boundary.deliver({ groupKey: key, sourceKind: items[0]!.sourceKind, itemIds: items.map(item => item.id), count: items.length, actionRequired: items.some(item => item.presentation.requiresAction) }); }
}

/** Bounded Daily Layer bridge; it consumes the Inbox projection, not sources. */
export function createInboxDailySource(inbox: UniversalInboxService): DailyContextSource {
  return {
    sourceType: 'messages', sourceId: 'universal-inbox', trust: 'core',
    collect: async (window: DailyContextWindow, _owner: DailyContextOwnerContext): Promise<readonly DailyContextItem[]> => {
      const result = await inbox.list({ view: 'NEEDS_ACTION', limit: Math.min(window.limit, 64) });
      return result.items.map(item => ({ id: item.id, sourceType: 'messages', sourceId: item.sourceKind, canonicalRef: { id: item.id, type: `inbox:${item.kind}`, ...(item.source.source === 'collaboration' && item.source.spaceId ? { spaceId: item.source.spaceId } : {}) }, title: item.presentation.title, ...(item.presentation.snippet ? { summary: item.presentation.snippet } : {}), reason: item.presentation.reasons[0], createdAt: item.presentation.receivedAt, updatedAt: item.presentation.updatedAt, ...(item.presentation.dueAt ? { dueAt: item.presentation.dueAt } : {}), priority: item.presentation.priority, dataClass: item.presentation.dataClass === 'security' ? 'SECRET' : item.presentation.dataClass === 'private' || item.presentation.dataClass === 'sensitive' ? 'PRIVATE' : 'PUBLIC', requiresAction: item.presentation.requiresAction, dedupKey: `inbox:${item.id}`, action: { kind: 'open-object', object: { id: item.id, type: `inbox:${item.kind}` } } } satisfies DailyContextItem));
    },
  };
}

function itemIdFor(ref: InboxSourceRef): InboxItemId { return `inbox:${ref.source}:${encodeURIComponent(ref.id)}` as InboxItemId; }
function actionId(ref: InboxSourceRef, kind: InboxActionKind): InboxActionId { return `inbox-action:${ref.source}:${encodeURIComponent(ref.id)}:${kind}` as InboxActionId; }
function defaultOrganization(now: () => number, deviceId: string): InboxOrganizationState { return { read: false, archived: false, dismissed: false, pinned: false, saved: false, changedAt: new Date(now()).toISOString(), revision: { clock: 0, deviceId } }; }
function clone<T>(value: T): T { return structuredClone(value); }
function safeText(value: unknown, max: number): string { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
function validDate(value: unknown): string { const parsed = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString(); }
function normalizeQuery(value: string | undefined): readonly string[] { return safeText(value ?? '', 256).toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0, 16); }
function clampInt(value: number | undefined, min: number, max: number, fallback = min): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isSafeId(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= INBOX_MAX_SOURCE_ID && !/[\u0000-\u001f\u007f]/.test(value); }
function compareRevision(a: InboxOrganizationState['revision'], b: InboxOrganizationState['revision']): number { return a.clock - b.clock || a.deviceId.localeCompare(b.deviceId); }
function sameOrganization(a: InboxOrganizationState, b: InboxOrganizationState): boolean { return a.read === b.read && a.archived === b.archived && a.dismissed === b.dismissed && a.snoozedUntil === b.snoozedUntil && a.pinned === b.pinned && a.saved === b.saved; }
function validOrganization(value: unknown): value is InboxOrganizationState { return isRecord(value) && typeof value.read === 'boolean' && typeof value.archived === 'boolean' && typeof value.dismissed === 'boolean' && typeof value.pinned === 'boolean' && typeof value.saved === 'boolean' && typeof value.changedAt === 'string' && isRecord(value.revision) && Number.isSafeInteger(value.revision.clock) && typeof value.revision.deviceId === 'string'; }
function normalizeSourceRef(value: unknown): InboxSourceRef | undefined {
  if (!isRecord(value) || typeof value.source !== 'string' || !isSafeId(value.id)) return undefined;
  const source = value.source as InboxSourceKind;
  if (!SOURCE_LABELS[source]) return undefined;
  if (source === 'keystone' && isSafeId(value.notificationId) && isSafeId(value.objectId) && typeof value.objectType === 'string') return { source, id: value.id, notificationId: value.notificationId, objectId: value.objectId, objectType: safeText(value.objectType, 128) };
  if (source === 'mail' && isSafeId(value.accountId) && isSafeId(value.messageId) && isSafeId(value.threadId)) return { source, id: value.id, accountId: value.accountId, messageId: value.messageId, threadId: value.threadId };
  if (source === 'calls' && isSafeId(value.callId) && isSafeId(value.sessionId)) return { source, id: value.id, callId: value.callId, sessionId: value.sessionId };
  if (source === 'collaboration' && isSafeId(value.recordId) && (value.recordKind === 'invitation' || value.recordKind === 'comment') && isSafeId(value.objectId)) return { source, id: value.id, recordId: value.recordId, recordKind: value.recordKind, objectId: value.objectId, ...(isSafeId(value.spaceId) ? { spaceId: value.spaceId } : {}) };
  if (source === 'continuity' && isSafeId(value.requestId) && isSafeId(value.sourceDeviceId)) return { source, id: value.id, requestId: value.requestId, sourceDeviceId: value.sourceDeviceId };
  if (source === 'nearby' && isSafeId(value.recordId) && (value.recordKind === 'offer' || value.recordKind === 'transfer') && isSafeId(value.endpointId)) return { source, id: value.id, recordId: value.recordId, recordKind: value.recordKind, endpointId: value.endpointId, ...(isSafeId(value.offerId) ? { offerId: value.offerId } : {}) };
  if (source === 'agents' && isSafeId(value.runId)) return { source, id: value.id, runId: value.runId, ...(isSafeId(value.sessionId) ? { sessionId: value.sessionId } : {}) };
  if (source === 'approvals' && isSafeId(value.runId) && isSafeId(value.toolId) && Number.isSafeInteger(value.step)) return { source, id: value.id, runId: value.runId, toolId: value.toolId, step: value.step };
  if (source === 'automation' && isSafeId(value.runId)) return { source, id: value.id, runId: value.runId, ...(isSafeId(value.automationId) ? { automationId: value.automationId } : {}) };
  if (source === 'calendar' && isSafeId(value.eventId) && isSafeId(value.calendarId)) return { source, id: value.id, eventId: value.eventId, calendarId: value.calendarId, ...(isSafeId(value.inviteId) ? { inviteId: value.inviteId } : {}) };
  if (source === 'workboard' && isSafeId(value.boardId) && isSafeId(value.itemId)) return { source, id: value.id, boardId: value.boardId, itemId: value.itemId };
  if (source === 'security' && isSafeId(value.eventId)) return { source, id: value.id, eventId: value.eventId };
  if (source === 'system' && isSafeId(value.eventId)) return { source, id: value.id, eventId: value.eventId };
  if (source === 'web' && isSafeId(value.archiveId)) return { source, id: value.id, archiveId: value.archiveId };
  if (source === 'files' && isSafeId(value.folderId) && (value.recordKind === 'invitation' || value.recordKind === 'conflict')) return { source, id: value.id, folderId: value.folderId, recordKind: value.recordKind };
  if (source === 'subscriptions' && isSafeId(value.subscriptionId) && isSafeId(value.entryId) && typeof value.feedUrl === 'string' && isSafeId(value.feedUrl)) return { source, id: value.id, subscriptionId: value.subscriptionId, entryId: value.entryId, feedUrl: value.feedUrl };
  if (source === 'plugin' && isSafeId(value.pluginId) && isSafeId(value.eventId)) return { source, id: value.id, pluginId: value.pluginId, eventId: value.eventId };
  return undefined;
}
function normalizeActions(values: readonly InboxActionDescriptor[], source: InboxSourceRef, sourceVersion: string, trust: InboxAdapterTrust): readonly InboxActionDescriptor[] { if (trust === 'PLUGIN') return [{ id: 'plugin-open' as InboxActionId, kind: 'OPEN_SOURCE', label: 'Open', requiresOwnerConfirmation: false, sourceVersion: safeText(sourceVersion, 128) || '1' }]; const candidates = Array.isArray(values) ? values : []; return candidates.filter(value => value && ALLOWED_ACTIONS.has(value.kind) && allowedAction(source.source, value.kind) && typeof value.label === 'string').slice(0, INBOX_MAX_ACTIONS).map(value => ({ id: actionId(source, value.kind), kind: value.kind, label: safeText(value.label, 128), requiresOwnerConfirmation: value.requiresOwnerConfirmation === true, sourceVersion: safeText(value.sourceVersion, 128) || safeText(sourceVersion, 128) || '1' })); }
function allowedAction(source: InboxSourceKind, action: InboxActionKind): boolean { const actions: Readonly<Record<InboxSourceKind, readonly InboxActionKind[]>> = { keystone: ['OPEN_SOURCE'], mail: ['OPEN_SOURCE', 'REPLY_MAIL'], calls: ['OPEN_SOURCE', 'CALL_BACK'], collaboration: ['OPEN_SOURCE', 'ACCEPT_INVITATION', 'DECLINE_INVITATION'], continuity: ['OPEN_HANDOFF'], nearby: ['OPEN_SOURCE', 'ACCEPT_NEARBY', 'REJECT_NEARBY'], agents: ['OPEN_AGENT_RESULT'], approvals: ['OPEN_SOURCE', 'APPROVE', 'REJECT_APPROVAL'], automation: ['OPEN_SOURCE'], calendar: ['OPEN_SOURCE', 'OPEN_CALENDAR'], workboard: ['OPEN_SOURCE', 'OPEN_TASK'], security: ['OPEN_SOURCE'], system: ['OPEN_SOURCE'], web: ['OPEN_SOURCE'], files: ['OPEN_SOURCE', 'ACCEPT_FOLDER_INVITATION', 'DECLINE_INVITATION', 'OPEN_FOLDER_CONFLICT'], subscriptions: ['OPEN_SUBSCRIPTION'], plugin: ['OPEN_SOURCE'] }; return actions[source].includes(action); }
function normalizePresentation(value: InboxSourceProjection['presentation'], adapter: InboxProjectionAdapter): InboxPresentation { const sourceKind = adapter.sourceKind; const badge: InboxSourceBadge = { source: sourceKind, label: SOURCE_LABELS[sourceKind], trusted: adapter.trust !== 'PLUGIN' }; const reasons = isRecord(value) && Array.isArray(value.reasons) ? value.reasons : []; const priority = isRecord(value) && PRIORITIES.has(value.priority as InboxPriority) ? value.priority as InboxPriority : 'informational'; const dataClass = isRecord(value) && ['public', 'private', 'sensitive', 'security'].includes(String(value.dataClass)) ? value.dataClass as InboxDataClass : 'private'; return { badge, title: safeText(value?.title, INBOX_MAX_TITLE) || SOURCE_LABELS[sourceKind], ...(safeText(value?.snippet, INBOX_MAX_SNIPPET) ? { snippet: safeText(value.snippet, INBOX_MAX_SNIPPET) } : {}), ...(safeText(value?.sender, 320) ? { sender: safeText(value.sender, 320) } : {}), receivedAt: validDate(value?.receivedAt), updatedAt: validDate(value?.updatedAt), ...(value?.dueAt ? { dueAt: validDate(value.dueAt) } : {}), ...(safeText(value?.groupKey, INBOX_MAX_GROUP_KEY) ? { groupKey: safeText(value.groupKey, INBOX_MAX_GROUP_KEY) } : {}), reasons: reasons.filter(reason => typeof reason === 'string').map(reason => safeText(reason, 180)).filter(Boolean).slice(0, 8), priority, requiresAction: value?.requiresAction === true, dataClass }; }
function normalizePersistedItem(value: unknown, key: string, now: () => number, deviceId: string): InboxItem | undefined { if (!isRecord(value) || value.version !== 1 || key !== value.id || !isSafeId(key)) return undefined; const source = normalizeSourceRef(value.source); if (!source || itemIdFor(source) !== key || value.sourceKind !== source.source || typeof value.kind !== 'string' || !ITEM_KINDS.has(value.kind as InboxItemKind) || !validOrganization(value.organization)) return undefined; const presentation = value.presentation as InboxPresentation; if (!isRecord(presentation) || !isRecord(presentation.badge) || presentation.badge.source !== source.source || typeof presentation.title !== 'string' || !PRIORITIES.has(presentation.priority as InboxPriority)) return undefined; const sourceVersion = safeText(value.sourceVersion, 128) || '1'; const actions = normalizeActions(Array.isArray(value.actions) ? value.actions as InboxActionDescriptor[] : [], source, sourceVersion, 'CORE'); const item: InboxItem = { version: 1, id: key as InboxItemId, source, sourceKind: source.source, kind: value.kind as InboxItemKind, sourceVersion, sourceState: ['available', 'unavailable', 'stale', 'revoked', 'removed'].includes(String(value.sourceState)) ? value.sourceState as InboxSourceState : 'stale', presentation: normalizePresentation(presentation, { sourceKind: source.source, trust: 'CORE', list: () => [], project: () => undefined }), organization: { ...value.organization, changedAt: validDate(value.organization.changedAt), revision: { clock: Math.max(0, value.organization.revision.clock), deviceId: safeText(value.organization.revision.deviceId, 128) || deviceId } }, actions }; return item; }
function compareInboxItems(a: InboxItem, b: InboxItem): number { return PRIORITY_ORDER[a.presentation.priority] - PRIORITY_ORDER[b.presentation.priority] || Number(b.organization.pinned) - Number(a.organization.pinned) || Number(b.presentation.requiresAction) - Number(a.presentation.requiresAction) || Date.parse(b.presentation.receivedAt) - Date.parse(a.presentation.receivedAt) || b.presentation.updatedAt.localeCompare(a.presentation.updatedAt) || a.id.localeCompare(b.id); }
function buildGroups(values: readonly InboxItem[]): readonly InboxGroup[] { const groups = new Map<string, InboxGroup>(); for (const item of values) { const key = item.presentation.groupKey ?? `${item.sourceKind}:${item.sourceKind}`; const id = `inbox-group:${item.sourceKind}:${encodeURIComponent(key)}` as InboxGroupId; const previous = groups.get(String(id)); groups.set(String(id), { id, key, sourceKind: item.sourceKind, title: item.presentation.title, count: (previous?.count ?? 0) + 1, unreadCount: (previous?.unreadCount ?? 0) + Number(!item.organization.read), actionCount: (previous?.actionCount ?? 0) + Number(item.presentation.requiresAction) }); } return [...groups.values()].sort((a, b) => b.actionCount - a.actionCount || b.unreadCount - a.unreadCount || a.id.localeCompare(b.id)); }
