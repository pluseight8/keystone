import { describe, expect, it } from 'vitest';
import { InMemoryTaskStateStore, TaskService } from '../tasks.js';

const NOW = Date.parse('2026-08-26T09:00:00.000Z');

describe('R0P91 TaskService scale bounds', () => {
  it('hydrates, indexes and paginates a bounded 100,000-task state', async () => {
    const timestamp = new Date(NOW).toISOString();
    const store = new InMemoryTaskStateStore();
    store.corrupt({
      version: 1,
      lists: [{ version: 1, id: 'task-list:inbox', name: 'Inbox', scope: 'PRIVATE', ownerIdentityId: 'alice', members: [{ version: 1, identityId: 'alice', role: 'OWNER', joinedAt: timestamp, revision: 1 }], epoch: 1, pinned: true, builtIn: 'INBOX', createdAt: timestamp, updatedAt: timestamp, revision: 1, tombstone: false }],
      tasks: Array.from({ length: 100_000 }, (_, index) => ({ version: 1, id: `task:${index}`, listId: 'task-list:inbox', title: `Scale task ${index}`, status: 'OPEN', orderKey: index.toString().padStart(8, '0'), createdAt: timestamp, updatedAt: timestamp, reminders: [], priority: 'NONE', tags: index % 10 === 0 ? ['batch'] : [], references: [], revision: 1, tombstone: false })),
      invitations: [],
      seenEvents: [],
    });
    const started = performance.now();
    const tasks = new TaskService({ identityId: 'alice', defaultTimezone: 'UTC', now: () => NOW, store });
    await tasks.ready();
    const page = await tasks.listTasks({ view: 'ALL', limit: 256 });
    const searched = await tasks.searchTasks('99999', { limit: 8 });
    const elapsed = performance.now() - started;
    expect(tasks.diagnostics().tasks).toBe(100_000);
    expect(page.items).toHaveLength(256);
    expect(page.nextCursor).toBeTruthy();
    expect(searched.items.map(task => task.title)).toContain('Scale task 99999');
    expect(elapsed).toBeLessThan(60_000);
  }, 180_000);
});
