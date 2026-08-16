import { createRecoveryMnemonic } from './backup.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const MAGIC = enc.encode('KEYSTONE-BACKUP\0');
const KEY_AAD = enc.encode('keystone-backup-key-v2');
const CURRENT_VERSION = 2 as const;
const NONCE_BYTES = 24;
export const BACKUP_FORMAT_VERSION = CURRENT_VERSION;

/** Sections that can be selected for a portable, local-first Keystone backup. */
export type BackupSection =
  | 'identity-security'
  | 'application-state'
  | 'settings'
  | 'social-graph'
  | 'conversations'
  | 'communities'
  | 'private-communities'
  | 'media-metadata'
  | 'library-playlists'
  | 'notifications'
  | 'storage-references'
  | 'user-owned-media'
  | 'cache';

export interface SelectiveBackupPolicy {
  /** Identity, trusted devices, security events and the encrypted master seed. */
  identitySecurity?: boolean;
  /** Settings and durable application/social state (the default). */
  applicationState?: boolean;
  /** User-owned media metadata/references and optional local source files. */
  userOwnedMedia?: boolean;
  /** Temporary cache/chunks. Disabled by default; they can be fetched over P2P. */
  cache?: boolean;
}

export const DEFAULT_BACKUP_POLICY: Required<SelectiveBackupPolicy> = Object.freeze({
  identitySecurity: true,
  applicationState: true,
  userOwnedMedia: true,
  cache: false,
});

/** JSON-serializable state supplied by the host application. */
export interface KeystoneBackupState {
  identitySecurity?: unknown;
  applicationState?: unknown;
  settings?: unknown;
  socialGraph?: unknown;
  conversations?: unknown;
  communities?: unknown;
  privateCommunities?: unknown;
  mediaMetadata?: unknown;
  libraryPlaylists?: unknown;
  notifications?: unknown;
  storageReferences?: unknown;
  userOwnedMedia?: unknown;
  cache?: unknown;
}

export interface BackupManifest {
  format: 'keystone.backup';
  version: typeof CURRENT_VERSION | 1;
  createdAt: string;
  /** Approximate encrypted payload size in bytes; no private content is exposed. */
  approximateSize: number;
  sections: readonly BackupSection[];
  cacheIncluded: boolean;
  encrypted: true;
}

export interface BackupInspection {
  format: BackupManifest['format'];
  version: BackupManifest['version'];
  createdAt: string;
  approximateSize: number;
  sections: readonly BackupSection[];
  cacheIncluded: boolean;
  encrypted: true;
}

export interface BackupCreationResult {
  /** The recovery secret is deliberately returned separately and never serialized. */
  recoverySecret: string;
  bytes: Uint8Array;
  manifest: BackupManifest;
}

export interface BackupRestoreResult {
  state: KeystoneBackupState;
  manifest: BackupManifest;
  /** Set when an older payload schema was upgraded before returning state. */
  migratedFrom?: number;
}

export interface BackupRestoreTransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface BackupRestoreTarget {
  /** stage must write only temporary state; commit performs the atomic swap. */
  stage(state: KeystoneBackupState, manifest: BackupManifest): Promise<BackupRestoreTransaction>;
}

export interface RecoverySecretBoundary {
  /** Native UI/keychain boundary. Implementations must not persist or log the secret. */
  requestSecret(context: { purpose: 'create' | 'restore' }): Promise<string>;
}

/** Versioned encrypted backup service. It does not alter Identity or crypto protocols. */
export class BackupService {
  async create(state: KeystoneBackupState, options: { recoverySecret?: string; policy?: SelectiveBackupPolicy; now?: Date } = {}): Promise<BackupCreationResult> {
    const recoverySecret = options.recoverySecret?.trim() || createRecoveryMnemonic(24);
    assertSecret(recoverySecret);
    return encryptBackup(state, recoverySecret, options.policy, options.now);
  }

  inspect(bytes: Uint8Array): BackupInspection { return inspectBackup(bytes); }

  async restore(bytes: Uint8Array, recoverySecret: string, target?: BackupRestoreTarget): Promise<BackupRestoreResult> {
    const restored = await decryptBackup(bytes, recoverySecret);
    if (!target) return restored;
    let transaction: BackupRestoreTransaction | undefined;
    try {
      transaction = await target.stage(restored.state, restored.manifest);
      await transaction.commit();
      return restored;
    } catch (error) {
      await transaction?.rollback().catch(() => undefined);
      throw error;
    }
  }

  async createWithBoundary(state: KeystoneBackupState, boundary: RecoverySecretBoundary, options: { policy?: SelectiveBackupPolicy; now?: Date } = {}): Promise<BackupCreationResult> {
    const secret = await boundary.requestSecret({ purpose: 'create' });
    return this.create(state, { ...options, recoverySecret: secret });
  }

  async restoreWithBoundary(bytes: Uint8Array, boundary: RecoverySecretBoundary, target?: BackupRestoreTarget): Promise<BackupRestoreResult> {
    const secret = await boundary.requestSecret({ purpose: 'restore' });
    return this.restore(bytes, secret, target);
  }
}

export async function createEncryptedBackup(state: KeystoneBackupState, recoverySecret?: string, policy?: SelectiveBackupPolicy, now?: Date): Promise<BackupCreationResult> {
  return new BackupService().create(state, { recoverySecret, policy, now });
}

export function inspectBackup(bytes: Uint8Array): BackupInspection {
  const parsed = parseContainer(bytes);
  return { format: parsed.manifest.format, version: parsed.manifest.version, createdAt: parsed.manifest.createdAt, approximateSize: parsed.manifest.approximateSize, sections: parsed.manifest.sections, cacheIncluded: parsed.manifest.cacheIncluded, encrypted: true };
}

export async function restoreBackup(bytes: Uint8Array, recoverySecret: string, target?: BackupRestoreTarget): Promise<BackupRestoreResult> {
  return new BackupService().restore(bytes, recoverySecret, target);
}

/** Pure migration hook used by restore and by hosts importing an older state export. */
export function migrateBackupPayload(value: unknown): { state: KeystoneBackupState; migratedFrom?: number } {
  if (!isRecord(value) || (value.version !== 1 && value.version !== CURRENT_VERSION)) throw new Error('Unsupported Keystone backup payload version');
  if (value.version === CURRENT_VERSION) {
    if (!isRecord(value.sections)) throw new Error('Invalid Keystone backup sections');
    if (Object.keys(value.sections).some(section => !SECTION_NAMES.includes(section as BackupSection))) throw new Error('Invalid Keystone backup section name');
    return { state: sectionsToState(value.sections) };
  }
  // Version 1 used `state` as the map of sections. Keep this migration small and
  // deterministic so future schemas can be added without changing encryption.
  const legacy = isRecord(value.state) ? value.state : isRecord(value.sections) ? value.sections : undefined;
  if (!legacy) throw new Error('Invalid legacy Keystone backup payload');
  if (Object.keys(legacy).some(section => !SECTION_NAMES.includes(section as BackupSection))) throw new Error('Invalid legacy Keystone backup section name');
  return { state: sectionsToState(legacy), migratedFrom: 1 };
}

async function encryptBackup(state: KeystoneBackupState, recoverySecret: string, policyInput?: SelectiveBackupPolicy, now = new Date()): Promise<BackupCreationResult> {
  const policy = { ...DEFAULT_BACKUP_POLICY, ...policyInput };
  const sections = selectSections(state, policy);
  const payload = enc.encode(JSON.stringify({ version: CURRENT_VERSION, sections }));
  const manifest: BackupManifest = {
    format: 'keystone.backup', version: CURRENT_VERSION, createdAt: now.toISOString(), approximateSize: payload.byteLength, sections: Object.keys(sections) as BackupSection[], cacheIncluded: policy.cache && sections.cache !== undefined, encrypted: true,
  };
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  const sodium = await loadSodium();
  const nonce = sodium.randombytes_buf(NONCE_BYTES) as Uint8Array;
  const key = deriveKey(sodium, recoverySecret);
  let ciphertext: Uint8Array;
  try {
    ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(payload, manifestBytes, null, nonce, key) as Uint8Array;
  } finally {
    sodium.memzero(key); sodium.memzero(payload);
  }
  return { recoverySecret, bytes: join(MAGIC, Uint8Array.of(CURRENT_VERSION), u32(manifestBytes.byteLength), manifestBytes, nonce, ciphertext), manifest };
}

async function decryptBackup(bytes: Uint8Array, recoverySecret: string): Promise<BackupRestoreResult> {
  assertSecret(recoverySecret);
  const parsed = parseContainer(bytes);
  const sodium = await loadSodium();
  const key = deriveKey(sodium, recoverySecret);
  let plain: Uint8Array;
  try {
    plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, parsed.ciphertext, parsed.manifestBytes, parsed.nonce, key) as Uint8Array;
  } catch {
    sodium.memzero(key);
    throw new Error('Incorrect recovery secret or damaged backup');
  }
  sodium.memzero(key);
  try {
    let payload: unknown;
    try { payload = JSON.parse(dec.decode(plain)); } catch { throw new Error('Invalid Keystone backup payload'); }
    const migrated = migrateBackupPayload(payload);
    validateManifestState(parsed.manifest, migrated.state);
    return { state: migrated.state, manifest: parsed.manifest, ...(migrated.migratedFrom === undefined ? {} : { migratedFrom: migrated.migratedFrom }) };
  } finally { sodium.memzero(plain); }
}

function selectSections(state: KeystoneBackupState, policy: Required<SelectiveBackupPolicy>): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  if (policy.identitySecurity && state.identitySecurity !== undefined) selected['identity-security'] = cloneAndValidate(state.identitySecurity);
  if (policy.applicationState) {
    if (state.applicationState !== undefined) selected['application-state'] = cloneAndValidate(state.applicationState);
    for (const [section, value] of Object.entries(state)) {
      if (section === 'identitySecurity' || section === 'applicationState' || section === 'userOwnedMedia' || section === 'cache' || value === undefined) continue;
      const name = sectionToName(section);
      if (name) selected[name] = cloneAndValidate(value);
    }
  }
  if (policy.userOwnedMedia && state.userOwnedMedia !== undefined) selected['user-owned-media'] = cloneAndValidate(state.userOwnedMedia);
  if (policy.cache && state.cache !== undefined) selected.cache = cloneAndValidate(state.cache);
  return selected;
}

function sectionsToState(sections: Record<string, unknown>): KeystoneBackupState {
  const state: KeystoneBackupState = {};
  for (const [name, value] of Object.entries(sections)) {
    const key = nameToStateKey(name);
    if (key) (state as Record<string, unknown>)[key] = structuredClone(value);
  }
  return state;
}

function validateManifestState(manifest: BackupManifest, state: KeystoneBackupState): void {
  const names = new Set(Object.keys(selectSections(state, { identitySecurity: true, applicationState: true, userOwnedMedia: true, cache: true })));
  for (const name of manifest.sections) if (!names.has(name)) {
    // A section may intentionally have an undefined value only if it was empty;
    // encrypted payloads generated by this service never list such sections.
    throw new Error('Backup manifest does not match encrypted state');
  }
  if (names.size !== manifest.sections.length) throw new Error('Backup manifest does not match encrypted state');
}

function parseContainer(bytes: Uint8Array): { manifest: BackupManifest; manifestBytes: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array } {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < MAGIC.byteLength + 1 + 4 + NONCE_BYTES + 16 || !same(bytes.subarray(0, MAGIC.byteLength), MAGIC)) throw new Error('Invalid Keystone backup container');
  let offset = MAGIC.byteLength;
  const version = bytes[offset++];
  if (version !== 1 && version !== CURRENT_VERSION) throw new Error('Unsupported Keystone backup version');
  const manifestLength = readU32(bytes, offset); offset += 4;
  if (!manifestLength || manifestLength > 64 * 1024 || offset + manifestLength + NONCE_BYTES + 16 > bytes.byteLength) throw new Error('Invalid Keystone backup manifest');
  const manifestBytes = bytes.slice(offset, offset += manifestLength);
  let manifest: BackupManifest;
  try { manifest = JSON.parse(dec.decode(manifestBytes)) as BackupManifest; } catch { throw new Error('Invalid Keystone backup manifest'); }
  validateManifest(manifest, version);
  const nonce = bytes.slice(offset, offset += NONCE_BYTES); const ciphertext = bytes.slice(offset);
  if (ciphertext.byteLength < 16) throw new Error('Truncated Keystone backup');
  return { manifest, manifestBytes, nonce, ciphertext };
}

function validateManifest(manifest: BackupManifest, containerVersion: number): void {
  if (!isRecord(manifest) || manifest.format !== 'keystone.backup' || manifest.version !== containerVersion || (manifest.version !== 1 && manifest.version !== CURRENT_VERSION) || manifest.encrypted !== true || typeof manifest.createdAt !== 'string' || !Number.isSafeInteger(manifest.approximateSize) || manifest.approximateSize < 0 || !Array.isArray(manifest.sections) || manifest.sections.some(section => !SECTION_NAMES.includes(section as BackupSection)) || typeof manifest.cacheIncluded !== 'boolean') throw new Error('Invalid Keystone backup manifest');
}

function cloneAndValidate(value: unknown): unknown {
  assertNoSecretFields(value);
  try { return structuredClone(value); } catch { throw new Error('Backup state must be structured-cloneable'); }
}

function assertNoSecretFields(value: unknown, path = ''): void {
  if (!value || typeof value !== 'object') return;
  if (value instanceof Uint8Array) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(recovery(secret|phrase)|mnemonic|privateKey|secretKey)$/i.test(key)) throw new Error(`Backup state contains forbidden secret field at ${path}${key}`);
    assertNoSecretFields(child, `${path}${key}.`);
  }
}

function sectionToName(key: string): BackupSection | undefined {
  const names: Record<string, BackupSection> = { settings: 'settings', socialGraph: 'social-graph', conversations: 'conversations', communities: 'communities', privateCommunities: 'private-communities', mediaMetadata: 'media-metadata', libraryPlaylists: 'library-playlists', notifications: 'notifications', storageReferences: 'storage-references' };
  return names[key];
}

function nameToStateKey(name: string): keyof KeystoneBackupState | undefined {
  const names: Record<string, keyof KeystoneBackupState> = { 'identity-security': 'identitySecurity', 'application-state': 'applicationState', settings: 'settings', 'social-graph': 'socialGraph', conversations: 'conversations', communities: 'communities', 'private-communities': 'privateCommunities', 'media-metadata': 'mediaMetadata', 'library-playlists': 'libraryPlaylists', notifications: 'notifications', 'storage-references': 'storageReferences', 'user-owned-media': 'userOwnedMedia', cache: 'cache' };
  return names[name];
}

const SECTION_NAMES: readonly BackupSection[] = ['identity-security', 'application-state', 'settings', 'social-graph', 'conversations', 'communities', 'private-communities', 'media-metadata', 'library-playlists', 'notifications', 'storage-references', 'user-owned-media', 'cache'];
function assertSecret(secret: string): void { if (typeof secret !== 'string' || secret.trim().length < 12) throw new Error('Recovery secret must contain at least 12 characters'); }
function deriveKey(sodium: any, secret: string): Uint8Array { const input = enc.encode(secret.normalize('NFKD').trim()); try { return sodium.crypto_generichash(32, input, KEY_AAD) as Uint8Array; } finally { input.fill(0); } }
function readU32(bytes: Uint8Array, offset: number): number { if (offset < 0 || offset + 4 > bytes.length) throw new Error('Truncated Keystone backup'); return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0); }
function u32(value: number): Uint8Array { const output = new Uint8Array(4); new DataView(output.buffer).setUint32(0, value); return output; }
function join(...parts: Uint8Array[]): Uint8Array { const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0)); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.byteLength; } return output; }
function same(a: Uint8Array, b: Uint8Array): boolean { if (a.length !== b.length) return false; let difference = 0; for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]; return difference === 0; }
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
async function loadSodium(): Promise<any> { const { default: sodium } = await import('libsodium-wrappers'); await sodium.ready; return sodium; }
