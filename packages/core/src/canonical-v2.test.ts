import { describe, expect, it } from 'vitest';
import { CANONICAL_V2_SIGNATURE_PREFIX, SodiumCryptoProvider, canonicalJson, canonicalJsonV2, signCanonical, verifyCanonical } from './crypto.js';

describe('canonical JSON v2 (RFC 8785)', () => {
  it('matches the RFC 8785 key-ordering and number vectors', () => {
    const c = (...units: number[]) => String.fromCharCode(...units);
    // RFC 8785 section 3.2.3: keys ordered by UTF-16 code unit, so the emoji (a surrogate pair) sorts before U+FB33.
    const keys = [c(0x20ac), c(0x0d), c(0xfb33), '1', c(0xd83d, 0xde00), c(0x80), c(0xf6)];
    const text = canonicalJsonV2(Object.fromEntries(keys.map((key, index) => [key, index])));
    const order = [c(0x0d), '1', c(0x80), c(0xf6), c(0x20ac), c(0xd83d, 0xde00), c(0xfb33)].map(key => text.indexOf(`${JSON.stringify(key)}:`));
    expect(order).toEqual([...order].sort((a, b) => a - b)); expect(order[0]).toBe(1);
    // RFC 8785 section 3.2.2: number and string serialization.
    const backslash = c(0x5c);
    expect(canonicalJsonV2({ numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], string: c(0x20ac) + '$' + c(0x0f) + c(0x0a) + "A'B" + '"' + backslash + backslash + '"/', literals: [null, true, false] }))
      .toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"' + c(0x20ac) + '$' + backslash + 'u000f' + backslash + "nA'B" + backslash + '"' + backslash.repeat(4) + backslash + '"/"}');
    expect(canonicalJsonV2([-0, 'a', {}])).toBe('[0,"a",{}]');
  });

  it('orders camelCase keys differently from v1, which is why signatures carry a version', () => {
    const value = { contents: 1, contentType: 2 };
    expect(canonicalJson(value)).toBe('{"contents":1,"contentType":2}');
    expect(canonicalJsonV2(value)).toBe('{"contentType":2,"contents":1}');
  });

  it('omits undefined properties so the bytes survive JSON transport', () => {
    const value = { id: 'a', note: undefined };
    expect(canonicalJsonV2(value)).toBe('{"id":"a"}');
    expect(canonicalJsonV2(JSON.parse(JSON.stringify(value)))).toBe(canonicalJsonV2(value));
  });

  it('rejects values JSON cannot carry instead of rewriting them', () => {
    const lone = String.fromCharCode(0xd800); const low = String.fromCharCode(0xdc00);
    for (const value of [undefined, NaN, Infinity, 1n, () => 1, Symbol('s'), new Date(0), new Map(), new Uint8Array(1), [undefined], { nested: NaN }, `lone ${lone}`, { [low]: 1 }, low + lone])
      expect(() => canonicalJsonV2(value)).toThrow(TypeError);
  });
});

describe('versioned canonical signatures', () => {
  const crypto = new SodiumCryptoProvider();
  const value = { contents: ['x'], contentType: 'note', note: undefined };

  it('signs with v2, marks the signature and verifies it after JSON transport', async () => {
    const keys = await crypto.generateIdentity();
    const signature = await signCanonical(value, bytes => crypto.sign(bytes, keys.privateKey));
    expect(signature.startsWith(CANONICAL_V2_SIGNATURE_PREFIX)).toBe(true);
    const received = JSON.parse(JSON.stringify(value));
    expect(await verifyCanonical(received, signature, (bytes, raw) => crypto.verify(bytes, raw, keys.publicKey))).toBe(true);
    expect(await verifyCanonical({ ...received, contentType: 'task' }, signature, (bytes, raw) => crypto.verify(bytes, raw, keys.publicKey))).toBe(false);
  });

  it('still verifies an unmarked v1 signature made before v2', async () => {
    const keys = await crypto.generateIdentity();
    const stored = { contents: ['x'], contentType: 'note' };
    const v1 = await crypto.sign(canonicalJson(stored), keys.privateKey);
    expect(await verifyCanonical(stored, v1, (bytes, raw) => crypto.verify(bytes, raw, keys.publicKey))).toBe(true);
  });

  it('does not let the marker be moved between versions', async () => {
    const keys = await crypto.generateIdentity();
    const verify = (bytes: string, raw: string) => crypto.verify(bytes, raw, keys.publicKey);
    const v2 = await signCanonical(value, bytes => crypto.sign(bytes, keys.privateKey));
    const v1 = await crypto.sign(canonicalJson({ contents: ['x'], contentType: 'note' }), keys.privateKey);
    expect(await verifyCanonical(value, v2.slice(CANONICAL_V2_SIGNATURE_PREFIX.length), verify)).toBe(false);
    expect(await verifyCanonical(value, CANONICAL_V2_SIGNATURE_PREFIX + v1, verify)).toBe(false);
  });

  it('rejects, rather than throws on, a missing signature or an unrepresentable value', async () => {
    expect(await verifyCanonical(value, undefined, () => true)).toBe(false);
    expect(await verifyCanonical({ at: new Date(0) }, `${CANONICAL_V2_SIGNATURE_PREFIX}x`, () => true)).toBe(false);
  });
});
