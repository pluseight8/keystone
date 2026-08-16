import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import type { NodeId } from '../types.js';
import { ContactEnvelopeSecurity, DirectMessageService, InMemorySocialStorage, SodiumDirectMessageCipher, type SocialContact } from './messaging.js';
import { InMemoryEncryptedSocialStateStore, PersistentSocialStorage } from './storage.js';
import { contentUri, createContentManifest } from './content.js';

class LinkedTransport implements Transport {
  private readonly handlers = new Set<(value: Envelope) => void>(); peer?: LinkedTransport; online = true; sent: Envelope[] = [];
  async connect(_peer: NodeId) { if (!this.online || !this.peer?.online) throw new Error('offline'); }
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope) { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; this.sent.push(structuredClone(envelope)); if (!this.online || !this.peer?.online) throw new Error('offline'); this.peer.handlers.forEach(handler => handler(structuredClone(envelope))); }
  deliver(envelope: Envelope) { this.handlers.forEach(handler => handler(structuredClone(envelope))); }
  onMessage(handler: (value: Envelope) => void) { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(_peer: NodeId) { return this.online && !!this.peer?.online; }
  async close() { this.handlers.clear(); }
}
async function fixture() {
  const a = await (await IdentityManager.generate()).sessionKeys('alice'); const b = await (await IdentityManager.generate()).sessionKeys('bob');
  const aContact: SocialContact = { nodeId: b.nodeId, signingPublicKey: b.publicKey, encryptionPublicKey: b.encryptionPublicKey };
  const bContact: SocialContact = { nodeId: a.nodeId, signingPublicKey: a.publicKey, encryptionPublicKey: a.encryptionPublicKey };
  const aTransport = new LinkedTransport(), bTransport = new LinkedTransport(); aTransport.peer = bTransport; bTransport.peer = aTransport;
  const crypto = new SodiumCryptoProvider(), cipher = new SodiumDirectMessageCipher();
  const aStore = new InMemorySocialStorage(), bStore = new InMemorySocialStorage();
  return { a, b, aTransport, bTransport, aStore, bStore, alice: new DirectMessageService(aTransport, aStore, crypto, a, [aContact], new ContactEnvelopeSecurity(a, [aContact]), cipher), bob: new DirectMessageService(bTransport, bStore, crypto, b, [bContact], new ContactEnvelopeSecurity(b, [bContact]), cipher) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

describe('DirectMessageService', () => {
  it('persists an encrypted signed message, queues offline work, and deduplicates replay', async () => {
    const { alice, bob, a, b, aTransport, aStore, bStore } = await fixture(); aTransport.peer!.online = false;
    const sent = await alice.sendText(b.nodeId, 'offline hello'); const conversation = await alice.createConversation(b.nodeId); expect((await aStore.pending(b.nodeId)).length).toBe(1); expect((await bStore.messages(conversation.id)).length).toBe(0);
    aTransport.peer!.online = true; await alice.flush(b.nodeId); await tick(); expect((await bob.history(conversation.id)).map(message => message.id)).toEqual([sent.id]);
    const wire = aTransport.sent.find(envelope => envelope.type === 'social.message')!; (aTransport.peer as LinkedTransport).deliver(wire); await tick(); expect((await bob.history(conversation.id)).length).toBe(1);
  });
  it('rejects a malformed or signature-tampered remote envelope', async () => {
    const { alice, bob, b, aTransport } = await fixture(); const message = await alice.sendText(b.nodeId, 'signed'); await tick(); const good = aTransport.sent.find(envelope => envelope.type === 'social.message')!; const bad = { ...good, signature: 'invalid', nonce: 'another-nonce' }; (aTransport.peer as LinkedTransport).deliver(bad); await tick(); const conversation = await alice.createConversation(b.nodeId); expect((await bob.history(conversation.id)).map(value => value.id)).toEqual([message.id]);
  });
  it('creates immutable reaction, edit, and tombstone revisions', async () => {
    const { alice, b } = await fixture(); const original = await alice.sendText(b.nodeId, 'first'); const edited = await alice.editText(b.nodeId, original.id, 'second'); const reaction = await alice.react(b.nodeId, original.id, '👍'); const deleted = await alice.deleteMessage(b.nodeId, edited.id);
    expect(edited.supersedes).toBe(original.id); expect(edited.payload.kind === 'text' && edited.payload.text).toBe('second'); expect(reaction.payload.kind === 'reaction' && reaction.payload.targetMessageId).toBe(original.id); expect(deleted.deleted).toBe(true); expect(deleted.supersedes).toBe(edited.id);
  });
  it('restores outbox and history through the durable storage boundary', async () => {
    const backend = new InMemoryEncryptedSocialStateStore(), first = new PersistentSocialStorage(backend); const { b } = await fixture(); const message = { version: 1 as const, type: 'message' as const, id: crypto.randomUUID(), author: b.nodeId, createdAt: new Date().toISOString(), visibility: 'private' as const, references: [], payload: { conversationId: 'f'.repeat(64), kind: 'text' as const, text: 'kept', logicalClock: 1, attachments: [] }, signature: 's'.repeat(32) };
    await first.upsertMessage(message); const restarted = new PersistentSocialStorage(backend); expect((await restarted.messages(message.payload.conversationId))[0]?.payload).toEqual(message.payload);
  });
  it('sends only a signed content reference rather than attachment bytes in an envelope', async () => {
    const { alice, bob, b, aTransport } = await fixture(); const source = Uint8Array.from({ length: 20_000 }, (_, index) => index % 251); const manifest = await createContentManifest(source, { mimeType: 'image/png', name: 'image.png', chunkSize: 16 * 1024 }); const attachment = { contentUri: contentUri(manifest.contentId), name: 'image.png', mimeType: 'image/png', size: source.length }; const message = await alice.sendAttachments(b.nodeId, [attachment]); await tick(); const conversation = await alice.createConversation(b.nodeId); const received = await bob.history(conversation.id); expect(received[0]?.payload.kind).toBe('attachment'); expect(JSON.stringify(aTransport.sent.find(envelope => envelope.type === 'social.message'))).not.toContain(attachment.contentUri); expect(message.payload.kind).toBe('attachment');
  });
});
