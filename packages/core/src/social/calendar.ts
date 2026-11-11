/**
 * Keystone Calendar.
 *
 * Calendar is a local-first object layer.  It deliberately does not own a
 * scheduler, a contacts database, or a file store: reminders are handed to a
 * Chronos-compatible host, participants are authenticated identities, and
 * attachments remain references which are checked by the File/Content layer.
 * Every durable object is bounded, revisioned and signed.  Shared calendars
 * use the same authenticated transport envelope as the rest of Keystone.
 */
import { canonicalJson, type CryptoProvider, signCanonical, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { SafetyRuntime, SafetySurfaceGate, type ContentDomain } from '../security/content-safety.js';

export const CALENDAR_VERSION = 1 as const;
export const CALENDAR_ENVELOPE = 'social.calendar';
export const CALENDAR_MAX_OBJECT_BYTES = 512 * 1024;
export const CALENDAR_MAX_EVENTS = 100_000;
export const CALENDAR_MAX_OCCURRENCES = 512;
export const CALENDAR_MAX_REVISIONS = 2_048;
export const CALENDAR_MAX_PENDING = 4_096;

export type CalendarVisibility = 'private' | 'shared' | 'contacts' | 'public';
export type CalendarEventVisibility = 'private' | 'shared' | 'contacts' | 'public';
export type CalendarDisclosure = 'FULL_EVENT' | 'TITLE_ONLY' | 'FREE_BUSY' | 'HIDDEN';
export type CalendarRSVP = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'MAYBE';
export type CalendarParticipantRole = 'organizer' | 'required' | 'optional' | 'resource';
export type CalendarMembershipRole = 'owner' | 'editor' | 'viewer';
export type CalendarInviteState = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceExceptionKind = 'edit' | 'delete' | 'move';
export type CalendarConflictKind = 'same_field' | 'stale_revision' | 'deleted_modified' | 'recurrence' | 'participant_response';

export const CALENDAR_PERMISSIONS = [
  'VIEW_EVENTS', 'VIEW_FREE_BUSY', 'CREATE', 'EDIT_OWN', 'EDIT_ALL',
  'DELETE_OWN', 'DELETE_ALL', 'INVITE', 'REMOVE_MEMBER',
  'MANAGE_PERMISSIONS', 'MANAGE_CALENDAR',
] as const;
export type CalendarPermissionName = (typeof CALENDAR_PERMISSIONS)[number];

export interface CalendarActor {
  readonly identityId: string;
  readonly deviceId?: string;
  readonly agentId?: string;
}

export interface CalendarMembership {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  readonly identityId: string;
  readonly role: CalendarMembershipRole;
  readonly permissions: readonly CalendarPermissionName[];
  readonly disclosure: CalendarDisclosure;
  readonly joinedAt: string;
  readonly removedAt?: string;
  readonly revision: number;
  readonly signature: string;
}

export interface CalendarPermission {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  /** Identity, participant, group or public subject. */
  readonly subjectType: 'identity' | 'participant' | 'group' | 'public';
  readonly subjectId: string;
  readonly permissions: readonly CalendarPermissionName[];
  readonly disclosure: CalendarDisclosure;
  readonly from?: string;
  readonly until?: string;
  readonly eventIds?: readonly string[];
  readonly groupId?: string;
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly revokedAt?: string;
  readonly revision: number;
  readonly signature: string;
}

export interface Calendar {
  readonly version: 1;
  readonly id: string;
  readonly ownerIdentityId: string;
  readonly name: string;
  readonly description?: string;
  readonly timezone: string;
  readonly visibility: CalendarVisibility;
  readonly color?: string;
  readonly style?: Readonly<Record<string, string>>;
  readonly members: readonly CalendarMembership[];
  readonly permissions: readonly CalendarPermission[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly tombstone: boolean;
  readonly signature: string;
}

export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly interval: number;
  /** JavaScript weekday numbering: Sunday = 0. */
  readonly weekdays?: readonly number[];
  readonly until?: string;
  readonly count?: number;
}

export interface RecurrenceException {
  readonly version: 1;
  readonly id: string;
  readonly eventId: string;
  /** Original occurrence instant, not the edited instance instant. */
  readonly occurrenceStart: string;
  readonly kind: RecurrenceExceptionKind;
  readonly eventPatch?: Readonly<Record<string, unknown>>;
  readonly newStart?: string;
  readonly newEnd?: string;
  readonly createdBy: CalendarActor;
  readonly createdAt: string;
  readonly revision: number;
  readonly signature: string;
}

export interface EventParticipant {
  readonly version: 1;
  readonly identityId: string;
  readonly role: CalendarParticipantRole;
  readonly rsvp: CalendarRSVP;
  readonly responseRevision: number;
  readonly respondedAt?: string;
  readonly responseSignature?: string;
  readonly disclosure?: CalendarDisclosure;
  readonly removedAt?: string;
}

export interface EventReminder {
  readonly version: 1;
  readonly id: string;
  readonly eventId: string;
  readonly kind: 'start' | 'offset' | 'absolute';
  readonly minutesBefore?: number;
  readonly absoluteAt?: string;
  readonly firedAt?: string;
  /** Fired occurrence instants for recurring reminders. Kept bounded by the service. */
  readonly firedOccurrences?: readonly string[];
  readonly chronosId?: string;
  readonly revision: number;
  readonly signature: string;
}

export interface EventAttachment {
  readonly version: 1;
  readonly id: string;
  readonly objectId: string;
  readonly objectType: 'file' | 'track' | 'video' | 'short' | 'live' | 'space' | 'workboard' | 'work-item' | 'object';
  readonly dataClass: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
  readonly locked?: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly signature: string;
}

export interface CalendarEvent {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  readonly creatorIdentityId: string;
  readonly title: string;
  readonly description: string;
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
  readonly allDay: boolean;
  readonly recurrence?: RecurrenceRule;
  readonly recurrenceExceptions: readonly RecurrenceException[];
  readonly reminders: readonly EventReminder[];
  readonly location?: string;
  readonly participants: readonly EventParticipant[];
  readonly attachments: readonly EventAttachment[];
  readonly spaceId?: string;
  readonly workboardId?: string;
  readonly workItemId?: string;
  readonly relatedObjectRefs: readonly string[];
  readonly visibility: CalendarEventVisibility;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly tombstone: boolean;
  readonly signature: string;
}

export interface CalendarEventRevision {
  readonly version: 1;
  readonly id: string;
  readonly eventId: string;
  readonly calendarId: string;
  readonly revision: number;
  readonly baseRevision?: number;
  readonly actor: CalendarActor;
  readonly changes: Readonly<Record<string, unknown>>;
  /** Optional model-independent snapshot used to reconstruct stale bases safely. */
  readonly snapshot?: CalendarEvent;
  readonly createdAt: string;
  readonly conflictId?: string;
  readonly signature: string;
}

export interface CalendarInvite {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  readonly inviterIdentityId: string;
  readonly inviteeIdentityId: string;
  readonly permissions: readonly CalendarPermissionName[];
  readonly disclosure: CalendarDisclosure;
  readonly state: CalendarInviteState;
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly respondedAt?: string;
  readonly revision: number;
  readonly signature: string;
}

export interface CalendarConflictState {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  readonly eventId: string;
  readonly kind: CalendarConflictKind;
  readonly baseRevision: number;
  readonly currentRevision: number;
  readonly incomingRevision: number;
  readonly fields: readonly string[];
  readonly currentEvent: CalendarEvent;
  readonly incomingEvent: CalendarEvent;
  readonly createdAt: string;
  readonly resolvedAt?: string;
  readonly resolution?: 'keep_current' | 'accept_incoming' | 'merged';
}

export interface AvailabilityInterval { readonly start: string; readonly end: string; }
export interface AvailabilityQuery {
  readonly participantIds: readonly string[];
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly desiredDurationMinutes: number;
  readonly preferredStart?: string;
  readonly preferredEnd?: string;
  readonly timezone?: string;
  readonly bufferBeforeMinutes?: number;
  readonly bufferAfterMinutes?: number;
  readonly requiredParticipantIds?: readonly string[];
  readonly optionalParticipantIds?: readonly string[];
  readonly workingHours?: { readonly start: string; readonly end: string };
}
export interface AvailabilityResult {
  readonly version: 1;
  readonly participantId: string;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly busy: readonly AvailabilityInterval[];
  readonly available: readonly AvailabilityInterval[];
  readonly disclosure: 'FREE_BUSY';
  readonly derivedOnly: true;
  readonly generatedAt: string;
  readonly signature?: string;
}

export interface CalendarSearchOptions {
  readonly query?: string;
  readonly from?: string;
  readonly until?: string;
  readonly calendarIds?: readonly string[];
  readonly participantId?: string;
  readonly relatedObjectId?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly actor?: CalendarActor;
}

export interface CalendarSnapshot {
  readonly version: 1;
  readonly calendars: readonly Calendar[];
  readonly events: readonly CalendarEvent[];
  readonly revisions: readonly CalendarEventRevision[];
  readonly recurrenceExceptions: readonly RecurrenceException[];
  readonly reminders: readonly EventReminder[];
  readonly invites: readonly CalendarInvite[];
  readonly conflicts: readonly CalendarConflictState[];
  readonly seen: readonly string[];
  readonly pending?: readonly CalendarReplicationEvent[];
}

export interface CalendarStateStore { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemoryCalendarStateStore implements CalendarStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

/** A host can put this backend behind the existing encrypted durable store. */
export class PersistentCalendarStateStore implements CalendarStateStore {
  constructor(private readonly backend: { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void> }) {}
  read(): Promise<unknown | undefined> { return this.backend.read(); }
  write(value: unknown): Promise<void> { return this.backend.write(value); }
}

export interface CalendarSigner {
  sign(payload: string, actor?: CalendarActor): Promise<string> | string;
  verify?(payload: string, signature: string, actor: CalendarActor): Promise<boolean> | boolean;
}

export interface CalendarReminderScheduler {
  schedule(input: { readonly id: string; readonly dueAt: string; readonly timezone: string; readonly calendarId: string; readonly eventId: string; readonly reminderId: string }): Promise<void>;
  cancel?(id: string): Promise<void>;
  recover?(input: { readonly calendarId: string; readonly eventId: string; readonly reminder: EventReminder; readonly dueAt: string }): Promise<void>;
}

/**
 * Typed bridge to the existing Chronos scheduler. Calendar never creates a
 * second scheduler: hosts adapt their Chronos instance to this small port.
 */
export interface ChronosCalendarPort {
  schedule(input: { readonly id: string; readonly dueAt: string; readonly timezone: string; readonly action: 'calendar.reminder'; readonly payload: Readonly<Record<string, string>> }): Promise<void>;
  cancel?(id: string): Promise<void>;
  recover?(input: { readonly id: string; readonly dueAt: string; readonly timezone: string; readonly payload: Readonly<Record<string, string>> }): Promise<void>;
}

export class ChronosCalendarReminderScheduler implements CalendarReminderScheduler {
  constructor(private readonly chronos: ChronosCalendarPort) {}
  schedule(input: { readonly id: string; readonly dueAt: string; readonly timezone: string; readonly calendarId: string; readonly eventId: string; readonly reminderId: string }): Promise<void> {
    return this.chronos.schedule({ id: input.id, dueAt: input.dueAt, timezone: input.timezone, action: 'calendar.reminder', payload: { calendarId: input.calendarId, eventId: input.eventId, reminderId: input.reminderId } });
  }
  cancel(id: string): Promise<void> { return this.chronos.cancel?.(id) ?? Promise.resolve(); }
  recover(input: { readonly calendarId: string; readonly eventId: string; readonly reminder: EventReminder; readonly dueAt: string }): Promise<void> {
    return this.chronos.recover?.({ id: input.reminder.chronosId ?? `${input.eventId}:${input.reminder.id}`, dueAt: input.dueAt, timezone: 'UTC', payload: { calendarId: input.calendarId, eventId: input.eventId, reminderId: input.reminder.id } }) ?? Promise.resolve();
  }
}

export interface CalendarNotificationBoundary {
  notify(input: { readonly title: string; readonly body: string; readonly data: Readonly<Record<string, string>> }): Promise<void>;
}

export interface CalendarReplicationAdapter {
  publish(event: CalendarReplicationEvent, recipients?: readonly string[]): Promise<void>;
}

export type CalendarReplicationOperation = 'calendar.upsert' | 'event.upsert' | 'revision.add' | 'invite.upsert' | 'exception.upsert' | 'reminder.upsert' | 'permission.upsert';
export interface CalendarReplicationEvent {
  readonly version: 1;
  readonly id: string;
  readonly calendarId: string;
  readonly operation: CalendarReplicationOperation;
  readonly targetId: string;
  readonly revision: number;
  readonly baseRevision?: number;
  readonly actor: CalendarActor;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly signature: string;
}

export interface CalendarServiceOptions {
  readonly identityId: string;
  readonly deviceId?: string;
  readonly storage?: CalendarStateStore;
  readonly signer?: CalendarSigner;
  readonly replication?: CalendarReplicationAdapter;
  readonly now?: () => number;
  readonly defaultTimezone?: string;
  readonly reminderScheduler?: CalendarReminderScheduler;
  readonly notifications?: CalendarNotificationBoundary;
  readonly attachmentPermission?: (input: { readonly identityId: string; readonly attachment: EventAttachment }) => Promise<boolean> | boolean;
  readonly availabilityProvider?: (identityId: string, query: AvailabilityQuery) => Promise<AvailabilityResult | undefined>;
  readonly authorize?: (input: { readonly action: string; readonly actor: CalendarActor; readonly calendar: Calendar; readonly event?: CalendarEvent }) => Promise<boolean> | boolean;
  readonly onConflict?: (conflict: CalendarConflictState) => void | Promise<void>;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
}

export interface CreateCalendarInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
  readonly timezone?: string;
  readonly visibility?: CalendarVisibility;
  readonly color?: string;
  readonly style?: Readonly<Record<string, string>>;
  readonly members?: readonly { readonly identityId: string; readonly role?: CalendarMembershipRole; readonly permissions?: readonly CalendarPermissionName[]; readonly disclosure?: CalendarDisclosure }[];
  readonly permissions?: readonly Omit<CalendarPermission, 'version' | 'id' | 'calendarId' | 'issuedBy' | 'issuedAt' | 'revision' | 'signature'>[];
}

export interface CreateEventInput {
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly start: string;
  readonly end: string;
  readonly timezone?: string;
  readonly allDay?: boolean;
  readonly recurrence?: RecurrenceRule;
  readonly recurrenceExceptions?: readonly Omit<RecurrenceException, 'version' | 'id' | 'eventId' | 'createdBy' | 'createdAt' | 'revision' | 'signature'>[];
  readonly reminders?: readonly (Omit<EventReminder, 'version' | 'eventId' | 'firedAt' | 'firedOccurrences' | 'chronosId' | 'revision' | 'signature'> & { readonly id?: string })[];
  readonly location?: string;
  readonly participants?: readonly (Partial<EventParticipant> & Pick<EventParticipant, 'identityId'>)[];
  readonly attachments?: readonly (Omit<EventAttachment, 'version' | 'createdBy' | 'createdAt' | 'signature'> & { readonly id?: string })[];
  readonly spaceId?: string;
  readonly workboardId?: string;
  readonly workItemId?: string;
  readonly relatedObjectRefs?: readonly string[];
  readonly visibility?: CalendarEventVisibility;
}

export interface UpdateEventInput {
  readonly baseRevision?: number;
  readonly patch: Partial<Omit<CalendarEvent, 'version' | 'id' | 'calendarId' | 'creatorIdentityId' | 'createdAt' | 'updatedAt' | 'revision' | 'signature'>>;
}

export interface CalendarAgentResult {
  readonly type: 'AGENT_SUGGESTION' | 'DERIVED_PREFERENCE' | 'PUBLIC_INFORMATION' | 'OWNER_CONFIRMED_DECISION';
  readonly text: string;
  readonly eventIds?: readonly string[];
  readonly intervals?: readonly AvailabilityInterval[];
  readonly requiresOwnerConfirmation: boolean;
}

export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode, message: string) { super(message); this.name = 'CalendarError'; }
}
export type CalendarErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'REVISION_CONFLICT' | 'REPLAY' | 'INVALID_SIGNATURE' | 'INVALID_EVENT' | 'INVALID_RECURRENCE' | 'INVITE_INVALID' | 'MEMBER_REVOKED' | 'CONFLICT' | 'BOUNDS_EXCEEDED' | 'PRIVATE_DATA' | 'REMINDER_INVALID';

const VIEWER_PERMISSIONS: readonly CalendarPermissionName[] = ['VIEW_FREE_BUSY'];
const EDITOR_PERMISSIONS: readonly CalendarPermissionName[] = ['VIEW_EVENTS', 'VIEW_FREE_BUSY', 'CREATE', 'EDIT_OWN', 'DELETE_OWN', 'INVITE'];
const DEFAULT_PERMISSIONS = VIEWER_PERMISSIONS;
const OWNER_PERMISSIONS: readonly CalendarPermissionName[] = [...CALENDAR_PERMISSIONS];
const DATA_CLASSES = new Set(['PUBLIC', 'USER_EXPLICIT', 'PRIVATE', 'SECRET']);
const CALENDAR_VISIBILITIES = new Set<CalendarVisibility>(['private', 'shared', 'contacts', 'public']);
const EVENT_VISIBILITIES = new Set<CalendarEventVisibility>(['private', 'shared', 'contacts', 'public']);
const CALENDAR_DISCLOSURES = new Set<CalendarDisclosure>(['FULL_EVENT', 'TITLE_ONLY', 'FREE_BUSY', 'HIDDEN']);
const MEMBERSHIP_ROLES = new Set<CalendarMembershipRole>(['owner', 'editor', 'viewer']);
const PARTICIPANT_ROLES = new Set<CalendarParticipantRole>(['organizer', 'required', 'optional', 'resource']);
const RSVP_VALUES = new Set<CalendarRSVP>(['PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE']);
const REMINDER_KINDS = new Set<EventReminder['kind']>(['start', 'offset', 'absolute']);
const ATTACHMENT_TYPES = new Set<EventAttachment['objectType']>(['file', 'track', 'video', 'short', 'live', 'space', 'workboard', 'work-item', 'object']);

function clone<T>(value: T): T { return structuredClone(value); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function safeId(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeIdentity(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value); }
function boundedText(value: unknown, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new CalendarError('INVALID_ARGUMENT', 'Calendar text is invalid'); return value.trim(); }
function safeDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validTimezone(value: string): string { try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value; } catch { throw new CalendarError('INVALID_ARGUMENT', 'Invalid IANA timezone'); } }
function stripUndefined<T>(value: T): T { if (Array.isArray(value)) return value.filter(item => item !== undefined).map(item => stripUndefined(item)) as T; if (value && typeof value === 'object') { const out: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) out[key] = stripUndefined(item); return out as T; } return value; }
function unsigned(value: { readonly signature: string }): Record<string, unknown> { const { signature: _signature, ...rest } = value as Record<string, unknown>; return rest; }
function digest(value: unknown): string { const text = canonicalJson(value); let a = 2166136261; let b = 2246822519; for (let i = 0; i < text.length; i += 1) { const code = text.charCodeAt(i); a = Math.imul(a ^ code, 16777619); b = Math.imul(b ^ (code + i), 2246822519); } return `calendar-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }
function validRange(start: string, end: string): void { if (!safeDate(start) || !safeDate(end) || Date.parse(end) <= Date.parse(start)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar event range is invalid'); }
function isTerminalTombstone(value: { readonly tombstone: boolean }): boolean { return value.tombstone === true; }
function permissionSet(values: readonly CalendarPermissionName[]): Set<CalendarPermissionName> { return new Set(values.filter(value => CALENDAR_PERMISSIONS.includes(value))); }
function normalizePermissions(values: readonly CalendarPermissionName[]): readonly CalendarPermissionName[] { if (!Array.isArray(values) || values.some(value => !CALENDAR_PERMISSIONS.includes(value))) throw new CalendarError('INVALID_ARGUMENT', 'Calendar permissions are invalid'); return [...new Set(values)]; }
function normalizeDisclosure(value: CalendarDisclosure | undefined): CalendarDisclosure { if (value !== undefined && !CALENDAR_DISCLOSURES.has(value)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar disclosure is invalid'); return value ?? 'FREE_BUSY'; }
function normalizeCalendarVisibility(value: CalendarVisibility | undefined): CalendarVisibility { const visibility = value ?? 'private'; if (!CALENDAR_VISIBILITIES.has(visibility)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar visibility is invalid'); return visibility; }
function normalizeEventVisibility(value: CalendarEventVisibility | undefined, fallback: CalendarEventVisibility): CalendarEventVisibility { const visibility = value ?? fallback; if (!EVENT_VISIBILITIES.has(visibility)) throw new CalendarError('INVALID_ARGUMENT', 'Event visibility is invalid'); return visibility; }
function maxLimit(value: number | undefined, min: number, max: number, fallback: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback; }

function defaultSigner(): CalendarSigner { return { sign: payload => digest(payload), verify: (payload, signature) => digest(payload) === signature }; }

/** RFC-compatible timezone offset in milliseconds for an instant. */
function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - date.getTime();
}
function localParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '0';
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), hour: Number(value('hour')), minute: Number(value('minute')), second: Number(value('second')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday')) };
}
function zonedToUtc(parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timezone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second ?? 0);
  let instant = naive;
  for (let i = 0; i < 3; i += 1) { const next = naive - timezoneOffsetMs(new Date(instant), timezone); if (next === instant) break; instant = next; }
  return new Date(instant);
}
function addCalendarDays(parts: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } { const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)); date.setUTCDate(date.getUTCDate() + days); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; }
function intervalMinutes(value: string): number { const match = /^(\d{1,2}):(\d{2})$/.exec(value); if (!match) throw new CalendarError('INVALID_ARGUMENT', 'Time must be HH:MM'); const hour = Number(match[1]); const minute = Number(match[2]); if (hour > 23 || minute > 59) throw new CalendarError('INVALID_ARGUMENT', 'Time is invalid'); return hour * 60 + minute; }
function intersectIntervals(left: readonly AvailabilityInterval[], right: readonly AvailabilityInterval[]): AvailabilityInterval[] { const result: AvailabilityInterval[] = []; for (const a of left) for (const b of right) { const start = Math.max(Date.parse(a.start), Date.parse(b.start)); const end = Math.min(Date.parse(a.end), Date.parse(b.end)); if (end > start) result.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }); } return mergeIntervals(result); }
function mergeIntervals(values: readonly AvailabilityInterval[]): AvailabilityInterval[] { const sorted = [...values].filter(value => safeDate(value.start) && safeDate(value.end) && Date.parse(value.end) > Date.parse(value.start)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)); const result: Array<{ start: string; end: string }> = []; for (const value of sorted) { const last = result[result.length - 1]; if (last && Date.parse(value.start) <= Date.parse(last.end)) last.end = new Date(Math.max(Date.parse(last.end), Date.parse(value.end))).toISOString(); else result.push({ start: value.start, end: value.end }); } return result; }
function subtractIntervals(range: AvailabilityInterval, busy: readonly AvailabilityInterval[]): AvailabilityInterval[] { const result: AvailabilityInterval[] = []; let cursor = Date.parse(range.start); const end = Date.parse(range.end); for (const interval of mergeIntervals(busy)) { const start = Math.max(cursor, Date.parse(interval.start)); const stop = Math.min(end, Date.parse(interval.end)); if (start > cursor) result.push({ start: new Date(cursor).toISOString(), end: new Date(start).toISOString() }); cursor = Math.max(cursor, stop); if (cursor >= end) break; } if (cursor < end) result.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() }); return result; }
function recurrenceValid(rule: RecurrenceRule | undefined): void { if (!rule) return; if (!['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1 || rule.interval > 366 || (rule.count !== undefined && (!Number.isSafeInteger(rule.count) || rule.count < 1 || rule.count > 100_000)) || (rule.until !== undefined && !safeDate(rule.until)) || (rule.weekdays !== undefined && (!Array.isArray(rule.weekdays) || rule.weekdays.length > 7 || rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)))) throw new CalendarError('INVALID_RECURRENCE', 'Recurrence rule is invalid'); }
function recurrenceRule(value: RecurrenceRule | undefined): RecurrenceRule | undefined { recurrenceValid(value); return value ? { frequency: value.frequency, interval: value.interval, ...(value.weekdays?.length ? { weekdays: [...new Set(value.weekdays)].sort((a, b) => a - b) } : {}), ...(value.until ? { until: value.until } : {}), ...(value.count ? { count: value.count } : {}) } : undefined; }
function defaultActor(identityId: string, deviceId?: string): CalendarActor { return { identityId, ...(deviceId ? { deviceId } : {}) }; }
function actorIdentity(actor: CalendarActor | string): string { return typeof actor === 'string' ? actor : actor.identityId; }

export class CalendarConflictResolver {
  merge(base: CalendarEvent, current: CalendarEvent, incoming: CalendarEvent): { event?: CalendarEvent; conflicts: readonly string[] } {
    if (base.id !== current.id || current.id !== incoming.id) throw new CalendarError('INVALID_ARGUMENT', 'Cannot merge different events');
    const fields = ['title', 'description', 'start', 'end', 'timezone', 'allDay', 'recurrence', 'recurrenceExceptions', 'reminders', 'location', 'participants', 'attachments', 'spaceId', 'workboardId', 'workItemId', 'relatedObjectRefs', 'visibility', 'tombstone'] as const;
    const conflicts: string[] = []; const patch: Record<string, unknown> = {};
    for (const field of fields) { const before = canonicalJson(base[field]); const local = canonicalJson(current[field]); const remote = canonicalJson(incoming[field]); const localChanged = local !== before; const remoteChanged = remote !== before; if (localChanged && remoteChanged && local !== remote) conflicts.push(field); else if (remoteChanged) patch[field] = clone(incoming[field]); }
    if (conflicts.length) return { conflicts };
    return { event: { ...current, ...patch, revision: Math.max(current.revision, incoming.revision) + 1, updatedAt: incoming.updatedAt, signature: incoming.signature }, conflicts: [] };
  }
  resolve(conflict: CalendarConflictState, resolution: 'keep_current' | 'accept_incoming' | 'merged', merged?: CalendarEvent): CalendarEvent {
    if (resolution === 'keep_current') return clone(conflict.currentEvent);
    if (resolution === 'accept_incoming') return clone(conflict.incomingEvent);
    if (!merged || merged.id !== conflict.eventId) throw new CalendarError('INVALID_ARGUMENT', 'Merged event is invalid');
    return clone(merged);
  }
}

export class CalendarService {
  private readonly calendars = new Map<string, Calendar>();
  private readonly events = new Map<string, CalendarEvent>();
  private readonly revisions = new Map<string, CalendarEventRevision[]>();
  private readonly exceptions = new Map<string, RecurrenceException>();
  private readonly reminders = new Map<string, EventReminder>();
  private readonly invites = new Map<string, CalendarInvite>();
  private readonly conflicts = new Map<string, CalendarConflictState>();
  private readonly seen = new Set<string>();
  private readonly pendingIncoming: CalendarReplicationEvent[] = [];
  private readonly listeners = new Set<(event: CalendarReplicationEvent) => void | Promise<void>>();
  private readonly now: () => number;
  private readonly signer: CalendarSigner;
  private readonly storage: CalendarStateStore;
  private readonly defaultTimezone: string;
  private readonly resolver: CalendarConflictResolver;
  private readonly writes: { value: Promise<void> } = { value: Promise.resolve() };
  private readyPromise?: Promise<void>;
  private closed = false;
  private replication?: CalendarReplicationAdapter;
  private readonly options: CalendarServiceOptions;
  private readonly protectedSurfaces: MandatorySafetySurfaceRegistry;

  constructor(options: CalendarServiceOptions) {
    if (!safeIdentity(options.identityId)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar identity is invalid');
    this.options = options; this.now = options.now ?? Date.now; this.signer = options.signer ?? defaultSigner(); this.storage = options.storage ?? new InMemoryCalendarStateStore(); this.defaultTimezone = validTimezone(options.defaultTimezone ?? 'UTC'); this.resolver = new CalendarConflictResolver(); this.replication = options.replication; this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
  }

  get identityId(): string { return this.options.identityId; }
  get localActor(): CalendarActor { return defaultActor(this.options.identityId, this.options.deviceId); }
  get conflictResolver(): CalendarConflictResolver { return this.resolver; }
  setReplication(replication?: CalendarReplicationAdapter): void { this.replication = replication; }
  subscribe(listener: (event: CalendarReplicationEvent) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async ready(): Promise<void> { this.readyPromise ??= this.hydrate(); return this.readyPromise; }
  close(): void { this.closed = true; this.listeners.clear(); }

  async createCalendar(input: CreateCalendarInput, actor: CalendarActor = this.localActor): Promise<Calendar> {
    await this.ready(); if (actorIdentity(actor) !== this.identityId) throw new CalendarError('NOT_AUTHORIZED', 'Only the local identity can create a local calendar');
    const id = input.id ?? randomId('calendar'); if (!safeId(id)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar id is invalid'); if (this.calendars.has(id)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar already exists');
    const timestamp = nowIso(this.now); const timezone = validTimezone(input.timezone ?? this.defaultTimezone); const visibility = normalizeCalendarVisibility(input.visibility);
    const ownerMembership = await this.makeMembership(id, this.identityId, 'owner', OWNER_PERMISSIONS, 'FULL_EVENT', timestamp, 1);
    if ((input.members?.length ?? 0) > 4_096 || (input.permissions?.length ?? 0) > 4_096) throw new CalendarError('BOUNDS_EXCEEDED', 'Calendar membership or permission bound exceeded');
    const members: CalendarMembership[] = [ownerMembership];
    for (const member of input.members ?? []) { if (member.identityId === this.identityId) continue; const role = member.role ?? 'viewer'; if (role === 'owner') throw new CalendarError('INVALID_ARGUMENT', 'Only the calendar creator can be owner'); members.push(await this.makeMembership(id, member.identityId, role, member.permissions ?? (role === 'editor' ? EDITOR_PERMISSIONS : VIEWER_PERMISSIONS), member.disclosure ?? (role === 'editor' ? 'FULL_EVENT' : 'FREE_BUSY'), timestamp, 1)); }
    const permissions: CalendarPermission[] = [];
    for (const permission of input.permissions ?? []) permissions.push(await this.makePermission(id, permission, actor, timestamp, 1));
    const calendar = await this.withSignature({ version: 1 as const, id, ownerIdentityId: this.identityId, name: boundedText(input.name, 256, true), ...(input.description ? { description: boundedText(input.description, 4_096) } : {}), timezone, visibility, ...(input.color ? { color: boundedText(input.color, 64) } : {}), ...(input.style ? { style: Object.fromEntries(Object.entries(input.style).slice(0, 32).map(([key, value]) => [key.slice(0, 64), String(value).slice(0, 256)])) } : {}), members, permissions, createdAt: timestamp, updatedAt: timestamp, revision: 1, tombstone: false });
    if (!(await this.visibleShared(calendar))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar failed mandatory SafetySurfaceGate'); this.calendars.set(id, calendar); await this.persist(); await this.emit('calendar.upsert', id, 1, calendar, actor, id); return clone(calendar);
  }

  async getCalendar(id: string, actor: CalendarActor | string = this.localActor): Promise<Calendar | undefined> { await this.ready(); const value = this.calendars.get(id); if (!value || !this.canReadCalendar(value, actorIdentity(actor), 'VIEW_FREE_BUSY') || !(await this.visibleShared(value))) return undefined; return clone(value); }
  async listCalendars(actor: CalendarActor | string = this.localActor, includeTombstone = false): Promise<readonly Calendar[]> { await this.ready(); const output: Calendar[] = []; for (const value of this.calendars.values()) if ((includeTombstone || !value.tombstone) && this.canReadCalendar(value, actorIdentity(actor), 'VIEW_FREE_BUSY') && await this.visibleShared(value)) output.push(clone(value)); return output; }

  async updateCalendar(calendarId: string, patch: Partial<Pick<Calendar, 'name' | 'description' | 'timezone' | 'visibility' | 'color' | 'style'>>, actor: CalendarActor = this.localActor): Promise<Calendar> {
    await this.ready(); const current = this.requireCalendar(calendarId); await this.authorize('calendar.update', actor, current); if (!this.hasPermission(current, actorIdentity(actor), 'MANAGE_CALENDAR')) throw new CalendarError('NOT_AUTHORIZED', 'Calendar management permission is required');
    const next = await this.withSignature({ ...current, ...(patch.name !== undefined ? { name: boundedText(patch.name, 256, true) } : {}), ...(patch.description !== undefined ? { description: boundedText(patch.description, 4_096) } : {}), ...(patch.timezone !== undefined ? { timezone: validTimezone(patch.timezone) } : {}), ...(patch.visibility !== undefined ? { visibility: normalizeCalendarVisibility(patch.visibility) } : {}), ...(patch.color !== undefined ? { color: boundedText(patch.color, 64) } : {}), ...(patch.style !== undefined ? { style: Object.fromEntries(Object.entries(patch.style).slice(0, 32)) } : {}), revision: current.revision + 1, updatedAt: nowIso(this.now) });
    if (!(await this.visibleShared(next))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar failed mandatory SafetySurfaceGate'); this.calendars.set(calendarId, next); await this.persist(); await this.emit('calendar.upsert', calendarId, next.revision, next, actor, calendarId); return clone(next);
  }

  async deleteCalendar(calendarId: string, actor: CalendarActor = this.localActor): Promise<Calendar> { const current = await this.updateCalendar(calendarId, {}, actor); const next = await this.withSignature({ ...current, tombstone: true, revision: current.revision + 1, updatedAt: nowIso(this.now) }); if (!(await this.visibleShared(next))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar failed mandatory SafetySurfaceGate'); this.calendars.set(calendarId, next); await this.persist(); await this.emit('calendar.upsert', calendarId, next.revision, next, actor, calendarId); return clone(next); }

  async addMember(calendarId: string, input: { readonly identityId: string; readonly role?: CalendarMembershipRole; readonly permissions?: readonly CalendarPermissionName[]; readonly disclosure?: CalendarDisclosure }, actor: CalendarActor = this.localActor): Promise<CalendarMembership> {
    await this.ready(); const current = this.requireCalendar(calendarId); await this.authorize('member.add', actor, current); if (!this.hasPermission(current, actorIdentity(actor), 'INVITE') && !this.hasPermission(current, actorIdentity(actor), 'MANAGE_CALENDAR')) throw new CalendarError('NOT_AUTHORIZED', 'Invite permission is required'); if (!safeIdentity(input.identityId)) throw new CalendarError('INVALID_ARGUMENT', 'Member identity is invalid');
    const existing = current.members.find(member => member.identityId === input.identityId && !member.removedAt); if (existing) return clone(existing); const timestamp = nowIso(this.now); const role = input.role ?? 'viewer'; if (role === 'owner') throw new CalendarError('INVALID_ARGUMENT', 'Only the calendar creator can be owner'); const membership = await this.makeMembership(calendarId, input.identityId, role, input.permissions ?? (role === 'editor' ? EDITOR_PERMISSIONS : VIEWER_PERMISSIONS), input.disclosure ?? (role === 'editor' ? 'FULL_EVENT' : 'FREE_BUSY'), timestamp, current.revision + 1); const members = [...current.members, membership]; const next = await this.withSignature({ ...current, members, revision: current.revision + 1, updatedAt: timestamp }); this.calendars.set(calendarId, next); await this.persist(); await this.emit('calendar.upsert', calendarId, next.revision, next, actor, calendarId); return clone(membership);
  }

  async removeMember(calendarId: string, identityId: string, actor: CalendarActor = this.localActor): Promise<Calendar> {
    await this.ready(); const current = this.requireCalendar(calendarId); await this.authorize('member.remove', actor, current); if (!this.hasPermission(current, actorIdentity(actor), 'REMOVE_MEMBER')) throw new CalendarError('NOT_AUTHORIZED', 'Remove-member permission is required'); if (identityId === current.ownerIdentityId) throw new CalendarError('NOT_AUTHORIZED', 'The calendar owner cannot be removed'); const timestamp = nowIso(this.now); const members: CalendarMembership[] = []; for (const member of current.members) { if (member.identityId === identityId && !member.removedAt) members.push(await this.withSignature({ version: member.version, id: member.id, calendarId: member.calendarId, identityId: member.identityId, role: member.role, permissions: member.permissions, disclosure: member.disclosure, joinedAt: member.joinedAt, removedAt: timestamp, revision: member.revision + 1 })); else members.push(member); } const next = await this.withSignature({ ...current, members, revision: current.revision + 1, updatedAt: timestamp }); this.calendars.set(calendarId, next); await this.persist(); await this.emit('calendar.upsert', calendarId, next.revision, next, actor, calendarId); return clone(next);
  }

  async setPermissions(calendarId: string, input: { readonly subjectType: CalendarPermission['subjectType']; readonly subjectId: string; readonly permissions: readonly CalendarPermissionName[]; readonly disclosure?: CalendarDisclosure; readonly from?: string; readonly until?: string; readonly eventIds?: readonly string[]; readonly groupId?: string }, actor: CalendarActor = this.localActor): Promise<CalendarPermission> {
    await this.ready(); const current = this.requireCalendar(calendarId); await this.authorize('permission.set', actor, current); if (!this.hasPermission(current, actorIdentity(actor), 'MANAGE_PERMISSIONS')) throw new CalendarError('NOT_AUTHORIZED', 'Permission management is required'); const permission = await this.makePermission(calendarId, input, actor, nowIso(this.now), current.revision + 1); const next = await this.withSignature({ ...current, permissions: [...current.permissions.filter(item => !(item.subjectType === input.subjectType && item.subjectId === input.subjectId && !item.revokedAt)), permission], revision: current.revision + 1, updatedAt: nowIso(this.now) }); this.calendars.set(calendarId, next); await this.persist(); await this.emit('calendar.upsert', calendarId, next.revision, next, actor, calendarId); return clone(permission);
  }

  async createInvite(calendarId: string, input: { readonly inviteeIdentityId: string; readonly permissions?: readonly CalendarPermissionName[]; readonly disclosure?: CalendarDisclosure; readonly expiresAt?: string }, actor: CalendarActor = this.localActor): Promise<CalendarInvite> {
    await this.ready(); const calendar = this.requireCalendar(calendarId); await this.authorize('invite.create', actor, calendar); if (!this.hasPermission(calendar, actorIdentity(actor), 'INVITE')) throw new CalendarError('NOT_AUTHORIZED', 'Invite permission is required'); if (!safeIdentity(input.inviteeIdentityId) || (input.expiresAt && !safeDate(input.expiresAt))) throw new CalendarError('INVITE_INVALID', 'Invite is invalid'); const permissions = normalizePermissions(input.permissions ?? DEFAULT_PERMISSIONS); const invite = await this.withSignature({ version: 1 as const, id: randomId('calendar-invite'), calendarId, inviterIdentityId: actorIdentity(actor), inviteeIdentityId: input.inviteeIdentityId, permissions, disclosure: input.disclosure ?? 'FREE_BUSY', state: 'pending' as const, createdAt: nowIso(this.now), ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}), revision: 1 }); this.invites.set(invite.id, invite); await this.persist(); await this.emit('calendar.upsert', calendar.id, calendar.revision, calendar, actor, calendarId, undefined, [input.inviteeIdentityId]); await this.emit('invite.upsert', invite.id, invite.revision, invite, actor, calendarId, undefined, [input.inviteeIdentityId]); return clone(invite);
  }

  async acceptInvite(inviteId: string, actor: CalendarActor = this.localActor): Promise<CalendarInvite> { await this.ready(); const invite = this.requireInvite(inviteId); if (invite.inviteeIdentityId !== actorIdentity(actor)) throw new CalendarError('NOT_AUTHORIZED', 'Only the invitee can accept this invite'); if (invite.state !== 'pending' || (invite.expiresAt && Date.parse(invite.expiresAt) <= this.now())) throw new CalendarError('INVITE_INVALID', 'Invite is no longer active'); const calendar = this.requireCalendar(invite.calendarId); const membership = await this.makeMembership(calendar.id, actorIdentity(actor), 'viewer', invite.permissions, invite.disclosure, nowIso(this.now), calendar.revision + 1); const nextCalendar = await this.withSignature({ ...calendar, members: [...calendar.members.filter(item => item.identityId !== actorIdentity(actor)), membership], revision: calendar.revision + 1, updatedAt: nowIso(this.now) }); this.calendars.set(calendar.id, nextCalendar); const next = await this.withSignature({ ...invite, state: 'accepted' as const, respondedAt: nowIso(this.now), revision: invite.revision + 1 }); this.invites.set(invite.id, next); await this.persist(); await this.emit('invite.upsert', invite.id, next.revision, next, actor, calendar.id); return clone(next); }
  async declineInvite(inviteId: string, actor: CalendarActor = this.localActor): Promise<CalendarInvite> { await this.ready(); const invite = this.requireInvite(inviteId); if (invite.inviteeIdentityId !== actorIdentity(actor)) throw new CalendarError('NOT_AUTHORIZED', 'Only the invitee can decline this invite'); if (invite.state !== 'pending') return clone(invite); const next = await this.withSignature({ ...invite, state: 'declined' as const, respondedAt: nowIso(this.now), revision: invite.revision + 1 }); this.invites.set(invite.id, next); await this.persist(); await this.emit('invite.upsert', invite.id, next.revision, next, actor, invite.calendarId); return clone(next); }
  async listInvites(actor: CalendarActor | string = this.localActor): Promise<readonly CalendarInvite[]> { await this.ready(); const identity = actorIdentity(actor); return [...this.invites.values()].filter(value => value.inviteeIdentityId === identity || value.inviterIdentityId === identity).map(clone); }

  async createEvent(calendarId: string, input: CreateEventInput, actor: CalendarActor = this.localActor): Promise<CalendarEvent> {
    await this.ready(); const calendar = this.requireCalendar(calendarId); await this.authorize('event.create', actor, calendar); if (!this.hasPermission(calendar, actorIdentity(actor), 'CREATE')) throw new CalendarError('NOT_AUTHORIZED', 'Create permission is required'); if (this.events.size >= CALENDAR_MAX_EVENTS) throw new CalendarError('BOUNDS_EXCEEDED', 'Calendar event bound exceeded'); const id = input.id ?? randomId('event'); if (!safeId(id)) throw new CalendarError('INVALID_ARGUMENT', 'Event id is invalid'); if (this.events.has(id)) throw new CalendarError('INVALID_ARGUMENT', 'Event already exists'); const event = await this.buildEvent(calendar, input, actor); if (!(await this.visibleShared(event))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar event failed mandatory SafetySurfaceGate'); this.events.set(id, event); const revision = await this.makeRevision(event, actor, undefined, input); this.revisions.set(id, [revision]); for (const exception of event.recurrenceExceptions) this.exceptions.set(exception.id, exception); for (const reminder of event.reminders) this.reminders.set(reminder.id, reminder); await this.persist(); await this.scheduleReminders(event); await this.emit('event.upsert', id, event.revision, event, actor, calendarId); await this.emit('revision.add', revision.id, revision.revision, revision, actor, calendarId); return clone(event);
  }

  async getEvent(eventId: string, actor: CalendarActor | string = this.localActor): Promise<CalendarEvent | undefined> { await this.ready(); const event = this.events.get(eventId); if (!event || !(await this.visibleShared(event))) return undefined; const visible = await this.visibleEvent(event, actorIdentity(actor)); return visible ? clone(visible) : undefined; }
  async listEvents(calendarId: string, options: { readonly from?: string; readonly until?: string; readonly actor?: CalendarActor | string; readonly includeTombstone?: boolean; readonly expand?: boolean; readonly limit?: number } = {}): Promise<readonly CalendarEvent[]> { await this.ready(); const calendar = this.calendars.get(calendarId); if (!calendar || !this.canReadCalendar(calendar, actorIdentity(options.actor ?? this.localActor), 'VIEW_FREE_BUSY')) return []; const from = options.from ?? new Date(this.now() - 366 * 86_400_000).toISOString(); const until = options.until ?? new Date(this.now() + 366 * 86_400_000).toISOString(); validRange(from, until); const values = [...this.events.values()].filter(event => event.calendarId === calendarId && (options.includeTombstone || !event.tombstone)); const output: CalendarEvent[] = []; for (const event of values) { const visible = await this.visibleEvent(event, actorIdentity(options.actor ?? this.localActor)); if (!visible) continue; if (options.expand) { const occurrences = this.expandOccurrences(event, from, until, maxLimit(options.limit, 1, CALENDAR_MAX_OCCURRENCES, CALENDAR_MAX_OCCURRENCES)); for (const occurrence of occurrences) output.push(occurrence); } else if (Date.parse(event.end) >= Date.parse(from) && Date.parse(event.start) <= Date.parse(until)) output.push(visible); } return output.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)).slice(0, maxLimit(options.limit, 1, CALENDAR_MAX_EVENTS, CALENDAR_MAX_EVENTS)).map(clone); }

  async updateEvent(eventId: string, input: UpdateEventInput, actor: CalendarActor = this.localActor): Promise<CalendarEvent> {
    await this.ready(); const current = this.requireEvent(eventId); const calendar = this.requireCalendar(current.calendarId); await this.authorize('event.update', actor, calendar, current); const owns = current.creatorIdentityId === actorIdentity(actor); const permission = owns ? 'EDIT_OWN' : 'EDIT_ALL'; if (!this.hasPermission(calendar, actorIdentity(actor), permission)) throw new CalendarError('NOT_AUTHORIZED', `${permission} permission is required`); const baseRevision = input.baseRevision ?? current.revision; if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) throw new CalendarError('REVISION_CONFLICT', 'Event base revision is invalid'); const patch = this.normalizeEventPatch(input.patch); validRange(patch.start ?? current.start, patch.end ?? current.end); if (baseRevision !== current.revision) { const base = this.revisions.get(eventId)?.find(revision => revision.revision === baseRevision); if (!base) throw new CalendarError('REVISION_CONFLICT', 'Event base revision is unavailable'); const baseEvent = this.reconstructRevision(current, baseRevision); const incoming = await this.withSignature({ ...current, ...patch, revision: baseRevision + 1, updatedAt: nowIso(this.now) }); const merged = this.resolver.merge(baseEvent, current, incoming); if (merged.conflicts.length) { const conflict = await this.makeConflict(current, incoming, merged.conflicts, 'same_field', baseRevision); this.conflicts.set(conflict.id, conflict); await this.persist(); await this.options.onConflict?.(clone(conflict)); throw new CalendarError('CONFLICT', `Calendar event conflict: ${conflict.id}`); } validRange(merged.event!.start, merged.event!.end); return this.commitEventUpdate(current, merged.event!, actor, baseRevision, patch); }
    const next = await this.withSignature({ ...current, ...patch, revision: current.revision + 1, updatedAt: nowIso(this.now) }); return this.commitEventUpdate(current, next, actor, baseRevision, patch);
  }

  async deleteEvent(eventId: string, actor: CalendarActor = this.localActor): Promise<CalendarEvent> { const current = this.requireEvent(eventId); const calendar = this.requireCalendar(current.calendarId); await this.authorize('event.delete', actor, calendar, current); const permission = current.creatorIdentityId === actorIdentity(actor) ? 'DELETE_OWN' : 'DELETE_ALL'; if (!this.hasPermission(calendar, actorIdentity(actor), permission)) throw new CalendarError('NOT_AUTHORIZED', `${permission} permission is required`); const next = await this.withSignature({ ...current, tombstone: true, revision: current.revision + 1, updatedAt: nowIso(this.now) }); return this.commitEventUpdate(current, next, actor, current.revision, { tombstone: true }); }

  async respond(eventId: string, rsvp: CalendarRSVP, actor: CalendarActor = this.localActor): Promise<CalendarEvent> { await this.ready(); if (!['PENDING', 'ACCEPTED', 'DECLINED', 'MAYBE'].includes(rsvp)) throw new CalendarError('INVALID_ARGUMENT', 'Invalid RSVP'); const current = this.requireEvent(eventId); const calendar = this.requireCalendar(current.calendarId); const identity = actorIdentity(actor); const index = current.participants.findIndex(participant => participant.identityId === identity && !participant.removedAt); if (index < 0) throw new CalendarError('NOT_AUTHORIZED', 'Only an event participant can respond'); const participant = current.participants[index]!; const responseRevision = participant.responseRevision + 1; const unsignedResponse = { eventId, identityId: identity, rsvp, responseRevision, respondedAt: nowIso(this.now) }; const responseSignature = await signCanonical(unsignedResponse, canonicalBytes => this.signer.sign(canonicalBytes, actor)); const participants = current.participants.map((value, valueIndex) => valueIndex === index ? { ...value, rsvp, responseRevision, respondedAt: unsignedResponse.respondedAt, responseSignature } : value); const next = await this.withSignature({ ...current, participants, revision: current.revision + 1, updatedAt: nowIso(this.now) }); return this.commitEventUpdate(current, next, actor, current.revision, { participants }); }

  async removeParticipant(eventId: string, identityId: string, actor: CalendarActor = this.localActor): Promise<CalendarEvent> { const current = this.requireEvent(eventId); const calendar = this.requireCalendar(current.calendarId); await this.authorize('participant.remove', actor, calendar, current); if (current.creatorIdentityId !== actorIdentity(actor) && !this.hasPermission(calendar, actorIdentity(actor), 'EDIT_ALL')) throw new CalendarError('NOT_AUTHORIZED', 'Only the organizer may remove participants'); const participants = current.participants.map(value => value.identityId === identityId ? { ...value, removedAt: nowIso(this.now), rsvp: 'DECLINED' as const, responseRevision: value.responseRevision + 1 } : value); const next = await this.withSignature({ ...current, participants, revision: current.revision + 1, updatedAt: nowIso(this.now) }); return this.commitEventUpdate(current, next, actor, current.revision, { participants }); }

  async addRecurrenceException(eventId: string, input: Omit<RecurrenceException, 'version' | 'id' | 'eventId' | 'createdBy' | 'createdAt' | 'revision' | 'signature'>, actor: CalendarActor = this.localActor): Promise<CalendarEvent> {
    await this.ready(); const current = this.requireEvent(eventId); const calendar = this.requireCalendar(current.calendarId); await this.authorize('event.recurrence_exception', actor, calendar, current); const permission = current.creatorIdentityId === actorIdentity(actor) ? 'EDIT_OWN' : 'EDIT_ALL'; if (!this.hasPermission(calendar, actorIdentity(actor), permission)) throw new CalendarError('NOT_AUTHORIZED', `${permission} permission is required`); if (!safeDate(input.occurrenceStart)) throw new CalendarError('INVALID_RECURRENCE', 'Occurrence start is invalid'); if (!['edit', 'delete', 'move'].includes(input.kind)) throw new CalendarError('INVALID_RECURRENCE', 'Exception kind is invalid'); if (input.kind === 'move') { if (!input.newStart || !safeDate(input.newStart)) throw new CalendarError('INVALID_RECURRENCE', 'Moved occurrence start is invalid'); if (input.newEnd && (!safeDate(input.newEnd) || Date.parse(input.newEnd) <= Date.parse(input.newStart))) throw new CalendarError('INVALID_RECURRENCE', 'Moved occurrence range is invalid'); }
    const exception = await this.withSignature({ version: 1 as const, id: randomId('exception'), eventId, occurrenceStart: input.occurrenceStart, kind: input.kind, ...(input.eventPatch ? { eventPatch: clone(input.eventPatch) } : {}), ...(input.newStart ? { newStart: input.newStart } : {}), ...(input.newEnd ? { newEnd: input.newEnd } : {}), createdBy: actor, createdAt: nowIso(this.now), revision: 1 });
    const recurrenceExceptions = [...current.recurrenceExceptions.filter(value => value.occurrenceStart !== exception.occurrenceStart), exception]; const next = await this.withSignature({ ...current, recurrenceExceptions, revision: current.revision + 1, updatedAt: nowIso(this.now) }); return this.commitEventUpdate(current, next, actor, current.revision, { recurrenceExceptions });
  }

  expandOccurrences(event: CalendarEvent, rangeStart: string, rangeEnd: string, limit = CALENDAR_MAX_OCCURRENCES): CalendarEvent[] {
    validRange(rangeStart, rangeEnd); const cap = maxLimit(limit, 1, CALENDAR_MAX_OCCURRENCES, CALENDAR_MAX_OCCURRENCES); if (event.tombstone) return []; const startBound = Date.parse(rangeStart); const endBound = Date.parse(rangeEnd); const base = new Date(event.start); const duration = Date.parse(event.end) - Date.parse(event.start); if (!event.recurrence) return Date.parse(event.end) >= startBound && Date.parse(event.start) <= endBound ? [clone(event)] : [];
    const timezone = validTimezone(event.timezone); const baseLocal = localParts(base, timezone); const rule = event.recurrence; const result: CalendarEvent[] = []; const exceptions = new Map(event.recurrenceExceptions.map(value => [value.occurrenceStart, value])); let emitted = 0; let candidate = { year: baseLocal.year, month: baseLocal.month, day: baseLocal.day }; let generated = 0; const horizon = new Date(endBound + 366 * 86_400_000); const shouldAdd = (parts: { year: number; month: number; day: number }, occurrenceIndex: number) => {
      const instant = zonedToUtc({ ...parts, hour: baseLocal.hour, minute: baseLocal.minute, second: baseLocal.second }, timezone); const originalStart = instant.toISOString(); if (instant.getTime() > horizon.getTime() || (rule.until && instant.getTime() > Date.parse(rule.until)) || (rule.count && occurrenceIndex >= rule.count)) return false; const exception = exceptions.get(originalStart); if (exception?.kind === 'delete') return false; let start = instant; let end = new Date(instant.getTime() + duration); let patch: Record<string, unknown> = {}; if (exception?.kind === 'move' && exception.newStart) { start = new Date(exception.newStart); end = exception.newEnd ? new Date(exception.newEnd) : new Date(start.getTime() + duration); } if (exception?.kind === 'edit' && exception.eventPatch) patch = exception.eventPatch as Record<string, unknown>; if (start.getTime() <= endBound && end.getTime() >= startBound) { result.push({ ...clone(event), ...patch, id: `${event.id}@${originalStart}`, start: start.toISOString(), end: end.toISOString(), recurrence: undefined, recurrenceExceptions: [], reminders: [], revision: event.revision, updatedAt: event.updatedAt }); emitted += 1; } return emitted >= cap;
    };
    if (rule.frequency === 'weekly' && rule.weekdays?.length) {
      const firstWeekStart = addCalendarDays(candidate, -((baseLocal.weekday + 7) % 7)); for (let dayIndex = 0; generated < cap && dayIndex < 366 * 10; dayIndex += 1) { const day = addCalendarDays(firstWeekStart, dayIndex); const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay(); const weeks = Math.floor(dayIndex / 7); if (rule.weekdays.includes(weekday) && weeks % rule.interval === 0) { if (shouldAdd(day, generated)) break; generated += 1; } }
    } else {
      for (let index = 0; generated < cap && index < 100_000; index += 1) { if (shouldAdd(candidate, generated)) break; generated += 1; if (rule.frequency === 'daily') candidate = addCalendarDays(candidate, rule.interval); else if (rule.frequency === 'weekly') candidate = addCalendarDays(candidate, 7 * rule.interval); else if (rule.frequency === 'monthly') { const month = candidate.month - 1 + rule.interval; const year = candidate.year + Math.floor(month / 12); const nextMonth = (month % 12 + 12) % 12 + 1; const days = new Date(Date.UTC(year, nextMonth, 0)).getUTCDate(); candidate = { year, month: nextMonth, day: Math.min(candidate.day, days) }; } else { const year = candidate.year + rule.interval; const days = new Date(Date.UTC(year, candidate.month, 0)).getUTCDate(); candidate = { year, month: candidate.month, day: Math.min(candidate.day, days) }; } if (zonedToUtc({ ...candidate, hour: baseLocal.hour, minute: baseLocal.minute, second: baseLocal.second }, timezone).getTime() > horizon.getTime()) break; }
    }
    return result.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, cap);
  }

  async dueReminders(at = this.now()): Promise<readonly { readonly event: CalendarEvent; readonly reminder: EventReminder; readonly occurrenceStart: string }[]> { await this.ready(); const output: Array<{ event: CalendarEvent; reminder: EventReminder; occurrenceStart: string }> = []; for (const event of this.events.values()) { if (event.tombstone) continue; const occurrences = this.expandOccurrences(event, new Date(at - 366 * 86_400_000).toISOString(), new Date(at + 366 * 86_400_000).toISOString()); for (const occurrence of occurrences) for (const sourceReminder of event.reminders) { const reminder = this.reminders.get(sourceReminder.id) ?? sourceReminder; const recurring = Boolean(event.recurrence); if (reminder.kind === 'absolute' && recurring) continue; if ((recurring ? reminder.firedOccurrences?.includes(occurrence.start) : reminder.firedAt) || (!recurring && reminder.firedAt)) continue; const due = reminder.kind === 'absolute' && reminder.absoluteAt ? Date.parse(reminder.absoluteAt) : Date.parse(occurrence.start) - (reminder.minutesBefore ?? 0) * 60_000; if (due <= at && due > at - 86_400_000) output.push({ event: occurrence, reminder, occurrenceStart: occurrence.start }); } } return output; }
  async runDueReminders(at = this.now()): Promise<number> { const due = await this.dueReminders(at); let count = 0; for (const item of due) { if (this.options.notifications) await this.options.notifications.notify({ title: item.event.title, body: item.event.description || 'Calendar reminder', data: { calendarId: item.event.calendarId, eventId: item.event.id } }); const reminder = this.reminders.get(item.reminder.id); if (reminder) { const event = this.events.get(item.event.id.split('@')[0]) ?? this.events.get(item.event.id); const recurring = Boolean(event?.recurrence); const firedOccurrences = recurring ? [...new Set([...(reminder.firedOccurrences ?? []), item.occurrenceStart])].slice(-256) : undefined; const next = await this.withSignature({ ...reminder, ...(recurring ? { firedOccurrences } : { firedAt: new Date(at).toISOString() }), revision: reminder.revision + 1 }); this.reminders.set(reminder.id, next); } count += 1; } if (count) await this.persist(); return count; }

  async search(options: CalendarSearchOptions = {}): Promise<readonly CalendarEvent[]> { await this.ready(); if ((options.from && !safeDate(options.from)) || (options.until && !safeDate(options.until)) || (options.from && options.until && Date.parse(options.until) < Date.parse(options.from))) throw new CalendarError('INVALID_ARGUMENT', 'Calendar search range is invalid'); const query = options.query?.toLocaleLowerCase(); const from = options.from ? Date.parse(options.from) : -Infinity; const until = options.until ? Date.parse(options.until) : Infinity; const ids = options.calendarIds ? new Set(options.calendarIds) : undefined; const actor = actorIdentity(options.actor ?? this.localActor); const result: CalendarEvent[] = []; for (const event of this.events.values()) { if (ids && !ids.has(event.calendarId) || Date.parse(event.end) < from || Date.parse(event.start) > until || (options.relatedObjectId && !event.relatedObjectRefs.includes(options.relatedObjectId) && event.spaceId !== options.relatedObjectId && event.workItemId !== options.relatedObjectId) || (options.participantId && !event.participants.some(value => value.identityId === options.participantId))) continue; const visible = await this.visibleEvent(event, actor); if (!visible) continue; if (query && !`${visible.title} ${visible.description} ${visible.location ?? ''} ${visible.participants.map(value => value.identityId).join(' ')}`.toLocaleLowerCase().includes(query)) continue; result.push(visible); } result.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id)); const offset = options.cursor ? Math.max(0, Number(options.cursor) || 0) : 0; return result.slice(offset, offset + maxLimit(options.limit, 1, 512, 64)).map(clone); }

  async availability(query: AvailabilityQuery, actor: CalendarActor = this.localActor): Promise<AvailabilityResult> { await this.ready(); validateAvailabilityQuery(query); const identity = actorIdentity(actor); if (!query.participantIds.includes(identity)) { const provided = await this.options.availabilityProvider?.(identity, query); if (!provided) return this.emptyAvailability(identity, query); return clone(provided); } const busy: AvailabilityInterval[] = []; for (const calendar of this.calendars.values()) { if (calendar.tombstone || !this.canReadCalendar(calendar, identity, 'VIEW_FREE_BUSY')) continue; const events = [...this.events.values()].filter(event => event.calendarId === calendar.id && !event.tombstone); for (const event of events) for (const occurrence of this.expandOccurrences(event, query.rangeStart, query.rangeEnd)) busy.push({ start: occurrence.start, end: occurrence.end }); } const range = { start: query.rangeStart, end: query.rangeEnd }; const available = this.applyWorkingHours(subtractIntervals(range, busy), query); return { version: 1, participantId: identity, rangeStart: query.rangeStart, rangeEnd: query.rangeEnd, busy: mergeIntervals(busy), available, disclosure: 'FREE_BUSY', derivedOnly: true, generatedAt: nowIso(this.now) }; }
  async findCommonTime(query: AvailabilityQuery, results?: readonly AvailabilityResult[], actor: CalendarActor = this.localActor): Promise<readonly AvailabilityInterval[]> { validateAvailabilityQuery(query); const required = new Set(query.requiredParticipantIds ?? query.participantIds); const values = results ?? await Promise.all(query.participantIds.map(async identity => identity === actorIdentity(actor) ? this.availability({ ...query, participantIds: [identity] }, actor) : this.options.availabilityProvider?.(identity, { ...query, participantIds: [identity] }).then(value => value ? clone(value) : this.emptyAvailability(identity, { ...query, participantIds: [identity] })) ?? this.emptyAvailability(identity, { ...query, participantIds: [identity] }))); const byIdentity = new Map(values.map(value => [value.participantId, value])); if ([...required].some(identity => !byIdentity.has(identity))) return []; let common: AvailabilityInterval[] | undefined; for (const identity of required) { const value = byIdentity.get(identity)!; common = common ? intersectIntervals(common, value.available) : [...value.available]; } if (!common) return []; const duration = (query.desiredDurationMinutes + (query.bufferBeforeMinutes ?? 0) + (query.bufferAfterMinutes ?? 0)) * 60_000; const preferredStart = query.preferredStart ? Date.parse(query.preferredStart) : -Infinity; const preferredEnd = query.preferredEnd ? Date.parse(query.preferredEnd) : Infinity; return common.flatMap(interval => { const start = Math.max(Date.parse(interval.start), preferredStart); const end = Math.min(Date.parse(interval.end), preferredEnd); return end - start >= duration ? [{ start: new Date(start + (query.bufferBeforeMinutes ?? 0) * 60_000).toISOString(), end: new Date(start + duration - (query.bufferAfterMinutes ?? 0) * 60_000).toISOString() }] : []; }).slice(0, 128); }

  async visibleEvent(event: CalendarEvent, identityId: string): Promise<CalendarEvent | undefined> { if (!(await this.visibleShared(event))) return undefined; const calendar = this.calendars.get(event.calendarId); if (!calendar || event.tombstone && !this.canReadCalendar(calendar, identityId, 'VIEW_EVENTS')) return undefined; const disclosure = this.disclosureFor(calendar, identityId, event); if (disclosure === 'HIDDEN') return undefined; if (disclosure === 'FULL_EVENT') return this.lockAttachments(event, identityId); if (disclosure === 'TITLE_ONLY') return this.lockAttachments({ ...event, description: '', location: undefined, participants: event.participants.map(value => ({ ...value, identityId: value.identityId === identityId ? value.identityId : 'redacted', responseSignature: undefined })), attachments: [], relatedObjectRefs: [], recurrenceExceptions: [] }, identityId); return this.lockAttachments({ ...event, title: 'BUSY', description: '', location: undefined, participants: [], attachments: [], relatedObjectRefs: [], recurrence: undefined, recurrenceExceptions: [] }, identityId); }
  async getConflict(id: string): Promise<CalendarConflictState | undefined> { await this.ready(); return this.conflicts.get(id) ? clone(this.conflicts.get(id)!) : undefined; }
  async listConflicts(calendarId?: string): Promise<readonly CalendarConflictState[]> { await this.ready(); return [...this.conflicts.values()].filter(value => !calendarId || value.calendarId === calendarId).filter(value => !value.resolvedAt).map(clone); }
  async resolveConflict(id: string, resolution: 'keep_current' | 'accept_incoming' | 'merged', actor: CalendarActor = this.localActor, merged?: CalendarEvent): Promise<CalendarEvent> { await this.ready(); const conflict = this.conflicts.get(id); if (!conflict) throw new CalendarError('NOT_FOUND', 'Calendar conflict not found'); const calendar = this.requireCalendar(conflict.calendarId); if (!this.hasPermission(calendar, actorIdentity(actor), 'EDIT_ALL') && actorIdentity(actor) !== calendar.ownerIdentityId) throw new CalendarError('NOT_AUTHORIZED', 'Conflict resolution permission is required'); const event = this.resolver.resolve(conflict, resolution, merged); const next = await this.withSignature({ ...event, revision: this.requireEvent(event.id).revision + 1, updatedAt: nowIso(this.now) }); this.events.set(event.id, next); this.conflicts.set(id, { ...conflict, resolvedAt: nowIso(this.now), resolution }); await this.persist(); await this.emit('event.upsert', next.id, next.revision, next, actor, next.calendarId); return clone(next); }

  /** Compact, privacy-safe Agent/AI bridge. Queries are read-only; actions require owner confirmation. */
  async agentQuery(request: { readonly text: string; readonly timezone?: string; readonly actor?: CalendarActor }): Promise<CalendarAgentResult> { const text = request.text.toLocaleLowerCase(); const actor = request.actor ?? this.localActor; const now = this.now(); let from = new Date(now); let until = new Date(now + 86_400_000); if (text.includes('tomorrow') || text.includes('завтра')) { from = new Date(now + 86_400_000); until = new Date(from.getTime() + 86_400_000); } else if (text.includes('week') || text.includes('недел')) until = new Date(now + 7 * 86_400_000); const events = await this.search({ from: from.toISOString(), until: until.toISOString(), actor, limit: 128 }); const requires = text.includes('free') || text.includes('свобод') || text.includes('meet') || text.includes('встрет'); return { type: requires ? 'DERIVED_PREFERENCE' : 'PUBLIC_INFORMATION', text: events.length ? events.map(event => `${event.start} · ${event.title}`).join('\n').slice(0, 8_000) : 'No calendar events found', eventIds: events.map(event => event.id), requiresOwnerConfirmation: false }; }
  async agentConfirm(input: { readonly action: 'create' | 'edit' | 'delete' | 'rsvp'; readonly eventId?: string; readonly calendarId?: string; readonly event?: CreateEventInput; readonly patch?: UpdateEventInput; readonly rsvp?: CalendarRSVP; readonly confirmed: boolean; readonly actor?: CalendarActor }): Promise<CalendarAgentResult> { const actor = input.actor ?? this.localActor; if (!input.confirmed) return { type: 'AGENT_SUGGESTION', text: 'Owner confirmation is required.', requiresOwnerConfirmation: true }; let event: CalendarEvent; if (input.action === 'create') { if (!input.calendarId || !input.event) throw new CalendarError('INVALID_ARGUMENT', 'Calendar and event are required'); event = await this.createEvent(input.calendarId, input.event, actor); } else if (input.action === 'edit') { if (!input.eventId || !input.patch) throw new CalendarError('INVALID_ARGUMENT', 'Event patch is required'); event = await this.updateEvent(input.eventId, input.patch, actor); } else if (input.action === 'delete') { if (!input.eventId) throw new CalendarError('INVALID_ARGUMENT', 'Event id is required'); event = await this.deleteEvent(input.eventId, actor); } else { if (!input.eventId || !input.rsvp) throw new CalendarError('INVALID_ARGUMENT', 'RSVP is required'); event = await this.respond(input.eventId, input.rsvp, actor); } return { type: 'OWNER_CONFIRMED_DECISION', text: `Calendar action ${input.action} confirmed`, eventIds: [event.id], requiresOwnerConfirmation: false }; }

  calendarLink(calendarId: string): string { if (!safeId(calendarId)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar id is invalid'); return `keystone://calendar/${encodeURIComponent(calendarId)}`; }
  eventLink(eventId: string): string { if (!safeId(eventId)) throw new CalendarError('INVALID_ARGUMENT', 'Event id is invalid'); return `keystone://calendar/event/${encodeURIComponent(eventId)}`; }

  async applyReplicationEvent(event: CalendarReplicationEvent): Promise<boolean> { await this.ready(); if (!event || event.version !== 1 || !safeId(event.id, 512) || !safeId(event.calendarId) || !safeId(event.targetId) || !safeIdentity(event.actor.identityId)) throw new CalendarError('INVALID_EVENT', 'Malformed Calendar replication event'); if (this.seen.has(event.id)) throw new CalendarError('REPLAY', 'Calendar replication event replayed'); if (!(await this.verify(event))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar replication signature invalid'); if (event.actor.identityId === this.identityId) { this.seen.add(event.id); return false; } if (event.operation !== 'calendar.upsert' && !this.calendars.has(event.calendarId)) { if (!this.pendingIncoming.some(value => value.id === event.id)) this.pendingIncoming.push(clone(event)); return false; } this.seen.add(event.id); let applied = false; if (event.operation === 'calendar.upsert') { applied = await this.applyCalendarEvent(event); if (applied) await this.drainPending(event.calendarId); } else if (event.operation === 'event.upsert') applied = await this.applyEventEvent(event); else if (event.operation === 'invite.upsert') applied = await this.applyInviteEvent(event); else if (event.operation === 'revision.add') { const payload = event.payload as CalendarEventRevision; if (!payload || payload.eventId !== event.targetId || payload.calendarId !== event.calendarId) throw new CalendarError('INVALID_EVENT', 'Malformed Calendar revision'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar revision signature invalid'); const list = this.revisions.get(payload.eventId) ?? []; if (!list.some(value => value.id === payload.id)) list.push(clone(payload)); this.revisions.set(payload.eventId, list.slice(-CALENDAR_MAX_REVISIONS)); applied = true; } else if (event.operation === 'exception.upsert') { const payload = event.payload as RecurrenceException; if (!payload || payload.eventId !== event.targetId) throw new CalendarError('INVALID_EVENT', 'Malformed recurrence exception'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar exception signature invalid'); this.exceptions.set(payload.id, clone(payload)); applied = true; } else if (event.operation === 'reminder.upsert') { const payload = event.payload as EventReminder; if (!payload || payload.eventId !== event.targetId) throw new CalendarError('INVALID_EVENT', 'Malformed reminder'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar reminder signature invalid'); this.reminders.set(payload.id, clone(payload)); applied = true; } else if (event.operation === 'permission.upsert') applied = await this.applyPermissionEvent(event); await this.persist(); return applied; }

  private async applyCalendarEvent(event: CalendarReplicationEvent): Promise<boolean> { const payload = event.payload as Calendar; if (!payload || payload.version !== 1 || payload.id !== event.targetId || payload.ownerIdentityId !== event.actor.identityId) throw new CalendarError('INVALID_EVENT', 'Calendar owner binding is invalid'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar payload signature invalid'); if (!(await this.visibleShared(payload))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar failed mandatory safety gating'); const current = this.calendars.get(payload.id); if (current && current.revision > payload.revision) return false; if (current && current.revision === payload.revision && current.signature >= payload.signature) return false; if (current && !this.canReadCalendar(current, this.identityId, 'VIEW_FREE_BUSY') && !payload.members.some(value => value.identityId === this.identityId && !value.removedAt)) return false; this.calendars.set(payload.id, clone(payload)); return true; }
  private async applyPermissionEvent(event: CalendarReplicationEvent): Promise<boolean> { const payload = event.payload as CalendarPermission; const calendar = this.calendars.get(event.calendarId); if (!payload || payload.version !== 1 || payload.id !== event.targetId || payload.calendarId !== event.calendarId || payload.issuedBy !== event.actor.identityId || !calendar) throw new CalendarError('INVALID_EVENT', 'Calendar permission binding is invalid'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar permission signature invalid'); if (!this.hasPermission(calendar, event.actor.identityId, 'MANAGE_PERMISSIONS')) throw new CalendarError('NOT_AUTHORIZED', 'Calendar permission actor is not authorized'); const permissions = [...calendar.permissions.filter(item => !(item.subjectType === payload.subjectType && item.subjectId === payload.subjectId && !item.revokedAt)), clone(payload)]; this.calendars.set(calendar.id, { ...calendar, permissions, revision: Math.max(calendar.revision, event.revision), updatedAt: event.createdAt }); return true; }
  private async applyEventEvent(event: CalendarReplicationEvent): Promise<boolean> { const payload = event.payload as CalendarEvent; if (!payload || payload.version !== 1 || !safeId(payload.id) || payload.id !== event.targetId || payload.calendarId !== event.calendarId || !(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar event signature invalid'); if (!(await this.visibleShared(payload))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar event failed mandatory safety gating'); const calendar = this.calendars.get(payload.calendarId); if (!calendar || !this.canReadCalendar(calendar, this.identityId, 'VIEW_FREE_BUSY')) return false; const current = this.events.get(payload.id); if (!current) { if (!this.memberMayWrite(calendar, event.actor.identityId, payload)) throw new CalendarError('NOT_AUTHORIZED', 'Calendar event actor is not a member'); this.events.set(payload.id, clone(payload)); for (const reminder of payload.reminders) this.reminders.set(reminder.id, clone(reminder)); return true; } if (current.revision >= payload.revision) { if (current.revision === payload.revision && current.signature !== payload.signature) { const conflict = await this.makeConflict(current, payload, ['revision'], 'stale_revision', event.baseRevision ?? Math.max(1, current.revision - 1)); this.conflicts.set(conflict.id, conflict); await this.options.onConflict?.(clone(conflict)); } return false; } if (!this.memberMayWrite(calendar, event.actor.identityId, payload)) throw new CalendarError('NOT_AUTHORIZED', 'Calendar event actor is not allowed'); if (current.tombstone && !payload.tombstone) { const conflict = await this.makeConflict(current, payload, ['tombstone'], 'deleted_modified', event.baseRevision ?? current.revision); this.conflicts.set(conflict.id, conflict); await this.options.onConflict?.(clone(conflict)); return false; } this.events.set(payload.id, clone(payload)); for (const reminder of payload.reminders) this.reminders.set(reminder.id, clone(reminder)); return true; }
  private async applyInviteEvent(event: CalendarReplicationEvent): Promise<boolean> { const payload = event.payload as CalendarInvite; if (!payload || payload.version !== 1 || payload.id !== event.targetId || payload.calendarId !== event.calendarId || !safeIdentity(payload.inviterIdentityId) || !safeIdentity(payload.inviteeIdentityId) || !normalizePermissions(payload.permissions) || !CALENDAR_DISCLOSURES.has(payload.disclosure)) throw new CalendarError('INVALID_EVENT', 'Invite binding is invalid'); const isResponse = payload.state === 'accepted' || payload.state === 'declined'; const expectedActor = isResponse ? payload.inviteeIdentityId : payload.inviterIdentityId; if (event.actor.identityId !== expectedActor) throw new CalendarError('NOT_AUTHORIZED', 'Invite actor is not authorized'); if (!(await this.verifyPayload(payload, event.actor))) throw new CalendarError('INVALID_SIGNATURE', 'Calendar invite signature invalid'); if (payload.inviteeIdentityId !== this.identityId && payload.inviterIdentityId !== this.identityId) return false; const current = this.invites.get(payload.id); if (current && current.revision >= payload.revision) return false; this.invites.set(payload.id, clone(payload)); if (payload.state === 'accepted' && this.identityId === payload.inviterIdentityId) { const calendar = this.calendars.get(payload.calendarId); if (!calendar || !current || current.state !== 'pending') throw new CalendarError('INVITE_INVALID', 'Accepted invite has no pending owner state'); const existing = calendar.members.find(member => member.identityId === payload.inviteeIdentityId && !member.removedAt); if (!existing) { const membership = await this.makeMembership(calendar.id, payload.inviteeIdentityId, 'viewer', payload.permissions, payload.disclosure, event.createdAt, calendar.revision + 1); const nextCalendar = await this.withSignature({ ...calendar, members: [...calendar.members, membership], revision: calendar.revision + 1, updatedAt: event.createdAt }); this.calendars.set(calendar.id, nextCalendar); await this.emit('calendar.upsert', calendar.id, nextCalendar.revision, nextCalendar, this.localActor, calendar.id); } } return true; }

  private async commitEventUpdate(current: CalendarEvent, next: CalendarEvent, actor: CalendarActor, baseRevision: number, changes: Readonly<Record<string, unknown>>): Promise<CalendarEvent> { if (!(await this.visibleShared(next))) throw new CalendarError('NOT_AUTHORIZED', 'Shared Calendar event failed mandatory SafetySurfaceGate'); this.events.set(next.id, next); const revision = await this.makeRevision(next, actor, baseRevision, changes); const list = this.revisions.get(next.id) ?? []; list.push(revision); this.revisions.set(next.id, list.slice(-CALENDAR_MAX_REVISIONS)); for (const exception of next.recurrenceExceptions) this.exceptions.set(exception.id, exception); for (const reminder of next.reminders) this.reminders.set(reminder.id, reminder); await this.persist(); await this.scheduleReminders(next); await this.emit('event.upsert', next.id, next.revision, next, actor, next.calendarId, baseRevision); await this.emit('revision.add', revision.id, revision.revision, revision, actor, next.calendarId); return clone(next); }
  private async buildEvent(calendar: Calendar, input: CreateEventInput, actor: CalendarActor): Promise<CalendarEvent> { const start = input.start; const end = input.end; validRange(start, end); const timezone = validTimezone(input.timezone ?? calendar.timezone); const recurrence = recurrenceRule(input.recurrence); const timestamp = nowIso(this.now); const id = input.id ?? randomId('event'); const participants: EventParticipant[] = []; for (const value of input.participants ?? []) { const role = value.role ?? 'required'; const rsvp = value.rsvp ?? 'PENDING'; const responseRevision = value.responseRevision ?? 0; if (!safeIdentity(value.identityId) || !PARTICIPANT_ROLES.has(role) || !RSVP_VALUES.has(rsvp) || !Number.isSafeInteger(responseRevision) || responseRevision < 0 || (value.disclosure !== undefined && !CALENDAR_DISCLOSURES.has(value.disclosure))) throw new CalendarError('INVALID_ARGUMENT', 'Participant is invalid'); participants.push({ version: 1, identityId: value.identityId, role, rsvp, responseRevision, ...(value.disclosure ? { disclosure: value.disclosure } : {}) }); } const event = await this.withSignature({ version: 1 as const, id, calendarId: calendar.id, creatorIdentityId: actorIdentity(actor), title: boundedText(input.title, 512, true), description: boundedText(input.description ?? '', 16_000), start, end, timezone, allDay: input.allDay === true, ...(recurrence ? { recurrence } : {}), recurrenceExceptions: [], reminders: [], ...(input.location ? { location: boundedText(input.location, 2_000) } : {}), participants, attachments: [], ...(input.spaceId ? { spaceId: boundedText(input.spaceId, 256) } : {}), ...(input.workboardId ? { workboardId: boundedText(input.workboardId, 256) } : {}), ...(input.workItemId ? { workItemId: boundedText(input.workItemId, 256) } : {}), relatedObjectRefs: [...new Set((input.relatedObjectRefs ?? []).filter(value => safeId(value, 512)))].slice(0, 128), visibility: normalizeEventVisibility(input.visibility, calendar.visibility === 'private' ? 'private' : 'shared'), createdAt: timestamp, updatedAt: timestamp, revision: 1, tombstone: false }); const reminders: EventReminder[] = []; for (const value of input.reminders ?? []) { if (!REMINDER_KINDS.has(value.kind) || (value.minutesBefore !== undefined && (!Number.isSafeInteger(value.minutesBefore) || value.minutesBefore < 0)) || (value.absoluteAt !== undefined && !safeDate(value.absoluteAt)) || (value.kind === 'offset' && value.minutesBefore === undefined) || (value.kind === 'absolute' && !value.absoluteAt)) throw new CalendarError('REMINDER_INVALID', 'Reminder is invalid'); reminders.push(await this.withSignature({ version: 1 as const, id: value.id ?? randomId('reminder'), eventId: id, kind: value.kind, ...(value.minutesBefore !== undefined ? { minutesBefore: maxLimit(value.minutesBefore, 0, 365 * 24 * 60, 0) } : {}), ...(value.absoluteAt ? { absoluteAt: value.absoluteAt } : {}), revision: 1 })); } const attachments: EventAttachment[] = []; for (const value of input.attachments ?? []) { if (!safeId(value.objectId, 512) || !DATA_CLASSES.has(value.dataClass) || !ATTACHMENT_TYPES.has(value.objectType)) throw new CalendarError('INVALID_ARGUMENT', 'Attachment reference is invalid'); attachments.push(await this.withSignature({ version: 1 as const, id: value.id ?? randomId('attachment'), objectId: value.objectId, objectType: value.objectType, dataClass: value.dataClass, ...(value.locked !== undefined ? { locked: value.locked } : {}), createdBy: actorIdentity(actor), createdAt: timestamp })); } const exceptions: RecurrenceException[] = []; for (const value of input.recurrenceExceptions ?? []) { if (!safeDate(value.occurrenceStart) || !['edit', 'delete', 'move'].includes(value.kind) || (value.kind === 'move' && (!value.newStart || !safeDate(value.newStart))) || (value.newEnd !== undefined && (!safeDate(value.newEnd) || !value.newStart || Date.parse(value.newEnd) <= Date.parse(value.newStart)))) throw new CalendarError('INVALID_RECURRENCE', 'Recurrence exception is invalid'); exceptions.push(await this.withSignature({ version: 1 as const, id: randomId('exception'), eventId: id, occurrenceStart: value.occurrenceStart, kind: value.kind, ...(value.eventPatch ? { eventPatch: value.eventPatch } : {}), ...(value.newStart ? { newStart: value.newStart } : {}), ...(value.newEnd ? { newEnd: value.newEnd } : {}), createdBy: actor, createdAt: timestamp, revision: 1 })); } const final = await this.withSignature({ ...event, reminders, attachments, recurrenceExceptions: exceptions }); return final; }
  private normalizeEventPatch(patch: UpdateEventInput['patch']): Partial<CalendarEvent> {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (!['title', 'description', 'start', 'end', 'timezone', 'allDay', 'recurrence', 'recurrenceExceptions', 'reminders', 'location', 'participants', 'attachments', 'spaceId', 'workboardId', 'workItemId', 'relatedObjectRefs', 'visibility', 'tombstone'].includes(key)) continue;
      if (['start', 'end'].includes(key) && !safeDate(value)) throw new CalendarError('INVALID_ARGUMENT', 'Event date is invalid');
      if (key === 'timezone') { if (typeof value !== 'string') throw new CalendarError('INVALID_ARGUMENT', 'Event timezone is invalid'); validTimezone(value); }
      if (key === 'recurrence') recurrenceRule(value as RecurrenceRule | undefined);
      if (key === 'visibility') next.visibility = normalizeEventVisibility(value as CalendarEventVisibility | undefined, 'shared');
      else if (key === 'title') next.title = boundedText(value, 512, true);
      else if (key === 'description') next.description = boundedText(value, 16_000);
      else if (key === 'relatedObjectRefs') { if (!Array.isArray(value)) throw new CalendarError('INVALID_ARGUMENT', 'Object references are invalid'); next.relatedObjectRefs = [...new Set(value.filter(value => safeId(value, 512)))].slice(0, 128); }
      else if (key === 'participants') { if (!Array.isArray(value)) throw new CalendarError('INVALID_ARGUMENT', 'Participants are invalid'); for (const participant of value) { const item = participant as Partial<EventParticipant>; if (!safeIdentity(item.identityId) || !PARTICIPANT_ROLES.has(item.role ?? 'required') || !RSVP_VALUES.has(item.rsvp ?? 'PENDING') || !Number.isSafeInteger(item.responseRevision ?? 0) || (item.disclosure !== undefined && !CALENDAR_DISCLOSURES.has(item.disclosure))) throw new CalendarError('INVALID_ARGUMENT', 'Participant is invalid'); } next.participants = clone(value); }
      else if (key === 'reminders') { if (!Array.isArray(value)) throw new CalendarError('REMINDER_INVALID', 'Reminders are invalid'); for (const reminder of value) { const item = reminder as Partial<EventReminder>; if (!REMINDER_KINDS.has(item.kind as EventReminder['kind']) || (item.minutesBefore !== undefined && (!Number.isSafeInteger(item.minutesBefore) || item.minutesBefore < 0)) || (item.absoluteAt !== undefined && !safeDate(item.absoluteAt))) throw new CalendarError('REMINDER_INVALID', 'Reminder is invalid'); } next.reminders = clone(value); }
      else if (key === 'attachments') { if (!Array.isArray(value)) throw new CalendarError('INVALID_ARGUMENT', 'Attachments are invalid'); for (const attachment of value) { const item = attachment as Partial<EventAttachment>; if (!safeId(item.objectId, 512) || !DATA_CLASSES.has(item.dataClass as string) || !ATTACHMENT_TYPES.has(item.objectType as EventAttachment['objectType'])) throw new CalendarError('INVALID_ARGUMENT', 'Attachment reference is invalid'); } next.attachments = clone(value); }
      else next[key] = clone(value);
    }
    return next as Partial<CalendarEvent>;
  }
  private async makeRevision(event: CalendarEvent, actor: CalendarActor, baseRevision: number | undefined, changes: object): Promise<CalendarEventRevision> { return this.withSignature({ version: 1 as const, id: randomId('event-revision'), eventId: event.id, calendarId: event.calendarId, revision: event.revision, ...(baseRevision === undefined ? {} : { baseRevision }), actor, changes: stripUndefined(changes as Record<string, unknown>), snapshot: clone(event), createdAt: nowIso(this.now) }); }
  private async makeConflict(current: CalendarEvent, incoming: CalendarEvent, fields: readonly string[], kind: CalendarConflictKind, baseRevision: number): Promise<CalendarConflictState> { return { version: 1, id: randomId('calendar-conflict'), calendarId: current.calendarId, eventId: current.id, kind, baseRevision, currentRevision: current.revision, incomingRevision: incoming.revision, fields: [...new Set(fields)], currentEvent: clone(current), incomingEvent: clone(incoming), createdAt: nowIso(this.now) }; }
  private async scheduleReminders(event: CalendarEvent): Promise<void> { if (!this.options.reminderScheduler) return; const occurrences = event.recurrence ? this.expandOccurrences(event, new Date(this.now()).toISOString(), new Date(this.now() + 366 * 86_400_000).toISOString(), 128) : [event]; for (const reminder of event.reminders) { for (const occurrence of occurrences) { if (reminder.kind === 'absolute' && occurrence.id !== event.id) continue; const due = reminder.kind === 'absolute' && reminder.absoluteAt ? reminder.absoluteAt : new Date(Date.parse(occurrence.start) - (reminder.minutesBefore ?? 0) * 60_000).toISOString(); if (safeDate(due)) await this.options.reminderScheduler.schedule({ id: reminder.chronosId ?? `${event.id}:${reminder.id}${event.recurrence ? `:${occurrence.start}` : ''}`, dueAt: due, timezone: event.timezone, calendarId: event.calendarId, eventId: event.id, reminderId: reminder.id }); } } }
  private applyWorkingHours(values: readonly AvailabilityInterval[], query: AvailabilityQuery): AvailabilityInterval[] { if (!query.workingHours) return [...values]; const startMinute = intervalMinutes(query.workingHours.start); const endMinute = intervalMinutes(query.workingHours.end); return values.flatMap(interval => { const result: AvailabilityInterval[] = []; const timezone = validTimezone(query.timezone ?? this.defaultTimezone); let cursor = new Date(interval.start); const end = Date.parse(interval.end); while (cursor.getTime() < end && result.length < 64) { const parts = localParts(cursor, timezone); const dayStart = zonedToUtc({ year: parts.year, month: parts.month, day: parts.day, hour: 0, minute: 0 }, timezone); const start = new Date(dayStart.getTime() + startMinute * 60_000); const stop = new Date(dayStart.getTime() + endMinute * 60_000); const left = Math.max(start.getTime(), cursor.getTime(), Date.parse(query.rangeStart)); const right = Math.min(stop.getTime(), end, Date.parse(query.rangeEnd)); if (right > left) result.push({ start: new Date(left).toISOString(), end: new Date(right).toISOString() }); cursor = new Date(dayStart.getTime() + 86_400_000); } return result; }); }
  private emptyAvailability(identity: string, query: AvailabilityQuery): AvailabilityResult { return { version: 1, participantId: identity, rangeStart: query.rangeStart, rangeEnd: query.rangeEnd, busy: [], available: [], disclosure: 'FREE_BUSY', derivedOnly: true, generatedAt: nowIso(this.now) }; }
  private async lockAttachments(event: CalendarEvent, identityId: string): Promise<CalendarEvent> { const attachments = await Promise.all(event.attachments.map(async attachment => { if (attachment.locked) return attachment; if (this.options.attachmentPermission) return { ...attachment, locked: !(await this.options.attachmentPermission({ identityId, attachment })) }; return { ...attachment, locked: attachment.dataClass === 'PRIVATE' || attachment.dataClass === 'SECRET' }; })); return { ...event, attachments }; }
  private disclosureFor(calendar: Calendar, identityId: string, event: CalendarEvent): CalendarDisclosure { if (identityId === calendar.ownerIdentityId) return 'FULL_EVENT'; const member = calendar.members.find(value => value.identityId === identityId && !value.removedAt); const explicit = calendar.permissions.filter(value => !value.revokedAt && ((value.subjectType === 'identity' && value.subjectId === identityId) || (value.subjectType === 'participant' && event.participants.some(participant => participant.identityId === identityId)) || value.subjectType === 'public')).sort((a, b) => b.revision - a.revision)[0]; if (explicit && (!explicit.eventIds?.length || explicit.eventIds.includes(event.id)) && (!explicit.from || Date.parse(event.start) >= Date.parse(explicit.from)) && (!explicit.until || Date.parse(event.end) <= Date.parse(explicit.until))) return explicit.disclosure; if (event.visibility === 'private' && member?.disclosure !== 'FULL_EVENT') return member?.disclosure === 'TITLE_ONLY' || member?.disclosure === 'FREE_BUSY' ? member.disclosure : 'HIDDEN'; if (!member || member.removedAt) return event.visibility === 'public' ? 'TITLE_ONLY' : 'HIDDEN'; if (!this.hasPermission(calendar, identityId, 'VIEW_EVENTS')) return this.hasPermission(calendar, identityId, 'VIEW_FREE_BUSY') ? 'FREE_BUSY' : 'HIDDEN'; return member.disclosure; }
  private canReadCalendar(calendar: Calendar, identityId: string, permission: CalendarPermissionName): boolean { if (calendar.tombstone) return identityId === calendar.ownerIdentityId; if (identityId === calendar.ownerIdentityId) return true; return this.hasPermission(calendar, identityId, permission) || (permission === 'VIEW_FREE_BUSY' && (calendar.visibility === 'public' || calendar.visibility === 'contacts')); }
  private hasPermission(calendar: Calendar, identityId: string, permission: CalendarPermissionName): boolean { if (identityId === calendar.ownerIdentityId) return true; const member = calendar.members.find(value => value.identityId === identityId && !value.removedAt); if (member && permissionSet(member.permissions).has(permission)) return true; for (const item of calendar.permissions) if (!item.revokedAt && ((item.subjectType === 'identity' && item.subjectId === identityId) || item.subjectType === 'public') && permissionSet(item.permissions).has(permission)) return true; return false; }
  private memberMayWrite(calendar: Calendar, identityId: string, event: CalendarEvent): boolean { return event.creatorIdentityId === identityId || this.hasPermission(calendar, identityId, 'EDIT_ALL') || this.hasPermission(calendar, identityId, 'CREATE'); }
  private async authorize(action: string, actor: CalendarActor, calendar: Calendar, event?: CalendarEvent): Promise<void> { if (actor.agentId && !calendar.members.some(member => member.identityId === actor.identityId && !member.removedAt && member.permissions.includes('CREATE'))) throw new CalendarError('NOT_AUTHORIZED', 'Agent is not explicitly granted calendar capability'); if (this.options.authorize && !(await this.options.authorize({ action, actor, calendar, ...(event ? { event } : {}) }))) throw new CalendarError('NOT_AUTHORIZED', 'Calendar policy denied action'); }
  private async visibleShared(value: Calendar | CalendarEvent): Promise<boolean> { const visibility = value.visibility; if (visibility === 'private') { if (!('calendarId' in value)) return true; const parent = this.calendars.get(value.calendarId); if (!parent || parent.visibility === 'private') return true; } const domain: ContentDomain = visibility === 'public' ? 'PUBLIC' : visibility === 'contacts' ? 'DIRECT_SHARED' : 'SHARED_SPACE'; const objectId = value.id; return (await this.protectedSurfaces.evaluate('CALENDAR', { objectId, domain, value, content: value, sourceType: 'calendar', verified: true, authorized: true, sharing: true })) !== undefined; }
  private requireCalendar(id: string): Calendar { const value = this.calendars.get(id); if (!value) throw new CalendarError('NOT_FOUND', 'Calendar not found'); return value; }
  private requireEvent(id: string): CalendarEvent { const value = this.events.get(id); if (!value) throw new CalendarError('NOT_FOUND', 'Calendar event not found'); return value; }
  private requireInvite(id: string): CalendarInvite { const value = this.invites.get(id); if (!value) throw new CalendarError('INVITE_INVALID', 'Calendar invite not found'); return value; }
  private async makeMembership(calendarId: string, identityId: string, role: CalendarMembershipRole, permissions: readonly CalendarPermissionName[], disclosure: CalendarDisclosure, joinedAt: string, revision: number): Promise<CalendarMembership> { if (!safeIdentity(identityId) || !MEMBERSHIP_ROLES.has(role)) throw new CalendarError('INVALID_ARGUMENT', 'Calendar membership is invalid'); const unsignedValue = { version: 1 as const, id: randomId('calendar-member'), calendarId, identityId, role, permissions: normalizePermissions(permissions), disclosure: normalizeDisclosure(disclosure), joinedAt, revision }; return this.withSignature(unsignedValue); }
  private async makePermission(calendarId: string, input: { readonly subjectType: CalendarPermission['subjectType']; readonly subjectId: string; readonly permissions: readonly CalendarPermissionName[]; readonly disclosure?: CalendarDisclosure; readonly from?: string; readonly until?: string; readonly eventIds?: readonly string[]; readonly groupId?: string }, actor: CalendarActor, issuedAt: string, revision: number): Promise<CalendarPermission> { if (!['identity', 'participant', 'group', 'public'].includes(input.subjectType) || !safeIdentity(input.subjectId) || (input.from && !safeDate(input.from)) || (input.until && !safeDate(input.until)) || (input.from && input.until && Date.parse(input.until) <= Date.parse(input.from))) throw new CalendarError('INVALID_ARGUMENT', 'Calendar permission is invalid'); return this.withSignature({ version: 1 as const, id: randomId('calendar-permission'), calendarId, subjectType: input.subjectType, subjectId: input.subjectId, permissions: normalizePermissions(input.permissions), disclosure: normalizeDisclosure(input.disclosure), ...(input.from ? { from: input.from } : {}), ...(input.until ? { until: input.until } : {}), ...(input.eventIds?.length ? { eventIds: [...new Set(input.eventIds)].filter(value => safeId(value, 512)).slice(0, 256) } : {}), ...(input.groupId ? { groupId: boundedText(input.groupId, 512, true) } : {}), issuedBy: actorIdentity(actor), issuedAt, revision }); }
  private async withSignature<T extends object>(value: T): Promise<T & { readonly signature: string }> { const normalized = stripUndefined(unsigned(value as T & { readonly signature: string })); const signed = await signCanonical(normalized, canonicalBytes => this.signer.sign(canonicalBytes)); return { ...normalized, signature: signed } as T & { readonly signature: string }; }
  private async verify(value: CalendarReplicationEvent): Promise<boolean> { if (this.options.signer?.verify) return Boolean(await verifyCanonical(unsigned(value), value.signature, (canonicalBytes, rawSignature) => this.options.signer!.verify!(canonicalBytes, rawSignature, value.actor))); return digest(unsigned(value)) === value.signature; }
  private async verifyPayload(value: { readonly signature: string }, actor: CalendarActor): Promise<boolean> { const normalized = stripUndefined(unsigned(value)); if (this.options.signer?.verify) return Boolean(await verifyCanonical(normalized, value.signature, (canonicalBytes, rawSignature) => this.options.signer!.verify!(canonicalBytes, rawSignature, actor))); return digest(normalized) === value.signature; }
  private async emit(operation: CalendarReplicationOperation, targetId: string, revision: number, payload: unknown, actor: CalendarActor, calendarId: string, baseRevision?: number, extraRecipients?: readonly string[]): Promise<void> { const calendar = this.calendars.get(calendarId); if (calendar && calendar.visibility !== 'private' && !(await this.protectedSurfaces.evaluate('CALENDAR', { objectId: targetId, value: payload, content: payload, text: JSON.stringify(payload), domain: calendar.visibility === 'public' ? 'PUBLIC' : calendar.visibility === 'contacts' ? 'DIRECT_SHARED' : 'SHARED_SPACE', sourceType: 'calendar', verified: true, authorized: true, sharing: true }))) throw new CalendarError('NOT_AUTHORIZED', 'Calendar publication failed mandatory SafetySurfaceGate'); const event = await this.withSignature({ version: 1 as const, id: randomId('calendar-event'), calendarId, operation, targetId, revision, ...(baseRevision === undefined ? {} : { baseRevision }), actor, payload: clone(payload), createdAt: nowIso(this.now) }); this.seen.add(event.id); try { await this.replication?.publish(event, [...new Set([...this.recipients(calendarId), ...(extraRecipients ?? [])])]); } catch { /* durable local state remains usable while peers are offline */ } for (const listener of this.listeners) await listener(clone(event)); await this.persist(); }
  private recipients(calendarId: string): string[] { const calendar = this.calendars.get(calendarId); return calendar ? calendar.members.filter(member => !member.removedAt && member.identityId !== this.identityId).map(member => member.identityId) : []; }
  private async persist(): Promise<void> { if (this.closed) return; const snapshot: CalendarSnapshot = { version: 1, calendars: [...this.calendars.values()].map(clone), events: [...this.events.values()].map(clone), revisions: [...this.revisions.values()].flat().slice(-CALENDAR_MAX_REVISIONS).map(clone), recurrenceExceptions: [...this.exceptions.values()].map(clone), reminders: [...this.reminders.values()].map(clone), invites: [...this.invites.values()].map(clone), conflicts: [...this.conflicts.values()].map(clone), seen: [...this.seen].slice(-16_384), pending: this.pendingIncoming.slice(-CALENDAR_MAX_PENDING).map(clone) }; const operation = this.writes.value.then(() => this.storage.write(snapshot)); this.writes.value = operation.catch(() => undefined); await operation; }
  private async hydrate(): Promise<void> { const raw = await this.storage.read(); if (!raw) return; if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) throw new CalendarError('INVALID_ARGUMENT', 'Invalid Calendar state version'); const snapshot = raw as CalendarSnapshot; for (const calendar of snapshot.calendars ?? []) if (calendar?.version === 1 && safeId(calendar.id)) this.calendars.set(calendar.id, clone(calendar)); for (const event of snapshot.events ?? []) if (event?.version === 1 && safeId(event.id) && this.calendars.has(event.calendarId)) this.events.set(event.id, clone(event)); for (const revision of snapshot.revisions ?? []) if (revision?.version === 1 && safeId(revision.id)) { const list = this.revisions.get(revision.eventId) ?? []; list.push(clone(revision)); this.revisions.set(revision.eventId, list.slice(-CALENDAR_MAX_REVISIONS)); } for (const exception of snapshot.recurrenceExceptions ?? []) if (exception?.version === 1 && safeId(exception.id)) this.exceptions.set(exception.id, clone(exception)); for (const reminder of snapshot.reminders ?? []) if (reminder?.version === 1 && safeId(reminder.id)) this.reminders.set(reminder.id, clone(reminder)); for (const invite of snapshot.invites ?? []) if (invite?.version === 1 && safeId(invite.id)) this.invites.set(invite.id, clone(invite)); for (const conflict of snapshot.conflicts ?? []) if (conflict?.version === 1 && safeId(conflict.id)) this.conflicts.set(conflict.id, clone(conflict)); for (const id of snapshot.seen ?? []) if (safeId(id, 512)) this.seen.add(id); this.pendingIncoming.push(...(snapshot.pending ?? []).filter(value => value?.version === 1).map(clone)); }
  private async drainPending(calendarId: string): Promise<void> { const pending = this.pendingIncoming.splice(0); for (const event of pending) { if (event.calendarId !== calendarId) this.pendingIncoming.push(event); else { try { await this.applyReplicationEvent(event); } catch { /* rejected pending event remains dropped */ } } } }
  private reconstructRevision(current: CalendarEvent, revision: number): CalendarEvent { const revisions = this.revisions.get(current.id) ?? []; if (revision === current.revision) return clone(current); const exact = revisions.find(value => value.revision === revision && value.snapshot); if (exact?.snapshot) return clone(exact.snapshot); const first = revisions.find(value => value.revision === 1); if (!first) return clone(current); let value = first.snapshot ? clone(first.snapshot) : { ...current, ...(first.changes as Partial<CalendarEvent>), revision: 1, updatedAt: first.createdAt }; for (const item of revisions.filter(item => item.revision > 1 && item.revision <= revision).sort((a, b) => a.revision - b.revision)) value = item.snapshot ? clone(item.snapshot) : { ...value, ...item.changes, revision: item.revision, updatedAt: item.createdAt }; return value; }
}

/** Shared calendars use CalendarService's exact permission and object model. */
export class SharedCalendarService extends CalendarService {
  async createSharedCalendar(input: Omit<CreateCalendarInput, 'visibility'>, actor?: CalendarActor): Promise<Calendar> { return this.createCalendar({ ...input, visibility: 'shared' }, actor); }
}

/** Transport adapter for real Hyperswarm/Noise envelopes.  It queues while a
 * peer is offline and never bypasses CalendarService authorization. */
export class CalendarReplicationService implements CalendarReplicationAdapter {
  private readonly pending = new Map<string, CalendarReplicationEvent[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private readonly service: CalendarService;
  private readonly now: () => number;
  private readonly peers: readonly string[];
  constructor(options: { readonly transport: KeystoneDeliveryInterface; readonly service: CalendarService; readonly security: EnvelopeSecurity; readonly local: Pick<DeviceSessionKeys, 'nodeId'>; readonly peers?: readonly string[]; readonly now?: () => number }) {
    this.transport = options.transport; this.service = options.service; this.security = options.security; this.local = options.local; this.peers = options.peers ?? []; this.now = options.now ?? Date.now; this.service.setReplication(this); this.unsubscribe = this.transport.onMessage(envelope => { void this.receive(envelope); });
  }
  private readonly transport: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly local: Pick<DeviceSessionKeys, 'nodeId'>;
  async publish(event: CalendarReplicationEvent, recipients?: readonly string[]): Promise<void> {
    for (const peer of recipients ?? this.peers) {
      if (peer === this.local.nodeId) continue;
      this.enqueue(peer, event);
      // Publishing is a local-first operation.  The event is durable before
      // this method returns; the provider may need its bounded discovery
      // timeout, so delivery is kicked off in the background.  Explicit
      // callers can await `flush` when they need a delivery attempt.
      void this.runFlush(peer).catch(() => undefined);
    }
  }
  async flush(peer?: string): Promise<void> {
    const recipients = peer ? [peer] : [...new Set([...this.pending.keys(), ...this.inFlight.keys()])];
    await Promise.all(recipients.map(recipient => this.runFlush(recipient)));
  }
  pendingCount(peer?: string): number { return peer ? (this.pending.get(peer)?.length ?? 0) : [...this.pending.values()].reduce((sum, value) => sum + value.length, 0); }
  close(): void { this.unsubscribe(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.pending.clear(); }
  private enqueue(peer: string, event: CalendarReplicationEvent): void { const queue = this.pending.get(peer) ?? []; if (!queue.some(value => value.id === event.id)) queue.push(clone(event)); this.pending.set(peer, queue.slice(-CALENDAR_MAX_PENDING)); }
  private runFlush(peer: string): Promise<void> {
    const active = this.inFlight.get(peer); if (active) return active;
    const run = this.flushPeer(peer).finally(() => { if (this.inFlight.get(peer) === run) this.inFlight.delete(peer); });
    this.inFlight.set(peer, run); return run;
  }
  private async flushPeer(recipient: string): Promise<void> {
    const queue = this.pending.get(recipient) ?? [];
    while (queue.length) {
      try { await this.send(recipient, queue[0]!); queue.shift(); }
      catch { await this.transport.reconnect?.(recipient).catch(() => undefined); break; }
    }
    if (queue.length) this.schedule(recipient);
    else { this.pending.delete(recipient); const timer = this.timers.get(recipient); if (timer) clearTimeout(timer); this.timers.delete(recipient); }
  }
  private schedule(peer: string): void { if (this.timers.has(peer)) return; const timer = setTimeout(() => { this.timers.delete(peer); void this.runFlush(peer).catch(() => undefined); }, 500); this.timers.set(peer, timer); }
  private async send(peer: string, event: CalendarReplicationEvent): Promise<void> { const unsigned: UnsignedEnvelope = { version: 1, type: CALENDAR_ENVELOPE, id: randomId('calendar-envelope'), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 10 * 60_000).toISOString(), body: event }; await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); }
  private async receive(envelope: Envelope): Promise<void> { if (envelope.type !== CALENDAR_ENVELOPE || envelope.recipient !== this.local.nodeId || Date.parse(envelope.expiresAt) <= this.now() || !(await this.security.verify(envelope))) return; try { await this.service.applyReplicationEvent(envelope.body as CalendarReplicationEvent); } catch { /* rejected events remain outside durable Calendar state */ } }
}

/** Agent/Negotiation bridge.  It only exchanges derived availability and
 * leaves actions at the existing owner-confirmation boundary. */
export class CalendarAgentAdapter {
  constructor(private readonly service: CalendarService) {}
  query(text: string, actor?: CalendarActor): Promise<CalendarAgentResult> { return this.service.agentQuery({ text, actor }); }
  commonTime(query: AvailabilityQuery, actor?: CalendarActor): Promise<readonly AvailabilityInterval[]> { return this.service.findCommonTime(query, undefined, actor); }
  confirm(input: Parameters<CalendarService['agentConfirm']>[0]): Promise<CalendarAgentResult> { return this.service.agentConfirm(input); }
  negotiationValue(intervals: readonly AvailabilityInterval[]): { readonly type: 'DERIVED_PREFERENCE'; readonly intervals: readonly AvailabilityInterval[]; readonly dataClass: 'USER_EXPLICIT' } { return { type: 'DERIVED_PREFERENCE', intervals: intervals.slice(0, 32), dataClass: 'USER_EXPLICIT' }; }
}

export function createCalendarSigner(crypto: CryptoProvider, local: Pick<DeviceSessionKeys, 'nodeId' | 'privateKey' | 'publicKey'>, publicKeys: Readonly<Record<string, string>> = {}): CalendarSigner { return { sign: payload => crypto.sign(payload, local.privateKey), verify: (payload, signature, actor) => { const key = publicKeys[actor.identityId] ?? (actor.identityId === local.nodeId ? local.publicKey : undefined); return key ? crypto.verify(payload, signature, key) : false; } }; }

export function parseCalendarLink(value: string): { kind: 'calendar' | 'event'; id: string } | undefined { try { const url = new URL(value); if (url.protocol !== 'keystone:') return undefined; if (url.hostname === 'calendar') { const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); if (path[0] === 'event' && safeId(path[1])) return { kind: 'event', id: path[1]! }; if (safeId(path[0])) return { kind: 'calendar', id: path[0]! }; } return undefined; } catch { return undefined; } }

export function findCommonAvailability(query: AvailabilityQuery, results: readonly AvailabilityResult[]): readonly AvailabilityInterval[] { validateAvailabilityQuery(query); const required = new Set(query.requiredParticipantIds ?? query.participantIds); const byIdentity = new Map(results.map(value => [value.participantId, value])); if ([...required].some(identity => !byIdentity.has(identity))) return []; let common: AvailabilityInterval[] | undefined; for (const identity of required) { const result = byIdentity.get(identity)!; common = common ? intersectIntervals(common, result.available) : [...result.available]; } if (!common) return []; const duration = (query.desiredDurationMinutes + (query.bufferBeforeMinutes ?? 0) + (query.bufferAfterMinutes ?? 0)) * 60_000; return common.flatMap(value => Date.parse(value.end) - Date.parse(value.start) >= duration ? [{ start: new Date(Date.parse(value.start) + (query.bufferBeforeMinutes ?? 0) * 60_000).toISOString(), end: new Date(Date.parse(value.start) + duration - (query.bufferAfterMinutes ?? 0) * 60_000).toISOString() }] : []); }

function validateAvailabilityQuery(query: AvailabilityQuery): void { if (!query || !Array.isArray(query.participantIds) || !query.participantIds.length || query.participantIds.some(value => !safeIdentity(value)) || !safeDate(query.rangeStart) || !safeDate(query.rangeEnd) || Date.parse(query.rangeEnd) <= Date.parse(query.rangeStart) || !Number.isSafeInteger(query.desiredDurationMinutes) || query.desiredDurationMinutes < 1 || query.desiredDurationMinutes > 7 * 24 * 60 || (query.preferredStart && !safeDate(query.preferredStart)) || (query.preferredEnd && !safeDate(query.preferredEnd)) || (query.preferredStart && query.preferredEnd && Date.parse(query.preferredEnd) <= Date.parse(query.preferredStart)) || (query.requiredParticipantIds && (query.requiredParticipantIds.some(value => !query.participantIds.includes(value)) || query.requiredParticipantIds.some(value => !safeIdentity(value)))) || (query.optionalParticipantIds && (query.optionalParticipantIds.some(value => !query.participantIds.includes(value)) || query.optionalParticipantIds.some(value => !safeIdentity(value))))) throw new CalendarError('INVALID_ARGUMENT', 'Availability query is invalid'); if (query.timezone) validTimezone(query.timezone); if (query.workingHours) { intervalMinutes(query.workingHours.start); intervalMinutes(query.workingHours.end); } }
