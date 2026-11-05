import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

  // Frozen v1 behaviour, including its known quirks (see docs/testing/protocol-compatibility.md).
  // Key order is the ICU 'en' collation, not UTF-16 code-unit order.
  const v1Vectors: ReadonlyArray<readonly [string, unknown, string]> = [
    ['case and digit keys', { b: 1, B: 2, a: 3, A: 4, _x: 5, '1': 6, '10': 7, '2': 8 }, '{"_x":5,"1":6,"10":7,"2":8,"a":3,"A":4,"b":1,"B":2}'],
    ['non-ASCII keys', { 'é': 1, e: 2, z: 3, 'ё': 4, 'я': 5 }, '{"e":2,"é":1,"z":3,"ё":4,"я":5}'],
    ['numbers', [0, -0, 1.5, 1e21, 1e-7, Number.NaN], '[0,0,1.5,1e+21,1e-7,null]'],
    ['strings', ['\u2028', '\ud800', 'a\u0000b', 'ü'], '["\u2028","\\ud800","a\\u0000b","ü"]'],
    ['undefined property', { a: 1, b: undefined }, '{"a":1,"b":undefined}'],
  ];
  for (const [name, value, expected] of v1Vectors) {
    it(`keeps the v1 vector stable: ${name}`, () => { expect(canonicalJson(value)).toBe(expected); });
  }

  it('produces identical bytes under different OS locales in separate processes', () => {
    const module = fileURLToPath(new URL('./crypto.ts', import.meta.url));
    const script = `const { canonicalJson } = await import(${JSON.stringify(module)}); process.stdout.write(canonicalJson(${JSON.stringify({ byKind: 1, busy: 2, size: 3, six: 4, zone: 5, aa: 6, ab: 7, Z: 8, i: 9, y: 10 })}));`;
    const outputs = ['C', 'ru_RU.UTF-8', 'lt_LT.UTF-8', 'da_DK.UTF-8', 'et_EE.UTF-8', 'tr_TR.UTF-8'].map(locale => execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], { env: { ...process.env, LANG: locale, LC_ALL: locale }, encoding: 'utf8' }));
    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toBe('{"aa":6,"ab":7,"busy":2,"byKind":1,"i":9,"six":4,"size":3,"y":10,"Z":8,"zone":5}');
  });

  it('documents the v1 JSON-transport divergence for undefined properties', () => {
    // A signer that keeps `undefined` and a verifier that receives the object over JSON hash different bytes.
    const signed = { id: 'video:1', payload: { title: 'x', thumbnailUri: undefined } };
    expect(canonicalJson(JSON.parse(JSON.stringify(signed)))).not.toBe(canonicalJson(signed));
  });

  it('keeps the v1 BLAKE2b-256 action-hash vector stable', async () => {
    expect(await new SodiumCryptoProvider().hash('keystone-protocol-vector-v1')).toBe('qsLdmG5p8eQS37eIS2iJ_grZoNbD-zJgjusETKQHcrE');
  });
});
