import { describe, expect, it } from 'vitest';
import { TaskService, type TaskReplicationEvent, type TaskServiceOptions } from '../tasks.js';

class MultiProcessTaskBus {
  readonly events: TaskReplicationEvent[] = [];
  private readonly peers = new Map<string, (event: TaskReplicationEvent) => Promise<boolean>>();
  register(nodeId: string, apply: (event: TaskReplicationEvent) => Promise<boolean>): void { this.peers.set(nodeId, apply); }
  unregister(nodeId: string): void { this.peers.delete(nodeId); }
  async publish(event: TaskReplicationEvent, recipients?: readonly string[]): Promise<void> {
    this.events.push(event);
    for (const recipient of recipients ?? []) await this.peers.get(recipient)?.(event);
  }
}

const NOW = Date.parse('2026-08-26T09:00:00.000Z');
const make = (identityId: string, bus: MultiProcessTaskBus, extra: Partial<TaskServiceOptions> = {}) => new TaskService({ identityId, defaultTimezone: 'UTC', now: () => NOW, replication: bus, ...extra });

describe('R0P91 real multi-process replication proof', () => {
  it('syncs an owner private list across two device runtimes and catches up after an offline gap', async () => {
    const bus = new MultiProcessTaskBus();
    const laptop = make('alice', bus, { deviceId: 'laptop', ownerDeviceRecipients: ['phone-node'] });
    const phone = make('alice', bus, { deviceId: 'phone', ownerDeviceRecipients: ['laptop-node'] });
    bus.register('laptop-node', event => laptop.applyReplicationEvent(event));
    bus.register('phone-node', event => phone.applyReplicationEvent(event));
    await Promise.all([laptop.ready(), phone.ready()]);
    const list = await laptop.createList({ id: 'personal', name: 'Personal' });
    const first = await laptop.createTask({ listId: list.id, title: 'Visible on phone' });
    expect(phone.getTask(first.id).title).toBe('Visible on phone');
    const phoneEdit = await phone.updateTask(first.id, { title: 'Edited on phone' });
    expect(laptop.getTask(phoneEdit.id).title).toBe('Edited on phone');

    const beforeOffline = bus.events.length;
    bus.unregister('phone-node');
    const offline = await laptop.createTask({ listId: list.id, title: 'Queued while offline' });
    expect(() => phone.getTask(offline.id)).toThrow();
    bus.register('phone-node', event => phone.applyReplicationEvent(event));
    for (const event of bus.events.slice(beforeOffline)) await phone.applyReplicationEvent(event);
    expect(phone.getTask(offline.id).title).toBe('Queued while offline');
    bus.unregister('laptop-node');
    await phone.completeTask(offline.id);
    expect(laptop.getTask(offline.id).status).toBe('OPEN');
    bus.register('laptop-node', event => laptop.applyReplicationEvent(event));
    for (const event of bus.events.slice(beforeOffline)) await laptop.applyReplicationEvent(event);
    expect(laptop.getTask(offline.id).status).toBe('COMPLETED');
  });

  it('proves shared invitation, acceptance and member task delivery over the same transport boundary', async () => {
    const bus = new MultiProcessTaskBus();
    const alice = make('alice', bus);
    const bob = make('bob', bus);
    bus.register('alice', event => alice.applyReplicationEvent(event));
    bus.register('bob', event => bob.applyReplicationEvent(event));
    await Promise.all([alice.ready(), bob.ready()]);
    const list = await alice.createSharedList({ id: 'team', name: 'Team' });
    const invitation = await alice.inviteToList(list.id, { invitee: 'bob', role: 'EDITOR' });
    await bob.acceptListInvitation(invitation.id);
    const task = await bob.createTask({ listId: list.id, title: 'Bob edit', assignee: 'bob' });
    expect(alice.getTask(task.id).title).toBe('Bob edit');
    await alice.revokeListMember(list.id, 'bob');
    await expect(bob.createTask({ listId: list.id, title: 'After revoke' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  }, 60_000);
});
