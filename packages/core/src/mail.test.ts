import { describe, expect, it } from 'vitest';
import {
  ControlledMailProvider,
  ControlledMailCredentialBoundary,
  ImapSmtpMailAdapter,
  InMemoryMailStateStore,
  MailError,
  MailService,
  parseMailMime,
  sanitizeMailHtml,
  type MailFolder,
  type MailImapSession,
  type MailPendingMutation,
  type MailProviderMessage,
  type MailSendReceipt,
  type MailSmtpSession,
} from './mail.js';

const ACCOUNT_ID = 'mail-test-account';
const OWNER = { name: 'Owner', address: 'owner@example.test' } as const;
const INBOX_ID = `${ACCOUNT_ID}:inbox`;
const FIXED_NOW = Date.parse('2026-08-25T10:00:00.000Z');

function providerMessage(overrides: Partial<MailProviderMessage> = {}): MailProviderMessage {
  return {
    providerMessageId: 'provider-message-1',
    folderId: INBOX_ID,
    messageId: '<message-1@example.test>',
    from: { name: 'Sender', address: 'sender@example.test' },
    to: [OWNER],
    cc: [{ name: 'Colleague', address: 'colleague@example.test' }],
    replyTo: [{ address: 'reply@example.test' }],
    subject: 'Project update',
    bodyText: 'The project update is ready.',
    bodyHtml: '<p>The <strong>project update</strong> is ready.</p>',
    flags: [],
    snippet: 'The project update is ready.',
    receivedAt: '2026-08-25T09:00:00.000Z',
    attachments: [{ id: 'attachment-1', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 16, disposition: 'ATTACHMENT', contentAvailable: false, privateByDefault: true }],
    ...overrides,
  };
}

function controlledService(provider: ControlledMailProvider, store = new InMemoryMailStateStore(), now = () => FIXED_NOW): MailService {
  return new MailService({ store, adapters: [provider], now });
}

async function addControlledAccount(service: MailService): Promise<void> {
  await service.addAccount({
    id: ACCOUNT_ID,
    label: 'External test mailbox',
    address: OWNER,
    provider: { kind: 'CONTROLLED', controlled: { adapterId: 'controlled' } },
  });
}

describe('R0P83 external mail bridge', () => {
  it('keeps an external mailbox as a bounded local projection with offline search and UIDVALIDITY reset', async () => {
    const provider = new ControlledMailProvider('controlled', ACCOUNT_ID);
    provider.addMessage(providerMessage());
    const service = controlledService(provider);
    await addControlledAccount(service);

    const first = await service.sync(ACCOUNT_ID);
    expect(first.baseline).toBe(true);
    expect(service.listMessages({ accountId: ACCOUNT_ID }).items).toHaveLength(1);
    expect(service.search('project update', { accountId: ACCOUNT_ID })[0]?.kind).toBe('mail');
    expect(service.listThreads(ACCOUNT_ID)).toHaveLength(1);

    provider.rotateUidValidity();
    const second = await service.sync(ACCOUNT_ID);
    expect(second.account.syncState.baselineEstablished).toBe(true);
    expect(service.listMessages({ accountId: ACCOUNT_ID }).items[0]?.providerUidValidity).toMatch(/^controlled-/);

    const rendered = service.renderMessage(service.listMessages({ accountId: ACCOUNT_ID }).items[0]!.id);
    expect(rendered.mode).toBe('SANITIZED_HTML');
    expect(rendered.value).not.toContain('<script');
    expect(rendered.blockedExternalImages).toEqual([]);
    await service.close();
  });

  it('requires owner confirmation for send, queues offline work, and preserves one stable Message-ID across restart', async () => {
    let now = FIXED_NOW;
    const provider = new ControlledMailProvider('controlled', ACCOUNT_ID);
    const store = new InMemoryMailStateStore();
    const service = controlledService(provider, store, () => now);
    await addControlledAccount(service);
    await service.sync(ACCOUNT_ID);
    const draft = await service.createDraft({ accountId: ACCOUNT_ID, to: [{ address: 'recipient@example.test' }], subject: 'Queued message', bodyText: 'Hello from the offline queue.' });

    await expect(service.sendDraft(draft.id)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    provider.setOnline(false);
    const queued = await service.sendDraft(draft.id, true);
    expect(queued.state).toBe('QUEUED');
    const stableMessageId = queued.stableMessageId;

    provider.setOnline(true);
    now += 2_000;
    const processed = await service.processOutbox(ACCOUNT_ID);
    expect(processed.find(value => value.id === queued.id)?.state).toBe('SENT');
    expect(provider.listSent()).toHaveLength(1);
    expect(provider.listSent()[0]?.providerMessageId).toBe(stableMessageId);
    expect(service.drafts(ACCOUNT_ID).find(value => value.id === draft.id)?.status).toBe('SENT');

    await service.close();
    const restarted = controlledService(provider, store, () => now);
    await restarted.ready();
    expect(restarted.outbox(ACCOUNT_ID).find(value => value.id === queued.id)?.state).toBe('SENT');
    expect(restarted.drafts(ACCOUNT_ID).find(value => value.id === draft.id)?.stableMessageId).toBe(stableMessageId);
    expect(restarted.listMessages({ accountId: ACCOUNT_ID }).items.some(value => value.folderId.endsWith(':sent'))).toBe(true);
    await restarted.close();
  });

  it('supports reply/reply-all/forward without exposing Bcc and keeps attachments private and lazy', async () => {
    const provider = new ControlledMailProvider('controlled', ACCOUNT_ID);
    provider.addMessage(providerMessage({ bcc: [{ address: 'hidden@example.test' }] }));
    const service = controlledService(provider);
    await addControlledAccount(service);
    await service.sync(ACCOUNT_ID);
    const message = service.listMessages({ accountId: ACCOUNT_ID }).items[0]!;

    const reply = await service.createReplyDraft(message.id);
    expect(reply.to.map(value => value.address)).toEqual(['reply@example.test']);
    expect(reply.subject).toBe('Re: Project update');
    const replyAll = await service.createReplyDraft(message.id, true);
    expect(replyAll.to.map(value => value.address)).toEqual(['reply@example.test']);
    expect(replyAll.cc.map(value => value.address)).toEqual(['colleague@example.test']);

    const forward = await service.createForwardDraft(message.id, [{ address: 'forward@example.test' }]);
    expect(forward.attachmentIds).toEqual(['attachment-1']);
    const bccDraft = await service.createDraft({ accountId: ACCOUNT_ID, to: [{ address: 'recipient@example.test' }], bcc: [{ address: 'hidden@example.test' }], subject: 'Private recipient', bodyText: 'Body' });
    provider.setOnline(false);
    const queued = await service.sendDraft(bccDraft.id, true);
    const serialized = JSON.stringify(await service.drafts(ACCOUNT_ID));
    expect(serialized).toContain('hidden@example.test');
    expect(queued.state).toBe('QUEUED');
    await service.close();
  });

  it('applies local mutations immediately and bounds provider retry state', async () => {
    let now = FIXED_NOW;
    const provider = new ControlledMailProvider('controlled', ACCOUNT_ID);
    provider.addMessage(providerMessage());
    const service = controlledService(provider, undefined, () => now);
    await addControlledAccount(service);
    await service.sync(ACCOUNT_ID);
    const message = service.listMessages({ accountId: ACCOUNT_ID }).items[0]!;

    provider.setOnline(false);
    const local = await service.setStarred(message.id, true);
    expect(local.message.flags).toContain('STARRED');
    expect(local.queued).toBe(true);
    provider.setOnline(true);
    now += 2_000;
    expect(await service.processMutations(ACCOUNT_ID)).toHaveLength(0);
    expect(service.requireMessage(message.id).flags).toContain('STARRED');
    const trash = service.folders(ACCOUNT_ID).find(value => value.role === 'TRASH')!;
    const moved = await service.moveMessage(message.id, trash.id);
    expect(moved.message.folderId).toBe(trash.id);
    await service.close();
  });

  it('resolves forwarded attachment bytes only for the owning account and serializes multipart/mixed', async () => {
    const provider = new ControlledMailProvider('controlled', ACCOUNT_ID);
    provider.addMessage(providerMessage());
    const service = controlledService(provider);
    await addControlledAccount(service);
    await service.sync(ACCOUNT_ID);
    const message = service.listMessages({ accountId: ACCOUNT_ID }).items[0]!;
    const draft = await service.createForwardDraft(message.id, [{ address: 'forward@example.test' }]);

    const sent = await service.sendDraft(draft.id, true);
    const input = provider.listSentInputs()[0]!;
    expect(sent.state).toBe('SENT');
    expect(input.attachmentPayloads).toHaveLength(1);
    expect(input.serialized).toContain('Content-Type: multipart/mixed;');
    expect(input.serialized).toContain('filename="notes.txt"');
    expect(input.serialized).toContain('Content-Transfer-Encoding: base64');
    await service.close();
  });

  it('uses the scoped credential boundary for IMAP/SMTP and never persists the provider secret', async () => {
    const credentials = new ControlledMailCredentialBoundary();
    const observed: string[] = [];
    const folders: MailFolder[] = [{ id: 'imap-account:inbox', accountId: 'imap-account', name: 'Inbox', path: 'INBOX', role: 'INBOX', selectable: true }];
    const emptyDelta = { folders, messages: [], nextState: { version: 1 as const, folders: {}, baselineEstablished: true }, complete: true, baseline: true };
    const imap: MailImapSession = {
      async authenticate(_username, secret) { observed.push(`imap:${secret}`); },
      async listFolders() { return folders; },
      async sync() { return emptyDelta; },
      async fetchMessage() { throw new Error('not used'); },
      async fetchAttachment() { return new Uint8Array(); },
      async mutate(_operation: MailPendingMutation) { return { applied: true }; },
      async close() {},
    };
    const smtp: MailSmtpSession = {
      async authenticate(_username, secret) { observed.push(`smtp:${secret}`); },
      async send(input): Promise<MailSendReceipt> { return { accepted: true, providerMessageId: input.messageId, acceptedAt: new Date(FIXED_NOW).toISOString() }; },
      async close() {},
    };
    const adapter = new ImapSmtpMailAdapter({ async connect() { return imap; } }, { async connect() { return smtp; } }, 'fake-imap-smtp');
    const store = new InMemoryMailStateStore();
    const service = new MailService({ store, adapters: [adapter], credentials, now: () => FIXED_NOW });
    const accountId = 'imap-account';
    const credential = credentials.register('test-handle', 'provider-secret', accountId, 'APP_PASSWORD');
    await service.addAccount({
      id: accountId,
      label: 'IMAP test',
      address: { address: 'imap-owner@example.test' },
      credential,
      provider: {
        kind: 'IMAP_SMTP',
        adapterId: 'fake-imap-smtp',
        imap: { endpoint: { hostname: 'imap.example.test', port: 993, security: 'TLS' }, username: 'imap-owner' },
        smtp: { endpoint: { hostname: 'smtp.example.test', port: 465, security: 'TLS' }, username: 'imap-owner' },
      },
    });
    expect(await service.testAccount(accountId)).toMatchObject({ ok: true });
    expect(JSON.stringify(await store.read())).not.toContain('provider-secret');
    expect(observed).toEqual(['imap:provider-secret']);
    await service.close();
  });

  it('rejects private provider endpoints without an explicit owner decision', async () => {
    const service = new MailService({ adapters: [] });
    const input = {
      id: 'private-account',
      label: 'Private mail',
      address: { address: 'private-owner@example.test' },
      provider: {
        kind: 'IMAP_SMTP' as const,
        imap: { endpoint: { hostname: '127.0.0.1', port: 993, security: 'TLS' as const, allowPrivateNetwork: true }, username: 'owner' },
        smtp: { endpoint: { hostname: '127.0.0.1', port: 465, security: 'TLS' as const, allowPrivateNetwork: true }, username: 'owner' },
        adapterId: 'missing',
      },
    };
    await expect(service.addAccount({ ...input, credential: { kind: 'MAIL_CREDENTIAL_REFERENCE', handleId: 'h', secretClass: 'PROVIDER_CREDENTIAL', auth: 'PASSWORD', accountId: 'private-account', createdAt: new Date(FIXED_NOW).toISOString() } })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await service.close();
  });
});

describe('R0P83 MIME and hostile content safety', () => {
  it('parses bounded MIME parts and sanitizes active content without network access', () => {
    const parsed = parseMailMime([
      'Content-Type: multipart/alternative; boundary="r0p83"',
      '',
      '--r0p83',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain body',
      '--r0p83',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML body</p>',
      '--r0p83--',
      '',
    ].join('\r\n'));
    expect(parsed.children).toHaveLength(2);
    expect(parsed.children[1]?.contentType).toBe('text/html');

    const sanitized = sanitizeMailHtml('<script>fetch("https://bad.test")</script><img src="https://tracking.test/pixel" onerror="alert(1)"/><a href="javascript:alert(1)">bad</a><a href="https://safe.test">safe</a>');
    expect(sanitized.html).not.toMatch(/script|onerror|javascript:/i);
    expect(sanitized.html).toContain('data-mail-external-image="blocked"');
    expect(sanitized.externalImageUrls).toEqual(['https://tracking.test/pixel']);
    expect(sanitized.links).toEqual([{ url: 'https://safe.test', label: 'safe' }]);
  });

  it('fails closed on MIME resource bounds', () => {
    expect(() => parseMailMime('Content-Type: text/plain\r\n\r\nbody', { maxBytes: 4 })).toThrowError(MailError);
    expect(() => parseMailMime('Content-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: multipart/mixed; boundary="y"\r\n\r\n--y--\r\n--x--', { maxDepth: 0 })).toThrowError(MailError);
  });
});
