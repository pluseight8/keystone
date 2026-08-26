import { describe, expect, it } from 'vitest';
import { InMemoryTaskStateStore, TaskService, type TaskNotification, type TaskReplicationAdapter, type TaskReplicationEvent, type TaskServiceOptions } from './tasks.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');
const service = (identityId: string, options: Partial<TaskServiceOptions> = {}) => new TaskService({ identityId, defaultTimezone: 'UTC', now: () => NOW, ...options });

describe('R0P91 TaskService security boundaries', () => {
  it('fails safely on malformed nested persisted list data', async () => {
    const store = new InMemoryTaskStateStore();
    store.corrupt({ version: 1, lists: [{ version: 1, id: '\u0000', name: 'bad', scope: 'PRIVATE', ownerIdentityId: 'alice', members: [], epoch: 1, revision: 1, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() }], tasks: [] });
    const tasks = service('alice', { store });
    await tasks.ready();
    expect((await tasks.listLists()).some(list => list.builtIn === 'INBOX')).toBe(true);
  });

  it('does not allow a replication payload to cross a list boundary', async () => {
    const events: TaskReplicationEvent[] = [];
    const replication: TaskReplicationAdapter = { publish(event) { events.push(event); } };
    const tasks = service('alice', { replication });
    await tasks.ready();
    const first = await tasks.createList({ id: 'first', name: 'First' });
    const second = await tasks.createList({ id: 'second', name: 'Second' });
    const task = await tasks.createTask({ listId: first.id, title: 'Private task' });
    const event = events.find(value => value.operation === 'task.upsert' && value.targetId === task.id);
    expect(event).toBeDefined();
    await expect(tasks.applyReplicationEvent({ ...event!, payload: { ...(event!.payload as object), listId: second.id } })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('redacts SECRET references in reminder notifications and coalesces missed delivery', async () => {
    const notifications: TaskNotification[] = [];
    const tasks = service('alice', { notifications: { notify(value) { notifications.push(value); } } });
    const task = await tasks.createTask({ title: 'Do not disclose', due: '2026-08-25', references: [{ type: 'file', id: 'secret-file', dataClass: 'SECRET' }], reminders: [{ kind: 'AT_DUE' }] });
    const reminder = task.reminders[0]!;
    expect(await tasks.reconcileMissedReminders(NOW)).toEqual({ notified: 1, coalesced: 0 });
    expect(await tasks.reconcileMissedReminders(NOW)).toEqual({ notified: 0, coalesced: 0 });
    expect(notifications[0]).toMatchObject({ privacy: 'GENERIC', title: 'Task reminder' });
    expect(notifications[0]?.title).not.toContain('Do not disclose');
    expect(await tasks.handleReminderFired({ taskId: task.id, reminderId: reminder.id, version: task.revision })).toBe(true);
    expect(notifications.at(-1)).toMatchObject({ privacy: 'GENERIC', title: 'Task reminder' });
  });
});
