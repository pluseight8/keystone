export interface CryptoProvider { hash(value: string): Promise<string>; sign(value: string, privateKey: string): Promise<string>; verify(value: string, signature: string, publicKey: string): Promise<boolean>; randomNonce(): Promise<string>; }
export interface SodiumKeyPair { publicKey: string; privateKey: string; }
/** libsodium-backed provider. Keys and signatures are base64 encoded at the API boundary. */
export class SodiumCryptoProvider implements CryptoProvider {
  private ready: Promise<any>;
  constructor() { this.ready = import('libsodium-wrappers').then(async ({ default: sodium }) => { await sodium.ready; return sodium; }); }
  async generateIdentity(): Promise<SodiumKeyPair> { const sodium = await this.ready; const pair = sodium.crypto_sign_keypair(); return { publicKey: sodium.to_base64(pair.publicKey), privateKey: sodium.to_base64(pair.privateKey) }; }
  async hash(value: string): Promise<string> { const sodium = await this.ready; return sodium.to_base64(sodium.crypto_generichash(32, sodium.from_string(value))); }
  async actionHash(action: unknown): Promise<string> { return this.hash(canonicalJson(action)); }
  async sign(value: string, privateKey: string): Promise<string> { const sodium = await this.ready; return sodium.to_base64(sodium.crypto_sign_detached(sodium.from_string(value), sodium.from_base64(privateKey))); }
  async verify(value: string, signature: string, publicKey: string): Promise<boolean> { const sodium = await this.ready; try { return sodium.crypto_sign_verify_detached(sodium.from_base64(signature), sodium.from_string(value), sodium.from_base64(publicKey)); } catch { return false; } }
  async randomNonce(): Promise<string> { const sodium = await this.ready; return sodium.to_base64(sodium.randombytes_buf(24), sodium.base64_variants.URLSAFE_NO_PADDING); }
}
// Key order is pinned to the 'en' collation: the process default follows the OS locale
// (e.g. lt-LT orders `byKind` before `busy`), which would change signed bytes per device.
// 'en' matches the ordering already used for existing en/ru signatures.
export function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`; }

/** Marks a signature made over canonical JSON v2. Signatures without it cover canonical JSON v1. */
export const CANONICAL_V2_SIGNATURE_PREFIX = 'c2.';

/**
 * Canonical JSON v2: RFC 8785 (JCS). Keys are ordered by UTF-16 code unit, `undefined`
 * properties are omitted as JSON transport omits them, and values JSON cannot carry throw
 * instead of being silently rewritten. Use it for new signatures only: hashes and ids that
 * are already stored or shared keep `canonicalJson` (v1).
 */
export function canonicalJsonV2(value: unknown): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') { assertWellFormed(value); return JSON.stringify(value); }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot represent a non-finite number'); return JSON.stringify(value); }
  if (typeof value !== 'object') throw new TypeError(`Canonical JSON cannot represent ${typeof value}`);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJsonV2).join(',')}]`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Canonical JSON accepts plain objects only');
  return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => { assertWellFormed(key); return `${JSON.stringify(key)}:${canonicalJsonV2((value as Record<string, unknown>)[key])}`; }).join(',')}}`;
}

function assertWellFormed(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    const next = text.charCodeAt(index + 1);
    if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) { index += 1; continue; }
    throw new TypeError('Canonical JSON cannot represent a lone surrogate');
  }
}

/** The exact bytes `signature` covers and the raw signature to check them with: v2 when marked, v1 otherwise. */
export function canonicalSigned(value: unknown, signature: string): { readonly bytes: string; readonly signature: string } {
  return signature.startsWith(CANONICAL_V2_SIGNATURE_PREFIX) ? { bytes: canonicalJsonV2(value), signature: signature.slice(CANONICAL_V2_SIGNATURE_PREFIX.length) } : { bytes: canonicalJson(value), signature };
}

/** Sign `value` over canonical JSON v2 and mark the signature so every verifier picks the same bytes. */
export async function signCanonical(value: unknown, sign: (bytes: string) => Promise<string> | string): Promise<string> {
  return CANONICAL_V2_SIGNATURE_PREFIX + await sign(canonicalJsonV2(value));
}

/** Verify a v2 (marked) or v1 (unmarked, signed before v2) signature. A value v2 cannot represent is rejected. */
export async function verifyCanonical(value: unknown, signature: unknown, verify: (bytes: string, signature: string) => Promise<boolean> | boolean): Promise<boolean> {
  if (typeof signature !== 'string') return false;
  let signed: { readonly bytes: string; readonly signature: string };
  try { signed = canonicalSigned(value, signature); } catch { return false; }
  return Boolean(await verify(signed.bytes, signed.signature));
}
