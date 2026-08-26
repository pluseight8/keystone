import { describe, expect, it } from 'vitest';
import { ControlledMailProvider, InMemoryMailStateStore, MailService, type MailProviderMessage } from '../mail.js';

const accountId = 'mail-scale-account';
const inboxId = `${accountId}:inbox`;
const fixedNow = Date.parse('2026-08-25T10:00:00.000Z');

function scaleMessage(index: number): MailProviderMessage {
  return {
    providerMessageId: `scale-provider-${index}`,
    folderId: inboxId,
    providerUid: index + 1,
    messageId: `<scale-message-${index}@example.test>`,
    references: [`<scale-thread-${index % 100}@example.test>`],
    from: { name: `Scale Sender ${index % 50}`, address: `sender-${index % 50}@example.test` },
    to: [{ address: 'scale-owner@example.test' }],
    subject: `R0P83 Scale message ${index}`,
    snippet: `Incremental scale metadata ${index}`,
    flags: index % 3 === 0 ? [] : ['SEEN'],
    receivedAt: new Date(fixedNow - index * 1_000).toISOString(),
    attachments: [],
  };
}

describe('R0P83 mail scale and resource bounds', () => {
  it('syncs 10k bounded metadata records incrementally, searches offline, and keeps outbox work bounded', async () => {
    const provider = new ControlledMailProvider('controlled', accountId);
    for (let index = 0; index < 10_000; index += 1) provider.addMessage(scaleMessage(index));
    const service = new MailService({ store: new InMemoryMailStateStore(), adapters: [provider], maxMessages: 10_000, maxCacheBytes: 64 * 1024 * 1024, now: () => fixedNow });
    await service.addAccount({ id: accountId, label: 'Scale mailbox', address: { address: 'scale-owner@example.test' }, provider: { kind: 'CONTROLLED', controlled: { adapterId: 'controlled' } } });

    const started = performance.now();
    let syncRuns = 0;
    while (!service.account(accountId)?.syncState.baselineEstablished && syncRuns < 32) {
      await service.sync(accountId, { limit: 1_000, fetchBodies: false });
      syncRuns += 1;
    }
    const durationMs = Math.round(performance.now() - started);
    expect(syncRuns).toBeGreaterThan(1);
    expect(service.account(accountId)?.syncState.baselineEstablished).toBe(true);
    expect(service.settings().cachedMessageCount).toBe(10_000);
    expect(service.search('R0P83 Scale message 9999', { accountId, limit: 10 })[0]?.id).toContain('scale-provider-9999');
    expect(service.listThreads(accountId)).toHaveLength(100);

    provider.setOnline(false);
    const offlineSearch = service.search('Incremental scale metadata 9999', { accountId });
    expect(offlineSearch.length).toBeGreaterThan(0);
    for (let index = 0; index < 32; index += 1) {
      const draft = await service.createDraft({ accountId, to: [{ address: `queue-${index}@example.test` }], subject: `Queued ${index}`, bodyText: 'offline' });
      const queued = await service.sendDraft(draft.id, true);
      expect(queued.state).toBe('QUEUED');
    }
    expect(service.outbox(accountId)).toHaveLength(32);
    expect(service.outbox(accountId).every(value => value.attempts <= 8)).toBe(true);
    console.log(`[R0P83-PERF] ${JSON.stringify({ metadata: 10_000, threads: service.listThreads(accountId).length, syncRuns, durationMs, queuedOutbox: service.outbox(accountId).length })}`);
    await service.close();
  }, 180_000);
});
