import { describe, expect, it } from 'vitest';
import {
  ChronosTaskReminderScheduler,
  InMemoryTaskStateStore,
  TaskError,
  TaskService,
  orderKeyBetween,
  parseTaskQuickCapture,
  type TaskNotification,
  type TaskReplicationEvent,
  type TaskServiceOptions,
} from './tasks.js';

const FIXED_NOW = Date.parse('2026-08-26T09:00:00.000Z');

function service(identityId: string, options: Partial<TaskServiceOptions> = {}): TaskService {
  return new TaskService({ identityId, defaultTimezone: 'UTC', now: () => FIXED_NOW, ...options });
}

describe('R0P91 TaskService', () => {
  it('provides a built-in Inbox and supports lifecycle, smart views, search and trash', async () => {
    const tasks = service('alice');
    await tasks.ready();
    expect(tasks.getList('task-list:inbox').builtIn).toBe('INBOX');

    const today = await tasks.createTask({ title: 'Buy milk', due: '2026-08-26', tags: ['home'] });
    const tomorrow = await tasks.createTask({ title: 'Call mom', due: '2026-08-27', note: '<script>alert(1)</script> at 18:00' });
    expect(today.id).not.toBe(tomorrow.id);
    expect(today.title).toBe('Buy milk');
    expect(tomorrow.note).toBe('alert(1) at 18:00');
    expect((await tasks.listTasks({ view: 'TODAY' })).items.map(value => value.id)).toContain(today.id);
    expect((await tasks.searchTasks('milk')).items[0]?.id).toBe(today.id);

    await tasks.completeTask(today.id);
    expect((await tasks.listTasks({ view: 'COMPLETED' })).items.map(value => value.id)).toContain(today.id);
    await tasks.reopenTask(today.id);
    await tasks.deleteTask(today.id);
    expect((await tasks.listTasks({ view: 'TRASH', includeTrash: true })).items.map(value => value.id)).toContain(today.id);
    await tasks.restoreTask(today.id);
    expect(tasks.getTask(today.id).tombstone).toBe(false);
  });

  it('parses deterministic Russian and English quick capture without AI', () => {
    const ru = parseTaskQuickCapture('Позвонить маме завтра в 18:00', { locale: 'ru', now: FIXED_NOW, timezone: 'UTC' });
    expect(ru.title).toBe('Позвонить маме');
    expect(ru.due?.kind).toBe('DATETIME');
    expect(ru.due?.value).toBe('2026-08-27T18:00:00.000Z');
    const en = parseTaskQuickCapture('Renew domain in 2 weeks', { locale: 'en', now: FIXED_NOW, timezone: 'UTC' });
    expect(en.title).toBe('Renew domain');
    expect(en.due?.value).toBe('2026-09-09');
    const friday = parseTaskQuickCapture('Send report on Friday', { locale: 'en', now: FIXED_NOW, timezone: 'UTC' });
    expect(friday.title).toBe('Send report');
    expect(friday.due?.value).toBe('2026-08-28');
    const monthDay = parseTaskQuickCapture('Продлить домен 5 сентября', { locale: 'ru', now: FIXED_NOW, timezone: 'UTC' });
    expect(monthDay.title).toBe('Продлить домен');
    expect(monthDay.due?.value).toBe('2026-09-05');
    expect(parseTaskQuickCapture('в 5', { locale: 'ru', now: FIXED_NOW, timezone: 'UTC' }).ambiguous).toBe('в 5');
    expect(orderKeyBetween(undefined, 'U') < 'U').toBe(true);
    expect(orderKeyBetween('0', '0U')).toBe('0E');
  });

  it('keeps subtasks bounded and protects against cycles', async () => {
    const tasks = service('alice');
    const parent = await tasks.createTask({ title: 'Prepare documents' });
    const child = await tasks.addSubtask(parent.id, { title: 'Passport' });
    expect(child.parentId).toBe(parent.id);
    await expect(tasks.updateTask(parent.id, { parentId: child.id })).rejects.toMatchObject({ code: 'CYCLE' });
    await expect(tasks.addSubtask('missing-task', { title: 'Nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('uses one typed Chronos boundary, handles reminders and never completes from delivery', async () => {
    const scheduled = new Map<string, any>();
    const canceled: string[] = [];
    const notifications: TaskNotification[] = [];
    const scheduler = new ChronosTaskReminderScheduler({
      async schedule(value) { scheduled.set(value.id, value); },
      async cancel(id) { scheduled.delete(id); canceled.push(id); },
    });
    const tasks = service('alice', { reminderScheduler: scheduler, notifications: { notify(value) { notifications.push(value); } } });
    const task = await tasks.createTask({ title: 'Pay internet', due: '2026-08-26T10:00:00.000Z', reminders: [{ kind: 'AT_DUE' }, { kind: 'BEFORE_DUE', minutesBefore: 10 }] });
    expect(scheduled.size).toBe(2);
    const first = [...scheduled.values()][0];
    expect(await tasks.handleReminderFired({ taskId: task.id, reminderId: first.reminderId, scheduleId: first.id, version: task.revision })).toBe(true);
    expect(notifications).toHaveLength(1);
    expect(tasks.getTask(task.id).status).toBe('OPEN');
    const changed = await tasks.postponeTask(task.id, '2026-08-27T10:00:00.000Z');
    expect(changed.due?.value).toBe('2026-08-27T10:00:00.000Z');
    expect(canceled.length).toBeGreaterThan(0);
    await tasks.completeTask(task.id);
    expect(scheduled.size).toBe(0);
    expect(tasks.diagnostics().scheduledReminders).toBe(0);
  });

  it('resets delivery state for recurring and snoozed occurrences', async () => {
    const scheduled = new Map<string, any>();
    const tasks = service('alice', { reminderScheduler: { async schedule(value) { scheduled.set(value.id, value); }, async cancel(id) { scheduled.delete(id); } } });
    const task = await tasks.createTask({ title: 'Take medicine', due: '2026-08-26T09:00:00.000Z', recurrence: { frequency: 'DAILY' }, reminders: [{ kind: 'AT_DUE' }] });
    const reminder = task.reminders[0]!;
    await tasks.handleReminderFired({ taskId: task.id, reminderId: reminder.id, version: task.revision, at: '2026-08-26T09:00:00.000Z' });
    const next = await tasks.completeTask(task.id);
    expect(next.reminders[0]?.lastNotifiedAt).toBeUndefined();
    expect(scheduled.get(`task-reminder:${task.id}:${reminder.id}`)?.dueAt).toBe('2026-08-27T09:00:00.000Z');
    const snoozed = await tasks.snoozeReminder(task.id, reminder.id, '2026-08-27T10:00:00.000Z');
    expect(snoozed.reminders[0]?.lastNotifiedAt).toBeUndefined();
  });

  it('fails closed for private references without a source resolver and binds notification actions', async () => {
    const tasks = service('alice');
    const task = await tasks.createTask({ title: 'Private file task', references: [{ type: 'file', id: 'private-file', dataClass: 'PRIVATE' }] });
    expect(await tasks.openReference(task.references[0]!)).toMatchObject({ available: false, authorized: false });
    await expect(tasks.handleNotificationAction({ taskId: task.id, action: 'COMPLETE', expectedRevision: task.revision + 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await tasks.handleNotificationAction({ taskId: task.id, action: 'COMPLETE', expectedRevision: task.revision })).status).toBe('COMPLETED');
  });

  it('advances fixed and completion-relative recurrence without materializing future copies', async () => {
    const tasks = service('alice');
    const fixed = await tasks.createTask({ title: 'Water plants', due: '2026-08-26', recurrence: { frequency: 'DAILY' } });
    const next = await tasks.completeTask(fixed.id);
    expect(next.id).toBe(fixed.id);
    expect(next.status).toBe('OPEN');
    expect(next.due?.value).toBe('2026-08-27');
    expect(next.recurrenceState?.history).toHaveLength(1);
    const after = await tasks.createTask({ title: 'Change filter', due: '2026-08-26', recurrence: { kind: 'AFTER_COMPLETION', frequency: 'MONTHLY' } });
    const afterNext = await tasks.completeTask(after.id);
    expect(afterNext.due?.value).toBe('2026-09-26');
    expect((await tasks.listTasks({ view: 'ALL' })).total).toBe(2);
  });
});

class ReplicationBus {
  readonly events: TaskReplicationEvent[] = [];
  private readonly peers = new Map<string, TaskService>();
  add(id: string, service: TaskService): void { this.peers.set(id, service); }
  async publish(event: TaskReplicationEvent, recipients?: readonly string[]): Promise<void> {
    this.events.push(event);
    for (const recipient of recipients ?? []) await this.peers.get(recipient)?.applyReplicationEvent(event);
  }
}

describe('R0P91 shared lists and authorization', () => {
  it('delivers explicit invitations, converges assignment/completion, and rejects revoked changes', async () => {
    const bus = new ReplicationBus();
    const alice = service('alice', { replication: bus });
    const bob = service('bob', { replication: bus });
    const mallory = service('mallory');
    bus.add('alice', alice); bus.add('bob', bob);
    await Promise.all([alice.ready(), bob.ready(), mallory.ready()]);

    const list = await alice.createSharedList({ id: 'shopping', name: 'Shopping' });
    const invitation = await alice.inviteToList(list.id, { invitee: 'bob', role: 'EDITOR' });
    expect(bob.listInvitations(list.id)).toHaveLength(1);
    await bob.acceptListInvitation(invitation.id);
    const task = await alice.createTask({ listId: list.id, title: 'Buy milk', assignee: 'bob' });
    expect(bob.getTask(task.id).title).toBe('Buy milk');
    await bob.completeTask(task.id);
    expect(alice.getTask(task.id).status).toBe('COMPLETED');
    await alice.revokeListMember(list.id, 'bob');
    await expect(bob.createTask({ listId: list.id, title: 'Stale' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    const oldTaskEvent = bus.events.find(event => event.operation === 'task.upsert' && event.targetId === task.id);
    expect(oldTaskEvent).toBeDefined();
    await expect(alice.applyReplicationEvent(oldTaskEvent)).rejects.toMatchObject({ code: 'STALE_EPOCH' });
    const listEvent = bus.events.find(event => event.operation === 'list.upsert' && event.listId === list.id);
    await expect(mallory.applyReplicationEvent(listEvent)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('replicates a member leave without granting the member list authority', async () => {
    const bus = new ReplicationBus();
    const alice = service('alice', { replication: bus });
    const bob = service('bob', { replication: bus });
    bus.add('alice', alice); bus.add('bob', bob);
    await Promise.all([alice.ready(), bob.ready()]);
    const list = await alice.createSharedList({ id: 'house', name: 'House' });
    const invitation = await alice.inviteToList(list.id, { invitee: 'bob', role: 'EDITOR' });
    await bob.acceptListInvitation(invitation.id);
    const task = await alice.createTask({ listId: list.id, title: 'Take out bins', assignee: 'bob' });
    await bob.leaveList(list.id);
    expect(alice.getList(list.id).members.find(member => member.identityId === 'bob')?.removedAt).toBeTruthy();
    expect(alice.getTask(task.id).assignee).toBeUndefined();
  });
});
