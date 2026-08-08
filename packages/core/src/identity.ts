import type { NodeId, Role } from './types.js';
import { canonicalJson } from './crypto.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from './transport.js';

export type MasterSeed = string & { readonly __brand: 'MasterSeed' };
export interface DeviceSessionKeys {
  deviceId: string;
  role: 'Self';
  nodeId: NodeId;
  publicKey: string;
  privateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
}
export interface AddDevicePayload { version: 1; seed: MasterSeed; deviceId?: string; }
export interface SelfSwarmCapability { version: 1; role: 'Self'; topic: Uint8Array; }

/** Own-device identity. The seed must be kept in platform secure storage; it is never logged. */
export class IdentityManager {
  private readonly ready = import('libsodium-wrappers').then(async ({ default: sodium }) => { await sodium.ready; return sodium; });
  private readonly seed: Uint8Array;
  constructor(masterSeed?: MasterSeed | string | Uint8Array) { this.seed = masterSeed instanceof Uint8Array ? copySeed(masterSeed) : masterSeed ? decodeSeed(masterSeed) : randomSeed(); }
  static fromMasterSeed(seed: MasterSeed | string | Uint8Array): IdentityManager { return new IdentityManager(seed); }
  static fromAddDeviceUri(uri: string): IdentityManager { return new IdentityManager(parseAddDevice(uri).seed); }
  static async generate(): Promise<IdentityManager> { const sodium = await loadSodium(); return new IdentityManager(encode(sodium.randombytes_buf(32)) as MasterSeed); }
  get masterSeed(): MasterSeed { return encode(this.seed) as MasterSeed; }
  async getSwarmTopic(): Promise<Uint8Array> { return this.swarmTopic(); }
  async swarmTopic(): Promise<Uint8Array> { const sodium = await this.ready; return sodium.crypto_generichash(32, sodium.from_string('keystone:self-swarm:v1'), this.seed); }
  async selfSwarmCapability(): Promise<SelfSwarmCapability> { return { version:1, role:'Self', topic:await this.swarmTopic() }; }
  async swarmTopicHex(): Promise<string> { return hex(await this.swarmTopic()); }
  async deriveSessionKeys(deviceId: string): Promise<DeviceSessionKeys> { return this.sessionKeys(deviceId); }
  async generateSessionKeys(deviceId: string): Promise<DeviceSessionKeys> { return this.sessionKeys(deviceId); }
  async sessionKeys(deviceId: string): Promise<DeviceSessionKeys> {
    if (!deviceId || deviceId.length > 128) throw new Error('Invalid device id');
    const sodium = await this.ready;
    const material = sodium.crypto_generichash(64, sodium.from_string(`keystone:device:v1:${deviceId}`), this.seed);
    const signing = sodium.crypto_sign_seed_keypair(material.subarray(0, 32));
    const encryption = sodium.crypto_box_seed_keypair(material.subarray(32, 64));
    const publicKey = encode(signing.publicKey); const privateKey = encode(signing.privateKey);
    return { deviceId, role: 'Self', nodeId: publicKey, publicKey, privateKey, encryptionPublicKey: encode(encryption.publicKey), encryptionPrivateKey: encode(encryption.privateKey) };
  }
  createAddDeviceUri(deviceId?: string): string {
    const payload: AddDevicePayload = { version: 1, seed: this.masterSeed, ...(deviceId ? { deviceId } : {}) };
    return `keystone://add-device?data=${encode(new TextEncoder().encode(JSON.stringify(payload)))}`;
  }
  async addDevice(uriOrData: string, deviceId?: string): Promise<DeviceSessionKeys> {
    const payload = parseAddDevice(uriOrData);
    const manager = new IdentityManager(payload.seed);
    return manager.sessionKeys(deviceId ?? payload.deviceId ?? crypto.randomUUID());
  }
  /** A topic is an authorization capability: only holders of the seed may derive it. */
  assertSelf(role: Role): asserts role is 'Self' { if (role !== 'Self') throw new Error('Only Self devices may join the private swarm'); }
}

/** Application-level authentication binding envelope.sender to a paired Self public key. */
export class SelfEnvelopeSecurity implements EnvelopeSecurity {
  private readonly ready = loadSodium(); private readonly trusted = new Map<NodeId, string>();
  constructor(private readonly local: DeviceSessionKeys, trustedPeers: Readonly<Record<NodeId, string>> = {}) { Object.entries(trustedPeers).forEach(([id, key]) => this.trusted.set(id, key)); this.trusted.set(local.nodeId, local.publicKey); }
  trust(peer: Pick<DeviceSessionKeys, 'nodeId' | 'publicKey'>): void { this.trusted.set(peer.nodeId, peer.publicKey); }
  async sign(envelope: UnsignedEnvelope): Promise<string> { if (envelope.sender !== this.local.nodeId) throw new Error('Cannot sign for another device'); const sodium = await this.ready; return encode(sodium.crypto_sign_detached(sodium.from_string(canonicalJson(envelope)), sodium.from_base64(this.local.privateKey, sodium.base64_variants.URLSAFE_NO_PADDING))); }
  async verify(envelope: Envelope): Promise<boolean> { const key = this.trusted.get(envelope.sender); if (!key || !envelope.signature) return false; const sodium = await this.ready; try { const { signature: _signature, ...unsigned } = envelope; return sodium.crypto_sign_verify_detached(sodium.from_base64(envelope.signature, sodium.base64_variants.URLSAFE_NO_PADDING), sodium.from_string(canonicalJson(unsigned)), sodium.from_base64(key, sodium.base64_variants.URLSAFE_NO_PADDING)); } catch { return false; } }
}

export function parseAddDevice(value: string): AddDevicePayload {
  const raw = value.startsWith('keystone://') ? new URL(value).searchParams.get('data') : value;
  if (!raw) throw new Error('Missing add-device data');
  let decoded: string;
  try { decoded = new TextDecoder().decode(decode(raw)); } catch { throw new Error('Invalid add-device data'); }
  try {
    const parsed = JSON.parse(decoded) as Partial<AddDevicePayload>;
    if (parsed.version !== 1 || typeof parsed.seed !== 'string') throw new Error('Invalid add-device payload');
    decodeSeed(parsed.seed); return { version: 1, seed: parsed.seed as MasterSeed, ...(typeof parsed.deviceId === 'string' ? { deviceId: parsed.deviceId } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid add-device payload') throw error;
    decodeSeed(raw); return { version: 1, seed: raw as MasterSeed };
  }
}
function randomSeed(): Uint8Array { const bytes = new Uint8Array(32); globalThis.crypto.getRandomValues(bytes); return bytes; }
function copySeed(value: Uint8Array): Uint8Array { if (value.byteLength !== 32) throw new Error('Master seed must be exactly 32 bytes'); return new Uint8Array(value); }
function decodeSeed(value: string): Uint8Array { return copySeed(decode(value)); }
function encode(bytes: Uint8Array): string { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decode(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
function hex(bytes: Uint8Array): string { return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
