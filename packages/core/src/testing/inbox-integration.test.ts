import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ControlledMailProvider,
  InMemoryMailStateStore,
  InMemoryNotificationStateStore,
  MailService,
  NotificationService,
  PersistentNotificationStorage,
  UniversalInboxService,
  createKeystoneNotificationInboxAdapter,
  createMailInboxAdapter,
} from '../index.js';
import type { MailProviderMessage } from '../mail.js';

describe('R0P88 source integration', () => {
  it('projects a real Keystone NotificationService without publishing Inbox read state', async () => {
    const notifications = new NotificationService(new PersistentNotificationStorage(new InMemoryNotificationStateStore()), 'local-owner');
    await notifications.ingest({ version: 1, type: 'message', id: randomUUID(), author: 'a'.repeat(32), createdAt: '2026-08-25T08:00:00.000Z', visibility: 'private', references: [], payload: { kind: 'text', text: 'Hello from Keystone', conversationId: randomUUID(), logicalClock: 1 }, signature: 's'.repeat(16) });
    const inbox = new UniversalInboxService({ adapters: [createKeystoneNotificationInboxAdapter({ notificationService: notifications })] });
    await inbox.ready();
    const item = (await inbox.list()).items[0]!;
    expect(item.kind).toBe('MESSAGE');
    await inbox.markRead(item.id);
    expect((await notifications.list())[0]!.read).toBe(false);
  });

  it('projects a controlled external mailbox and routes reply drafts through MailService', async () => {
    const accountId = 'integration-mail';
    const provider = new ControlledMailProvider('controlled', accountId);
    const message: MailProviderMessage = { providerMessageId: 'provider-1', folderId: `${accountId}:inbox`, messageId: '<integration-1@example.test>', from: { address: 'sender@example.test' }, to: [{ address: 'owner@example.test' }], cc: [], subject: 'External update', bodyText: 'External body', snippet: 'External body', flags: [], receivedAt: '2026-08-25T08:00:00.000Z', attachments: [] };
    provider.addMessage(message);
    const mail = new MailService({ store: new InMemoryMailStateStore(), adapters: [provider], now: () => Date.parse('2026-08-25T09:00:00.000Z') });
    await mail.addAccount({ id: accountId, label: 'Integration mailbox', address: { address: 'owner@example.test' }, provider: { kind: 'CONTROLLED', controlled: { adapterId: 'controlled' } } });
    await mail.sync(accountId);
    const inbox = new UniversalInboxService({ adapters: [createMailInboxAdapter(mail)] });
    await inbox.ready();
    const item = (await inbox.list()).items[0]!;
    expect(item.kind).toBe('EMAIL');
    await inbox.markRead(item.id);
    expect(mail.requireMessage(item.source.source === 'mail' ? item.source.messageId : 'missing').flags).not.toContain('SEEN');
    const draft = await inbox.executeAction({ itemId: item.id, action: 'REPLY_MAIL', ownerConfirmed: true, send: false });
    expect(draft.status).toBe('DRAFT_CREATED');
    await mail.close();
  });
});
