import { describe, expect, it } from 'vitest';
import {
  InboxError,
  InMemoryInboxStateStore,
  UniversalInboxService,
  createMailInboxAdapter,
  type InboxAdapterEvent,
  type InboxProjectionAdapter,
  type InboxSourceProjection,
  type InboxSourceRef,
} from './inbox.js';
import type { MailMessage } from './mail.js';

interface FakeSource { readonly id: string; readonly version: string; readonly title: string; readonly requiresAction?: boolean; }

function fakeAdapter(values: FakeSource[] = [{ id: 'one', version: '1', title: 'First', requiresAction: true }, { id: 'two', version: '1', title: 'Second' }]): InboxProjectionAdapter<FakeSource> & { emit(event: InboxAdapterEvent<FakeSource>): void; calls: { readonly actions: number } } {
  const map = new Map(values.map(value => [value.id, value]));
  const listeners = new Set<(event: InboxAdapterEvent<FakeSource>) => void>();
  const calls = { actions: 0 };
  const project = (value: FakeSource): InboxSourceProjection => {
    const source: InboxSourceRef = { source: 'system', id: value.id, eventId: value.id };
    return {
      source,
      kind: value.requiresAction ? 'APPROVAL' : 'SYSTEM_ATTENTION',
      sourceVersion: value.version,
      presentation: {
        title: value.title,
        snippet: '<script>prompt injection</script>',
        receivedAt: '2026-08-25T08:00:00.000Z',
        updatedAt: '2026-08-25T08:00:00.000Z',
        reasons: value.requiresAction ? ['Needs explicit review'] : [],
        priority: value.requiresAction ? 'approval' : 'informational',
        requiresAction: value.requiresAction === true,
        dataClass: 'private',
        badge: { label: 'forged system label' },
      },
      actions: [{ id: 'arbitrary' as never, kind: 'OPEN_SOURCE', label: 'Open', requiresOwnerConfirmation: false, sourceVersion: value.version }, { id: 'evil' as never, kind: 'NOPE' as never, label: 'Run arbitrary', requiresOwnerConfirmation: false, sourceVersion: value.version }],
    };
  };
  return {
    sourceKind: 'system', trust: 'CORE', list: () => [...map.values()], project,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: ref => ref.source === 'system' ? map.get(ref.id) : undefined,
    execute: input => { calls.actions += 1; if (input.action !== 'OPEN_SOURCE') throw new InboxError('ACTION_UNAVAILABLE', 'unexpected action'); return { status: 'OPENED' }; },
    emit: event => { if (event.kind === 'UPSERT') map.set(event.source.id, event.source); if (event.kind === 'REMOVE') map.delete(event.ref.id); for (const listener of listeners) listener(event); },
    calls,
  };
}

function itemId(id: string) { return `inbox:system:${encodeURIComponent(id)}` as never; }

describe('UniversalInboxService', () => {
  it('hydrates a bounded projection, filters local organization state and groups deterministically', async () => {
    const adapter = fakeAdapter();
    const inbox = new UniversalInboxService({ adapters: [adapter], deviceId: 'device-a' });
    await inbox.ready();
    const initial = await inbox.list();
    expect(initial.items.map(item => item.id)).toEqual([itemId('one'), itemId('two')]);
    expect(initial.items[0]!.presentation.badge).toEqual({ source: 'system', label: 'System', trusted: true });
    expect(initial.items[0]!.presentation.snippet).toBe('<script>prompt injection</script>');
    expect(initial.items[0]!.actions).toHaveLength(1);
    await inbox.markRead(itemId('one'), true);
    expect((await inbox.list({ view: 'UNREAD' })).items.map(item => item.id)).toEqual([itemId('two')]);
    await inbox.archive(itemId('two'));
    expect((await inbox.list()).items).toHaveLength(1);
    expect((await inbox.list({ view: 'ARCHIVE' })).items).toHaveLength(1);
    expect((await inbox.list({ view: 'ARCHIVE' })).groups[0]!.count).toBe(1);
  });

  it('keeps Inbox read/archive state separate from source actions and revalidates actions', async () => {
    const adapter = fakeAdapter();
    const inbox = new UniversalInboxService({ adapters: [adapter] });
    await inbox.ready();
    await inbox.markRead(itemId('one'));
    expect(adapter.calls.actions).toBe(0);
    await expect(inbox.executeAction({ itemId: itemId('one'), action: 'OPEN_SOURCE' })).resolves.toEqual({ status: 'OPENED' });
    expect(adapter.calls.actions).toBe(1);
    adapter.emit({ kind: 'REMOVE', ref: { source: 'system', id: 'one', eventId: 'one' } });
    await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    await expect(inbox.executeAction({ itemId: itemId('one'), action: 'OPEN_SOURCE' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('uses a durable wake index instead of a timer per snoozed item', async () => {
    let now = Date.parse('2026-08-25T08:00:00.000Z');
    const store = new InMemoryInboxStateStore();
    const adapter = fakeAdapter([{ id: 'one', version: '1', title: 'Snooze me' }]);
    const first = new UniversalInboxService({ adapters: [adapter], store, now: () => now });
    await first.ready();
    await first.snooze(itemId('one'), '2026-08-25T08:05:00.000Z');
    expect(first.diagnostics().snoozeWakeIndexSize).toBe(1);
    expect((await first.list()).items).toHaveLength(0);
    now += 6 * 60_000;
    expect(await first.wakeSnoozed(now)).toBe(1);
    expect((await first.list()).items).toHaveLength(1);
    const restarted = new UniversalInboxService({ store, now: () => now });
    await restarted.ready();
    expect((await restarted.list()).items).toHaveLength(1);
  });

  it('coalesces adapter bursts and handles source unavailability without breaking other state', async () => {
    const adapter = fakeAdapter([{ id: 'one', version: '1', title: 'One' }]);
    const inbox = new UniversalInboxService({ adapters: [adapter] });
    await inbox.ready();
    for (let index = 0; index < 50; index += 1) adapter.emit({ kind: 'UPSERT', source: { id: 'one', version: String(index + 2), title: `One ${index}` }, eventId: `event-${index}` });
    await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    await inbox.flush();
    expect((await inbox.list()).items[0]!.presentation.title).toBe('One 49');
    adapter.emit({ kind: 'UNAVAILABLE', source: { source: 'system', id: 'one', eventId: 'one' }, reason: 'offline' });
    await new Promise<void>(resolve => queueMicrotask(() => resolve()));
    await inbox.flush();
    expect((await inbox.list()).items[0]!.sourceState).toBe('unavailable');
  });

  it('rejects plugin source spoofing and never exposes an external-AI action', async () => {
    const plugin = fakeAdapter();
    expect(() => new UniversalInboxService({ adapters: [{ ...plugin, sourceKind: 'security', trust: 'PLUGIN' }] })).toThrowError(InboxError);
    const inbox = new UniversalInboxService({ adapters: [plugin] });
    await inbox.ready();
    await expect(inbox.selectForLocalAi([itemId('one')], false)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(inbox.selectForLocalAi([itemId('one')], true)).resolves.toHaveLength(1);
  });
});

describe('createMailInboxAdapter', () => {
  it('routes reply drafts and explicit send through the exact mail boundary', async () => {
    const message = { id: 'message-1', accountId: 'account-a', folderId: 'inbox', providerMessageId: 'provider-1', references: [], threadId: 'thread-1', from: { address: 'sender@example.test' }, to: [], cc: [], subject: 'Hello', receivedAt: '2026-08-25T08:00:00.000Z', snippet: 'Safe text', attachments: [], flags: [], readReceiptRequested: false, contentState: 'METADATA', externalImageUrls: [], createdAt: '2026-08-25T08:00:00.000Z', updatedAt: '2026-08-25T08:00:00.000Z' } satisfies MailMessage;
    let sent = false;
    const port = {
      listMessages: () => ({ items: [message] }), getMessage: () => message,
      createReplyDraft: async () => ({ id: 'draft-1' }), updateDraft: async () => undefined,
      sendDraft: async (_id: string, confirmed?: boolean) => { sent = confirmed === true; return { id: 'outbox-1' }; },
    };
    const adapter = createMailInboxAdapter(port);
    const projection = adapter.project(message)!;
    await expect(adapter.execute!({ item: { version: 1, id: 'x' as never, source: projection.source, sourceKind: 'mail', kind: 'EMAIL', sourceVersion: message.updatedAt, sourceState: 'available', presentation: projection.presentation as never, organization: { read: false, archived: false, dismissed: false, pinned: false, saved: false, changedAt: message.updatedAt, revision: { clock: 0, deviceId: 'd' } }, actions: projection.actions! }, source: projection, action: 'REPLY_MAIL', ownerConfirmed: false, send: true, idempotencyKey: 'test' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(sent).toBe(false);
    await expect(adapter.execute!({ item: {} as never, source: projection, action: 'REPLY_MAIL', ownerConfirmed: true, send: true, idempotencyKey: 'test-2' })).resolves.toEqual({ status: 'SENT', outboxId: 'outbox-1' });
    expect(sent).toBe(true);
  });
});
