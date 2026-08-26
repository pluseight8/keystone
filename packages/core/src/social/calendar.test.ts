import { describe, expect, it } from 'vitest';
import {
  CalendarAgentAdapter,
  CalendarError,
  CalendarReplicationService,
  CalendarService,
  InMemoryCalendarStateStore,
  SharedCalendarService,
  findCommonAvailability,
  parseCalendarLink,
  type AvailabilityQuery,
  type CalendarReplicationEvent,
  type CalendarSigner,
} from './calendar.js';

const signer: CalendarSigner = { sign: value => `sig:${value.length}:${value.slice(0, 8)}`, verify: (value, signature) => signature === `sig:${value.length}:${value.slice(0, 8)}` };
function service(identityId = `identity-${crypto.randomUUID()}`, storage = new InMemoryCalendarStateStore(), now = () => Date.parse('2026-01-15T12:00:00.000Z')) { return new CalendarService({ identityId, storage, signer, defaultTimezone: 'Europe/Moscow', now }); }

describe('CalendarService', () => {
  it('creates stable event identities, revisions and restart state', async () => {
    const storage = new InMemoryCalendarStateStore(); const alice = service('identity-alice', storage); await alice.ready(); const calendar = await alice.createCalendar({ id: 'calendar-alice', name: 'Personal', timezone: 'Europe/Moscow' }); const event = await alice.createEvent(calendar.id, { id: 'event-stable', title: 'Review', start: '2026-01-16T09:00:00.000Z', end: '2026-01-16T10:00:00.000Z' }); const updated = await alice.updateEvent(event.id, { patch: { title: 'Review updated' } }); expect(updated.id).toBe(event.id); expect(updated.revision).toBe(2); const restored = service('identity-alice', storage); await restored.ready(); expect((await restored.getEvent(event.id))?.title).toBe('Review updated'); expect((await restored.listCalendars())[0]?.id).toBe(calendar.id);
  });

  it('expands bounded daily/weekly recurrence and handles a DST boundary', async () => {
    const calendar = service('dst-owner'); const value = await calendar.createCalendar({ id: 'dst-calendar', name: 'DST', timezone: 'America/New_York' }); const event = await calendar.createEvent(value.id, { id: 'dst-event', title: 'DST', start: '2026-03-07T15:00:00.000Z', end: '2026-03-07T16:00:00.000Z', timezone: 'America/New_York', recurrence: { frequency: 'daily', interval: 1, count: 4 } }); const occurrences = calendar.expandOccurrences(event, '2026-03-07T00:00:00.000Z', '2026-03-12T00:00:00.000Z'); expect(occurrences).toHaveLength(4); expect(occurrences[1]?.start).toBe('2026-03-08T14:00:00.000Z'); expect(occurrences[2]?.start).toBe('2026-03-09T14:00:00.000Z');
  });

  it('keeps shared permissions fail-closed and redacts private metadata', async () => {
    const alice = service('owner'); const calendar = await alice.createCalendar({ id: 'shared', name: 'Shared', visibility: 'shared', members: [{ identityId: 'viewer', role: 'viewer' }, { identityId: 'editor', role: 'editor' }] }); const event = await alice.createEvent(calendar.id, { id: 'private-event', title: 'Psychologist appointment', description: 'Sensitive', location: 'Clinic', start: '2026-01-20T12:00:00.000Z', end: '2026-01-20T13:00:00.000Z', visibility: 'private', participants: [{ identityId: 'viewer' }] }); expect((await alice.getEvent(event.id, 'viewer'))?.title).toBe('BUSY'); expect((await alice.getEvent(event.id, 'viewer'))?.description).toBe(''); expect(await alice.getEvent(event.id, 'outsider')).toBeUndefined(); const sharedEvent = await alice.createEvent(calendar.id, { id: 'shared-event', title: 'Project meeting', start: '2026-01-21T12:00:00.000Z', end: '2026-01-21T13:00:00.000Z', visibility: 'shared' }); expect((await alice.getEvent(sharedEvent.id, 'editor'))?.title).toBe('Project meeting'); expect((await alice.getEvent(sharedEvent.id, 'viewer'))?.title).toBe('BUSY');
  });

  it('enforces RSVP actor binding, member removal and invitations', async () => {
    const alice = service('owner'); const calendar = await alice.createCalendar({ id: 'invite-calendar', name: 'Invite' }); const invite = await alice.createInvite(calendar.id, { inviteeIdentityId: 'bob', permissions: ['VIEW_EVENTS', 'VIEW_FREE_BUSY'], disclosure: 'FULL_EVENT' }); const accepted = await alice.acceptInvite(invite.id, { identityId: 'bob' }); expect(accepted.state).toBe('accepted'); const event = await alice.createEvent(calendar.id, { id: 'rsvp-event', title: 'RSVP', start: '2026-02-01T10:00:00.000Z', end: '2026-02-01T11:00:00.000Z', participants: [{ identityId: 'bob' }] }); await expect(alice.respond(event.id, 'ACCEPTED')).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' }); await expect(alice.removeMember(calendar.id, 'bob', { identityId: 'bob' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('bootstraps and accepts an invite across independent Calendar services', async () => {
    const owner = service('owner'); const bob = service('bob');
    owner.setReplication({ publish: async event => { await bob.applyReplicationEvent(event); } });
    bob.setReplication({ publish: async event => { await owner.applyReplicationEvent(event); } });
    const calendar = await owner.createCalendar({ id: 'remote-invite', name: 'Remote', visibility: 'shared' });
    const invite = await owner.createInvite(calendar.id, { inviteeIdentityId: 'bob', permissions: ['VIEW_EVENTS', 'VIEW_FREE_BUSY'], disclosure: 'FULL_EVENT' });
    expect((await bob.listInvites()).some(value => value.id === invite.id)).toBe(true);
    await bob.acceptInvite(invite.id);
    expect((await owner.getCalendar(calendar.id, 'bob'))?.members.some(value => value.identityId === 'bob' && !value.removedAt)).toBe(true);
    expect((await bob.getCalendar(calendar.id, 'bob'))?.members.some(value => value.identityId === 'bob' && !value.removedAt)).toBe(true);
  });

  it('finds common time using only derived free/busy intervals', async () => {
    const query: AvailabilityQuery = { participantIds: ['a', 'b', 'c'], requiredParticipantIds: ['a', 'b', 'c'], rangeStart: '2026-02-07T08:00:00.000Z', rangeEnd: '2026-02-07T23:00:00.000Z', desiredDurationMinutes: 120 }; const results = ['a', 'b', 'c'].map((participantId, index) => ({ version: 1 as const, participantId, rangeStart: query.rangeStart, rangeEnd: query.rangeEnd, busy: [], available: [{ start: `2026-02-07T${index === 0 ? '17' : index === 1 ? '18' : '18'}:00:00.000Z`, end: `2026-02-07T${index === 0 ? '22' : index === 1 ? '20' : '23'}:00:00.000Z` }], disclosure: 'FREE_BUSY' as const, derivedOnly: true as const, generatedAt: '2026-02-01T00:00:00.000Z' })); const common = findCommonAvailability(query, results); expect(common[0]).toEqual({ start: '2026-02-07T18:00:00.000Z', end: '2026-02-07T20:00:00.000Z' }); expect(JSON.stringify(common)).not.toContain('Psychologist');
  });

  it('creates explicit conflict state rather than dropping concurrent edits', async () => {
    const storage = new InMemoryCalendarStateStore(); const alice = service('owner', storage); const calendar = await alice.createCalendar({ id: 'conflict-calendar', name: 'Conflict' }); const event = await alice.createEvent(calendar.id, { id: 'conflict-event', title: 'Original', start: '2026-03-01T10:00:00.000Z', end: '2026-03-01T11:00:00.000Z' }); await alice.updateEvent(event.id, { patch: { title: 'Local edit' } }); await expect(alice.updateEvent(event.id, { baseRevision: 1, patch: { title: 'Remote edit' } })).rejects.toMatchObject({ code: 'CONFLICT' }); expect((await alice.listConflicts(calendar.id)).length).toBe(1);
  });

  it('keeps reminder scheduling behind the Chronos host boundary', async () => {
    const scheduled: string[] = []; const calendar = new CalendarService({ identityId: 'owner', signer, now: () => Date.parse('2026-04-01T09:00:00.000Z'), reminderScheduler: { async schedule(value) { scheduled.push(value.id); } } }); const value = await calendar.createCalendar({ id: 'reminder-calendar', name: 'Reminders' }); await calendar.createEvent(value.id, { id: 'reminder-event', title: 'Reminder', start: '2026-04-02T09:00:00.000Z', end: '2026-04-02T10:00:00.000Z', reminders: [{ id: 'reminder-one', kind: 'offset', minutesBefore: 30 }] }); expect(scheduled).toEqual(['reminder-event:reminder-one']);
  });

  it('supports agent suggestions and requires confirmation for side effects', async () => {
    const calendar = service('owner'); const value = await calendar.createCalendar({ id: 'agent-calendar', name: 'Agent' }); const adapter = new CalendarAgentAdapter(calendar); const suggestion = await adapter.query('what is on my calendar today?'); expect(['PUBLIC_INFORMATION', 'DERIVED_PREFERENCE']).toContain(suggestion.type); const denied = await adapter.confirm({ action: 'create', calendarId: value.id, event: { title: 'Agent event', start: '2026-04-03T10:00:00.000Z', end: '2026-04-03T11:00:00.000Z' }, confirmed: false }); expect(denied.type).toBe('AGENT_SUGGESTION'); const confirmed = await adapter.confirm({ action: 'create', calendarId: value.id, event: { title: 'Agent event', start: '2026-04-03T10:00:00.000Z', end: '2026-04-03T11:00:00.000Z' }, confirmed: true }); expect(confirmed.type).toBe('OWNER_CONFIRMED_DECISION');
  });

  it('keeps arbitrary generated identities generic and links permission-aware', async () => {
    const identities = Array.from({ length: 6 }, (_, index) => `generated-${index}-${crypto.randomUUID()}`); const calendar = new SharedCalendarService({ identityId: identities[0]!, signer }); const value = await calendar.createSharedCalendar({ id: 'generated-shared', name: 'Any group', members: identities.slice(1).map(identityId => ({ identityId, role: 'viewer' })) }); expect(value.members).toHaveLength(6); const event = await calendar.createEvent(value.id, { id: 'generated-event', title: 'Arbitrary', start: '2026-05-01T10:00:00.000Z', end: '2026-05-01T11:00:00.000Z' }); expect(calendar.calendarLink(value.id)).toBe('keystone://calendar/generated-shared'); expect(calendar.eventLink(event.id)).toBe('keystone://calendar/event/generated-event'); expect(parseCalendarLink(calendar.eventLink(event.id))).toEqual({ kind: 'event', id: event.id });
  });

  it('rejects malformed recurrence and oversized identities', async () => {
    const calendar = service('owner'); const value = await calendar.createCalendar({ id: 'validation', name: 'Validation' }); await expect(calendar.createEvent(value.id, { title: 'Bad', start: '2026-01-01T10:00:00.000Z', end: '2026-01-01T11:00:00.000Z', recurrence: { frequency: 'weekly', interval: 0 } })).rejects.toBeInstanceOf(CalendarError); await expect(calendar.createCalendar({ id: 'bad', name: '' })).rejects.toBeInstanceOf(CalendarError);
  });
});

describe('CalendarReplicationService', () => {
  it('applies signed revisioned events and rejects replay/spoof', async () => {
    const owner = service('owner'); const viewer = service('viewer'); const events: CalendarReplicationEvent[] = []; owner.subscribe(event => { events.push(event); }); const calendar = await owner.createCalendar({ id: 'replicated', name: 'Replicated', visibility: 'shared', members: [{ identityId: 'viewer', role: 'viewer', permissions: ['VIEW_EVENTS', 'VIEW_FREE_BUSY'], disclosure: 'FULL_EVENT' }] }); const event = await owner.createEvent(calendar.id, { id: 'replicated-event', title: 'P2P', start: '2026-06-01T10:00:00.000Z', end: '2026-06-01T11:00:00.000Z', visibility: 'shared' }); const calendarEvent = events.find(value => value.operation === 'calendar.upsert')!; const itemEvent = events.find(value => value.operation === 'event.upsert')!; expect(await viewer.applyReplicationEvent({ ...itemEvent })).toBe(false); expect(await viewer.applyReplicationEvent({ ...calendarEvent })).toBe(true); expect((await viewer.getEvent(event.id, 'viewer'))?.title).toBe('P2P'); await expect(viewer.applyReplicationEvent({ ...itemEvent })).rejects.toMatchObject({ code: 'REPLAY' }); await expect(viewer.applyReplicationEvent({ ...itemEvent, id: 'spoofed', signature: 'bad', actor: { identityId: 'mallory' } })).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
  });
});
