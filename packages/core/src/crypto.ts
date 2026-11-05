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
