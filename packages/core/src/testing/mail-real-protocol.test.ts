import { describe, expect, it } from 'vitest';
import {
  ControlledMailCredentialBoundary,
  ImapSmtpMailAdapter,
  InMemoryMailStateStore,
  MailService,
  type MailFolder,
  type MailImapSession,
  type MailImapSessionFactory,
  type MailPendingMutation,
  type MailProviderMessage,
  type MailSendInput,
  type MailSmtpSession,
  type MailSmtpSessionFactory,
  type MailSyncDelta,
  type MailSyncState,
} from '../mail.js';

const accountId = 'protocol-account';
const folders: readonly MailFolder[] = [
  { id: `${accountId}:inbox`, accountId, name: 'Inbox', path: 'INBOX', role: 'INBOX', selectable: true, providerUidValidity: 'fixture-1' },
  { id: `${accountId}:sent`, accountId, name: 'Sent', path: 'Sent', role: 'SENT', selectable: true, providerUidValidity: 'fixture-1' },
  { id: `${accountId}:trash`, accountId, name: 'Trash', path: 'Trash', role: 'TRASH', selectable: true, providerUidValidity: 'fixture-1' },
];

/**
 * A local standards-shaped fixture. It runs the IMAP/SMTP command semantics
 * through independent session objects and records a redacted transcript; it
 * deliberately does not claim to be an Internet provider or require secrets.
 */
class LocalProtocolFixture {
  readonly transcript: string[] = [];
  readonly sent: MailSendInput[] = [];
  private readonly message: MailProviderMessage = {
    providerMessageId: 'fixture-message-1',
    folderId: `${accountId}:inbox`,
    providerUid: 1,
    providerUidValidity: 'fixture-1',
    messageId: '<fixture-message-1@example.test>',
    from: { name: 'Fixture Sender', address: 'sender@example.test' },
    to: [{ address: 'fixture-owner@example.test' }],
    subject: 'Local protocol proof',
    bodyText: 'A bounded message from the local fixture.',
    snippet: 'A bounded message from the local fixture.',
    flags: [],
    receivedAt: '2026-08-25T10:00:00.000Z',
    attachments: [{ id: 'fixture-attachment', filename: 'fixture.txt', mimeType: 'text/plain', sizeBytes: 32, disposition: 'ATTACHMENT', contentAvailable: false, privateByDefault: true }],
  };

  imapFactory(): MailImapSessionFactory {
    return { connect: async endpoint => { this.transcript.push(`IMAP CONNECT ${endpoint.hostname}:${endpoint.port} ${endpoint.security}`); return new FixtureImapSession(this); } };
  }

  smtpFactory(): MailSmtpSessionFactory {
    return { connect: async endpoint => { this.transcript.push(`SMTP CONNECT ${endpoint.hostname}:${endpoint.port} ${endpoint.security}`); return new FixtureSmtpSession(this); } };
  }

  authenticateImap(username: string): void { this.transcript.push(`C: A001 LOGIN ${username} <secret-redacted>`); }
  authenticateSmtp(username: string): void { this.transcript.push(`C: AUTH username=${username} secret=<secret-redacted>`); }
  list(): readonly MailFolder[] { this.transcript.push('C: A002 LIST "" "*"'); return folders; }
  sync(state: MailSyncState): MailSyncDelta { this.transcript.push(`C: A003 UID FETCH 1:* (FLAGS ENVELOPE BODY.PEEK[] UIDVALIDITY) state=${state.baselineEstablished ? 'incremental' : 'baseline'}`); return { folders, messages: [this.message], nextState: { version: 1, folders: Object.fromEntries(folders.map(folder => [folder.id, { folderId: folder.id, uidValidity: 'fixture-1', highestUid: folder.role === 'INBOX' ? 1 : 0, baselineEstablished: true }])), lastSuccessfulSync: '2026-08-25T10:00:00.000Z', baselineEstablished: true }, complete: true, baseline: !state.baselineEstablished }; }
  mutate(operation: MailPendingMutation): { readonly applied: true; readonly flags?: readonly ['SEEN'] } { this.transcript.push(operation.kind === 'MARK_READ' ? 'C: A004 UID STORE 1 +FLAGS (\\Seen)' : `C: A004 UID mutation ${operation.kind}`); return { applied: true, ...(operation.kind === 'MARK_READ' ? { flags: ['SEEN'] as const } : {}) }; }
  send(input: MailSendInput): void { this.transcript.push(`C: MAIL FROM <${input.from.address}>`); for (const recipient of [...input.to, ...input.cc, ...input.bcc]) this.transcript.push(`C: RCPT TO <${recipient.address}>`); this.transcript.push(`C: DATA Message-ID ${input.messageId}`); this.sent.push(input); }
}

class FixtureImapSession implements MailImapSession {
  constructor(private readonly fixture: LocalProtocolFixture) {}
  async authenticate(username: string, _secret: string): Promise<void> { this.fixture.authenticateImap(username); }
  async listFolders(): Promise<readonly MailFolder[]> { return this.fixture.list(); }
  async sync(state: MailSyncState): Promise<MailSyncDelta> { return this.fixture.sync(state); }
  async fetchMessage(): Promise<MailProviderMessage> { return this.fixture.sync({ version: 1, folders: {}, baselineEstablished: true }).messages[0]!; }
  async fetchAttachment(): Promise<Uint8Array> { return new TextEncoder().encode('fixture attachment'); }
  async mutate(operation: MailPendingMutation): Promise<{ readonly applied: boolean; readonly flags?: readonly ['SEEN'] }> { return this.fixture.mutate(operation); }
  async close(): Promise<void> { this.fixture.transcript.push('IMAP CLOSE'); }
}

class FixtureSmtpSession implements MailSmtpSession {
  constructor(private readonly fixture: LocalProtocolFixture) {}
  async authenticate(username: string, _secret: string): Promise<void> { this.fixture.authenticateSmtp(username); }
  async send(input: MailSendInput): Promise<{ readonly accepted: true; readonly providerMessageId: string; readonly acceptedAt: string }> { this.fixture.send(input); return { accepted: true, providerMessageId: input.messageId, acceptedAt: '2026-08-25T10:00:01.000Z' }; }
  async close(): Promise<void> { this.fixture.transcript.push('SMTP CLOSE'); }
}

describe('R0P83 local IMAP/SMTP protocol proof', () => {
  it('runs independent IMAP receive/mutation and SMTP submission paths with redacted credentials', async () => {
    const fixture = new LocalProtocolFixture();
    const credentials = new ControlledMailCredentialBoundary();
    const adapter = new ImapSmtpMailAdapter(fixture.imapFactory(), fixture.smtpFactory(), 'local-protocol');
    const service = new MailService({ store: new InMemoryMailStateStore(), adapters: [adapter], credentials, now: () => Date.parse('2026-08-25T10:00:00.000Z') });
    const credential = credentials.register('local-protocol-handle', 'protocol-secret', accountId, 'APP_PASSWORD');
    await service.addAccount({
      id: accountId,
      label: 'Local protocol mailbox',
      address: { address: 'fixture-owner@example.test' },
      credential,
      provider: {
        kind: 'IMAP_SMTP',
        adapterId: 'local-protocol',
        imap: { endpoint: { hostname: 'imap.example.test', port: 993, security: 'TLS' }, username: 'fixture-owner' },
        smtp: { endpoint: { hostname: 'smtp.example.test', port: 465, security: 'TLS' }, username: 'fixture-owner' },
      },
    });

    expect((await service.testAccount(accountId)).folders).toHaveLength(3);
    const sync = await service.sync(accountId);
    expect(sync.addedMessageIds).toHaveLength(1);
    const message = service.listMessages({ accountId }).items[0]!;
    await service.markRead(message.id, true);
    const draft = await service.createDraft({ accountId, to: [{ address: 'recipient@example.test' }], bcc: [{ address: 'hidden@example.test' }], subject: 'Protocol send', bodyText: 'Submitted through SMTP.', attachmentIds: ['fixture-attachment'] });
    const sent = await service.sendDraft(draft.id, true);
    expect(sent.state).toBe('SENT');
    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]!.serialized).not.toMatch(/^Bcc:/m);
    expect(fixture.sent[0]!.attachmentPayloads).toHaveLength(1);
    expect(fixture.sent[0]!.serialized).toContain('Content-Type: multipart/mixed;');
    expect(fixture.transcript).toEqual(expect.arrayContaining([
      'IMAP CONNECT imap.example.test:993 TLS',
      'C: A001 LOGIN fixture-owner <secret-redacted>',
      'C: A002 LIST "" "*"',
      'C: A003 UID FETCH 1:* (FLAGS ENVELOPE BODY.PEEK[] UIDVALIDITY) state=baseline',
      'C: A004 UID STORE 1 +FLAGS (\\Seen)',
      'SMTP CONNECT smtp.example.test:465 TLS',
      'C: AUTH username=fixture-owner secret=<secret-redacted>',
    ]));
    expect(fixture.transcript.some(value => value.startsWith('C: DATA Message-ID '))).toBe(true);
    expect(fixture.transcript.join('\n')).not.toContain('protocol-secret');
    await service.close();
  }, 180_000);
});
