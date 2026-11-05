import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from './crypto.js';

describe('protocol crypto vectors', () => {
  it('keeps the v1 canonical JSON vector stable across insertion order', () => {
    const vector = { z: [3, { beta: false, alpha: 'keystone' }], a: { y: null, x: 1 } };
    expect(canonicalJson(vector)).toBe('{"a":{"x":1,"y":null},"z":[3,{"alpha":"keystone","beta":false}]}');
  });

  it('orders keys independently of the OS locale', () => {
    // Under a Lithuanian default collation `y` sorts like `i`, so an unpinned sort puts `byKind` first.
    expect(canonicalJson({ byKind: 1, busy: 2 })).toBe('{"busy":2,"byKind":1}');
  });

  it('keeps the v1 BLAKE2b-256 action-hash vector stable', async () => {
    expect(await new SodiumCryptoProvider().hash('keystone-protocol-vector-v1')).toBe('qsLdmG5p8eQS37eIS2iJ_grZoNbD-zJgjusETKQHcrE');
  });
});
