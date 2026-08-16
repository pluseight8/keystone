import { describe, expect, it } from 'vitest';
import { KEYSTONE_OBJECT_VERSION, parseKeystoneObject } from './object-model.js';

describe('Keystone object model', () => {
  const object = { version: KEYSTONE_OBJECT_VERSION, type: 'identity.profile' as const, id: crypto.randomUUID(), author: 'a'.repeat(43), createdAt: new Date().toISOString(), visibility: 'public' as const, references: [], payload: { displayName: 'Alice' }, signature: 's'.repeat(32) };
  it('accepts a signed versioned object and rejects unknown fields', () => {
    expect(parseKeystoneObject(object).type).toBe('identity.profile'); expect(() => parseKeystoneObject({ ...object, attackerControlled: true })).toThrow();
  });
  it('rejects unsupported versions and invalid stable IDs', () => {
    expect(() => parseKeystoneObject({ ...object, version: 2 })).toThrow(); expect(() => parseKeystoneObject({ ...object, id: 'mutable-42' })).toThrow();
  });
});
