import { describe, expect, it } from 'vitest';
import sodium from 'libsodium-wrappers';
import { CANONICAL_V2_SIGNATURE_PREFIX, canonicalJson } from './crypto.js';
import { IdentityManager } from './identity.js';
import { protocolSignedPayload } from './security/protocol-security.js';
import { ContactEnvelopeSecurity } from './social/messaging.js';
import type { Envelope } from './transport.js';

/** What a client from before canonical JSON v2 put on the wire: an unmarked signature over v1 bytes. */
async function signLikeV1Client(unsigned: Omit<Envelope, 'signature'>, privateKey: string): Promise<string> {
  await sodium.ready;
  const variant = sodium.base64_variants.URLSAFE_NO_PADDING;
  return sodium.to_base64(sodium.crypto_sign_detached(sodium.from_string(protocolSignedPayload(unsigned.type, unsigned)), sodium.from_base64(privateKey, variant)), variant);
}

describe('mixed protocol versions: canonical JSON v1 and v2 peers', () => {
  const unsignedFrom = (sender: string, recipient: string): Omit<Envelope, 'signature'> => ({ version: 1, type: 'keystone.test.note', id: crypto.randomUUID(), sender, recipient, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { contents: ['x'], contentType: 'note' } });

  async function pair() {
    const alice = await (await IdentityManager.generate()).sessionKeys('alice');
    const bob = await (await IdentityManager.generate()).sessionKeys('bob');
    const contact = (keys: typeof alice) => ({ nodeId: keys.nodeId, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey });
    return { alice, bob, aliceSecurity: new ContactEnvelopeSecurity(alice, [contact(bob)]), bobSecurity: new ContactEnvelopeSecurity(bob, [contact(alice)]) };
  }

  it('a current peer accepts an envelope signed by a v1-only peer', async () => {
    const { alice, bob, bobSecurity } = await pair();
    const unsigned = unsignedFrom(alice.nodeId, bob.nodeId);
    // The body is chosen so v1 and v2 order its keys differently: the bytes really differ.
    expect(canonicalJson(unsigned.body)).not.toBe(JSON.stringify({ contentType: 'note', contents: ['x'] }));
    const signature = await signLikeV1Client(unsigned, alice.privateKey);
    expect(signature.startsWith(CANONICAL_V2_SIGNATURE_PREFIX)).toBe(false);
    expect(await bobSecurity.verify({ ...unsigned, signature })).toBe(true);
    expect(await bobSecurity.verify({ ...unsigned, body: { contents: ['y'], contentType: 'note' }, signature })).toBe(false);
  });

  it('a current peer signs with v2 and another current peer accepts it after JSON transport', async () => {
    const { alice, bob, aliceSecurity, bobSecurity } = await pair();
    const unsigned = { ...unsignedFrom(alice.nodeId, bob.nodeId), body: { contents: ['x'], contentType: 'note', optional: undefined } };
    const signature = await aliceSecurity.sign(unsigned);
    expect(signature.startsWith(CANONICAL_V2_SIGNATURE_PREFIX)).toBe(true);
    const received = JSON.parse(JSON.stringify({ ...unsigned, signature })) as Envelope;
    expect(await bobSecurity.verify(received)).toBe(true);
  });

  it('a v1-only peer fails closed on a v2 signature instead of misreading it', async () => {
    const { alice, bob, aliceSecurity } = await pair();
    const unsigned = unsignedFrom(alice.nodeId, bob.nodeId);
    const signature = await aliceSecurity.sign(unsigned);
    await sodium.ready;
    const variant = sodium.base64_variants.URLSAFE_NO_PADDING;
    // A v1 client decodes the whole field as base64url; the marker makes that throw, which it treats as "invalid".
    expect(() => sodium.from_base64(signature, variant)).toThrow();
    // Even with the marker stripped by hand, the v2 bytes do not match what a v1 client computes.
    const raw = sodium.from_base64(signature.slice(CANONICAL_V2_SIGNATURE_PREFIX.length), variant);
    expect(sodium.crypto_sign_verify_detached(raw, sodium.from_string(protocolSignedPayload(unsigned.type, unsigned)), sodium.from_base64(alice.publicKey, variant))).toBe(false);
  });
});
