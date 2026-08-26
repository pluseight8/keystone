import { describe, expect, it } from 'vitest';
import { TaskService } from '../tasks.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');

describe('R0P91 TaskService source integrations', () => {
  it('projects Calendar, Daily and Workboard without creating parallel stores', async () => {
    const calendarCalls: unknown[] = [];
    const workboardCalls: unknown[] = [];
    const tasks = new TaskService({
      identityId: 'alice',
      defaultTimezone: 'UTC',
      now: () => NOW,
      calendar: { async createTimeBlock(input) { calendarCalls.push(input); return { eventId: 'calendar-event-1' }; } },
      workboards: {
        async createCard(input) { workboardCalls.push(input); return { boardId: 'board-1', itemId: 'card-1' }; },
        async referenceCard() { return { title: 'Existing card' }; },
      },
    });
    await tasks.ready();
    const task = await tasks.createTask({ title: 'Prepare release', due: '2026-08-26T12:00:00.000Z', priority: 'HIGH' });
    expect(tasks.calendarProjection({ from: '2026-08-26T00:00:00.000Z', until: '2026-08-27T00:00:00.000Z' })[0]).toMatchObject({ taskId: task.id, source: 'TASK' });
    expect(await tasks.createCalendarTimeBlock(task.id, { start: '2026-08-26T12:00:00.000Z', end: '2026-08-26T13:00:00.000Z' })).toEqual({ eventId: 'calendar-event-1' });
    expect(await tasks.createWorkboardCard(task.id)).toEqual({ boardId: 'board-1', itemId: 'card-1' });
    const imported = await tasks.createTaskFromWorkboard({ boardId: 'board-1', itemId: 'source-card', title: 'Review card' });
    expect(imported.references[0]).toMatchObject({ type: 'work-item', id: 'source-card' });
    expect(calendarCalls).toHaveLength(1);
    expect(workboardCalls).toHaveLength(1);

    const source = tasks.dailySource();
    const collected = await source.collect({ now: NOW, mode: 'day', timezone: 'UTC', from: NOW - 60_000, until: NOW + 86_400_000, limit: 32 }, { ownerId: 'alice', now: NOW, timezone: 'UTC', sourceEnabled: () => true });
    const items = Array.isArray(collected) ? collected : 'items' in collected ? collected.items : [];
    expect(items[0]).toMatchObject({ sourceType: 'tasks', canonicalRef: { type: 'task' }, dataClass: 'PRIVATE' });
  });

  it('keeps personal Tasks out of Universal Inbox unless explicitly assigned', async () => {
    const tasks = new TaskService({ identityId: 'alice', defaultTimezone: 'UTC', now: () => NOW });
    await tasks.ready();
    await tasks.createTask({ title: 'Personal only' });
    const privateItems = await tasks.inboxAdapter().list({ limit: 32, cursor: undefined });
    expect(privateItems).toHaveLength(0);
    const shared = await tasks.createSharedList({ id: 'team', name: 'Team' });
    const assigned = await tasks.createTask({ listId: shared.id, title: 'Assigned item', assignee: 'alice' });
    const assignedItems = await tasks.inboxAdapter().list({ limit: 32, cursor: undefined });
    expect(assignedItems.some(value => value.task.id === assigned.id)).toBe(true);
  });
});
