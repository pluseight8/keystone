/**
 * R0P91 Tasks, Reminders & Personal Planning.
 *
 * Tasks are a local-first action layer.  They are deliberately not a second
 * Workboard, Calendar or Chronos implementation: lists own task data,
 * Calendar consumes projections, and reminder scheduling is handed to a
 * typed Chronos host boundary.
 */
import * as Y from 'yjs';
import { canonicalJson } from './crypto.js';
import type { NodeId } from './types.js';
import type {
  CollaborationService,
  CollaborationChange,
  SharedObjectAdapter,
} from './collaboration.js';
import type {
  DailyContextItem,
  DailyContextOwnerContext,
  DailyContextSource,
  DailyContextWindow,
} from './daily-layer.js';
import type {
  InboxActionDescriptor,
  InboxActionKind,
  InboxActionResult,
  InboxAdapterEvent,
  InboxAdapterListInput,
  InboxItem,
  InboxProjectionAdapter,
  InboxSourceProjection,
  InboxSourceRef,
} from './inbox.js';

export const TASKS_PROTOCOL = 'keystone.tasks.r0p91' as const;
export const TASKS_VERSION = 1 as const;
export const TASK_INBOX_LIST_ID = 'task-list:inbox' as TaskListId;
export const TASK_MAX_TITLE_BYTES = 4 * 1024;
export const TASK_MAX_NOTE_BYTES = 64 * 1024;
export const TASK_MAX_TAGS = 64;
export const TASK_MAX_TAG_BYTES = 80;
export const TASK_MAX_REFERENCES = 64;
export const TASK_MAX_SUBTASK_DEPTH = 8;
export const TASK_MAX_TASKS = 100_000;
export const TASK_MAX_LISTS = 1_000;
export const TASK_MAX_PAGE = 256;
export const TASK_MAX_RECURRENCE_HISTORY = 512;
export const TASK_MAX_REMINDERS = 16;
export const TASK_MAX_PENDING_EVENTS = 8_192;

export type TaskId = string & { readonly __taskId: unique symbol };
export type TaskListId = string & { readonly __taskListId: unique symbol };
export type TaskReminderId = string & { readonly __taskReminderId: unique symbol };

export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELED';
export type TaskPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskListScope = 'PRIVATE' | 'SHARED';
export type TaskListRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type TaskView = 'INBOX' | 'TODAY' | 'UPCOMING' | 'ALL' | 'COMPLETED' | 'OVERDUE' | 'SOMEDAY' | 'ASSIGNED_TO_ME' | 'SHARED' | 'TRASH';
export type TaskReferenceType = 'file' | 'folder' | 'vault' | 'web-library' | 'mail' | 'message' | 'place' | 'route' | 'calendar-event' | 'workboard' | 'work-item' | 'photo' | 'publication' | 'contact';

export interface TaskDate {
  readonly kind: 'DATE' | 'DATETIME';
  /** YYYY-MM-DD for DATE, ISO-8601 instant or local datetime for DATETIME. */
  readonly value: string;
  /** Owner-local semantics are the default.  The value is explicit for timed work. */
  readonly timezone: string;
}

export type TaskDateInput = string | {
  readonly kind: 'DATE' | 'DATETIME';
  readonly value: string;
  readonly timezone?: string;
};

export type TaskRecurrenceKind = 'FIXED_SCHEDULE' | 'AFTER_COMPLETION';
export type TaskRecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface TaskRecurrence {
  readonly kind: TaskRecurrenceKind;
  readonly frequency: TaskRecurrenceFrequency;
  readonly interval: number;
  /** Sunday = 0.  A weekday list is useful for weekdays and selected days. */
  readonly weekdays?: readonly number[];
  /** Used by monthly schedules when a specific day is desired. */
  readonly dayOfMonth?: number;
  readonly until?: TaskDate;
  readonly count?: number;
}

export interface TaskOccurrenceRecord {
  readonly index: number;
  readonly scheduled?: TaskDate;
  readonly completedAt?: string;
  readonly skippedAt?: string;
  readonly actor: NodeId;
}

export interface TaskRecurrenceState {
  readonly occurrenceIndex: number;
  readonly history: readonly TaskOccurrenceRecord[];
}

export type TaskReminderKind = 'AT_DUE' | 'BEFORE_DUE' | 'ABSOLUTE';

export interface TaskReminder {
  readonly version: 1;
  readonly id: TaskReminderId;
  readonly kind: TaskReminderKind;
  readonly minutesBefore?: number;
  readonly at?: TaskDate;
  readonly snoozedUntil?: TaskDate;
  readonly lastNotifiedAt?: string;
  readonly revision: number;
}

export interface TaskReference {
  readonly version: 1;
  readonly type: TaskReferenceType;
  readonly id: string;
  readonly label?: string;
  readonly uri?: string;
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
  readonly sourceOwnerId?: NodeId;
}

export interface TaskListMember {
  readonly version: 1;
  readonly identityId: NodeId;
  readonly role: TaskListRole;
  readonly joinedAt: string;
  readonly removedAt?: string;
  readonly revision: number;
}

export interface TaskListInvitation {
  readonly version: 1;
  readonly id: string;
  readonly listId: TaskListId;
  readonly inviter: NodeId;
  readonly invitee: NodeId;
  readonly role: Exclude<TaskListRole, 'OWNER'>;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
}

export interface TaskList {
  readonly version: 1;
  readonly id: TaskListId;
  readonly name: string;
  readonly scope: TaskListScope;
  readonly ownerIdentityId: NodeId;
  readonly members: readonly TaskListMember[];
  /** Pending invite targets are metadata, not active access. */
  readonly pendingInvitees?: readonly NodeId[];
  readonly epoch: number;
  readonly pinned: boolean;
  readonly builtIn?: 'INBOX';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly tombstone: boolean;
}

export interface Task {
  readonly version: 1;
  readonly id: TaskId;
  readonly listId: TaskListId;
  readonly title: string;
  readonly note?: string;
  readonly status: TaskStatus;
  readonly orderKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly completedBy?: NodeId;
  readonly start?: TaskDate;
  readonly due?: TaskDate;
  readonly reminders: readonly TaskReminder[];
  readonly recurrence?: TaskRecurrence;
  readonly recurrenceState?: TaskRecurrenceState;
  readonly priority: TaskPriority;
  readonly tags: readonly string[];
  readonly parentId?: TaskId;
  readonly references: readonly TaskReference[];
  readonly assignee?: NodeId;
  readonly revision: number;
  readonly tombstone: boolean;
  readonly deletedAt?: string;
  /** Set when a list was deleted; restoration is explicit and bounded. */
  readonly deletedWithList?: TaskListId;
}

export interface CreateTaskInput {
  readonly id?: TaskId | string;
  readonly listId?: TaskListId | string;
  readonly title: string;
  readonly note?: string;
  readonly start?: TaskDateInput;
  readonly due?: TaskDateInput;
  readonly reminders?: readonly TaskReminderInput[];
  readonly recurrence?: TaskRecurrenceInput;
  readonly priority?: TaskPriority;
  readonly tags?: readonly string[];
  readonly parentId?: TaskId | string;
  readonly references?: readonly TaskReferenceInput[];
  readonly assignee?: NodeId;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly note?: string;
  readonly listId?: TaskListId | string;
  readonly start?: TaskDateInput | null;
  readonly due?: TaskDateInput | null;
  readonly reminders?: readonly TaskReminderInput[];
  readonly recurrence?: TaskRecurrenceInput | null;
  readonly priority?: TaskPriority;
  readonly tags?: readonly string[];
  readonly parentId?: TaskId | string | null;
  readonly references?: readonly TaskReferenceInput[];
  readonly assignee?: NodeId | null;
}

export interface TaskReminderInput {
  readonly id?: TaskReminderId | string;
  readonly kind: TaskReminderKind;
  readonly minutesBefore?: number;
  readonly at?: TaskDateInput;
}

export interface TaskRecurrenceInput {
  readonly kind?: TaskRecurrenceKind;
  readonly frequency: TaskRecurrenceFrequency;
  readonly interval?: number;
  readonly weekdays?: readonly number[];
  readonly dayOfMonth?: number;
  readonly until?: TaskDateInput;
  readonly count?: number;
}

export interface TaskReferenceInput {
  readonly type: TaskReferenceType;
  readonly id: string;
  readonly label?: string;
  readonly uri?: string;
  readonly dataClass?: TaskReference['dataClass'];
  readonly sourceOwnerId?: NodeId;
}

export interface CreateTaskListInput {
  readonly id?: TaskListId | string;
  readonly name: string;
  readonly scope?: TaskListScope;
  readonly pinned?: boolean;
}

export interface UpdateTaskListInput {
  readonly name?: string;
  readonly pinned?: boolean;
}

export interface TaskQuery {
  readonly view?: TaskView;
  readonly listId?: TaskListId | string;
  readonly status?: TaskStatus;
  readonly query?: string;
  readonly tag?: string;
  readonly assignee?: NodeId;
  readonly parentId?: TaskId | string | null;
  readonly includeTrash?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface TaskPage {
  readonly items: readonly Task[];
  readonly total: number;
  readonly nextCursor?: string;
}

export interface TaskChange {
  readonly kind: 'TASK_UPSERT' | 'TASK_REMOVE' | 'LIST_UPSERT' | 'REMINDER' | 'SYNC' | 'CONFLICT';
  readonly taskId?: TaskId;
  readonly listId?: TaskListId;
  readonly origin: 'LOCAL' | 'REMOTE' | 'SYSTEM';
}

export interface TaskStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryTaskStateStore implements TaskStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  corrupt(value: unknown): void { this.value = structuredClone(value); }
}

export class PersistentTaskStateStore implements TaskStateStore {
  constructor(private readonly backend: TaskStateStore) {}
  read(): Promise<unknown | undefined> { return this.backend.read(); }
  write(value: unknown): Promise<void> { return this.backend.write(value); }
}

export interface TaskSigner {
  sign(payload: string, actor?: NodeId): Promise<string> | string;
  verify?(payload: string, signature: string, actor: NodeId): Promise<boolean> | boolean;
}

export interface TaskReminderSchedule {
  readonly id: string;
  readonly taskId: TaskId;
  readonly reminderId: TaskReminderId;
  readonly version: number;
  readonly dueAt: string;
  readonly timezone: string;
  readonly action: 'task.reminder';
  readonly payload: Readonly<Record<string, string>>;
}

export interface TaskReminderScheduler {
  schedule(input: TaskReminderSchedule): Promise<void>;
  cancel?(id: string): Promise<void>;
  recover?(input: TaskReminderSchedule): Promise<void>;
}

/** Chronos host port.  This is an adapter, not a new scheduler or timer. */
export interface ChronosTaskPort {
  schedule(input: TaskReminderSchedule): Promise<void>;
  cancel?(id: string): Promise<void>;
  recover?(input: TaskReminderSchedule): Promise<void>;
}

export class ChronosTaskReminderScheduler implements TaskReminderScheduler {
  constructor(private readonly chronos: ChronosTaskPort) {}
  schedule(input: TaskReminderSchedule): Promise<void> { return this.chronos.schedule(input); }
  cancel(id: string): Promise<void> { return this.chronos.cancel?.(id) ?? Promise.resolve(); }
  recover(input: TaskReminderSchedule): Promise<void> { return this.chronos.recover?.(input) ?? this.chronos.schedule(input); }
}

export interface TaskNotification {
  readonly id: string;
  readonly taskId: TaskId;
  readonly reminderId: TaskReminderId;
  readonly title: string;
  readonly body: string;
  readonly dueAt: string;
  readonly actions: readonly ('COMPLETE' | 'SNOOZE' | 'OPEN')[];
  readonly privacy: 'TITLE' | 'GENERIC';
  readonly missed?: boolean;
}

export interface TaskNotificationBoundary {
  notify(value: TaskNotification): Promise<void> | void;
  notifyBatch?(values: readonly TaskNotification[]): Promise<void> | void;
}

export interface TaskNotificationActionInput {
  readonly taskId: TaskId | string;
  readonly action: 'COMPLETE' | 'SNOOZE' | 'OPEN';
  readonly reminderId?: TaskReminderId | string;
  readonly until?: TaskDateInput;
  readonly expectedRevision?: number;
  readonly actor?: NodeId;
}

export interface TaskReplicationEvent {
  readonly version: 1;
  readonly protocol: typeof TASKS_PROTOCOL;
  readonly id: string;
  readonly listId: TaskListId;
  readonly operation: 'list.upsert' | 'list.invite' | 'list.accept' | 'list.leave' | 'task.upsert' | 'task.delete';
  readonly targetId: string;
  readonly epoch: number;
  readonly revision: number;
  readonly actor: NodeId;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly signature?: string;
}

export interface TaskReplicationAdapter {
  publish(event: TaskReplicationEvent, recipients?: readonly NodeId[]): Promise<void> | void;
}

export interface TaskReferenceResolver {
  resolve(input: { readonly reference: TaskReference; readonly actor: NodeId }): Promise<{ readonly available: boolean; readonly label?: string; readonly authorized: boolean }> | { readonly available: boolean; readonly label?: string; readonly authorized: boolean };
}

export interface TaskCalendarAdapter {
  createTimeBlock(input: { readonly task: Task; readonly start: string; readonly end: string; readonly timezone: string }): Promise<{ readonly eventId: string }>;
}

export interface TaskWorkboardAdapter {
  createCard(input: { readonly task: Task; readonly title: string; readonly note?: string }): Promise<{ readonly boardId: string; readonly itemId: string }>;
  referenceCard?(input: { readonly boardId: string; readonly itemId: string }): Promise<{ readonly title?: string }>;
}

export interface TaskCollaborationPort {
  createList(input: { readonly list: TaskList; readonly tasks: readonly Task[] }): Promise<void>;
  editList(listId: TaskListId, edit: TaskListCollaborationEdit): Promise<void>;
  snapshotList(listId: TaskListId): Promise<TaskListCollaborationSnapshot>;
  subscribeList(listId: TaskListId, listener: () => void): () => void;
}

export interface TaskListCollaborationSnapshot {
  readonly version: 1;
  readonly list: TaskList;
  readonly tasks: readonly Task[];
}

export type TaskListCollaborationEdit =
  | { readonly type: 'upsert_task'; readonly task: Task }
  | { readonly type: 'remove_task'; readonly taskId: TaskId }
  | { readonly type: 'replace_list'; readonly list: TaskList };

export interface TaskServiceOptions {
  readonly identityId: NodeId;
  readonly deviceId?: string;
  readonly store?: TaskStateStore;
  readonly now?: () => number;
  readonly defaultTimezone?: string;
  readonly maxTasks?: number;
  readonly maxLists?: number;
  readonly reminderScheduler?: TaskReminderScheduler;
  readonly notifications?: TaskNotificationBoundary;
  readonly replication?: TaskReplicationAdapter;
  /** Peer node IDs for other devices owned by the same identity. */
  readonly ownerDeviceRecipients?: readonly NodeId[];
  readonly signer?: TaskSigner;
  readonly collaboration?: TaskCollaborationPort;
  readonly referenceResolver?: TaskReferenceResolver;
  readonly calendar?: TaskCalendarAdapter;
  readonly workboards?: TaskWorkboardAdapter;
}

export class TaskError extends Error {
  constructor(readonly code: TaskErrorCode, message: string) {
    super(message);
    this.name = 'TaskError';
  }
}

export type TaskErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_DATE'
  | 'INVALID_RECURRENCE'
  | 'INVALID_REFERENCE'
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'STALE_EPOCH'
  | 'CYCLE'
  | 'DEPTH_EXCEEDED'
  | 'BOUNDS_EXCEEDED'
  | 'CORRUPT_STATE'
  | 'SOURCE_UNAVAILABLE'
  | 'REMINDER_UNAVAILABLE'
  | 'INVALID_STATE';

interface PersistedTaskState {
  readonly version: 1;
  readonly lists: readonly TaskList[];
  readonly tasks: readonly Task[];
  readonly invitations: readonly TaskListInvitation[];
  readonly seenEvents: readonly string[];
  readonly missedReminderNotices?: readonly string[];
}

interface TaskServiceDiagnostics {
  readonly tasks: number;
  readonly lists: number;
  readonly activeTasks: number;
  readonly completedTasks: number;
  readonly trashedTasks: number;
  readonly sharedLists: number;
  readonly indexedTokens: number;
  readonly scheduledReminders: number;
  readonly reminderFailures: number;
  readonly listeners: number;
  readonly pendingEvents: number;
}

const ORDER_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TASK_REFERENCE_TYPES = new Set<TaskReferenceType>(['file', 'folder', 'vault', 'web-library', 'mail', 'message', 'place', 'route', 'calendar-event', 'workboard', 'work-item', 'photo', 'publication', 'contact']);
const TASK_REFERENCE_DATA_CLASSES = new Set<TaskReference['dataClass']>(['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET']);
const TASK_PRIORITIES = new Set<TaskPriority>(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const TASK_DATE_KINDS = new Set(['DATE', 'DATETIME']);
const TASK_RECURRENCE_FREQUENCIES = new Set<TaskRecurrenceFrequency>(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const TASK_RECURRENCE_KINDS = new Set<TaskRecurrenceKind>(['FIXED_SCHEDULE', 'AFTER_COMPLETION']);

export class TaskService {
  private readonly identityId: NodeId;
  private readonly deviceId: string;
  private readonly store: TaskStateStore;
  private readonly now: () => number;
  private readonly defaultTimezone: string;
  private readonly maxTasks: number;
  private readonly maxLists: number;
  private readonly reminderScheduler?: TaskReminderScheduler;
  private readonly notifications?: TaskNotificationBoundary;
  private readonly replication?: TaskReplicationAdapter;
  private readonly ownerDeviceRecipients: readonly NodeId[];
  private readonly signer?: TaskSigner;
  private readonly collaboration?: TaskCollaborationPort;
  private readonly referenceResolver?: TaskReferenceResolver;
  private readonly calendar?: TaskCalendarAdapter;
  private readonly workboards?: TaskWorkboardAdapter;
  private readonly lists = new Map<TaskListId, TaskList>();
  private readonly tasks = new Map<TaskId, Task>();
  private readonly invitations = new Map<string, TaskListInvitation>();
  private readonly listeners = new Set<(change: TaskChange) => void>();
  private readonly searchIndex = new Map<string, Set<TaskId>>();
  private readonly scheduled = new Map<string, TaskReminderSchedule>();
  private readonly reminderFailures = new Set<string>();
  private readonly firedReminders = new Set<string>();
  private readonly missedReminderNotices = new Set<string>();
  private readonly seenEvents = new Set<string>();
  private readonly collaborationUnsubscribers = new Map<TaskListId, () => void>();
  private writes: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private closed = false;

  constructor(options: TaskServiceOptions) {
    if (!safeId(options.identityId, 512)) throw new TaskError('INVALID_ARGUMENT', 'TaskService requires an owner identity');
    this.identityId = options.identityId;
    this.deviceId = normalizeText(options.deviceId ?? 'local-device', 128) || 'local-device';
    this.store = options.store ?? new InMemoryTaskStateStore();
    this.now = options.now ?? Date.now;
    this.defaultTimezone = validTimezone(options.defaultTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
    this.maxTasks = boundedInt(options.maxTasks, 1, TASK_MAX_TASKS, TASK_MAX_TASKS);
    this.maxLists = boundedInt(options.maxLists, 1, TASK_MAX_LISTS, TASK_MAX_LISTS);
    this.reminderScheduler = options.reminderScheduler;
    this.notifications = options.notifications;
    this.replication = options.replication;
    this.ownerDeviceRecipients = [...new Set((options.ownerDeviceRecipients ?? []).filter(value => safeId(value, 512) && value !== options.identityId))].slice(0, 32);
    this.signer = options.signer;
    this.collaboration = options.collaboration;
    this.referenceResolver = options.referenceResolver;
    this.calendar = options.calendar;
    this.workboards = options.workboards;
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  subscribe(listener: (change: TaskChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createList(input: CreateTaskListInput): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    if (this.lists.size >= this.maxLists) throw new TaskError('BOUNDS_EXCEEDED', 'Task list bound exceeded');
    const name = boundedUserText(input.name, 240, 'List name');
    const scope = input.scope ?? 'PRIVATE';
    if (!['PRIVATE', 'SHARED'].includes(scope)) throw new TaskError('INVALID_ARGUMENT', 'Task list scope is invalid');
    const id = asListId(input.id ?? randomId('task-list'));
    if (this.lists.has(id)) throw new TaskError('ALREADY_EXISTS', 'Task list already exists');
    const now = isoNow(this.now);
    const list: TaskList = {
      version: 1, id, name, scope, ownerIdentityId: this.identityId,
      members: [{ version: 1, identityId: this.identityId, role: 'OWNER', joinedAt: now, revision: 1 }],
      epoch: 1, pinned: input.pinned === true, createdAt: now, updatedAt: now, revision: 1, tombstone: false,
    };
    this.lists.set(id, list);
    await this.persist();
    if (list.scope === 'SHARED') await this.installCollaboration(list);
    await this.publishList(list);
    this.emit({ kind: 'LIST_UPSERT', listId: id, origin: 'LOCAL' });
    return clone(list);
  }

  async updateList(listId: TaskListId | string, patch: UpdateTaskListInput, actor: NodeId = this.identityId): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const current = this.requireList(asListId(listId));
    this.requireListPermission(current, actor, 'edit');
    const name = patch.name === undefined ? current.name : boundedUserText(patch.name, 240, 'List name');
    const next: TaskList = { ...current, name, pinned: patch.pinned ?? current.pinned, updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.lists.set(current.id, next);
    await this.persist();
    await this.publishList(next);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async listLists(options: { readonly includeTrash?: boolean; readonly scope?: TaskListScope } = {}): Promise<readonly TaskList[]> {
    await this.ready();
    return [...this.lists.values()].filter(value => (options.includeTrash || !value.tombstone) && (!options.scope || value.scope === options.scope)).sort(compareLists).map(clone);
  }

  getList(listId: TaskListId | string, options: { readonly includeTrash?: boolean } = {}): TaskList {
    const list = this.requireList(asListId(listId));
    if (list.tombstone && !options.includeTrash) throw new TaskError('NOT_FOUND', 'Task list is in Trash');
    return clone(list);
  }

  async deleteList(listId: TaskListId | string, actor: NodeId = this.identityId): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const current = this.requireList(asListId(listId));
    if (current.builtIn === 'INBOX') throw new TaskError('INVALID_STATE', 'The built-in Task Inbox cannot be deleted');
    this.requireListPermission(current, actor, 'manage');
    const next: TaskList = { ...current, tombstone: true, updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.lists.set(next.id, next);
    for (const task of this.tasks.values()) if (task.listId === next.id && !task.tombstone) {
      const deleted: Task = { ...task, tombstone: true, deletedAt: next.updatedAt, deletedWithList: next.id, updatedAt: next.updatedAt, revision: task.revision + 1 };
      this.replaceTask(deleted);
      await this.cancelTaskReminders(task);
      await this.publishTask(deleted, 'task.delete');
    }
    await this.persist();
    await this.publishList(next);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async restoreList(listId: TaskListId | string, actor: NodeId = this.identityId): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const current = this.requireList(asListId(listId), true);
    this.requireListPermission(current, actor, 'manage');
    const next: TaskList = { ...current, tombstone: false, updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.lists.set(next.id, next);
    for (const task of this.tasks.values()) if (task.deletedWithList === next.id && task.tombstone) {
      const restored: Task = { ...task, tombstone: false, deletedAt: undefined, deletedWithList: undefined, reminders: resetReminderDeliveries(task.reminders), updatedAt: next.updatedAt, revision: task.revision + 1 };
      this.replaceTask(restored);
      await this.reconcileTaskReminders(restored);
      await this.publishTask(restored, 'task.upsert');
    }
    await this.persist();
    await this.publishList(next);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async createTask(input: CreateTaskInput, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    if (this.tasks.size >= this.maxTasks) throw new TaskError('BOUNDS_EXCEEDED', 'Task bound exceeded');
    const list = this.requireList(asListId(input.listId ?? TASK_INBOX_LIST_ID));
    this.requireListPermission(list, actor, 'edit');
    const id = asTaskId(input.id ?? randomId('task'));
    if (this.tasks.has(id)) throw new TaskError('ALREADY_EXISTS', 'Task already exists');
    const now = isoNow(this.now);
    const parentId = input.parentId === undefined ? undefined : asTaskId(input.parentId);
    if (parentId) this.assertParentAllowed(id, list.id, parentId);
    const task: Task = {
      version: 1, id, listId: list.id, title: boundedUserText(input.title, 4_000, 'Task title'),
      ...(input.note === undefined ? {} : { note: boundedUserText(input.note, 64_000, 'Task note') }), status: 'OPEN',
      orderKey: this.orderKeyFor(list.id), createdAt: now, updatedAt: now,
      ...(input.start === undefined ? {} : { start: normalizeDate(input.start, this.defaultTimezone) }),
      ...(input.due === undefined ? {} : { due: normalizeDate(input.due, this.defaultTimezone) }),
      reminders: normalizeReminders(input.reminders ?? [], this.defaultTimezone),
      ...(input.recurrence === undefined ? {} : { recurrence: normalizeRecurrence(input.recurrence, this.defaultTimezone) }),
      priority: normalizePriority(input.priority), tags: normalizeTags(input.tags), ...(parentId ? { parentId } : {}),
      references: normalizeReferences(input.references), ...(input.assignee ? { assignee: input.assignee } : {}), revision: 1, tombstone: false,
    };
    this.validateScheduleAndRecurrence(task);
    if (task.assignee) this.assertAssignee(list, task.assignee, actor);
    this.replaceTask(task);
    await this.persist();
    await this.reconcileTaskReminders(task);
    await this.publishTask(task, 'task.upsert');
    await this.publishCollaborationTask(task);
    this.emit({ kind: 'TASK_UPSERT', taskId: id, listId: list.id, origin: 'LOCAL' });
    return clone(task);
  }

  async quickCapture(input: string, options: { readonly listId?: TaskListId | string; readonly locale?: 'en' | 'ru'; readonly timezone?: string; readonly actor?: NodeId } = {}): Promise<Task> {
    await this.ready();
    const parsed = parseTaskQuickCapture(input, { now: this.now(), timezone: options.timezone ?? this.defaultTimezone, locale: options.locale });
    return this.createTask({ title: parsed.title, ...(parsed.due ? { due: parsed.due } : {}), listId: options.listId }, options.actor ?? this.identityId);
  }

  previewQuickCapture(input: string, options: { readonly locale?: 'en' | 'ru'; readonly timezone?: string } = {}): TaskQuickCapturePreview {
    return parseTaskQuickCapture(input, { now: this.now(), timezone: options.timezone ?? this.defaultTimezone, locale: options.locale });
  }

  getTask(taskId: TaskId | string, options: { readonly includeTrash?: boolean } = {}): Task {
    const task = this.requireTask(asTaskId(taskId));
    if (task.tombstone && !options.includeTrash) throw new TaskError('NOT_FOUND', 'Task is in Trash');
    return clone(task);
  }

  async updateTask(taskId: TaskId | string, patch: UpdateTaskInput, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId));
    if (current.tombstone) throw new TaskError('INVALID_STATE', 'A trashed Task must be restored before editing');
    const currentList = this.requireList(current.listId);
    this.requireListPermission(currentList, actor, 'edit');
    const targetList = patch.listId === undefined ? currentList : this.requireList(asListId(patch.listId));
    if (targetList.id !== currentList.id) {
      this.requireListPermission(targetList, actor, 'edit');
      if (targetList.scope === 'SHARED' && currentList.scope !== 'SHARED' && actor !== this.identityId) throw new TaskError('NOT_AUTHORIZED', 'Moving a private Task into a shared list requires the owner');
    }
    const parentId = patch.parentId === undefined ? current.parentId : patch.parentId === null ? undefined : asTaskId(patch.parentId);
    if (parentId) this.assertParentAllowed(current.id, targetList.id, parentId);
    const scheduleChanged = patch.start !== undefined || patch.due !== undefined || patch.reminders !== undefined || patch.recurrence !== undefined;
    const next: Task = {
      ...current,
      ...(patch.title === undefined ? {} : { title: boundedUserText(patch.title, 4_000, 'Task title') }),
      ...(patch.note === undefined ? {} : { note: boundedUserText(patch.note, 64_000, 'Task note') }),
      ...(patch.listId === undefined ? {} : { listId: targetList.id, orderKey: this.orderKeyFor(targetList.id) }),
      ...(patch.start === undefined ? {} : { start: patch.start === null ? undefined : normalizeDate(patch.start, this.defaultTimezone) }),
      ...(patch.due === undefined ? {} : { due: patch.due === null ? undefined : normalizeDate(patch.due, this.defaultTimezone) }),
      ...(patch.reminders === undefined ? {} : { reminders: normalizeReminders(patch.reminders, this.defaultTimezone) }),
      ...(scheduleChanged && patch.reminders === undefined ? { reminders: resetReminderDeliveries(current.reminders) } : {}),
      ...(patch.recurrence === undefined ? {} : { recurrence: patch.recurrence === null ? undefined : normalizeRecurrence(patch.recurrence, this.defaultTimezone), recurrenceState: undefined }),
      ...(patch.priority === undefined ? {} : { priority: normalizePriority(patch.priority) }),
      ...(patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) }),
      ...(patch.parentId === undefined ? {} : { parentId }),
      ...(patch.references === undefined ? {} : { references: normalizeReferences(patch.references) }),
      ...(patch.assignee === undefined ? {} : { assignee: patch.assignee === null ? undefined : patch.assignee }),
      updatedAt: isoNow(this.now), revision: current.revision + 1,
    };
    this.validateScheduleAndRecurrence(next);
    if (next.assignee) this.assertAssignee(targetList, next.assignee, actor);
    this.replaceTask(next);
    await this.persist();
    await this.reconcileTaskReminders(current);
    await this.reconcileTaskReminders(next);
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async completeTask(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId));
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    if (current.tombstone) throw new TaskError('INVALID_STATE', 'Cannot complete a trashed Task');
    const now = isoNow(this.now);
    if (current.recurrence) {
      const occurrence = current.recurrenceState?.occurrenceIndex ?? 0;
      const history = [...(current.recurrenceState?.history ?? []), { index: occurrence, ...(current.due ? { scheduled: current.due } : {}), completedAt: now, actor }].slice(-TASK_MAX_RECURRENCE_HISTORY);
      const nextDate = nextRecurringDate(current, now);
      const exhausted = !nextDate || recurrenceExhausted(current.recurrence, history.length, nextDate);
      const next: Task = exhausted ? { ...current, status: 'COMPLETED', completedAt: now, completedBy: actor, recurrenceState: { occurrenceIndex: occurrence, history }, updatedAt: now, revision: current.revision + 1 } : { ...current, status: 'OPEN', completedAt: undefined, completedBy: undefined, due: nextDate, reminders: resetReminderDeliveries(current.reminders), recurrenceState: { occurrenceIndex: occurrence + 1, history }, updatedAt: now, revision: current.revision + 1 };
      this.replaceTask(next);
      await this.persist();
      await this.reconcileTaskReminders(current);
      await this.reconcileTaskReminders(next);
      await this.publishTask(next, 'task.upsert');
      await this.publishCollaborationTask(next);
      this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
      return clone(next);
    }
    const next: Task = { ...current, status: 'COMPLETED', completedAt: now, completedBy: actor, updatedAt: now, revision: current.revision + 1 };
    this.replaceTask(next);
    await this.cancelTaskReminders(current);
    await this.persist();
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async reopenTask(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId), true);
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    if (current.tombstone) throw new TaskError('INVALID_STATE', 'Restore a trashed Task before reopening it');
    const next: Task = { ...current, status: 'OPEN', completedAt: undefined, completedBy: undefined, reminders: resetReminderDeliveries(current.reminders), updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.persist();
    await this.reconcileTaskReminders(next);
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async deleteTask(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId));
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    const next: Task = { ...current, tombstone: true, deletedAt: isoNow(this.now), updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.cancelTaskReminders(current);
    await this.persist();
    await this.publishTask(next, 'task.delete');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_REMOVE', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async restoreTask(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId), true);
    const list = this.requireList(current.listId, true);
    this.requireListPermission(list, actor, 'edit');
    const next: Task = { ...current, tombstone: false, deletedAt: undefined, reminders: resetReminderDeliveries(current.reminders), updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.persist();
    await this.reconcileTaskReminders(next);
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async reorderTask(taskId: TaskId | string, input: { readonly beforeTaskId?: TaskId | string; readonly afterTaskId?: TaskId | string }, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    if (input.beforeTaskId && input.afterTaskId && String(input.beforeTaskId) === String(input.afterTaskId)) throw new TaskError('INVALID_ARGUMENT', 'Before and after Task cannot be the same');
    const current = this.requireTask(asTaskId(taskId));
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    const before = input.beforeTaskId ? this.requireTask(asTaskId(input.beforeTaskId)) : undefined;
    const after = input.afterTaskId ? this.requireTask(asTaskId(input.afterTaskId)) : undefined;
    if (before?.id === current.id || after?.id === current.id) throw new TaskError('INVALID_ARGUMENT', 'A Task cannot be ordered relative to itself');
    if (before && before.listId !== current.listId) throw new TaskError('INVALID_ARGUMENT', 'Before Task belongs to another list');
    if (after && after.listId !== current.listId) throw new TaskError('INVALID_ARGUMENT', 'After Task belongs to another list');
    if (before && after && before.orderKey >= after.orderKey) throw new TaskError('INVALID_ARGUMENT', 'Order bounds are not increasing');
    const next: Task = { ...current, orderKey: orderKeyBetween(before?.orderKey, after?.orderKey), updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.persist();
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async addSubtask(parentTaskId: TaskId | string, input: Omit<CreateTaskInput, 'parentId' | 'listId'> & { readonly listId?: TaskListId | string }, actor: NodeId = this.identityId): Promise<Task> {
    const parent = this.getTask(asTaskId(parentTaskId));
    if (input.listId !== undefined && String(input.listId) !== String(parent.listId)) throw new TaskError('INVALID_ARGUMENT', 'Subtask must remain in its parent list');
    return this.createTask({ ...input, listId: parent.listId, parentId: parent.id }, actor);
  }

  async skipOccurrence(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId));
    if (!current.recurrence) throw new TaskError('INVALID_STATE', 'Only recurring Tasks have occurrences to skip');
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    const index = current.recurrenceState?.occurrenceIndex ?? 0;
    const history = [...(current.recurrenceState?.history ?? []), { index, ...(current.due ? { scheduled: current.due } : {}), skippedAt: isoNow(this.now), actor }].slice(-TASK_MAX_RECURRENCE_HISTORY);
    const nextDate = nextRecurringDate(current, isoNow(this.now));
    const next: Task = nextDate ? { ...current, due: nextDate, reminders: resetReminderDeliveries(current.reminders), recurrenceState: { occurrenceIndex: index + 1, history }, updatedAt: isoNow(this.now), revision: current.revision + 1 } : { ...current, status: 'COMPLETED', recurrenceState: { occurrenceIndex: index, history }, completedAt: isoNow(this.now), completedBy: actor, updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.persist();
    await this.reconcileTaskReminders(current);
    await this.reconcileTaskReminders(next);
    await this.publishTask(next, 'task.upsert');
    await this.publishCollaborationTask(next);
    this.emit({ kind: 'TASK_UPSERT', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async snoozeReminder(taskId: TaskId | string, reminderId: TaskReminderId | string, until: TaskDateInput, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    const current = this.requireTask(asTaskId(taskId));
    const list = this.requireList(current.listId);
    this.requireListPermission(list, actor, 'edit');
    const id = asReminderId(reminderId);
    if (!current.reminders.some(reminder => reminder.id === id)) throw new TaskError('NOT_FOUND', 'Reminder was not found');
    const snoozed = normalizeDate(until, this.defaultTimezone);
    const reminders = current.reminders.map(reminder => reminder.id === id ? resetReminderDelivery(reminder, { snoozedUntil: snoozed }) : reminder);
    const next: Task = { ...current, reminders, updatedAt: isoNow(this.now), revision: current.revision + 1 };
    this.replaceTask(next);
    await this.persist();
    await this.reconcileTaskReminders(current);
    await this.reconcileTaskReminders(next);
    await this.publishTask(next, 'task.upsert');
    this.emit({ kind: 'REMINDER', taskId: next.id, listId: next.listId, origin: 'LOCAL' });
    return clone(next);
  }

  async postponeTask(taskId: TaskId | string, due: TaskDateInput, actor: NodeId = this.identityId): Promise<Task> {
    return this.updateTask(taskId, { due }, actor);
  }

  async listTasks(options: TaskQuery = {}): Promise<TaskPage> {
    await this.ready();
    const limit = boundedInt(options.limit, 1, TASK_MAX_PAGE, 64);
    const values = this.queryTasks(options);
    const start = options.cursor ? Math.max(0, values.findIndex(value => value.id === options.cursor) + 1) : 0;
    const items = values.slice(start, start + limit).map(clone);
    return { items, total: values.length, ...(start + limit < values.length && items.length ? { nextCursor: items.at(-1)!.id } : {}) };
  }

  async searchTasks(query: string, options: Omit<TaskQuery, 'query'> = {}): Promise<TaskPage> {
    return this.listTasks({ ...options, query });
  }

  async moveTask(taskId: TaskId | string, listId: TaskListId | string, actor: NodeId = this.identityId): Promise<Task> {
    return this.updateTask(taskId, { listId }, actor);
  }

  async assignTask(taskId: TaskId | string, assignee: NodeId | null, actor: NodeId = this.identityId): Promise<Task> {
    return this.updateTask(taskId, { assignee }, actor);
  }

  async createSharedList(input: Omit<CreateTaskListInput, 'scope'>): Promise<TaskList> { return this.createList({ ...input, scope: 'SHARED' }); }

  async inviteToList(listId: TaskListId | string, input: { readonly invitee: NodeId; readonly role: Exclude<TaskListRole, 'OWNER'>; readonly expiresAt?: string }, actor: NodeId = this.identityId): Promise<TaskListInvitation> {
    await this.ready();
    this.assertOpen();
    const list = this.requireList(asListId(listId));
    this.requireListPermission(list, actor, 'manage');
    if (list.scope !== 'SHARED' || !safeId(input.invitee, 512) || input.invitee === list.ownerIdentityId) throw new TaskError('INVALID_ARGUMENT', 'Shared-list invitation target is invalid');
    if (!['EDITOR', 'VIEWER'].includes(input.role)) throw new TaskError('INVALID_ARGUMENT', 'Task list role is invalid');
    const expiresAt = input.expiresAt ?? new Date(this.now() + 7 * 24 * 60 * 60_000).toISOString();
    const expires = Date.parse(expiresAt);
    if (!Number.isFinite(expires) || expires <= this.now() || expires - this.now() > 30 * 24 * 60 * 60_000) throw new TaskError('INVALID_ARGUMENT', 'Invitation expiry is invalid');
    const invitation: TaskListInvitation = { version: 1, id: randomId('task-invite'), listId: list.id, inviter: actor, invitee: input.invitee, role: input.role, createdAt: isoNow(this.now), expiresAt, status: 'PENDING' };
    const pendingList: TaskList = { ...list, pendingInvitees: [...new Set([...(list.pendingInvitees ?? []), input.invitee])], updatedAt: isoNow(this.now), revision: list.revision + 1 };
    this.lists.set(list.id, pendingList);
    this.invitations.set(invitation.id, invitation);
    await this.persist();
    await this.publishList(pendingList, [input.invitee]);
    await this.publishInvitation(invitation, [input.invitee]);
    return clone(invitation);
  }

  listInvitations(listId?: TaskListId | string): readonly TaskListInvitation[] {
    const id = listId === undefined ? undefined : asListId(listId);
    return [...this.invitations.values()].filter(value => !id || value.listId === id).map(clone);
  }

  async acceptListInvitation(invitationId: string): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw new TaskError('NOT_FOUND', 'Task-list invitation was not found');
    if (invitation.invitee !== this.identityId) throw new TaskError('NOT_AUTHORIZED', 'Invitation belongs to another identity');
    if (Date.parse(invitation.expiresAt) <= this.now()) { this.invitations.set(invitation.id, { ...invitation, status: 'EXPIRED' }); await this.persist(); throw new TaskError('INVALID_STATE', 'Task-list invitation expired'); }
    if (invitation.status !== 'PENDING') throw new TaskError('INVALID_STATE', 'Task-list invitation is not pending');
    const list = this.requireList(invitation.listId, true);
    if (list.members.some(member => member.identityId === this.identityId && !member.removedAt)) throw new TaskError('ALREADY_EXISTS', 'Identity is already a list member');
    const nextMember: TaskListMember = { version: 1, identityId: this.identityId, role: invitation.role, joinedAt: isoNow(this.now), revision: 1 };
    const next: TaskList = { ...list, members: [...list.members.filter(member => member.identityId !== this.identityId), nextMember], pendingInvitees: (list.pendingInvitees ?? []).filter(identityId => identityId !== this.identityId), epoch: list.epoch + 1, updatedAt: isoNow(this.now), revision: list.revision + 1, tombstone: false };
    this.lists.set(next.id, next);
    this.invitations.set(invitation.id, { ...invitation, status: 'ACCEPTED' });
    await this.persist();
    if (next.scope === 'SHARED') await this.installCollaboration(next);
    await this.publishAcceptance(invitation);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async revokeListMember(listId: TaskListId | string, identityId: NodeId, actor: NodeId = this.identityId): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const list = this.requireList(asListId(listId));
    this.requireListPermission(list, actor, 'manage');
    if (identityId === list.ownerIdentityId) throw new TaskError('NOT_AUTHORIZED', 'The list owner cannot be revoked');
    const member = list.members.find(value => value.identityId === identityId && !value.removedAt);
    if (!member) throw new TaskError('NOT_FOUND', 'Active list member was not found');
    const next: TaskList = { ...list, members: list.members.map(value => value.identityId === identityId ? { ...value, removedAt: isoNow(this.now), revision: value.revision + 1 } : value), epoch: list.epoch + 1, updatedAt: isoNow(this.now), revision: list.revision + 1 };
    this.lists.set(next.id, next);
    for (const task of this.tasks.values()) if (task.listId === next.id && task.assignee === identityId) {
      const unassigned: Task = { ...task, assignee: undefined, updatedAt: next.updatedAt, revision: task.revision + 1 };
      this.replaceTask(unassigned);
      await this.publishTask(unassigned, 'task.upsert');
    }
    await this.persist();
    await this.publishList(next, [...new Set([identityId, ...this.recipients(next.id)])]);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async leaveList(listId: TaskListId | string): Promise<TaskList> {
    await this.ready();
    this.assertOpen();
    const list = this.requireList(asListId(listId));
    if (list.ownerIdentityId === this.identityId) throw new TaskError('INVALID_STATE', 'The owner must delete or transfer the list');
    const member = list.members.find(value => value.identityId === this.identityId && !value.removedAt);
    if (!member) throw new TaskError('NOT_AUTHORIZED', 'Identity is not an active member');
    const next: TaskList = { ...list, members: list.members.map(value => value.identityId === this.identityId ? { ...value, removedAt: isoNow(this.now), revision: value.revision + 1 } : value), epoch: list.epoch + 1, updatedAt: isoNow(this.now), revision: list.revision + 1 };
    for (const task of this.tasks.values()) if (task.listId === next.id && task.assignee === this.identityId) {
      const unassigned: Task = { ...task, assignee: undefined, updatedAt: next.updatedAt, revision: task.revision + 1 };
      this.replaceTask(unassigned);
      await this.publishTask(unassigned, 'task.upsert');
    }
    this.lists.set(next.id, next);
    await this.persist();
    await this.publishMemberLeave(next);
    this.emit({ kind: 'LIST_UPSERT', listId: next.id, origin: 'LOCAL' });
    return clone(next);
  }

  async handleReminderFired(input: { readonly taskId: TaskId | string; readonly reminderId: TaskReminderId | string; readonly scheduleId?: string; readonly version?: number; readonly at?: string }): Promise<boolean> {
    await this.ready();
    this.assertOpen();
    const task = this.tasks.get(asTaskId(input.taskId));
    const reminderId = asReminderId(input.reminderId);
    if (!task || task.tombstone || task.status !== 'OPEN') return false;
    const reminder = task.reminders.find(value => value.id === reminderId);
    if (!reminder) return false;
    const expectedId = reminderScheduleId(task, reminder);
    const schedule = reminderSchedule(task, reminder);
    if (!schedule) return false;
    if (input.scheduleId && input.scheduleId !== expectedId) return false;
    if (input.version !== undefined && input.version !== task.revision) return false;
    const at = input.at === undefined ? schedule.dueAt : validInstant(input.at);
    if (!at) throw new TaskError('INVALID_DATE', 'Reminder delivery time is invalid');
    if (input.at !== undefined && Date.parse(at) + 60_000 < Date.parse(schedule.dueAt)) return false;
    if (input.version === undefined && reminder.lastNotifiedAt && !task.recurrence) return false;
    const dedup = `${expectedId}:${input.version ?? task.revision}`;
    if (this.firedReminders.has(dedup)) return false;
    this.firedReminders.add(dedup);
    const notified: Task = { ...task, reminders: task.reminders.map(value => value.id === reminderId ? { ...value, lastNotifiedAt: at } : value), updatedAt: at, revision: task.revision + 1 };
    this.replaceTask(notified);
    await this.persist();
    if (this.notifications) {
      const privacy = task.references.some(reference => reference.dataClass === 'SECRET') ? 'GENERIC' : 'TITLE';
      await this.notifications.notify({ id: `task-reminder:${expectedId}:${notified.revision}`, taskId: task.id, reminderId, title: privacy === 'GENERIC' ? 'Task reminder' : task.title, body: privacy === 'GENERIC' ? 'A private task is due.' : task.due ? formatTaskDate(task.due) : 'Reminder', dueAt: at, actions: ['COMPLETE', 'SNOOZE', 'OPEN'], privacy });
    }
    this.emit({ kind: 'REMINDER', taskId: task.id, listId: task.listId, origin: 'SYSTEM' });
    return true;
  }

  async handleNotificationAction(input: TaskNotificationActionInput): Promise<Task | { readonly status: 'OPENED' }> {
    await this.ready();
    this.assertOpen();
    const task = this.requireTask(asTaskId(input.taskId));
    if (input.expectedRevision !== undefined && input.expectedRevision !== task.revision) throw new TaskError('CONFLICT', 'Task notification is stale');
    const actor = input.actor ?? this.identityId;
    if (input.action === 'COMPLETE') return this.completeTask(task.id, actor);
    if (input.action === 'OPEN') { this.requireListPermission(this.requireList(task.listId), actor, 'read'); return { status: 'OPENED' }; }
    if (input.reminderId === undefined || input.until === undefined) throw new TaskError('INVALID_ARGUMENT', 'Snooze action requires a reminder and time');
    return this.snoozeReminder(task.id, input.reminderId, input.until, actor);
  }

  async reconcileMissedReminders(at = this.now(), limit = 8): Promise<{ readonly notified: number; readonly coalesced: number }> {
    await this.ready();
    const due: Array<{ readonly key: string; readonly notification: TaskNotification }> = [];
    for (const task of this.tasks.values()) {
      if (task.tombstone || task.status !== 'OPEN') continue;
      for (const reminder of task.reminders) {
        const schedule = reminderSchedule(task, reminder);
        if (!schedule || Date.parse(schedule.dueAt) > at || reminder.lastNotifiedAt) continue;
        const key = `${schedule.id}:${schedule.dueAt}`;
        if (this.missedReminderNotices.has(key)) continue;
        const privacy = task.references.some(reference => reference.dataClass === 'SECRET') ? 'GENERIC' : 'TITLE';
        due.push({ key, notification: { id: `task-missed:${schedule.id}`, taskId: task.id, reminderId: reminder.id, title: privacy === 'GENERIC' ? 'Task reminder' : task.title, body: privacy === 'GENERIC' ? 'A private task is due.' : 'Reminder', dueAt: schedule.dueAt, actions: ['COMPLETE', 'SNOOZE', 'OPEN'], privacy, missed: true } });
      }
    }
    due.sort((a, b) => a.notification.dueAt.localeCompare(b.notification.dueAt) || a.notification.id.localeCompare(b.notification.id));
    const selected = due.slice(0, boundedInt(limit, 1, 32, 8));
    if (this.notifications && selected.length) {
      const notifications = selected.map(value => value.notification);
      if (this.notifications.notifyBatch) await this.notifications.notifyBatch(notifications);
      else for (const value of notifications) await this.notifications.notify(value);
      for (const value of selected) this.missedReminderNotices.add(value.key);
      await this.persist();
    }
    return { notified: selected.length, coalesced: Math.max(0, due.length - selected.length) };
  }

  async reconcileReminders(): Promise<{ readonly scheduled: number; readonly canceled: number; readonly failed: number }> {
    await this.ready();
    return this.reconcileRemindersInternal();
  }

  private async reconcileRemindersInternal(): Promise<{ readonly scheduled: number; readonly canceled: number; readonly failed: number }> {
    if (!this.reminderScheduler) return { scheduled: 0, canceled: 0, failed: 0 };
    let scheduled = 0;
    let canceled = 0;
    const expected = new Map<string, TaskReminderSchedule>();
    for (const task of this.tasks.values()) if (!task.tombstone && task.status === 'OPEN') for (const reminder of task.reminders) {
      const schedule = reminderSchedule(task, reminder);
      if (schedule) expected.set(schedule.id, schedule);
    }
    for (const id of [...this.scheduled.keys()]) if (!expected.has(id)) {
      try { if (this.reminderScheduler?.cancel) await this.reminderScheduler.cancel(id); } catch { /* stale host schedule is reconciled on the next run */ }
      this.scheduled.delete(id); canceled += 1;
    }
    for (const [id, schedule] of expected) {
      const current = this.scheduled.get(id);
      if (current && current.version === schedule.version && current.dueAt === schedule.dueAt) continue;
      try {
        if (current) await this.reminderScheduler?.cancel?.(id);
        if (this.reminderScheduler) await this.reminderScheduler.schedule(schedule);
        this.scheduled.set(id, schedule);
        this.reminderFailures.delete(id);
        scheduled += 1;
      } catch {
        this.reminderFailures.add(id);
      }
    }
    return { scheduled, canceled, failed: this.reminderFailures.size };
  }

  async openReference(reference: TaskReferenceInput, actor: NodeId = this.identityId): Promise<{ readonly available: boolean; readonly authorized: boolean; readonly label?: string }> {
    const value = normalizeReference(reference);
    if (!this.referenceResolver) {
      // A typed reference is not an access grant.  Only explicitly public
      // references may be opened without the source subsystem's resolver;
      // private/secret objects fail closed until that resolver revalidates
      // the actor and source ownership.
      return value.dataClass === 'PUBLIC'
        ? { available: true, authorized: true, ...(value.label ? { label: value.label } : {}) }
        : { available: false, authorized: false, ...(value.label ? { label: value.label } : {}) };
    }
    const result = await this.referenceResolver.resolve({ reference: value, actor });
    if (!result.available || !result.authorized) return { available: false, authorized: false, ...(result.label ? { label: result.label } : {}) };
    return { available: true, authorized: true, ...(result.label ? { label: result.label } : value.label ? { label: value.label } : {}) };
  }

  async createCalendarTimeBlock(taskId: TaskId | string, input: { readonly start: string; readonly end: string; readonly timezone?: string }, actor: NodeId = this.identityId): Promise<{ readonly eventId: string }> {
    await this.ready();
    this.assertOpen();
    if (!this.calendar) throw new TaskError('SOURCE_UNAVAILABLE', 'Calendar adapter is not installed');
    const task = this.getTask(asTaskId(taskId));
    this.requireListPermission(this.requireList(task.listId), actor, 'read');
    const start = validInstant(input.start);
    const end = validInstant(input.end);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) throw new TaskError('INVALID_DATE', 'Calendar time block range is invalid');
    return this.calendar.createTimeBlock({ task, start, end, timezone: validTimezone(input.timezone ?? task.due?.timezone ?? this.defaultTimezone) ?? this.defaultTimezone });
  }

  async createWorkboardCard(taskId: TaskId | string, actor: NodeId = this.identityId): Promise<{ readonly boardId: string; readonly itemId: string }> {
    await this.ready();
    this.assertOpen();
    if (!this.workboards) throw new TaskError('SOURCE_UNAVAILABLE', 'Workboard adapter is not installed');
    const task = this.getTask(asTaskId(taskId));
    this.requireListPermission(this.requireList(task.listId), actor, 'read');
    return this.workboards.createCard({ task, title: task.title, ...(task.note ? { note: task.note } : {}) });
  }

  async createTaskFromWorkboard(input: { readonly boardId: string; readonly itemId: string; readonly title: string; readonly note?: string; readonly listId?: TaskListId | string }, actor: NodeId = this.identityId): Promise<Task> {
    await this.ready();
    this.assertOpen();
    if (this.workboards?.referenceCard) await this.workboards.referenceCard({ boardId: input.boardId, itemId: input.itemId });
    return this.createTask({ title: input.title, ...(input.note ? { note: input.note } : {}), listId: input.listId, references: [{ type: 'work-item', id: input.itemId, label: input.title, dataClass: 'PRIVATE' }] }, actor);
  }

  calendarProjection(options: { readonly from?: string; readonly until?: string; readonly includeCompleted?: boolean } = {}): readonly TaskCalendarProjection[] {
    const from = options.from ? Date.parse(options.from) : Number.NEGATIVE_INFINITY;
    const until = options.until ? Date.parse(options.until) : Number.POSITIVE_INFINITY;
    if (options.from && !Number.isFinite(from) || options.until && !Number.isFinite(until)) throw new TaskError('INVALID_DATE', 'Calendar projection range is invalid');
    return [...this.tasks.values()].filter(task => !task.tombstone && (options.includeCompleted || task.status !== 'COMPLETED')).flatMap(task => taskDateProjection(task, from, until)).sort((a, b) => a.start.localeCompare(b.start) || a.taskId.localeCompare(b.taskId)).map(clone);
  }

  dailySource(): DailyContextSource {
    return {
      sourceId: 'tasks', sourceType: 'tasks', trust: 'core',
      collect: async (window: DailyContextWindow, _owner: DailyContextOwnerContext): Promise<readonly DailyContextItem[]> => {
        const page = await this.listTasks({ view: 'TODAY', limit: 128 });
        return page.items.map(task => ({ id: `task:${task.id}`, sourceType: 'tasks', sourceId: 'tasks', canonicalRef: { id: task.id, type: 'task', visibility: 'private' }, title: task.title, ...(task.due ? { dueAt: taskDateToComparableInstant(task.due) } : {}), ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}), createdAt: task.createdAt, priority: task.priority === 'HIGH' ? 'time-sensitive' : 'completion', dataClass: 'PRIVATE', requiresAction: task.status === 'OPEN', completed: task.status === 'COMPLETED', dedupKey: `task:${task.id}:${task.revision}`, action: { kind: 'open-object', object: { id: task.id, type: 'task', visibility: 'private' } } })) satisfies DailyContextItem[];
      },
    };
  }

  inboxAdapter(): InboxProjectionAdapter<TaskInboxSource> {
    const service = this;
    return {
      sourceKind: 'keystone', trust: 'CORE',
      list: async (_input: InboxAdapterListInput): Promise<readonly TaskInboxSource[]> => (await service.listTasks({ view: 'ASSIGNED_TO_ME', limit: 128 })).items.map(task => ({ task })),
      project: source => taskInboxProjection(source.task),
      refOf: source => taskInboxRef(source.task),
      refresh: ref => { const taskId = ref.source === 'keystone' ? ref.objectId : ''; try { return { task: service.getTask(taskId) }; } catch { return undefined; } },
      resolve: ref => ref,
      subscribe: listener => service.subscribe(change => { if (!change.taskId) return; try { const task = service.getTask(change.taskId); if (task.assignee === service.identityId && task.status === 'OPEN') listener({ kind: 'UPSERT', source: { task }, eventId: `task:${task.id}:${task.revision}` }); else listener({ kind: 'REMOVE', ref: taskInboxRef(task), eventId: `task:${task.id}:${task.revision}:remove` }); } catch { /* source was deleted */ } }),
      execute: async input => executeTaskInboxAction(service, input),
    };
  }

  toContinuityReference(taskId: TaskId | string): TaskContinuityReference {
    const task = this.getTask(asTaskId(taskId));
    return { version: 1, kind: 'task', objectId: task.id, listId: task.listId, title: task.title, status: task.status };
  }

  diagnostics(): TaskServiceDiagnostics {
    const values = [...this.tasks.values()];
    return { tasks: values.length, lists: this.lists.size, activeTasks: values.filter(value => !value.tombstone && value.status === 'OPEN').length, completedTasks: values.filter(value => !value.tombstone && value.status === 'COMPLETED').length, trashedTasks: values.filter(value => value.tombstone).length, sharedLists: [...this.lists.values()].filter(value => value.scope === 'SHARED' && !value.tombstone).length, indexedTokens: this.searchIndex.size, scheduledReminders: this.scheduled.size, reminderFailures: this.reminderFailures.size, listeners: this.listeners.size, pendingEvents: this.seenEvents.size };
  }

  async applyReplicationEvent(event: unknown): Promise<boolean> {
    await this.ready();
    this.assertOpen();
    const value = validateReplicationEvent(event);
    if (this.seenEvents.has(value.id)) return false;
    if (this.signer?.verify && (!value.signature || !(await this.signer.verify(canonicalJson(unsignedReplication(value)), value.signature, value.actor)))) throw new TaskError('NOT_AUTHORIZED', 'Task replication signature is invalid');
    if (value.operation === 'list.invite') {
      const list = this.requireList(value.listId, true);
      if (value.actor !== list.ownerIdentityId || value.targetId === '') throw new TaskError('NOT_AUTHORIZED', 'Only the list owner can invite members');
      const invitation = normalizeInvitation(value.payload);
      if (!invitation || invitation.id !== value.targetId || invitation.listId !== list.id || invitation.inviter !== list.ownerIdentityId) throw new TaskError('NOT_AUTHORIZED', 'Task invitation replication payload is invalid');
      this.invitations.set(invitation.id, invitation);
      await this.persist();
      this.seenEvents.add(value.id);
      this.emit({ kind: 'SYNC', listId: list.id, origin: 'REMOTE' });
      return true;
    }
    if (value.operation === 'list.accept') {
      const list = this.requireList(value.listId, true);
      const invitation = this.invitations.get(value.targetId) ?? normalizeInvitation(value.payload);
      if (!invitation || invitation.id !== value.targetId || invitation.listId !== list.id || invitation.invitee !== value.actor || invitation.status !== 'PENDING' || Date.parse(invitation.expiresAt) <= this.now()) throw new TaskError('NOT_AUTHORIZED', 'Task invitation acceptance is invalid');
      const existing = list.members.find(member => member.identityId === value.actor && !member.removedAt);
      if (!existing) {
        const member: TaskListMember = { version: 1, identityId: value.actor, role: invitation.role, joinedAt: isoNow(this.now), revision: 1 };
        const next: TaskList = { ...list, members: [...list.members, member], pendingInvitees: (list.pendingInvitees ?? []).filter(identityId => identityId !== value.actor), epoch: list.epoch + 1, updatedAt: isoNow(this.now), revision: list.revision + 1 };
        this.lists.set(list.id, next);
        this.invitations.set(invitation.id, { ...invitation, status: 'ACCEPTED' });
        await this.persist();
        this.emit({ kind: 'LIST_UPSERT', listId: list.id, origin: 'REMOTE' });
      }
      this.seenEvents.add(value.id);
      return true;
    }
    if (value.operation === 'list.leave') {
      const current = this.requireList(value.listId, true);
      const incoming = normalizePersistedList(value.payload);
      if (!incoming || incoming.id !== current.id || !isValidMemberLeave(current, incoming, value.actor) || value.epoch !== incoming.epoch || value.revision !== incoming.revision) throw new TaskError('NOT_AUTHORIZED', 'Task member leave replication payload is invalid');
      this.lists.set(incoming.id, incoming);
      for (const task of this.tasks.values()) if (task.listId === incoming.id && task.assignee === value.actor) this.replaceTask({ ...task, assignee: undefined, updatedAt: incoming.updatedAt, revision: task.revision + 1 });
      await this.persist();
      this.seenEvents.add(value.id);
      if (this.identityId === incoming.ownerIdentityId) await this.publishList(incoming);
      this.emit({ kind: 'LIST_UPSERT', listId: incoming.id, origin: 'REMOTE' });
      return true;
    }
    if (value.operation === 'list.upsert') {
      const incoming = normalizePersistedList(value.payload);
      if (!incoming || incoming.id !== value.listId || incoming.ownerIdentityId !== value.actor) throw new TaskError('NOT_AUTHORIZED', 'Task list replication payload is invalid');
      const current = this.lists.get(incoming.id);
      if (current && current.epoch > incoming.epoch) throw new TaskError('STALE_EPOCH', 'Task list replication epoch is stale');
      if (current && current.revision > incoming.revision && current.epoch === incoming.epoch) { this.seenEvents.add(value.id); return false; }
      const currentMemberRecord = current?.members.some(member => member.identityId === this.identityId);
      if (this.identityId !== incoming.ownerIdentityId && !incoming.members.some(member => member.identityId === this.identityId && !member.removedAt) && !incoming.pendingInvitees?.includes(this.identityId) && !currentMemberRecord) throw new TaskError('NOT_AUTHORIZED', 'Task list replication is outside the local identity scope');
      this.lists.set(incoming.id, incoming);
      for (const invitation of this.invitations.values()) if (invitation.listId === incoming.id && invitation.inviter === incoming.ownerIdentityId) this.invitations.set(invitation.id, invitation);
      if (incoming.scope === 'SHARED') await this.installCollaboration(incoming);
      await this.persist();
      this.seenEvents.add(value.id);
      this.emit({ kind: 'LIST_UPSERT', listId: incoming.id, origin: 'REMOTE' });
      return true;
    }
    const list = this.requireList(value.listId, true);
    if (value.epoch < list.epoch) throw new TaskError('STALE_EPOCH', 'Task replication epoch is stale');
    if (!list.members.some(member => member.identityId === value.actor && !member.removedAt && (member.role === 'OWNER' || member.role === 'EDITOR'))) throw new TaskError('NOT_AUTHORIZED', 'Remote actor cannot edit this Task list');
    const incoming = normalizePersistedTask(value.payload);
    if (!incoming || incoming.id !== value.targetId || incoming.listId !== list.id) throw new TaskError('NOT_AUTHORIZED', 'Task replication payload crosses list boundary');
    if (incoming.parentId) this.assertParentAllowed(incoming.id, incoming.listId, incoming.parentId);
    const current = this.tasks.get(incoming.id);
    if (current && current.revision > incoming.revision) { this.seenEvents.add(value.id); return false; }
    if (value.operation === 'task.delete' && !incoming.tombstone) throw new TaskError('CORRUPT_STATE', 'Delete replication must carry a tombstone');
    this.replaceTask(incoming);
    await this.persist();
    await this.reconcileTaskReminders(incoming);
    this.seenEvents.add(value.id);
    this.emit({ kind: incoming.tombstone ? 'TASK_REMOVE' : 'TASK_UPSERT', taskId: incoming.id, listId: incoming.listId, origin: 'REMOTE' });
    return true;
  }

  async flush(): Promise<void> { await this.writes; }

  async close(): Promise<void> {
    if (this.closed) return;
    for (const unsubscribe of this.collaborationUnsubscribers.values()) unsubscribe();
    this.collaborationUnsubscribers.clear();
    await this.flush();
    await this.persist();
    this.closed = true;
  }

  private async hydrate(): Promise<void> {
    const raw = await this.store.read().catch(() => undefined);
    if (raw !== undefined) {
      if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.lists) || !Array.isArray(raw.tasks)) throw new TaskError('CORRUPT_STATE', 'Unsupported Task state version');
      for (const value of raw.lists.slice(0, this.maxLists)) { const list = normalizePersistedList(value); if (list) this.lists.set(list.id, list); }
      for (const value of raw.tasks.slice(0, this.maxTasks)) { const task = normalizePersistedTask(value); if (task && this.lists.has(task.listId)) this.tasks.set(task.id, task); }
      if (Array.isArray(raw.invitations)) for (const value of raw.invitations.slice(0, TASK_MAX_PENDING_EVENTS)) { const invitation = normalizeInvitation(value); if (invitation && this.lists.has(invitation.listId)) this.invitations.set(invitation.id, invitation); }
      if (Array.isArray(raw.seenEvents)) for (const id of raw.seenEvents.slice(-TASK_MAX_PENDING_EVENTS)) if (typeof id === 'string') this.seenEvents.add(id);
      if (Array.isArray(raw.missedReminderNotices)) for (const id of raw.missedReminderNotices.slice(-TASK_MAX_PENDING_EVENTS)) if (typeof id === 'string') this.missedReminderNotices.add(id);
    }
    this.ensureInbox();
    this.sanitizeHierarchy();
    this.rebuildSearchIndex();
    for (const list of this.lists.values()) if (list.scope === 'SHARED' && !list.tombstone && list.members.some(member => member.identityId === this.identityId && !member.removedAt)) await this.installCollaboration(list);
    if (this.reminderScheduler) await this.reconcileRemindersInternal();
    await this.persist();
  }

  private ensureInbox(): void {
    const current = this.lists.get(TASK_INBOX_LIST_ID);
    if (current) return;
    const now = isoNow(this.now);
    this.lists.set(TASK_INBOX_LIST_ID, { version: 1, id: TASK_INBOX_LIST_ID, name: 'Inbox', scope: 'PRIVATE', ownerIdentityId: this.identityId, members: [{ version: 1, identityId: this.identityId, role: 'OWNER', joinedAt: now, revision: 1 }], epoch: 1, pinned: true, builtIn: 'INBOX', createdAt: now, updatedAt: now, revision: 1, tombstone: false });
  }

  private sanitizeHierarchy(): void {
    for (const task of this.tasks.values()) {
      if (!task.parentId) continue;
      try { this.assertParentAllowed(task.id, task.listId, task.parentId); } catch { this.replaceTask({ ...task, parentId: undefined, revision: task.revision + 1 }); }
    }
  }

  private assertOpen(): void { if (this.closed) throw new TaskError('INVALID_STATE', 'TaskService is closed'); }

  private requireTask(id: TaskId, includeTrash = false): Task { const task = this.tasks.get(id); if (!task || (task.tombstone && !includeTrash)) throw new TaskError('NOT_FOUND', `Task ${id} was not found`); return task; }
  private requireList(id: TaskListId, includeTrash = false): TaskList { const list = this.lists.get(id); if (!list || (list.tombstone && !includeTrash)) throw new TaskError('NOT_FOUND', `Task list ${id} was not found`); return list; }

  private requireListPermission(list: TaskList, actor: NodeId, action: 'read' | 'edit' | 'manage'): void {
    if (actor === list.ownerIdentityId) return;
    const member = list.members.find(value => value.identityId === actor && !value.removedAt);
    if (!member) throw new TaskError('NOT_AUTHORIZED', 'Identity is not an active Task-list member');
    if (action === 'read') return;
    if (action === 'edit' && member.role === 'EDITOR') return;
    throw new TaskError('NOT_AUTHORIZED', `Task-list role cannot ${action} Tasks`);
  }

  private assertAssignee(list: TaskList, assignee: NodeId, actor: NodeId): void {
    if (list.scope !== 'SHARED') { if (assignee !== this.identityId || actor !== this.identityId) throw new TaskError('NOT_AUTHORIZED', 'Private Tasks cannot be assigned to another identity'); return; }
    if (!list.members.some(member => member.identityId === assignee && !member.removedAt)) throw new TaskError('NOT_AUTHORIZED', 'Assignee is not an active list member');
  }

  private assertParentAllowed(taskId: TaskId, listId: TaskListId, parentId: TaskId): void {
    if (taskId === parentId) throw new TaskError('CYCLE', 'Task cannot be its own parent');
    const parent = this.tasks.get(parentId);
    if (!parent || parent.listId !== listId || parent.tombstone) throw new TaskError('INVALID_ARGUMENT', 'Parent Task is invalid');
    let depth = 1;
    let current: Task | undefined = parent;
    const seen = new Set<TaskId>();
    while (current) { if (seen.has(current.id) || current.id === taskId) throw new TaskError('CYCLE', 'Task hierarchy contains a cycle'); seen.add(current.id); if (!current.parentId) break; depth += 1; current = this.tasks.get(current.parentId); }
    if (depth > TASK_MAX_SUBTASK_DEPTH) throw new TaskError('DEPTH_EXCEEDED', 'Task subtask depth exceeds the bounded limit');
  }

  private validateScheduleAndRecurrence(task: Task): void {
    if (task.recurrence && !task.due && !task.start) throw new TaskError('INVALID_RECURRENCE', 'A recurring Task requires a start or due date');
    if (task.recurrence?.kind === 'AFTER_COMPLETION' && task.due?.kind === 'DATE') {
      // Completion-relative date-only recurrence is intentionally supported,
      // but it remains a calendar date rather than a midnight UTC instant.
      if (task.recurrence.frequency === 'YEARLY' && task.recurrence.interval > 10) throw new TaskError('INVALID_RECURRENCE', 'Completion-relative yearly interval is too large');
    }
    for (const reminder of task.reminders) {
      if (reminder.kind !== 'ABSOLUTE' && !task.due) throw new TaskError('INVALID_DATE', 'Due-relative reminder requires a due date');
      if (reminder.kind === 'ABSOLUTE' && !reminder.at) throw new TaskError('INVALID_DATE', 'Absolute reminder requires a date');
    }
  }

  private replaceTask(task: Task): void { this.removeFromSearchIndex(this.tasks.get(task.id)); this.tasks.set(task.id, task); this.addToSearchIndex(task); }
  private orderKeyFor(listId: TaskListId): string { const values = [...this.tasks.values()].filter(task => task.listId === listId && !task.tombstone).sort(compareTasks); return orderKeyBetween(values.at(-1)?.orderKey, undefined); }
  private queryTasks(options: TaskQuery): Task[] {
    const queryTokens = tokenize(options.query ?? '');
    let candidates: Iterable<Task> = queryTokens.length ? new Set(queryTokens.flatMap(token => [...(this.searchIndex.get(token) ?? [])]).map(id => this.tasks.get(id)).filter((task): task is Task => Boolean(task))) : this.tasks.values();
    const now = this.now();
    const values = [...candidates].filter(task => {
      const list = this.lists.get(task.listId);
      if (!list) return false;
      if (!options.includeTrash && task.tombstone && options.view !== 'TRASH') return false;
      if (options.includeTrash !== true && list.tombstone && options.view !== 'TRASH') return false;
      if (options.view !== 'TRASH' && task.tombstone) return false;
      if (options.view === 'TRASH' && !task.tombstone) return false;
      if (options.listId !== undefined && task.listId !== asListId(options.listId)) return false;
      if (options.status && task.status !== options.status) return false;
      if (options.tag && !task.tags.includes(options.tag)) return false;
      if (options.assignee && task.assignee !== options.assignee) return false;
      if (options.parentId !== undefined && (task.parentId ?? undefined) !== (options.parentId === null ? undefined : asTaskId(options.parentId))) return false;
      const view = options.view;
      if (view === 'INBOX' && task.listId !== TASK_INBOX_LIST_ID) return false;
      if (view === 'COMPLETED' && task.status !== 'COMPLETED') return false;
      if (view === 'ASSIGNED_TO_ME' && (task.assignee !== this.identityId || task.status !== 'OPEN')) return false;
      if (view === 'SHARED' && list.scope !== 'SHARED') return false;
      if (view === 'TODAY' && !isTaskToday(task, now, this.defaultTimezone)) return false;
      if (view === 'UPCOMING' && !isTaskUpcoming(task, now, this.defaultTimezone)) return false;
      if (view === 'OVERDUE' && !isTaskOverdue(task, now, this.defaultTimezone)) return false;
      if (view === 'SOMEDAY' && (task.due || task.start)) return false;
      return true;
    }).sort(compareTasks);
    if (queryTokens.length) {
      const lower = queryTokens.join(' ');
      return values.filter(task => `${task.title} ${task.note ?? ''} ${task.tags.join(' ')} ${task.references.map(value => value.label ?? value.id).join(' ')}`.toLocaleLowerCase().includes(lower));
    }
    return values;
  }

  private rebuildSearchIndex(): void { this.searchIndex.clear(); for (const task of this.tasks.values()) this.addToSearchIndex(task); }
  private addToSearchIndex(task: Task): void { if (task.tombstone) return; for (const token of tokenize(`${task.title} ${task.note ?? ''} ${task.tags.join(' ')} ${task.references.map(value => value.label ?? '').join(' ')}`)) { const set = this.searchIndex.get(token) ?? new Set<TaskId>(); set.add(task.id); this.searchIndex.set(token, set); } }
  private removeFromSearchIndex(task: Task | undefined): void { if (!task) return; for (const token of tokenize(`${task.title} ${task.note ?? ''} ${task.tags.join(' ')} ${task.references.map(value => value.label ?? '').join(' ')}`)) { const set = this.searchIndex.get(token); set?.delete(task.id); if (set?.size === 0) this.searchIndex.delete(token); } }

  private async persist(): Promise<void> {
    if (this.closed) return;
    const snapshot: PersistedTaskState = { version: 1, lists: [...this.lists.values()].map(clone), tasks: [...this.tasks.values()].map(clone), invitations: [...this.invitations.values()].map(clone), seenEvents: [...this.seenEvents].slice(-TASK_MAX_PENDING_EVENTS), missedReminderNotices: [...this.missedReminderNotices].slice(-TASK_MAX_PENDING_EVENTS) };
    const operation = this.writes.then(() => this.store.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation;
  }

  private async publishList(list: TaskList, recipients?: readonly NodeId[]): Promise<void> { await this.publish({ version: 1, protocol: TASKS_PROTOCOL, id: randomId('task-event'), listId: list.id, operation: 'list.upsert', targetId: list.id, epoch: list.epoch, revision: list.revision, actor: this.identityId, payload: clone(list), createdAt: isoNow(this.now) }, recipients); }
  private async publishMemberLeave(list: TaskList, recipients?: readonly NodeId[]): Promise<void> { await this.publish({ version: 1, protocol: TASKS_PROTOCOL, id: randomId('task-event'), listId: list.id, operation: 'list.leave', targetId: list.id, epoch: list.epoch, revision: list.revision, actor: this.identityId, payload: clone(list), createdAt: isoNow(this.now) }, recipients); }
  private async publishInvitation(invitation: TaskListInvitation, recipients?: readonly NodeId[]): Promise<void> { const list = this.requireList(invitation.listId, true); await this.publish({ version: 1, protocol: TASKS_PROTOCOL, id: randomId('task-event'), listId: list.id, operation: 'list.invite', targetId: invitation.id, epoch: list.epoch, revision: list.revision, actor: this.identityId, payload: clone(invitation), createdAt: isoNow(this.now) }, recipients); }
  private async publishAcceptance(invitation: TaskListInvitation): Promise<void> { const list = this.requireList(invitation.listId, true); await this.publish({ version: 1, protocol: TASKS_PROTOCOL, id: randomId('task-event'), listId: list.id, operation: 'list.accept', targetId: invitation.id, epoch: list.epoch, revision: list.revision, actor: this.identityId, payload: clone(invitation), createdAt: isoNow(this.now) }); }
  private async publishTask(task: Task, operation: 'task.upsert' | 'task.delete'): Promise<void> { const list = this.requireList(task.listId, true); await this.publish({ version: 1, protocol: TASKS_PROTOCOL, id: randomId('task-event'), listId: list.id, operation, targetId: task.id, epoch: list.epoch, revision: task.revision, actor: this.identityId, payload: clone(task), createdAt: isoNow(this.now) }); }
  private async publish(input: Omit<TaskReplicationEvent, 'signature'>, recipients?: readonly NodeId[]): Promise<void> { if (!this.replication) return; const event = this.signer ? { ...input, signature: await this.signer.sign(canonicalJson(input), input.actor) } : input; try { await this.replication.publish(event, recipients ?? this.recipients(input.listId)); } catch { /* local-first state remains usable while peers are offline */ } }
  private recipients(listId: TaskListId): readonly NodeId[] {
    const members = (this.lists.get(listId)?.members ?? []).filter(member => member.identityId !== this.identityId && !member.removedAt).map(member => member.identityId);
    return [...new Set([...members, ...this.ownerDeviceRecipients])].slice(0, 64);
  }

  private async publishCollaborationTask(task: Task): Promise<void> { if (this.collaboration && this.lists.get(task.listId)?.scope === 'SHARED') await this.collaboration.editList(task.listId, { type: 'upsert_task', task }).catch(() => undefined); }
  private async installCollaboration(list: TaskList): Promise<void> {
    if (!this.collaboration || this.collaborationUnsubscribers.has(list.id) || list.tombstone) return;
    await this.collaboration.createList({ list: clone(list), tasks: [...this.tasks.values()].filter(task => task.listId === list.id).map(clone) }).catch(() => undefined);
    const unsubscribe = this.collaboration.subscribeList(list.id, () => { void this.applyCollaborationSnapshot(list.id); });
    this.collaborationUnsubscribers.set(list.id, unsubscribe);
  }
  private async applyCollaborationSnapshot(listId: TaskListId): Promise<void> { if (!this.collaboration || this.closed) return; try { const snapshot = await this.collaboration.snapshotList(listId); if (snapshot.list.id !== listId || snapshot.list.scope !== 'SHARED') return; this.lists.set(listId, clone(snapshot.list)); const incoming = new Set(snapshot.tasks.filter(task => task.listId === listId).map(task => task.id)); for (const task of [...this.tasks.values()]) if (task.listId === listId && !incoming.has(task.id)) { this.removeFromSearchIndex(task); this.tasks.delete(task.id); } for (const task of snapshot.tasks) if (task.listId === listId) this.replaceTask(clone(task)); await this.persist(); this.emit({ kind: 'SYNC', listId, origin: 'REMOTE' }); } catch { /* stale collaboration object is handled by its own boundary */ } }

  private async cancelTaskReminders(task: Task): Promise<void> { for (const reminder of task.reminders) { const id = reminderScheduleId(task, reminder); if (this.scheduled.has(id)) { try { if (this.reminderScheduler?.cancel) await this.reminderScheduler.cancel(id); } catch { /* best effort; reconciliation will retry */ } this.scheduled.delete(id); } } }
  private async reconcileTaskReminders(_task: Task): Promise<void> { if (this.reminderScheduler) await this.reconcileReminders(); }

  private emit(change: TaskChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export interface TaskCalendarProjection {
  readonly taskId: TaskId;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly allDay: boolean;
  readonly source: 'TASK';
}

export interface TaskContinuityReference { readonly version: 1; readonly kind: 'task'; readonly objectId: TaskId; readonly listId: TaskListId; readonly title: string; readonly status: TaskStatus; }
export interface TaskInboxSource { readonly task: Task; }

function taskInboxRef(task: Task): InboxSourceRef { return { source: 'keystone', id: `task:${task.id}`, notificationId: `task:${task.id}`, objectId: task.id, objectType: 'task' }; }
function taskInboxProjection(task: Task): InboxSourceProjection { const source = taskInboxRef(task); const action: InboxActionDescriptor = { id: `task-action:${task.id}` as InboxActionDescriptor['id'], kind: 'OPEN_TASK', label: 'Open task', requiresOwnerConfirmation: false, sourceVersion: String(task.revision) }; return { source, kind: 'TASK', sourceVersion: String(task.revision), presentation: { title: task.title, ...(task.note ? { snippet: task.note.slice(0, 280) } : {}), receivedAt: task.createdAt, updatedAt: task.updatedAt, ...(task.due ? { dueAt: taskDateToComparableInstant(task.due) } : {}), groupKey: `task-list:${task.listId}`, reasons: ['Assigned task'], priority: 'completion', requiresAction: true, dataClass: 'private' }, actions: [action] }; }
async function executeTaskInboxAction(service: TaskService, input: { readonly item: InboxItem; readonly source: InboxSourceProjection; readonly action: InboxActionKind; readonly ownerConfirmed: boolean }): Promise<InboxActionResult> { if (input.action !== 'OPEN_TASK') throw new TaskError('INVALID_ARGUMENT', 'Unsupported Task Inbox action'); const ref = input.source.source; if (ref.source !== 'keystone') throw new TaskError('SOURCE_UNAVAILABLE', 'Task source is unavailable'); const task = service.getTask(ref.objectId); return task.status === 'OPEN' ? { status: 'OPENED' } : { status: 'NOOP' }; }

export class TaskListSharedObjectAdapter implements SharedObjectAdapter<TaskListCollaborationSnapshot, TaskListCollaborationEdit> {
  readonly kind = 'custom' as const;
  readonly name = 'TaskService shared-list adapter';
  constructor(private readonly maxTasks = TASK_MAX_TASKS) {}
  initialize(doc: Y.Doc, initial?: TaskListCollaborationSnapshot): void { const state = doc.getMap<unknown>('r0p91.tasks'); if (state.has('snapshot')) return; if (!initial) throw new TaskError('INVALID_ARGUMENT', 'Task collaboration requires an initial snapshot'); this.validateSnapshot(initial); state.set('snapshot', JSON.stringify(initial)); }
  snapshot(doc: Y.Doc): TaskListCollaborationSnapshot { const raw = doc.getMap<unknown>('r0p91.tasks').get('snapshot'); if (typeof raw !== 'string') throw new TaskError('CORRUPT_STATE', 'Task collaboration snapshot is missing'); let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new TaskError('CORRUPT_STATE', 'Task collaboration snapshot is malformed'); } const value = parsed as TaskListCollaborationSnapshot; this.validateSnapshot(value); return clone(value); }
  applyLocalEdit(doc: Y.Doc, edit: TaskListCollaborationEdit): void { const current = this.snapshot(doc); const next = edit.type === 'replace_list' ? { ...current, list: edit.list } : edit.type === 'remove_task' ? { ...current, tasks: current.tasks.filter(task => task.id !== edit.taskId) } : { ...current, tasks: [...current.tasks.filter(task => task.id !== edit.task.id), edit.task] }; this.validateSnapshot(next); doc.transact(() => doc.getMap<unknown>('r0p91.tasks').set('snapshot', JSON.stringify(next)), 'r0p91-local-edit'); }
  validate(doc: Y.Doc): void { this.snapshot(doc); }
  private validateSnapshot(value: TaskListCollaborationSnapshot): void { if (!value || value.version !== 1 || !value.list || value.list.scope !== 'SHARED' || value.tasks.length > this.maxTasks) throw new TaskError('CORRUPT_STATE', 'Task collaboration snapshot is invalid'); const ids = new Set<string>(); for (const task of value.tasks) { if (!task || task.version !== 1 || task.listId !== value.list.id || ids.has(task.id)) throw new TaskError('CORRUPT_STATE', 'Task collaboration task is invalid'); ids.add(task.id); } }
}

export function createTaskCollaborationPort(collaboration: Pick<CollaborationService, 'createObject' | 'edit' | 'snapshot' | 'subscribeObject'>): TaskCollaborationPort {
  const adapter = new TaskListSharedObjectAdapter();
  return {
    createList: async input => { await collaboration.createObject({ id: input.list.id, kind: 'custom', private: true, adapter, initial: { version: 1, list: input.list, tasks: input.tasks } }); },
    editList: async (listId, edit) => { await collaboration.edit(listId, edit); },
    snapshotList: async listId => collaboration.snapshot<TaskListCollaborationSnapshot>(listId),
    subscribeList: (listId, listener) => collaboration.subscribeObject(listId, (change: CollaborationChange) => { if (change.origin === 'remote' || change.origin === 'local') listener(); }),
  };
}

export interface TaskQuickCapturePreview { readonly title: string; readonly due?: TaskDate; readonly extracted: readonly string[]; readonly ambiguous?: string; }

export function parseTaskQuickCapture(input: string, options: { readonly now?: number; readonly timezone?: string; readonly locale?: 'en' | 'ru' } = {}): TaskQuickCapturePreview {
  const text = normalizeText(input, 4_000);
  if (!text) throw new TaskError('INVALID_ARGUMENT', 'Quick capture text is empty');
  const timezone = validTimezone(options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
  const now = options.now ?? Date.now();
  const locale = options.locale ?? (/\p{Script=Cyrillic}/u.test(text) ? 'ru' : 'en');
  const today = localDateString(now, timezone);
  let due: TaskDate | undefined;
  let title = text;
  const extracted: string[] = [];
  const relative = text.match(locale === 'ru' ? /через\s+(\d{1,3})\s+(день|дня|дней|недел(?:ю|и)|месяц|месяца|месяцев)(?=\s|$)/iu : /\bin\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/iu);
  if (relative) { const count = Number(relative[1]); const unit = relative[2].toLocaleLowerCase(); const days = /недел|week/.test(unit) ? count * 7 : /месяц|month/.test(unit) ? count * 30 : count; due = { kind: 'DATE', value: addDateDays(today, days), timezone }; title = title.replace(relative[0], '').trim(); extracted.push(relative[0]); }
  const shortcut = text.match(locale === 'ru' ? /(сегодня|завтра|послезавтра)/iu : /\b(today|tomorrow|the day after tomorrow)\b/iu);
  if (!due && shortcut) { const word = shortcut[1].toLocaleLowerCase(); const days = /послезавтра|day after/.test(word) ? 2 : /завтра|tomorrow/.test(word) ? 1 : 0; due = { kind: 'DATE', value: addDateDays(today, days), timezone }; title = title.replace(shortcut[0], '').trim(); extracted.push(shortcut[0]); }
  const weekday = text.match(locale === 'ru' ? /(?:в\s+)?(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)/iu : /\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu);
  if (!due && weekday) {
    const names = locale === 'ru' ? ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'] : ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const normalized = weekday[1].toLocaleLowerCase().replace(/у$/u, 'а');
    const target = names.findIndex(name => normalized.startsWith(name.slice(0, Math.max(4, Math.min(name.length, normalized.length)))));
    if (target >= 0) { due = { kind: 'DATE', value: nextWeekdayDate(today, target), timezone }; title = title.replace(weekday[0], '').trim(); extracted.push(weekday[0]); }
  }
  const calendar = locale === 'ru'
    ? text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?=\s|$)/iu)
    : text.match(/\b(?:(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)|(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?)(?=\s|$)/iu);
  if (!due && calendar) {
    const months = locale === 'ru' ? ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'] : ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const day = Number(calendar[1] ?? calendar[4]);
    const monthName = (calendar[2] ?? calendar[3]).toLocaleLowerCase();
    const month = months.indexOf(monthName);
    if (month < 0) throw new TaskError('INVALID_DATE', 'Calendar date is invalid');
    const value = monthDayDate(today, month, day);
    due = { kind: 'DATE', value, timezone }; title = title.replace(calendar[0], '').trim(); extracted.push(calendar[0]);
  }
  const time = text.match(locale === 'ru' ? /в\s+([01]?\d|2[0-3]):([0-5]\d)(?=\s|$)/iu : /\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b/iu);
  if (time) { const base = due?.value ?? today; due = { kind: 'DATETIME', value: localDateTimeToUtc(base, `${time[1].padStart(2, '0')}:${time[2]}`, timezone), timezone }; title = title.replace(time[0], '').trim(); extracted.push(time[0]); }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!due && iso) { const value = `${iso[1]}-${iso[2]}-${iso[3]}`; normalizeDate(value, timezone); due = { kind: 'DATE', value, timezone }; title = title.replace(iso[0], '').trim(); extracted.push(iso[0]); }
  const ambiguous = locale === 'ru' && /в\s+\d{1,2}(?=\s|$)/iu.test(text) && !time ? text.match(/в\s+\d{1,2}(?=\s|$)/iu)?.[0] : undefined;
  return { title: title.replace(/\s{2,}/g, ' ').trim() || text, ...(due ? { due } : {}), extracted, ...(ambiguous ? { ambiguous } : {}) };
}

function executeNoop(): void { /* marker for architecture scans: Task text is never executable */ }
void executeNoop;

export function orderKeyBetween(before?: string, after?: string): string {
  const left = before ?? '';
  const right = after ?? '';
  if (before !== undefined && after !== undefined && left >= right) throw new TaskError('INVALID_ARGUMENT', 'Order bounds are not increasing');
  if (before === undefined && after === undefined) return ORDER_ALPHABET[Math.floor(ORDER_ALPHABET.length / 2)]!;
  let prefix = '';
  for (let index = 0; index < 128; index += 1) {
    const leftEnded = index >= left.length;
    const rightEnded = after !== undefined && index >= right.length;
    if (rightEnded && prefix === right) throw new TaskError('BOUNDS_EXCEEDED', 'Order key space between adjacent Tasks is exhausted');
    const leftValue = leftEnded ? -1 : ORDER_ALPHABET.indexOf(left[index]!);
    const rightValue = after === undefined || rightEnded ? ORDER_ALPHABET.length : ORDER_ALPHABET.indexOf(right[index]!);
    if (leftValue < 0 && !leftEnded) throw new TaskError('INVALID_ARGUMENT', 'Order key contains an invalid character');
    if (rightValue < 0 && !rightEnded) throw new TaskError('INVALID_ARGUMENT', 'Order key contains an invalid character');
    if (rightValue - leftValue > 1) return `${prefix}${ORDER_ALPHABET[Math.floor((leftValue + rightValue) / 2)]!}`;
    prefix += leftEnded ? ORDER_ALPHABET[0]! : ORDER_ALPHABET[leftValue]!;
  }
  throw new TaskError('BOUNDS_EXCEEDED', 'Order key length bound exceeded');
}

function normalizePersistedList(value: unknown): TaskList | undefined {
  try {
    if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string' || !['PRIVATE', 'SHARED'].includes(String(value.scope)) || typeof value.ownerIdentityId !== 'string' || !safeId(value.ownerIdentityId, 512) || !Array.isArray(value.members) || !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return undefined;
    const id = asListId(value.id);
    const name = normalizeText(value.name, 240);
    if (!name) return undefined;
    const members = value.members.flatMap(member => normalizeMember(member)).slice(0, 256);
    if (!members.some(member => member.identityId === value.ownerIdentityId && member.role === 'OWNER' && !member.removedAt)) return undefined;
    const pendingInvitees = Array.isArray(value.pendingInvitees) ? [...new Set(value.pendingInvitees.filter((entry): entry is string => safeId(entry, 512)))].slice(0, 256) : [];
    return { version: 1, id, name, scope: value.scope as TaskListScope, ownerIdentityId: value.ownerIdentityId, members, ...(pendingInvitees.length ? { pendingInvitees } : {}), epoch: value.epoch as number, pinned: value.pinned === true, ...(value.builtIn === 'INBOX' ? { builtIn: 'INBOX' as const } : {}), createdAt: validInstant(value.createdAt) ?? new Date(0).toISOString(), updatedAt: validInstant(value.updatedAt) ?? new Date(0).toISOString(), revision: value.revision as number, tombstone: value.tombstone === true };
  } catch { return undefined; }
}

function isValidMemberLeave(current: TaskList, incoming: TaskList, actor: NodeId): boolean {
  if (actor === current.ownerIdentityId || incoming.ownerIdentityId !== current.ownerIdentityId || incoming.scope !== current.scope || incoming.name !== current.name || incoming.pinned !== current.pinned || incoming.tombstone !== current.tombstone || incoming.epoch !== current.epoch + 1 || incoming.revision !== current.revision + 1) return false;
  if (canonicalJson(incoming.pendingInvitees ?? []) !== canonicalJson(current.pendingInvitees ?? [])) return false;
  const before = current.members.find(member => member.identityId === actor && !member.removedAt);
  const after = incoming.members.find(member => member.identityId === actor);
  if (!before || !after || !after.removedAt || after.role !== before.role || after.joinedAt !== before.joinedAt) return false;
  return canonicalJson(incoming.members.filter(member => member.identityId !== actor)) === canonicalJson(current.members.filter(member => member.identityId !== actor));
}

function normalizePersistedTask(value: unknown): Task | undefined {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.listId !== 'string' || typeof value.title !== 'string' || !['OPEN', 'COMPLETED', 'CANCELED'].includes(String(value.status)) || typeof value.orderKey !== 'string' || !Array.isArray(value.reminders) || !Array.isArray(value.tags) || !Array.isArray(value.references) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return undefined;
  try { const task = { ...value, id: asTaskId(value.id), listId: asListId(value.listId), title: boundedUserText(value.title, 4_000, 'Task title'), note: value.note === undefined ? undefined : boundedUserText(String(value.note), 64_000, 'Task note'), status: value.status as TaskStatus, start: value.start === undefined ? undefined : normalizeDate(value.start as TaskDate, 'UTC'), due: value.due === undefined ? undefined : normalizeDate(value.due as TaskDate, 'UTC'), reminders: normalizeReminders(value.reminders as TaskReminderInput[], 'UTC', true), recurrence: value.recurrence === undefined ? undefined : normalizeRecurrence(value.recurrence as TaskRecurrenceInput, 'UTC'), recurrenceState: value.recurrenceState === undefined ? undefined : normalizeRecurrenceState(value.recurrenceState), priority: normalizePriority(value.priority as TaskPriority), tags: normalizeTags(value.tags as string[]), parentId: value.parentId === undefined ? undefined : asTaskId(value.parentId as string), references: normalizeReferences(value.references as TaskReferenceInput[]), assignee: typeof value.assignee === 'string' && safeId(value.assignee, 512) ? value.assignee : undefined, revision: value.revision as number, tombstone: value.tombstone === true, deletedAt: typeof value.deletedAt === 'string' ? validInstant(value.deletedAt) : undefined, deletedWithList: typeof value.deletedWithList === 'string' ? asListId(value.deletedWithList) : undefined, createdAt: validInstant(value.createdAt) ?? new Date(0).toISOString(), updatedAt: validInstant(value.updatedAt) ?? new Date(0).toISOString() } as Task; validateTaskShape(task); return task; } catch { return undefined; }
}

function validateReplicationEvent(value: unknown): TaskReplicationEvent { if (!isRecord(value) || value.version !== 1 || value.protocol !== TASKS_PROTOCOL || !safeId(value.id, 512) || !safeId(value.listId, 512) || !['list.upsert', 'list.invite', 'list.accept', 'list.leave', 'task.upsert', 'task.delete'].includes(String(value.operation)) || !safeId(value.targetId, 512) || !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !safeId(value.actor, 512) || !validInstant(value.createdAt)) throw new TaskError('CORRUPT_STATE', 'Task replication event is malformed'); return value as unknown as TaskReplicationEvent; }
function unsignedReplication(event: TaskReplicationEvent): Omit<TaskReplicationEvent, 'signature'> { const { signature: _signature, ...unsigned } = event; return unsigned; }
function validateTaskShape(task: Task): void { if (task.title.length === 0 || task.reminders.length > TASK_MAX_REMINDERS || task.tags.length > TASK_MAX_TAGS || task.references.length > TASK_MAX_REFERENCES) throw new TaskError('CORRUPT_STATE', 'Persisted Task violates bounds'); }
function normalizeInvitation(value: unknown): TaskListInvitation | undefined { try { if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || !safeId(value.id, 256) || typeof value.listId !== 'string' || typeof value.inviter !== 'string' || typeof value.invitee !== 'string' || !safeId(value.inviter, 512) || !safeId(value.invitee, 512) || !['EDITOR', 'VIEWER'].includes(String(value.role)) || !['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'].includes(String(value.status))) return undefined; return { version: 1, id: normalizeText(value.id, 256), listId: asListId(value.listId), inviter: value.inviter, invitee: value.invitee, role: value.role as Exclude<TaskListRole, 'OWNER'>, createdAt: validInstant(value.createdAt) ?? new Date(0).toISOString(), expiresAt: validInstant(value.expiresAt) ?? new Date(0).toISOString(), status: value.status as TaskListInvitation['status'] }; } catch { return undefined; } }
function normalizeMember(value: unknown): TaskListMember[] { if (!isRecord(value) || value.version !== 1 || !safeId(value.identityId, 512) || !['OWNER', 'EDITOR', 'VIEWER'].includes(String(value.role))) return []; return [{ version: 1, identityId: value.identityId, role: value.role as TaskListRole, joinedAt: validInstant(value.joinedAt) ?? new Date(0).toISOString(), ...(typeof value.removedAt === 'string' && validInstant(value.removedAt) ? { removedAt: value.removedAt } : {}), revision: Number.isSafeInteger(value.revision) && (value.revision as number) > 0 ? value.revision as number : 1 }]; }
function normalizePriority(value: unknown): TaskPriority { return TASK_PRIORITIES.has(value as TaskPriority) ? value as TaskPriority : 'NONE'; }
function normalizeTags(values: readonly string[] | undefined): readonly string[] { return [...new Set((values ?? []).filter(value => typeof value === 'string').map(value => normalizeText(value, TASK_MAX_TAG_BYTES)).filter(Boolean))].slice(0, TASK_MAX_TAGS); }
function normalizeReferences(values: readonly TaskReferenceInput[] | undefined): readonly TaskReference[] { return (values ?? []).slice(0, TASK_MAX_REFERENCES).map(value => normalizeReference(value)); }
function normalizeReference(value: TaskReferenceInput): TaskReference { if (!value || !TASK_REFERENCE_TYPES.has(value.type) || !safeId(value.id, 512) || (value.dataClass !== undefined && !TASK_REFERENCE_DATA_CLASSES.has(value.dataClass))) throw new TaskError('INVALID_REFERENCE', 'Task reference is invalid'); if (value.sourceOwnerId !== undefined && !safeId(value.sourceOwnerId, 512)) throw new TaskError('INVALID_REFERENCE', 'Task reference owner is invalid'); return { version: 1, type: value.type, id: value.id, ...(value.label ? { label: normalizeText(value.label, 240) } : {}), ...(value.uri ? { uri: normalizeText(value.uri, 2_000) } : {}), dataClass: value.dataClass ?? 'PRIVATE', ...(value.sourceOwnerId ? { sourceOwnerId: value.sourceOwnerId } : {}) }; }
function normalizeReminders(values: readonly TaskReminderInput[], timezone: string, preserveDeliveryState = false): readonly TaskReminder[] { if (!Array.isArray(values) || values.length > TASK_MAX_REMINDERS) throw new TaskError('BOUNDS_EXCEEDED', 'Task reminder bound exceeded'); const ids = new Set<string>(); return values.map((value, index) => { const raw = value as TaskReminderInput & { readonly lastNotifiedAt?: unknown; readonly revision?: unknown }; if (!value || !['AT_DUE', 'BEFORE_DUE', 'ABSOLUTE'].includes(value.kind)) throw new TaskError('INVALID_ARGUMENT', 'Task reminder kind is invalid'); const id = asReminderId(value.id ?? `reminder:${index + 1}`); if (ids.has(id)) throw new TaskError('INVALID_ARGUMENT', 'Task reminder IDs must be unique'); ids.add(id); if (value.kind === 'BEFORE_DUE' && (!Number.isSafeInteger(value.minutesBefore) || (value.minutesBefore as number) < 0 || (value.minutesBefore as number) > 366 * 24 * 60)) throw new TaskError('INVALID_ARGUMENT', 'Reminder offset is invalid'); if (value.kind === 'ABSOLUTE' && value.at === undefined) throw new TaskError('INVALID_DATE', 'Absolute reminder requires a date'); const lastNotifiedAt = preserveDeliveryState && typeof raw.lastNotifiedAt === 'string' ? validInstant(raw.lastNotifiedAt) : undefined; const revision = preserveDeliveryState && Number.isSafeInteger(raw.revision) && (raw.revision as number) > 0 ? raw.revision as number : 1; return { version: 1, id, kind: value.kind, ...(value.minutesBefore === undefined ? {} : { minutesBefore: value.minutesBefore }), ...(value.at === undefined ? {} : { at: normalizeDate(value.at, timezone) }), ...(lastNotifiedAt ? { lastNotifiedAt } : {}), revision }; }); }
function resetReminderDelivery(reminder: TaskReminder, patch: Pick<TaskReminder, 'snoozedUntil'> = {}): TaskReminder { const { lastNotifiedAt: _lastNotifiedAt, snoozedUntil: _snoozedUntil, ...base } = reminder; return { ...base, ...patch, revision: reminder.revision + 1 }; }
function resetReminderDeliveries(reminders: readonly TaskReminder[]): readonly TaskReminder[] { return reminders.map(reminder => resetReminderDelivery(reminder)); }
function normalizeRecurrence(value: TaskRecurrenceInput, timezone: string): TaskRecurrence { if (!TASK_RECURRENCE_FREQUENCIES.has(value.frequency)) throw new TaskError('INVALID_RECURRENCE', 'Recurrence frequency is invalid'); const kind = value.kind ?? 'FIXED_SCHEDULE'; if (!TASK_RECURRENCE_KINDS.has(kind)) throw new TaskError('INVALID_RECURRENCE', 'Recurrence kind is invalid'); const interval = value.interval ?? 1; if (!Number.isSafeInteger(interval) || interval < 1 || interval > 366) throw new TaskError('INVALID_RECURRENCE', 'Recurrence interval is invalid'); const weekdays = value.weekdays?.filter(day => Number.isSafeInteger(day) && day >= 0 && day <= 6); if (value.weekdays && (!weekdays?.length || weekdays.length > 7)) throw new TaskError('INVALID_RECURRENCE', 'Recurrence weekdays are invalid'); if (value.dayOfMonth !== undefined && (!Number.isSafeInteger(value.dayOfMonth) || value.dayOfMonth < 1 || value.dayOfMonth > 31)) throw new TaskError('INVALID_RECURRENCE', 'Recurrence day is invalid'); if (value.count !== undefined && (!Number.isSafeInteger(value.count) || value.count < 1 || value.count > TASK_MAX_RECURRENCE_HISTORY * 16)) throw new TaskError('INVALID_RECURRENCE', 'Recurrence count is invalid'); return { kind, frequency: value.frequency, interval, ...(weekdays?.length ? { weekdays: [...new Set(weekdays)].sort() } : {}), ...(value.dayOfMonth === undefined ? {} : { dayOfMonth: value.dayOfMonth }), ...(value.until === undefined ? {} : { until: normalizeDate(value.until, timezone) }), ...(value.count === undefined ? {} : { count: value.count }) }; }
function normalizeRecurrenceState(value: unknown): TaskRecurrenceState { if (!isRecord(value) || !Number.isSafeInteger(value.occurrenceIndex) || !Array.isArray(value.history)) throw new TaskError('CORRUPT_STATE', 'Recurrence state is invalid'); return { occurrenceIndex: Math.max(0, value.occurrenceIndex as number), history: value.history.slice(-TASK_MAX_RECURRENCE_HISTORY).flatMap(entry => isRecord(entry) && Number.isSafeInteger(entry.index) && typeof entry.actor === 'string' ? [{ index: entry.index as number, ...(entry.scheduled ? { scheduled: normalizeDate(entry.scheduled as TaskDate, 'UTC') } : {}), ...(typeof entry.completedAt === 'string' && validInstant(entry.completedAt) ? { completedAt: entry.completedAt } : {}), ...(typeof entry.skippedAt === 'string' && validInstant(entry.skippedAt) ? { skippedAt: entry.skippedAt } : {}), actor: entry.actor }] : []) }; }
function isCalendarDate(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T12:00:00.000Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function normalizeDate(value: TaskDateInput, fallbackTimezone: string): TaskDate { if (typeof value === 'string') { if (isCalendarDate(value)) return { kind: 'DATE', value, timezone: fallbackTimezone }; const instant = validInstant(value); if (!instant) throw new TaskError('INVALID_DATE', 'Task date is invalid'); return { kind: 'DATETIME', value: instant, timezone: fallbackTimezone }; } if (!value || !TASK_DATE_KINDS.has(value.kind) || typeof value.value !== 'string') throw new TaskError('INVALID_DATE', 'Task date is invalid'); const timezone = validTimezone(value.timezone ?? fallbackTimezone); if (!timezone) throw new TaskError('INVALID_DATE', 'Task timezone is invalid'); if (value.kind === 'DATE' && !isCalendarDate(value.value)) throw new TaskError('INVALID_DATE', 'Date-only Task value is invalid'); if (value.kind === 'DATETIME' && !validInstant(value.value)) throw new TaskError('INVALID_DATE', 'Timed Task value is invalid'); return { kind: value.kind, value: value.kind === 'DATETIME' ? validInstant(value.value)! : value.value, timezone }; }
function normalizeText(value: string, maxChars: number): string { return value.replace(/<\/?(script|style|iframe|object|embed)[^>]*>/gi, '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxChars); }
function boundedUserText(value: string, maxChars: number, label: string): string { if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > maxChars) throw new TaskError('BOUNDS_EXCEEDED', `${label} exceeds its bound`); const normalized = normalizeText(value, maxChars); if (!normalized) throw new TaskError('INVALID_ARGUMENT', `${label} is empty`); return normalized; }
function tokenize(value: string): string[] { return [...new Set(normalizeText(value, 100_000).toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(token => token.length >= 2).slice(0, 256))]; }
function safeId(value: unknown, max = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value); }
function asTaskId(value: TaskId | string): TaskId { if (!safeId(value, 512)) throw new TaskError('INVALID_ARGUMENT', 'Task ID is invalid'); return value as TaskId; }
function asListId(value: TaskListId | string): TaskListId { if (!safeId(value, 512)) throw new TaskError('INVALID_ARGUMENT', 'Task list ID is invalid'); return value as TaskListId; }
function asReminderId(value: TaskReminderId | string): TaskReminderId { if (!safeId(value, 256)) throw new TaskError('INVALID_ARGUMENT', 'Reminder ID is invalid'); return value as TaskReminderId; }
function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number { return value === undefined ? fallback : Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : fallback; }
function randomId(prefix: string): string { return `${prefix}:${typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`; }
function isoNow(now: () => number): string { return new Date(now()).toISOString(); }
function clone<T>(value: T): T { return structuredClone(value); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function validInstant(value: unknown): string | undefined { if (typeof value !== 'string') return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined; }
function validTimezone(value: unknown): string | undefined { if (typeof value !== 'string' || !value || value.length > 128) return undefined; try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { return undefined; } }
function localDateString(timestamp: number, timezone: string): string { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp)); return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}-${parts.find(part => part.type === 'day')?.value}`; }
function addDateDays(date: string, days: number): string { const value = new Date(`${date}T12:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function nextWeekdayDate(date: string, targetWeekday: number): string { const currentWeekday = new Date(`${date}T12:00:00.000Z`).getUTCDay(); return addDateDays(date, (targetWeekday - currentWeekday + 7) % 7); }
function monthDayDate(today: string, month: number, day: number): string { const year = Number(today.slice(0, 4)); let value = `${year.toString().padStart(4, '0')}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`; if (!isCalendarDate(value)) throw new TaskError('INVALID_DATE', 'Calendar date is invalid'); if (value < today) { value = `${year + 1}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`; if (!isCalendarDate(value)) throw new TaskError('INVALID_DATE', 'Calendar date is invalid'); } return value; }
function localDateTimeToUtc(date: string, time: string, timezone: string): string { const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number); let guess = Date.UTC(year, month - 1, day, hour, minute); for (let pass = 0; pass < 2; pass++) { const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)); const local = Date.UTC(Number(parts.find(part => part.type === 'year')?.value), Number(parts.find(part => part.type === 'month')?.value) - 1, Number(parts.find(part => part.type === 'day')?.value), Number(parts.find(part => part.type === 'hour')?.value), Number(parts.find(part => part.type === 'minute')?.value)); guess += Date.UTC(year, month - 1, day, hour, minute) - local; } return new Date(guess).toISOString(); }
function zonedParts(value: TaskDate): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } { const timestamp = value.kind === 'DATE' ? Date.parse(`${value.value}T12:00:00.000Z`) : Date.parse(value.value); const parts = new Intl.DateTimeFormat('en', { timeZone: value.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(new Date(timestamp)); const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(part => part.type === 'weekday')?.value ?? 'Sun'); return { year: Number(parts.find(part => part.type === 'year')?.value), month: Number(parts.find(part => part.type === 'month')?.value), day: Number(parts.find(part => part.type === 'day')?.value), hour: Number(parts.find(part => part.type === 'hour')?.value), minute: Number(parts.find(part => part.type === 'minute')?.value), weekday: weekday < 0 ? 0 : weekday }; }
function taskDateToComparableInstant(value: TaskDate): string { return value.kind === 'DATETIME' ? value.value : localDateTimeToUtc(value.value, '09:00', value.timezone); }
function formatTaskDate(value: TaskDate): string { return value.kind === 'DATE' ? value.value : new Date(value.value).toLocaleString([], { timeZone: value.timezone }); }
function isTaskToday(task: Task, now: number, _fallbackTimezone: string): boolean { if (task.status !== 'OPEN') return false; return [task.start, task.due].some(value => value && (value.kind === 'DATE' ? value.value === localDateString(now, value.timezone) : localDateString(Date.parse(value.value), value.timezone) === localDateString(now, value.timezone))) || isTaskOverdue(task, now, _fallbackTimezone); }
function isTaskUpcoming(task: Task, now: number, _fallbackTimezone: string): boolean { if (task.status !== 'OPEN') return false; return [task.start, task.due].some(value => value && (value.kind === 'DATE' ? value.value > localDateString(now, value.timezone) : Date.parse(value.value) > now)); }
function isTaskOverdue(task: Task, now: number, _fallbackTimezone: string): boolean { if (task.status !== 'OPEN') return false; const due = task.due; return Boolean(due && (due.kind === 'DATE' ? due.value < localDateString(now, due.timezone) : Date.parse(due.value) < now)); }
function compareTasks(a: Task, b: Task): number { return a.orderKey.localeCompare(b.orderKey) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id); }
function compareLists(a: TaskList, b: TaskList): number { return Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); }

function reminderScheduleId(task: Task, reminder: TaskReminder): string { return `task-reminder:${task.id}:${reminder.id}`; }
function reminderSchedule(task: Task, reminder: TaskReminder): TaskReminderSchedule | undefined { let due: TaskDate | undefined = reminder.snoozedUntil; if (!due) { if (reminder.kind === 'ABSOLUTE') due = reminder.at; else if (task.due) due = task.due.kind === 'DATE' ? { kind: 'DATETIME', value: localDateTimeToUtc(task.due.value, '09:00', task.due.timezone), timezone: task.due.timezone } : reminder.kind === 'BEFORE_DUE' ? { kind: 'DATETIME', value: new Date(Date.parse(task.due.value) - (reminder.minutesBefore ?? 0) * 60_000).toISOString(), timezone: task.due.timezone } : task.due; } if (!due) return undefined; const dueAt = taskDateToComparableInstant(due); return { id: reminderScheduleId(task, reminder), taskId: task.id, reminderId: reminder.id, version: task.revision, dueAt, timezone: due.timezone, action: 'task.reminder', payload: { taskId: task.id, reminderId: reminder.id, taskRevision: String(task.revision) } }; }
function nextRecurringDate(task: Task, completionAt: string): TaskDate | undefined { const recurrence = task.recurrence; if (!recurrence) return undefined; const baseTimezone = task.due?.timezone ?? task.start?.timezone ?? 'UTC'; const original = task.due ?? task.start; const anchor = recurrence.kind === 'AFTER_COMPLETION' && original?.kind === 'DATE' ? ({ kind: 'DATE', value: localDateString(Date.parse(completionAt), baseTimezone), timezone: baseTimezone } satisfies TaskDate) : recurrence.kind === 'AFTER_COMPLETION' ? ({ kind: 'DATETIME', value: completionAt, timezone: baseTimezone } satisfies TaskDate) : original; if (!anchor) return undefined; if (anchor.kind === 'DATE') { let date = anchor.value; const amount = recurrence.interval; if (recurrence.frequency === 'DAILY') date = addDateDays(date, amount); else if (recurrence.frequency === 'WEEKLY') { if (recurrence.weekdays?.length) { for (let day = 1; day <= 7; day++) { const candidate = addDateDays(date, day); const weekday = new Date(`${candidate}T12:00:00.000Z`).getUTCDay(); if (recurrence.weekdays.includes(weekday) && day >= amount) return { ...anchor, value: candidate }; } } date = addDateDays(date, 7 * amount); } else if (recurrence.frequency === 'MONTHLY') { const current = new Date(`${date}T12:00:00.000Z`); current.setUTCMonth(current.getUTCMonth() + amount); if (recurrence.dayOfMonth) current.setUTCDate(Math.min(recurrence.dayOfMonth, daysInMonth(current.getUTCFullYear(), current.getUTCMonth()))); date = current.toISOString().slice(0, 10); } else { const current = new Date(`${date}T12:00:00.000Z`); current.setUTCFullYear(current.getUTCFullYear() + amount); date = current.toISOString().slice(0, 10); } return { ...anchor, value: date }; }
  const local = zonedParts(anchor); let date = `${local.year.toString().padStart(4, '0')}-${local.month.toString().padStart(2, '0')}-${local.day.toString().padStart(2, '0')}`; if (recurrence.frequency === 'DAILY') date = addDateDays(date, recurrence.interval); else if (recurrence.frequency === 'WEEKLY') date = addDateDays(date, 7 * recurrence.interval); else if (recurrence.frequency === 'MONTHLY') { const current = new Date(`${date}T12:00:00.000Z`); current.setUTCMonth(current.getUTCMonth() + recurrence.interval); date = current.toISOString().slice(0, 10); } else { const current = new Date(`${date}T12:00:00.000Z`); current.setUTCFullYear(current.getUTCFullYear() + recurrence.interval); date = current.toISOString().slice(0, 10); } return { kind: 'DATETIME', value: localDateTimeToUtc(date, `${local.hour.toString().padStart(2, '0')}:${local.minute.toString().padStart(2, '0')}`, anchor.timezone), timezone: anchor.timezone }; }
function recurrenceExhausted(recurrence: TaskRecurrence, completedCount: number, next: TaskDate): boolean { return Boolean((recurrence.count !== undefined && completedCount >= recurrence.count) || (recurrence.until && compareTaskDates(next, recurrence.until) > 0)); }
function compareTaskDates(a: TaskDate, b: TaskDate): number { if (a.kind === 'DATE' && b.kind === 'DATE') return a.value.localeCompare(b.value); return Date.parse(taskDateToComparableInstant(a)) - Date.parse(taskDateToComparableInstant(b)); }
function daysInMonth(year: number, month: number): number { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }
function taskDateProjection(task: Task, from: number, until: number): TaskCalendarProjection[] { const value = task.due ?? task.start; if (!value) return []; const start = Date.parse(taskDateToComparableInstant(value)); if (start < from || start > until) return []; return [{ taskId: task.id, title: task.title, start: value.kind === 'DATE' ? `${value.value}T00:00:00.000Z` : value.value, end: value.kind === 'DATE' ? `${addDateDays(value.value, 1)}T00:00:00.000Z` : new Date(start + 60 * 60_000).toISOString(), timezone: value.timezone, allDay: value.kind === 'DATE', source: 'TASK' }]; }
function orderKeyForSort(value: string): string { return value; }
void orderKeyForSort;
