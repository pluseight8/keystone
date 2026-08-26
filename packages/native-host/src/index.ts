/**
 * Keystone Native Host foundation (R0P65).
 *
 * This package is the only application-facing boundary for operating-system
 * capabilities.  It intentionally exposes scoped handles and coarse feature
 * state instead of paths, file descriptors, hardware identifiers or secrets.
 * Platform adapters may be incomplete on a development machine; an
 * unavailable capability is never replaced with a permissive test adapter.
 */

import { createHash, randomBytes } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants, existsSync, watch as watchFs, type FSWatcher } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { LinuxNativeMediaHost, UnavailableNativeMediaHost, type NativeMediaHost } from './media.js';

// ---------------------------------------------------------------------------
// Stable host contracts
// ---------------------------------------------------------------------------

export const NATIVE_HOST_FEATURES = [
  'secureStorage', 'filesystem', 'notifications', 'backgroundExecution',
  'camera', 'microphone', 'audio', 'bluetooth', 'wifiDirect', 'lanDiscovery',
  'usb', 'webRtc', 'location', 'processSandbox', 'clipboard', 'externalLinks', 'power',
  'thermal', 'permissions', 'mediaDecoder',
] as const;
export type NativeHostFeature = (typeof NATIVE_HOST_FEATURES)[number];
export type NativeHostFeatureState = 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PERMISSION_REQUIRED' | 'DEGRADED';
export type NativeHostPlatform = 'linux' | 'windows' | 'macos' | 'android' | 'ios' | 'unknown';
export type NativeHostEnvironment = 'PRODUCTION' | 'TEST';
export type NativeHostPrincipalKind = 'CORE_TRUSTED_SUBSYSTEM' | 'OWNER_UI' | 'PLUGIN' | 'AGENT' | 'TOOL' | 'SKILL' | 'BROWSER_CONTEXT' | 'REMOTE_PEER' | 'BACKGROUND_TASK';
export type NativeHostCapability =
  | 'secure-storage.read' | 'secure-storage.write' | 'secure-storage.sign' | 'secure-storage.decrypt'
  | 'filesystem.select' | 'filesystem.read' | 'filesystem.write' | 'filesystem.delete' | 'filesystem.watch'
  | 'process.plugin' | 'media.decode' | 'background.schedule' | 'notifications.post' | 'clipboard.read' | 'clipboard.write'
  | 'external-link.open' | 'camera.capture' | 'microphone.capture' | 'audio.playback' | 'audio.capture'
  | 'webrtc.session' | 'lan.discovery' | 'bluetooth.scan' | 'bluetooth.advertise' | 'bluetooth.connect' | 'bluetooth.exchange'
  | 'location.current' | 'location.watch' | 'location.stop'
  | 'wifi-direct.connect' | 'usb.enumerate' | 'usb.connect' | 'power.read' | 'thermal.read' | 'permissions.request';
export type NativeHostErrorCode = 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'PERMISSION_REQUIRED' | 'RESOURCE_EXHAUSTED' | 'PLATFORM_FAILURE' | 'SESSION_EXPIRED' | 'HANDLE_INVALID' | 'CANCELLED' | 'TEMPORARILY_UNAVAILABLE' | 'INVALID_REQUEST' | 'POLICY_DENIED' | 'NOT_FOUND' | 'CONFLICT';

export class NativeHostError extends Error {
  constructor(readonly code: NativeHostErrorCode, message: string, readonly details?: Readonly<Record<string, string | number | boolean>>) {
    super(message); this.name = 'NativeHostError';
  }
}

export interface NativeHostPrincipal {
  readonly kind: NativeHostPrincipalKind;
  readonly id: string;
  /** Original caller is retained through helper/deputy chains. */
  readonly chain?: readonly NativeHostPrincipalKind[];
  readonly ownerIdentityId?: string;
  readonly deviceId?: string;
}
export interface NativeHostRequest {
  readonly requestId: string;
  readonly principal: NativeHostPrincipal;
  readonly capability: NativeHostCapability;
  readonly scope?: string;
  readonly resource?: string;
  readonly sessionId?: string;
  readonly ownerConfirmed?: boolean;
  readonly sourceIntent?: string;
  readonly createdAt?: string;
  readonly expiresAt?: string;
}
export interface NativeHostResult<T = unknown> { readonly requestId: string; readonly accepted: boolean; readonly value?: T; readonly error?: NativeHostErrorCode; }
export interface NativeHostPolicy {
  authorize(request: NativeHostRequest, featureState: NativeHostFeatureState): { readonly allowed: boolean; readonly reason: string };
}
export interface NativeHostFeatureRecord { readonly feature: NativeHostFeature; readonly state: NativeHostFeatureState; readonly reason?: string; readonly checkedAt: string; }
export interface NativeHostHealth { readonly state: 'HEALTHY' | 'DEGRADED' | 'FAILED'; readonly features: readonly NativeHostFeatureRecord[]; readonly lastError?: string; }
export interface NativeHostAuditEvent { readonly id: string; readonly at: string; readonly requestId: string; readonly principal: NativeHostPrincipalKind; readonly capability: NativeHostCapability; readonly decision: 'ALLOW' | 'DENY' | 'ERROR'; readonly reason: string; readonly resource?: string; }
export type NativeLifecycleState = 'FOREGROUND' | 'BACKGROUND' | 'SUSPENDING' | 'SUSPENDED' | 'RESUMING' | 'TERMINATING';
export interface NativeHostSession { readonly sessionId: string; readonly principal: NativeHostPrincipal; readonly hostSessionId: string; readonly createdAt: string; readonly expiresAt?: string; readonly active: boolean; }

export interface NativeHost {
  readonly platform: NativeHostPlatform;
  readonly environment: NativeHostEnvironment;
  capabilities(): readonly NativeHostFeatureRecord[];
  feature(feature: NativeHostFeature): NativeHostFeatureRecord;
  health(): NativeHostHealth;
  openSession(principal: NativeHostPrincipal, ttlMs?: number): NativeHostSession;
  closeSession(sessionId: string): void;
  audit(): readonly NativeHostAuditEvent[];
  lifecycle(): NativeLifecycleState;
  power(): NativePowerState;
  thermal(): NativeThermalState;
  /** Narrow OS location boundary; raw platform objects never cross this API. */
  location(): NativeLocationHost;
  /** Narrow production media decoder boundary; raw child processes never cross this API. */
  media(): NativeMediaHost;
  requestPermission(request: NativePermissionRequest): Promise<NativePermissionState>;
  /** Generic requests are validated by policy and carry provenance; no raw OS authority is returned. */
  request<T = unknown>(request: NativeHostRequest, operation: () => Promise<T> | T): Promise<NativeHostResult<T>>;
}

export interface NativePowerState { readonly batteryClass: 'UNKNOWN' | 'CRITICAL' | 'LOW' | 'NORMAL' | 'FULL'; readonly charging: boolean | 'UNKNOWN'; readonly powerSaver: boolean | 'UNKNOWN'; readonly source: 'HOST' | 'UNAVAILABLE'; }
export interface NativeThermalState { readonly class: 'UNKNOWN' | 'NOMINAL' | 'FAIR' | 'SERIOUS' | 'CRITICAL'; readonly source: 'HOST' | 'UNAVAILABLE'; }

const PRINCIPAL_DENY: ReadonlySet<NativeHostPrincipalKind> = new Set(['REMOTE_PEER']);
export class DefaultNativeHostPolicy implements NativeHostPolicy {
  authorize(request: NativeHostRequest, featureState: NativeHostFeatureState): { allowed: boolean; reason: string } {
    if (!request || !request.requestId || !request.principal?.id || !request.capability) return { allowed: false, reason: 'Malformed native request' };
    if (PRINCIPAL_DENY.has(request.principal.kind)) return { allowed: false, reason: 'Remote peers cannot invoke native operations' };
    if (request.principal.chain?.includes('REMOTE_PEER')) return { allowed: false, reason: 'Remote provenance cannot be upgraded by a helper' };
    if (request.capability.startsWith('location.') && request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') return { allowed: false, reason: 'Location requires owner UI or trusted core provenance' };
    if (request.capability === 'location.watch' && request.ownerConfirmed !== true) return { allowed: false, reason: 'Location watches require explicit owner confirmation' };
    if (featureState === 'UNSUPPORTED' || featureState === 'UNAVAILABLE') return { allowed: false, reason: `Feature is ${featureState.toLowerCase()}` };
    if (request.expiresAt && Date.parse(request.expiresAt) <= Date.now()) return { allowed: false, reason: 'Native request expired' };
    if (['camera.capture', 'microphone.capture', 'external-link.open', 'secure-storage.read', 'secure-storage.write', 'secure-storage.sign', 'secure-storage.decrypt', 'filesystem.select', 'clipboard.read', 'clipboard.write'].includes(request.capability) && request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') return { allowed: false, reason: 'Owner UI or trusted core provenance is required' };
    if (request.capability === 'process.plugin' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') return { allowed: false, reason: 'Only the trusted core may start a plugin process' };
    if (request.capability === 'media.decode' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') return { allowed: false, reason: 'Only the trusted core may invoke the media decoder' };
    if ((request.capability === 'filesystem.read' || request.capability === 'filesystem.write' || request.capability === 'filesystem.delete') && !request.scope) return { allowed: false, reason: 'A filesystem scope is required' };
    if (request.capability === 'external-link.open' && request.ownerConfirmed !== true) return { allowed: false, reason: 'External open requires owner confirmation' };
    return { allowed: true, reason: 'Policy allowed scoped request' };
  }
}

// ---------------------------------------------------------------------------
// Opaque secret handles and secure storage
// ---------------------------------------------------------------------------

export interface NativeSecretMetadata { readonly id: string; readonly label: string; readonly createdAt: string; readonly deviceBound: boolean; readonly exportable: false; }
export interface NativeSecretStatus extends NativeSecretMetadata { readonly state: 'ACTIVE' | 'REVOKED' | 'UNAVAILABLE'; }
export interface NativeSecureStorage {
  readonly kind: 'OS_SECURE_STORAGE' | 'TEST_MEMORY' | 'UNAVAILABLE';
  readonly hardwareBacked: boolean | 'UNKNOWN';
  put(label: string, secret: Uint8Array, request: NativeHostRequest): Promise<NativeSecretHandle>;
  status(handle: NativeSecretHandle, request: NativeHostRequest): Promise<NativeSecretStatus>;
  sign(handle: NativeSecretHandle, data: Uint8Array, request: NativeHostRequest): Promise<Uint8Array>;
  decrypt(handle: NativeSecretHandle, ciphertext: Uint8Array, request: NativeHostRequest): Promise<Uint8Array>;
  revoke(handle: NativeSecretHandle, request: NativeHostRequest): Promise<void>;
}

/**
 * Linux production secure storage backed by the user's Secret Service
 * (normally GNOME Keyring/KWallet).  The keyring stores only base64 encoded
 * bytes; the application never writes a secret to a file, environment
 * variable, log, or serialized handle.  Availability is deliberately probed
 * at runtime because an installed `secret-tool` binary is not proof that a
 * Secret Service session is reachable.
 */
export class LinuxSecretToolStorage implements NativeSecureStorage {
  readonly kind = 'OS_SECURE_STORAGE' as const;
  readonly hardwareBacked = 'UNKNOWN' as const;
  private readonly service = 'keystone-native-host';
  constructor(private readonly command = 'secret-tool', private readonly timeoutMs = 5_000) {}
  available(): boolean { return existsSync(`/usr/bin/${this.command}`) || existsSync(`/bin/${this.command}`); }
  async probe(): Promise<boolean> {
    if (!this.available()) return false;
    const id = `probe-${randomId()}`;
    try {
      await this.run(['store', '--label=Keystone secure-storage probe', 'service', this.service, 'id', id], 'keystone-probe');
      const value = await this.run(['lookup', 'service', this.service, 'id', id]);
      await this.run(['clear', 'service', this.service, 'id', id]);
      return value === 'keystone-probe';
    } catch { try { await this.run(['clear', 'service', this.service, 'id', id]); } catch { /* best effort cleanup */ } return false; }
  }
  async put(label: string, secret: Uint8Array, request: NativeHostRequest): Promise<NativeSecretHandle> {
    this.assert(request, 'secure-storage.write');
    if (!label || secret.byteLength === 0 || secret.byteLength > 16 * 1024 * 1024) throw new NativeHostError('INVALID_REQUEST', 'Secret input is invalid');
    const id = `secret-${randomId()}`; const createdAt = new Date().toISOString();
    // Base64 makes the Secret Service stdin protocol binary-safe and is not a
    // plaintext application secret at rest.
    await this.run(['store', `--label=${label.slice(0, 128)}`, 'service', this.service, 'id', id, 'createdAt', createdAt], Buffer.from(secret).toString('base64'));
    return new NativeSecretHandle(id, { id, label: label.slice(0, 128), createdAt, deviceBound: true, exportable: false });
  }
  async status(handle: NativeSecretHandle, request: NativeHostRequest): Promise<NativeSecretStatus> {
    this.assert(request, 'secure-storage.read'); await this.lookup(handle); return { ...handle.metadata, state: 'ACTIVE' };
  }
  async sign(handle: NativeSecretHandle, data: Uint8Array, request: NativeHostRequest): Promise<Uint8Array> {
    this.assert(request, 'secure-storage.sign'); return digest(await this.lookup(handle), data);
  }
  async decrypt(handle: NativeSecretHandle, ciphertext: Uint8Array, request: NativeHostRequest): Promise<Uint8Array> {
    this.assert(request, 'secure-storage.decrypt'); const secret = await this.lookup(handle); const mask = digest(secret, new Uint8Array([0x6b, 0x73])); return ciphertext.map((v, i) => v ^ mask[i % mask.length]!);
  }
  async revoke(handle: NativeSecretHandle, request: NativeHostRequest): Promise<void> {
    this.assert(request, 'secure-storage.write'); await this.run(['clear', 'service', this.service, 'id', handle.id]);
  }
  private async lookup(handle: NativeSecretHandle): Promise<Uint8Array> {
    const encoded = await this.run(['lookup', 'service', this.service, 'id', handle.id]);
    try { const bytes = new Uint8Array(Buffer.from(encoded, 'base64')); if (!bytes.byteLength) throw new Error('empty'); return bytes; } catch { throw new NativeHostError('HANDLE_INVALID', 'Secure handle is invalid'); }
  }
  private assert(request: NativeHostRequest, capability: NativeHostCapability): void { if (!this.available()) throw new NativeHostError('UNSUPPORTED', 'Linux Secret Service is unavailable'); if (request.capability !== capability || (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM')) throw new NativeHostError('POLICY_DENIED', 'Secure storage requires owner/core provenance'); }
  private run(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false }); let out = ''; let err = ''; let settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(out.trim()); };
      const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Secure storage operation timed out')); }, this.timeoutMs);
      child.stdout.on('data', (chunk: Uint8Array) => { if (out.length < 1_000_000) out += Buffer.from(chunk).toString('utf8'); }); child.stderr.on('data', (chunk: Uint8Array) => { if (err.length < 4_096) err += Buffer.from(chunk).toString('utf8'); });
      child.once('error', error => finish(new NativeHostError('PLATFORM_FAILURE', `Secure storage process failed: ${error.message}`)));
      child.once('close', code => code === 0 ? finish() : finish(new NativeHostError(code === 1 ? 'NOT_FOUND' : 'PLATFORM_FAILURE', err.trim() || 'Secure storage operation failed')));
      // secret-tool's stdin protocol expects a terminating line delimiter.
      if (input !== undefined) child.stdin.end(`${input}\n`); else child.stdin.end();
    });
  }
}
export function createLinuxProductionSecureStorage(): NativeSecureStorage { return process.platform === 'linux' && (existsSync('/usr/bin/secret-tool') || existsSync('/bin/secret-tool')) ? new LinuxSecretToolStorage() : new UnavailableSecureStorage(); }
export class NativeSecretHandle {
  readonly kind = 'NATIVE_SECRET_HANDLE' as const;
  readonly id: string;
  readonly metadata: NativeSecretMetadata;
  /** Deliberately no secret bytes or export method. */
  private readonly opaque = true;
  constructor(id: string, metadata: NativeSecretMetadata) { this.id = id; this.metadata = Object.freeze({ ...metadata, exportable: false as const }); Object.freeze(this); }
  toJSON(): NativeSecretMetadata & { kind: 'NATIVE_SECRET_HANDLE' } { return { kind: this.kind, ...this.metadata }; }
}
export class UnavailableSecureStorage implements NativeSecureStorage {
  readonly kind = 'UNAVAILABLE' as const; readonly hardwareBacked = 'UNKNOWN' as const;
  private unavailable(): never { throw new NativeHostError('UNSUPPORTED', 'No production secure-storage adapter is available on this host'); }
  put(): Promise<NativeSecretHandle> { return Promise.reject(this.unavailable()); }
  status(): Promise<NativeSecretStatus> { return Promise.reject(this.unavailable()); }
  sign(): Promise<Uint8Array> { return Promise.reject(this.unavailable()); }
  decrypt(): Promise<Uint8Array> { return Promise.reject(this.unavailable()); }
  revoke(): Promise<void> { return Promise.reject(this.unavailable()); }
}
/** Test/development-only store. It is never selected by production host detection. */
export class TestSecureStorage implements NativeSecureStorage {
  readonly kind = 'TEST_MEMORY' as const; readonly hardwareBacked = false as const;
  private readonly values = new Map<string, { label: string; bytes: Uint8Array; createdAt: string; revoked: boolean }>();
  constructor(private readonly now: () => number = Date.now) {}
  async put(label: string, secret: Uint8Array, request: NativeHostRequest): Promise<NativeSecretHandle> { this.assert(request, 'secure-storage.write'); if (!label || secret.byteLength === 0 || secret.byteLength > 16 * 1024 * 1024) throw new NativeHostError('INVALID_REQUEST', 'Secret input is invalid'); const id = `nsh:${randomId()}`; const createdAt = new Date(this.now()).toISOString(); this.values.set(id, { label: label.slice(0, 128), bytes: secret.slice(), createdAt, revoked: false }); return new NativeSecretHandle(id, { id, label: label.slice(0, 128), createdAt, deviceBound: false, exportable: false }); }
  async status(handle: NativeSecretHandle, request: NativeHostRequest): Promise<NativeSecretStatus> { this.assert(request, 'secure-storage.read'); const value = this.values.get(handle.id); if (!value) throw new NativeHostError('HANDLE_INVALID', 'Secret handle is invalid'); return { ...handle.metadata, state: value.revoked ? 'REVOKED' : 'ACTIVE' }; }
  async sign(handle: NativeSecretHandle, data: Uint8Array, request: NativeHostRequest): Promise<Uint8Array> { this.assert(request, 'secure-storage.sign'); const value = this.require(handle); return digest(value.bytes, data); }
  async decrypt(handle: NativeSecretHandle, ciphertext: Uint8Array, request: NativeHostRequest): Promise<Uint8Array> { this.assert(request, 'secure-storage.decrypt'); const value = this.require(handle); const mask = digest(value.bytes, new Uint8Array([0x6b, 0x73])); return ciphertext.map((v, i) => v ^ mask[i % mask.length]!); }
  async revoke(handle: NativeSecretHandle, request: NativeHostRequest): Promise<void> { this.assert(request, 'secure-storage.write'); const value = this.values.get(handle.id); if (!value) throw new NativeHostError('HANDLE_INVALID', 'Secret handle is invalid'); value.revoked = true; }
  private require(handle: NativeSecretHandle) { const value = this.values.get(handle.id); if (!value || value.revoked) throw new NativeHostError('HANDLE_INVALID', 'Secret handle is stale or revoked'); return value; }
  private assert(request: NativeHostRequest, capability: NativeHostCapability): void { if (request.capability !== capability) throw new NativeHostError('POLICY_DENIED', 'Secret operation capability mismatch'); if (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') throw new NativeHostError('POLICY_DENIED', 'Secret operation requires owner/core provenance'); }
}

// ---------------------------------------------------------------------------
// Scoped filesystem handles
// ---------------------------------------------------------------------------

export type NativeStorageNamespace = 'CORE_DURABLE' | 'CACHE' | 'QUARANTINE' | 'PLUGIN_PRIVATE' | 'TEMPORARY' | 'LOGS' | 'BACKUP_STAGING' | 'OWNER_SELECTED';
export interface NativeFileMetadata { readonly name: string; readonly size: number; readonly modifiedAt: string; readonly namespace: NativeStorageNamespace; }
export interface NativeDirectoryMetadata { readonly name: string; readonly namespace: NativeStorageNamespace; }
interface HandleBinding { readonly token: string; readonly sessionId: string; readonly principal: NativeHostPrincipal; readonly namespace: NativeStorageNamespace; readonly absolutePath: string; readonly writable: boolean; readonly expiresAt: number; }
export class NativeFileHandle {
  readonly kind = 'NATIVE_FILE_HANDLE' as const;
  constructor(readonly id: string, readonly metadata: NativeFileMetadata, private readonly binding: HandleBinding, private readonly owner: NativeFileSystemService) { Object.freeze(this); }
  async read(signal?: AbortSignal): Promise<Uint8Array> { return this.owner.read(this, signal); }
  async write(data: Uint8Array, signal?: AbortSignal): Promise<void> { return this.owner.write(this, data, signal); }
  async delete(): Promise<void> { return this.owner.delete(this); }
  toJSON(): { kind: 'NATIVE_FILE_HANDLE'; id: string; metadata: NativeFileMetadata } { return { kind: this.kind, id: this.id, metadata: this.metadata }; }
  /** Host-only binding; not enumerable and never serialized. */
  _binding(): HandleBinding { return this.binding; }
}
export class NativeDirectoryHandle {
  readonly kind = 'NATIVE_DIRECTORY_HANDLE' as const;
  constructor(readonly id: string, readonly metadata: NativeDirectoryMetadata, private readonly binding: HandleBinding, private readonly owner: NativeFileSystemService) { Object.freeze(this); }
  async list(): Promise<readonly NativeFileMetadata[]> { return this.owner.list(this); }
  toJSON(): { kind: 'NATIVE_DIRECTORY_HANDLE'; id: string; metadata: NativeDirectoryMetadata } { return { kind: this.kind, id: this.id, metadata: this.metadata }; }
  _binding(): HandleBinding { return this.binding; }
}

export type NativeFolderEntryKind = 'FILE' | 'DIRECTORY' | 'SYMLINK' | 'OTHER';
export interface NativeFolderEntry { readonly relativePath: string; readonly kind: NativeFolderEntryKind; readonly size: number; readonly modifiedAt: string; }
export interface NativeFolderWatchEvent { readonly kind: 'CREATE' | 'UPDATE' | 'RENAME' | 'DELETE' | 'UNKNOWN'; readonly relativePath: string; }
/**
 * A directory binding is an owner-selected root capability.  It exposes
 * relative paths only; callers never receive the absolute path or a raw file
 * descriptor.  The core Files sync adapter consumes this structural contract.
 */
export interface NativeFolderBinding {
  list(): Promise<readonly NativeFolderEntry[]>;
  read(relativePath: string): Promise<Uint8Array>;
  writeAtomic(relativePath: string, bytes: Uint8Array): Promise<void>;
  mkdir(relativePath: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  watch(listener: (event: NativeFolderWatchEvent) => void): () => void;
  close(): void;
}
export interface NativeFileSystem {
  selectFile(path: string, request: NativeHostRequest, options?: { writable?: boolean; namespace?: NativeStorageNamespace }): Promise<NativeFileHandle>;
  selectDirectory(path: string, request: NativeHostRequest, options?: { namespace?: NativeStorageNamespace }): Promise<NativeDirectoryHandle>;
  openApplicationFile(relativePath: string, namespace: NativeStorageNamespace, request: NativeHostRequest, options?: { writable?: boolean }): Promise<NativeFileHandle>;
  read(handle: NativeFileHandle, signal?: AbortSignal): Promise<Uint8Array>;
  write(handle: NativeFileHandle, data: Uint8Array, signal?: AbortSignal): Promise<void>;
  delete(handle: NativeFileHandle): Promise<void>;
  list(handle: NativeDirectoryHandle): Promise<readonly NativeFileMetadata[]>;
  close(handle: NativeFileHandle | NativeDirectoryHandle): void;
  bindDirectory?(path: string, request: NativeHostRequest): Promise<NativeFolderBinding>;
}
const DEFAULT_NAMESPACES: readonly NativeStorageNamespace[] = ['CORE_DURABLE', 'CACHE', 'QUARANTINE', 'PLUGIN_PRIVATE', 'TEMPORARY', 'LOGS', 'BACKUP_STAGING', 'OWNER_SELECTED'];
export class NativeFileSystemService implements NativeFileSystem {
  private readonly handles = new Map<string, HandleBinding>();
  private readonly roots = new Map<NativeStorageNamespace, string>();
  constructor(readonly root: string, private readonly session: () => string, private readonly now: () => number = Date.now, private readonly sessionActive: (sessionId: string) => boolean = id => id === session()) { for (const namespace of DEFAULT_NAMESPACES) this.roots.set(namespace, resolve(root, namespace.toLowerCase())); }
  async init(): Promise<void> { await Promise.all([...this.roots.values()].map(value => mkdir(value, { recursive: true, mode: 0o700 }))); }
  async selectFile(path: string, request: NativeHostRequest, options: { writable?: boolean; namespace?: NativeStorageNamespace } = {}): Promise<NativeFileHandle> { this.assertOwnerSelection(request, 'filesystem.select'); const namespace = options.namespace ?? 'OWNER_SELECTED'; const absolute = namespace === 'OWNER_SELECTED' ? await this.safeSelectedPath(path) : await this.safePath(path, namespace); const info = await lstat(absolute).catch(() => { throw new NativeHostError('NOT_FOUND', 'Selected file does not exist'); }); if (!info.isFile()) throw new NativeHostError('INVALID_REQUEST', 'Selected path is not a regular file'); return this.makeFile(absolute, namespace, request, options.writable ?? false); }
  async selectDirectory(path: string, request: NativeHostRequest, options: { namespace?: NativeStorageNamespace } = {}): Promise<NativeDirectoryHandle> { this.assertOwnerSelection(request, 'filesystem.select'); const namespace = options.namespace ?? 'OWNER_SELECTED'; const absolute = namespace === 'OWNER_SELECTED' ? await this.safeSelectedPath(path) : await this.safePath(path, namespace); const info = await lstat(absolute).catch(() => { throw new NativeHostError('NOT_FOUND', 'Selected directory does not exist'); }); if (!info.isDirectory()) throw new NativeHostError('INVALID_REQUEST', 'Selected path is not a directory'); return this.makeDirectory(absolute, namespace, request, true); }
  async openApplicationFile(relativePath: string, namespace: NativeStorageNamespace, request: NativeHostRequest, options: { writable?: boolean } = {}): Promise<NativeFileHandle> { if (!DEFAULT_NAMESPACES.includes(namespace)) throw new NativeHostError('INVALID_REQUEST', 'Unknown storage namespace'); if (namespace === 'OWNER_SELECTED') this.assertOwnerSelection(request, 'filesystem.select'); if (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM' && namespace !== 'PLUGIN_PRIVATE' && namespace !== 'CACHE') throw new NativeHostError('POLICY_DENIED', 'Caller cannot open this storage namespace'); const absolute = await this.safePath(relativePath, namespace); if (options.writable) await mkdir(dirname(absolute), { recursive: true, mode: 0o700 }); if (options.writable) await writeFile(absolute, await readFile(absolute).catch(() => new Uint8Array()), { flag: 'a', mode: 0o600 }); else await access(absolute, fsConstants.R_OK).catch(() => { throw new NativeHostError('NOT_FOUND', 'File does not exist'); }); return this.makeFile(absolute, namespace, request, options.writable ?? false); }
  async read(handle: NativeFileHandle, signal?: AbortSignal): Promise<Uint8Array> { const binding = this.require(handle); this.assertSignal(signal); await this.assertRegularFile(binding.absolutePath); return new Uint8Array(await readFile(binding.absolutePath)); }
  async write(handle: NativeFileHandle, data: Uint8Array, signal?: AbortSignal): Promise<void> { const binding = this.require(handle); if (!binding.writable) throw new NativeHostError('PERMISSION_DENIED', 'File handle is read-only'); this.assertSignal(signal); if (data.byteLength > 256 * 1024 * 1024) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Single native write exceeds limit'); await this.assertRegularParent(binding.absolutePath); const temp = `${binding.absolutePath}.keystone-${randomId()}.tmp`; await writeFile(temp, data, { mode: 0o600 }); await rename(temp, binding.absolutePath); }
  async delete(handle: NativeFileHandle): Promise<void> { const binding = this.require(handle); if (!binding.writable || !['CACHE', 'TEMPORARY', 'QUARANTINE', 'OWNER_SELECTED'].includes(binding.namespace)) throw new NativeHostError('PERMISSION_DENIED', 'File is not deletable through this handle'); await rm(binding.absolutePath, { force: true }); this.handles.delete(binding.token); }
  async list(handle: NativeDirectoryHandle): Promise<readonly NativeFileMetadata[]> { const binding = this.requireDirectory(handle); const entries = await readdir(binding.absolutePath, { withFileTypes: true }); const output: NativeFileMetadata[] = []; for (const entry of entries.slice(0, 1_000)) { if (!entry.isFile()) continue; const absolute = join(binding.absolutePath, entry.name); const info = await lstat(absolute); if (!info.isFile()) continue; output.push({ name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString(), namespace: binding.namespace }); } return output; }
  async bindDirectory(path: string, request: NativeHostRequest): Promise<NativeFolderBinding> { if (request.capability !== 'filesystem.select' && request.capability !== 'filesystem.watch') throw new NativeHostError('POLICY_DENIED', 'Folder binding requires filesystem selection/watch capability'); const selectionRequest = request.capability === 'filesystem.watch' ? { ...request, capability: 'filesystem.select' as const } : request; const handle = await this.selectDirectory(path, selectionRequest); const binding = handle._binding(); return new NativeFolderBindingImpl(binding.absolutePath, binding.sessionId, () => this.sessionActive(binding.sessionId) && this.handles.has(binding.token) && binding.expiresAt > this.now(), () => this.close(handle)); }
  close(handle: NativeFileHandle | NativeDirectoryHandle): void { this.handles.delete(handle._binding().token); }
  revokeSession(sessionId: string): void { for (const [token, binding] of this.handles) if (binding.sessionId === sessionId) this.handles.delete(token); }
  private async makeFile(path: string, namespace: NativeStorageNamespace, request: NativeHostRequest, writable: boolean): Promise<NativeFileHandle> { const token = `nfh:${randomId()}`; const binding = this.binding(token, path, namespace, request, writable); this.handles.set(token, binding); const info = await stat(path); return new NativeFileHandle(token, { name: basename(path), size: info.size, modifiedAt: info.mtime.toISOString(), namespace }, binding, this); }
  private makeDirectory(path: string, namespace: NativeStorageNamespace, request: NativeHostRequest, writable: boolean): NativeDirectoryHandle { const token = `ndh:${randomId()}`; const binding = this.binding(token, path, namespace, request, writable); this.handles.set(token, binding); return new NativeDirectoryHandle(token, { name: basename(path) || namespace, namespace }, binding, this); }
  private binding(token: string, absolutePath: string, namespace: NativeStorageNamespace, request: NativeHostRequest, writable: boolean): HandleBinding { return { token, sessionId: request.sessionId ?? this.session(), principal: request.principal, namespace, absolutePath, writable, expiresAt: this.now() + 30 * 60_000 }; }
  private async safePath(input: string, namespace: NativeStorageNamespace): Promise<string> { if (typeof input !== 'string' || !input || input.includes('\0') || input.includes('\u0000')) throw new NativeHostError('INVALID_REQUEST', 'Path is invalid'); const root = this.roots.get(namespace)!; const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input); const relativePath = relative(root, candidate); if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new NativeHostError('POLICY_DENIED', 'Path escapes its native namespace'); const parent = dirname(candidate); const parentReal = await realpath(parent).catch(() => parent); const rootReal = await realpath(root).catch(() => root); const relativeReal = relative(rootReal, resolve(parentReal, basename(candidate))); if (relativeReal === '..' || relativeReal.startsWith(`..${sep}`) || isAbsolute(relativeReal)) throw new NativeHostError('POLICY_DENIED', 'Symlink or traversal escapes its native namespace'); return candidate; }
  private async safeSelectedPath(input: string): Promise<string> { if (typeof input !== 'string' || !input || !isAbsolute(input) || input.includes('\0') || input.includes('\u0000')) throw new NativeHostError('INVALID_REQUEST', 'Owner-selected path is invalid'); const candidate = resolve(input); const parent = dirname(candidate); const parentReal = await realpath(parent).catch(() => { throw new NativeHostError('NOT_FOUND', 'Selected parent is unavailable'); }); const final = join(parentReal, basename(candidate)); const info = await lstat(final).catch(() => { throw new NativeHostError('NOT_FOUND', 'Selected path is unavailable'); }); if (!info.isFile() && !info.isDirectory()) throw new NativeHostError('INVALID_REQUEST', 'Selected path is not a regular file or directory'); if (info.isSymbolicLink()) throw new NativeHostError('POLICY_DENIED', 'Selected symlink is not allowed'); return final; }
  private require(handle: NativeFileHandle): HandleBinding { const binding = this.handles.get(handle._binding().token); if (!binding || binding.token !== handle.id || binding.expiresAt <= this.now() || !this.sessionActive(binding.sessionId)) throw new NativeHostError('HANDLE_INVALID', 'File handle is stale or invalid'); return binding; }
  private requireDirectory(handle: NativeDirectoryHandle): HandleBinding { const binding = this.handles.get(handle._binding().token); if (!binding || binding.token !== handle.id || binding.expiresAt <= this.now() || !this.sessionActive(binding.sessionId)) throw new NativeHostError('HANDLE_INVALID', 'Directory handle is stale or invalid'); return binding; }
  private async assertRegularFile(path: string): Promise<void> { const info = await lstat(path).catch(() => { throw new NativeHostError('NOT_FOUND', 'File is unavailable'); }); if (!info.isFile()) throw new NativeHostError('POLICY_DENIED', 'Only regular files are allowed'); }
  private async assertRegularParent(path: string): Promise<void> { const info = await lstat(dirname(path)).catch(() => { throw new NativeHostError('NOT_FOUND', 'File parent is unavailable'); }); if (!info.isDirectory()) throw new NativeHostError('POLICY_DENIED', 'File parent is not a directory'); }
  private assertOwnerSelection(request: NativeHostRequest, capability: NativeHostCapability): void { if (request.capability !== capability || (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM')) throw new NativeHostError('POLICY_DENIED', 'Owner-selected filesystem access requires owner/core provenance'); }
  private assertSignal(signal?: AbortSignal): void { if (signal?.aborted) throw new NativeHostError('CANCELLED', 'Native file operation cancelled'); }
}

class NativeFolderBindingImpl implements NativeFolderBinding {
  private watcher?: FSWatcher;
  private closed = false;
  private readonly listeners = new Set<(event: NativeFolderWatchEvent) => void>();
  constructor(private readonly root: string, private readonly sessionId: string, private readonly active: () => boolean, private readonly closeHandle: () => void) {}
  async list(): Promise<readonly NativeFolderEntry[]> { this.assertActive(); const result: NativeFolderEntry[] = []; await this.walk(this.root, '', result, 0); return result.slice(0, 100_000); }
  async read(relativePath: string): Promise<Uint8Array> { this.assertActive(); const path = await this.safe(relativePath, false); const info = await lstat(path).catch(() => { throw new NativeHostError('NOT_FOUND', 'Bound file is unavailable'); }); if (!info.isFile()) throw new NativeHostError('POLICY_DENIED', 'Only regular files may be read'); if (info.size > 1024 * 1024 * 1024) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Bound file exceeds the host read bound'); return new Uint8Array(await readFile(path)); }
  async writeAtomic(relativePath: string, bytes: Uint8Array): Promise<void> { this.assertActive(); if (bytes.byteLength > 1024 * 1024 * 1024) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Bound write exceeds the host limit'); const path = await this.safe(relativePath, true); const parent = dirname(path); await mkdir(parent, { recursive: true, mode: 0o700 }); await this.assertRealInside(parent); const temp = `${path}.keystone-${randomId()}.tmp`; await writeFile(temp, bytes, { mode: 0o600 }); await rename(temp, path); }
  async mkdir(relativePath: string): Promise<void> { this.assertActive(); if (!relativePath) return; const path = await this.safe(relativePath, true); await mkdir(path, { recursive: true, mode: 0o700 }); await this.assertRealInside(path); }
  async remove(relativePath: string): Promise<void> { this.assertActive(); const path = await this.safe(relativePath, false); const info = await lstat(path).catch(() => undefined); if (!info) return; if (info.isSymbolicLink()) { await rm(path, { force: true }); return; } await rm(path, { recursive: info.isDirectory(), force: true }); }
  watch(listener: (event: NativeFolderWatchEvent) => void): () => void { this.assertActive(); this.listeners.add(listener); if (!this.watcher) { try { this.watcher = watchFs(this.root, { recursive: true }, (event, filename) => { const value = String(filename ?? ''); if (!value) return; const normalized = value.replaceAll('\\', '/').replace(/^\/+/, ''); const segments: string[] = normalized.split('/'); if (!normalized || segments.some((segment: string) => segment === '..' || segment === '.' || !safePortableSegment(segment))) return; const kind = event === 'rename' ? 'RENAME' : 'UPDATE'; for (const callback of this.listeners) callback({ kind, relativePath: normalized }); }); } catch { this.watcher = undefined; throw new NativeHostError('UNSUPPORTED', 'Recursive filesystem watching is unavailable on this host'); } } return () => { this.listeners.delete(listener); if (!this.listeners.size) { this.watcher?.close(); this.watcher = undefined; } }; }
  close(): void { if (this.closed) return; this.closed = true; this.watcher?.close(); this.watcher = undefined; this.listeners.clear(); this.closeHandle(); }
  private async walk(root: string, relativeRoot: string, output: NativeFolderEntry[], depth: number): Promise<void> { if (depth > 128 || output.length >= 100_000) return; const entries = await readdir(root, { withFileTypes: true }).catch(() => []); for (const entry of entries) { if (output.length >= 100_000) return; const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name; if (!safePortableSegment(entry.name)) continue; const absolute = join(root, entry.name); const info = await lstat(absolute).catch(() => undefined); if (!info) continue; if (entry.isSymbolicLink() || info.isSymbolicLink()) { output.push({ relativePath, kind: 'SYMLINK', size: 0, modifiedAt: info.mtime.toISOString() }); continue; } if (info.isDirectory()) { output.push({ relativePath, kind: 'DIRECTORY', size: 0, modifiedAt: info.mtime.toISOString() }); await this.walk(absolute, relativePath, output, depth + 1); } else if (info.isFile()) output.push({ relativePath, kind: 'FILE', size: info.size, modifiedAt: info.mtime.toISOString() }); else output.push({ relativePath, kind: 'OTHER', size: info.size, modifiedAt: info.mtime.toISOString() }); } }
  private async safe(relativePath: string, allowMissing: boolean): Promise<string> { if (typeof relativePath !== 'string' || !relativePath || relativePath.length > 4_096 || relativePath.includes('\0') || relativePath.startsWith('/') || relativePath.startsWith('\\') || /^[A-Za-z]:/.test(relativePath)) throw new NativeHostError('POLICY_DENIED', 'Bound path is unsafe'); const segments = relativePath.replaceAll('\\', '/').split('/'); if (segments.some(segment => !safePortableSegment(segment))) throw new NativeHostError('POLICY_DENIED', 'Bound path escapes its selected root'); const candidate = resolve(this.root, ...segments); const rootReal = await realpath(this.root).catch(() => this.root); const parent = dirname(candidate); const parentReal = await realpath(parent).catch(() => allowMissing ? parent : parent); const relativeParent = relative(rootReal, resolve(parentReal, basename(candidate))); if (relativeParent === '..' || relativeParent.startsWith(`..${sep}`) || isAbsolute(relativeParent)) throw new NativeHostError('POLICY_DENIED', 'Symlink or traversal escapes selected root'); if (!allowMissing) { const info = await lstat(candidate).catch(() => { throw new NativeHostError('NOT_FOUND', 'Bound path is unavailable'); }); if (info.isSymbolicLink()) throw new NativeHostError('POLICY_DENIED', 'Symlink targets are not followed by folder sync'); } return candidate; }
  private async assertRealInside(path: string): Promise<void> { const rootReal = await realpath(this.root).catch(() => this.root); const valueReal = await realpath(path).catch(() => path); const relativeValue = relative(rootReal, valueReal); if (relativeValue === '..' || relativeValue.startsWith(`..${sep}`) || isAbsolute(relativeValue)) throw new NativeHostError('POLICY_DENIED', 'Filesystem operation escaped selected root'); }
  private assertActive(): void { if (this.closed || !this.active()) throw new NativeHostError('HANDLE_INVALID', `Folder binding session ${this.sessionId} is stale or revoked`); }
}

function safePortableSegment(value: string): boolean { return Boolean(value && value.length <= 255 && value !== '.' && value !== '..' && !/[\0\u0000-\u001f\u007f]/.test(value) && !/^[A-Za-z]:/.test(value) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)); }
export function createNativeStorageRoots(root = join(tmpdir(), 'keystone-native-host')): ReadonlyMap<NativeStorageNamespace, string> { return new Map(DEFAULT_NAMESPACES.map(namespace => [namespace, resolve(root, namespace.toLowerCase())])); }

// ---------------------------------------------------------------------------
// Process, background, permissions and host services
// ---------------------------------------------------------------------------

export interface NativeProcessResourcePolicy { readonly maxRuntimeMs: number; readonly memoryBytes?: number; readonly maxProcesses: number; readonly maxOutputBytes: number; }
export interface NativePluginProcessRequest { readonly pluginId: string; readonly revisionHash: string; readonly entrypoint: string; readonly workingDirectory: string; readonly environment?: Readonly<Record<string, string>>; readonly policy: NativeProcessResourcePolicy; }
export interface NativeProcessSandboxHandle { readonly kind: 'NATIVE_PROCESS_SANDBOX_HANDLE'; readonly id: string; readonly pluginId: string; readonly startedAt: string; readonly state: 'RUNNING' | 'EXITED' | 'KILLED'; }
export interface NativeProcessSandboxHost { launchPlugin(request: NativePluginProcessRequest, signal?: AbortSignal): Promise<NativeProcessSandboxHandle>; terminate(handle: NativeProcessSandboxHandle, reason?: string): Promise<void>; health(handle: NativeProcessSandboxHandle): 'RUNNING' | 'EXITED' | 'KILLED' | 'UNKNOWN'; }
export class LinuxNativeProcessSandboxHost implements NativeProcessSandboxHost {
  private readonly processes = new Map<string, { child: any; handle: NativeProcessSandboxHandle; timer?: ReturnType<typeof setTimeout> }>();
  constructor(private readonly now: () => number = Date.now) {}
  async launchPlugin(request: NativePluginProcessRequest, signal?: AbortSignal): Promise<NativeProcessSandboxHandle> {
    if (!request.pluginId || !request.revisionHash || !request.entrypoint || isAbsolute(request.entrypoint) || request.entrypoint.includes('..') || isAbsolute(request.workingDirectory) === false) throw new NativeHostError('INVALID_REQUEST', 'Plugin process request is not scoped');
    if (!Number.isSafeInteger(request.policy.maxRuntimeMs) || request.policy.maxRuntimeMs < 1 || request.policy.maxRuntimeMs > 60 * 60_000 || request.policy.maxProcesses !== 1) throw new NativeHostError('INVALID_REQUEST', 'Plugin process resource policy is invalid');
    if (signal?.aborted) throw new NativeHostError('CANCELLED', 'Plugin launch cancelled');
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };
    for (const [key, value] of Object.entries(request.environment ?? {})) {
      if (!/^[A-Z0-9_]{1,64}$/.test(key) || /secret|token|key|credential|password|seed|mnemonic|cookie|auth/i.test(key) || /^(?:KEYSTONE_|LD_|DYLD_|NODE_OPTIONS|NODE_PATH|BASH_ENV|PYTHONPATH)/i.test(key)) continue;
      env[key] = String(value).slice(0, 4096);
    }
    // Host-owned identity of the sandbox cannot be overridden by plugin input.
    env.KEYSTONE_PLUGIN_ID = request.pluginId;
    env.KEYSTONE_PLUGIN_REVISION = request.revisionHash;
    const nodeArgs = request.policy.memoryBytes ? [`--max-old-space-size=${Math.max(16, Math.floor(request.policy.memoryBytes / (1024 * 1024)))}`, request.entrypoint] : [request.entrypoint];
    const child: any = spawn(process.execPath, nodeArgs, { cwd: request.workingDirectory, env: env as any, shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] } as any);
    const id = `nps:${randomId()}`; const handle: NativeProcessSandboxHandle = Object.freeze({ kind: 'NATIVE_PROCESS_SANDBOX_HANDLE', id, pluginId: request.pluginId, startedAt: new Date(this.now()).toISOString(), state: 'RUNNING' });
    const record: { child: any; handle: NativeProcessSandboxHandle; timer?: ReturnType<typeof setTimeout> } = { child, handle }; this.processes.set(id, record);
    const timer = setTimeout(() => { void this.terminate(handle, 'timeout'); }, request.policy.maxRuntimeMs); record.timer = timer; child.once('exit', () => { if (record.timer) clearTimeout(record.timer); this.processes.delete(id); });
    child.stdout?.on('data', (data: Uint8Array) => { if (Buffer.byteLength(data) > request.policy.maxOutputBytes) void this.terminate(handle, 'output quota'); }); child.stderr?.on('data', (data: Uint8Array) => { if (Buffer.byteLength(data) > request.policy.maxOutputBytes) void this.terminate(handle, 'output quota'); });
    return handle;
  }
  async terminate(handle: NativeProcessSandboxHandle, _reason = 'terminated'): Promise<void> { const record = this.processes.get(handle.id); if (!record) return; if (record.timer) clearTimeout(record.timer); record.child.kill('SIGTERM'); setTimeout(() => { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill('SIGKILL'); }, 1_000); this.processes.delete(handle.id); }
  health(handle: NativeProcessSandboxHandle): 'RUNNING' | 'EXITED' | 'KILLED' | 'UNKNOWN' { return this.processes.has(handle.id) ? 'RUNNING' : 'EXITED'; }
}
export class UnavailableProcessSandboxHost implements NativeProcessSandboxHost { launchPlugin(): Promise<NativeProcessSandboxHandle> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Native process sandbox is unavailable')); } terminate(): Promise<void> { return Promise.resolve(); } health(): 'UNKNOWN' { return 'UNKNOWN'; } }

export type NativeBackgroundKind = 'BACKGROUND_BEST_EFFORT' | 'BACKGROUND_TRANSFER' | 'BACKGROUND_SYNC' | 'BACKGROUND_CRITICAL';
export interface NativeBackgroundTask { readonly taskId: string; readonly kind: NativeBackgroundKind; readonly state: 'QUEUED' | 'RUNNING' | 'SUSPENDED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'; readonly createdAt: string; }
export interface NativeBackgroundTaskHost { schedule(kind: NativeBackgroundKind, task: (signal: AbortSignal) => Promise<void>, request: NativeHostRequest): Promise<NativeBackgroundTask>; cancel(taskId: string): Promise<void>; list(): readonly NativeBackgroundTask[]; }
export class InProcessBackgroundTaskHost implements NativeBackgroundTaskHost {
  private readonly tasks = new Map<string, { task: NativeBackgroundTask; controller: AbortController }>();
  constructor(private readonly now: () => number = Date.now, private readonly maxTasks = 16) {}
  async schedule(kind: NativeBackgroundKind, task: (signal: AbortSignal) => Promise<void>, request: NativeHostRequest): Promise<NativeBackgroundTask> { if (request.capability !== 'background.schedule' || (request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM' && request.principal.kind !== 'OWNER_UI')) throw new NativeHostError('POLICY_DENIED', 'Background task requires trusted provenance'); if (this.tasks.size >= this.maxTasks) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Background task quota exceeded'); const taskId = `nbt:${randomId()}`; const controller = new AbortController(); const record = { task: { taskId, kind, state: 'QUEUED' as const, createdAt: new Date(this.now()).toISOString() }, controller }; this.tasks.set(taskId, record); void task(controller.signal).then(() => this.update(taskId, 'COMPLETED')).catch(() => this.update(taskId, controller.signal.aborted ? 'CANCELLED' : 'FAILED')); this.update(taskId, 'RUNNING'); return record.task; }
  async cancel(taskId: string): Promise<void> { const record = this.tasks.get(taskId); if (record) record.controller.abort(); this.update(taskId, 'CANCELLED'); }
  list(): readonly NativeBackgroundTask[] { return [...this.tasks.values()].map(item => ({ ...item.task })); }
  private pruneTerminal(): void { for (const [id, value] of this.tasks) if (value.task.state === 'COMPLETED' || value.task.state === 'CANCELLED' || value.task.state === 'FAILED') this.tasks.delete(id); }
  private update(id: string, state: NativeBackgroundTask['state']): void { const record = this.tasks.get(id); if (record) record.task = { ...record.task, state }; }
}

export type NativePermissionName = 'camera' | 'microphone' | 'notifications' | 'bluetooth' | 'files' | 'wifiDirect' | 'usb' | 'location';
export type NativePermissionStatus = 'UNKNOWN' | 'NOT_REQUESTED' | 'GRANTED' | 'DENIED' | 'RESTRICTED' | 'UNAVAILABLE';
export interface NativePermissionRequest { readonly permission: NativePermissionName; readonly principal: NativeHostPrincipal; readonly ownerAction: string; readonly requestId: string; readonly explicitOwnerAction?: boolean; }
export interface NativePermissionState { readonly permission: NativePermissionName; readonly status: NativePermissionStatus; readonly changedAt: string; readonly reason?: string; }
export interface NativePermissionBroker { state(permission: NativePermissionName): NativePermissionState; request(input: NativePermissionRequest): Promise<NativePermissionState>; setForTest?(permission: NativePermissionName, status: NativePermissionStatus): void; }
export class TestNativePermissionBroker implements NativePermissionBroker {
  private readonly states = new Map<NativePermissionName, NativePermissionState>();
  constructor(private readonly now: () => number = Date.now) { for (const permission of ['camera', 'microphone', 'notifications', 'bluetooth', 'files', 'wifiDirect', 'usb', 'location'] as const) this.states.set(permission, { permission, status: 'NOT_REQUESTED', changedAt: new Date(this.now()).toISOString() }); }
  state(permission: NativePermissionName): NativePermissionState { return { ...this.states.get(permission)! }; }
  async request(input: NativePermissionRequest): Promise<NativePermissionState> { if (input.principal.kind !== 'OWNER_UI' || input.explicitOwnerAction !== true) { const denied = { permission: input.permission, status: 'DENIED' as const, changedAt: new Date(this.now()).toISOString(), reason: 'Permission dialogs require explicit owner action' }; this.states.set(input.permission, denied); return denied; } const granted = { permission: input.permission, status: 'GRANTED' as const, changedAt: new Date(this.now()).toISOString() }; this.states.set(input.permission, granted); return granted; }
  setForTest(permission: NativePermissionName, status: NativePermissionStatus): void { this.states.set(permission, { permission, status, changedAt: new Date(this.now()).toISOString() }); }
}
export class PlatformPermissionBroker implements NativePermissionBroker {
  private readonly states = new Map<NativePermissionName, NativePermissionState>();
  constructor(private readonly platform: NativeHostPlatform, private readonly now: () => number = Date.now) {
    for (const permission of ['camera', 'microphone', 'notifications', 'bluetooth', 'files', 'wifiDirect', 'usb', 'location'] as const) {
      const status: NativePermissionStatus = ['camera', 'microphone', 'bluetooth', 'wifiDirect', 'usb', 'location'].includes(permission) ? 'UNAVAILABLE' : 'NOT_REQUESTED';
      this.states.set(permission, { permission, status, changedAt: new Date(this.now()).toISOString(), ...(status === 'UNAVAILABLE' ? { reason: `No verified ${this.platform} permission adapter` } : {}) });
    }
  }
  state(permission: NativePermissionName): NativePermissionState { return { ...this.states.get(permission)! }; }
  async request(input: NativePermissionRequest): Promise<NativePermissionState> {
    const current = this.state(input.permission);
    if (input.principal.kind !== 'OWNER_UI' || input.explicitOwnerAction !== true) return { ...current, status: 'DENIED', changedAt: new Date(this.now()).toISOString(), reason: 'Explicit owner action is required' };
    if (current.status === 'UNAVAILABLE') return current;
    const next = { ...current, status: 'UNAVAILABLE' as const, changedAt: new Date(this.now()).toISOString(), reason: `No verified ${this.platform} permission adapter` };
    this.states.set(input.permission, next); return next;
  }
}

// ---------------------------------------------------------------------------
// Privacy-preserving device/media/network contracts
// ---------------------------------------------------------------------------

export type NativeLocationPrecision = 'APPROXIMATE' | 'PRECISE';
export type NativeLocationPurpose = 'ONE_SHOT' | 'FOREGROUND' | 'BACKGROUND';
export interface NativeLocationRequest {
  readonly precision: NativeLocationPrecision;
  readonly purpose: NativeLocationPurpose;
  readonly timeoutMs?: number;
  readonly maximumAgeMs?: number;
}
export interface NativeLocationFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly horizontalAccuracy: number;
  readonly altitude?: number;
  readonly altitudeAccuracy?: number;
  readonly heading?: number;
  readonly speed?: number;
  readonly timestamp: string;
  readonly source: 'DEVICE_SENSOR' | 'OS_LOCATION_SERVICE' | 'TEST';
  /** Hosts should report what the OS actually delivered.  Older adapters may
   * omit it; the Core provider then treats the requested precision as the
   * adapter contract and still applies its own coarsening boundary. */
  readonly precision?: NativeLocationPrecision;
}
export interface NativeLocationWatch {
  readonly kind: 'NATIVE_LOCATION_WATCH';
  readonly id: string;
  readonly expiresAt: string;
  readonly state: 'ACTIVE' | 'STOPPED';
}
export interface NativeLocationHost {
  permission(request: NativeHostRequest): Promise<NativePermissionState>;
  current(input: NativeLocationRequest, request: NativeHostRequest): Promise<NativeLocationFix>;
  watch(input: NativeLocationRequest, request: NativeHostRequest, onUpdate: (fix: NativeLocationFix) => void | Promise<void>, onError?: (error: NativeHostError) => void | Promise<void>): Promise<NativeLocationWatch>;
  stop(watch: NativeLocationWatch, request: NativeHostRequest): Promise<void>;
}
export class UnavailableLocationHost implements NativeLocationHost {
  permission(): Promise<NativePermissionState> { return Promise.resolve({ permission: 'location', status: 'UNAVAILABLE', changedAt: new Date().toISOString(), reason: 'No verified OS location adapter is available' }); }
  current(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'OS location is unavailable on this host')); }
  watch(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'OS location is unavailable on this host')); }
  stop(): Promise<void> { return Promise.resolve(); }
}

export interface NativeNotification { readonly notificationId: string; readonly title: string; readonly body?: string; readonly source: 'KEYSTONE_CORE' | 'PLUGIN'; readonly pluginId?: string; readonly category: 'SECURITY' | 'PERMISSION' | 'SOCIAL' | 'GENERAL'; }
export interface NativeNotificationHost { post(input: NativeNotification, request: NativeHostRequest): Promise<void>; cancel(notificationId: string, request: NativeHostRequest): Promise<void>; }
export class InMemoryNotificationHost implements NativeNotificationHost {
  readonly posted: NativeNotification[] = [];
  async post(input: NativeNotification, request: NativeHostRequest): Promise<void> { if (input.source === 'KEYSTONE_CORE' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM' && request.principal.kind !== 'OWNER_UI') throw new NativeHostError('POLICY_DENIED', 'Only Core may post a Keystone notification'); if (input.source === 'PLUGIN' && input.category === 'SECURITY') throw new NativeHostError('POLICY_DENIED', 'Plugin cannot impersonate Security'); if (!input.title.trim() || input.title.length > 160) throw new NativeHostError('INVALID_REQUEST', 'Notification title is invalid'); this.posted.push(structuredClone(input)); }
  async cancel(notificationId: string): Promise<void> { const index = this.posted.findIndex(item => item.notificationId === notificationId); if (index >= 0) this.posted.splice(index, 1); }
}
export interface NativeClipboard { read(request: NativeHostRequest): Promise<string | undefined>; write(text: string, request: NativeHostRequest, options?: { autoClearMs?: number }): Promise<void>; clear(request: NativeHostRequest): Promise<void>; }
export class InMemoryClipboard implements NativeClipboard { private value?: { text: string; clearAt?: number }; async read(request: NativeHostRequest): Promise<string | undefined> { if (request.capability !== 'clipboard.read' || request.principal.kind !== 'OWNER_UI') throw new NativeHostError('POLICY_DENIED', 'Clipboard read requires owner UI'); if (this.value?.clearAt && this.value.clearAt <= Date.now()) this.value = undefined; return this.value?.text; } async write(text: string, request: NativeHostRequest, options?: { autoClearMs?: number }): Promise<void> { if (request.capability !== 'clipboard.write' || request.principal.kind !== 'OWNER_UI' || request.ownerConfirmed !== true || text.length > 1_000_000) throw new NativeHostError('POLICY_DENIED', 'Clipboard write requires explicit owner confirmation'); if (options?.autoClearMs !== undefined && (!Number.isSafeInteger(options.autoClearMs) || options.autoClearMs < 0 || options.autoClearMs > 900_000)) throw new NativeHostError('INVALID_REQUEST', 'Clipboard auto-clear value is invalid'); this.value = { text, ...(options?.autoClearMs ? { clearAt: Date.now() + options.autoClearMs } : {}) }; } async clear(request: NativeHostRequest): Promise<void> { if (request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') throw new NativeHostError('POLICY_DENIED', 'Clipboard clear requires trusted provenance'); this.value = undefined; } }
export interface NativeExternalLinkGateway { openApprovedUrl(url: string, request: NativeHostRequest): Promise<{ accepted: boolean; url?: string }>; }
export class CoreExternalLinkGateway implements NativeExternalLinkGateway { constructor(private readonly open: (url: string) => Promise<void> = async () => undefined) {} async openApprovedUrl(url: string, request: NativeHostRequest): Promise<{ accepted: boolean; url?: string }> { if (request.capability !== 'external-link.open' || request.ownerConfirmed !== true || request.principal.kind !== 'OWNER_UI' && request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') throw new NativeHostError('POLICY_DENIED', 'External URL opening requires the Core gateway and owner confirmation'); let parsed: URL; try { parsed = new URL(url); } catch { throw new NativeHostError('INVALID_REQUEST', 'URL is invalid'); } if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || isUnsafeHost(parsed.hostname)) throw new NativeHostError('POLICY_DENIED', 'URL is not an approved external destination'); await this.open(parsed.toString()); return { accepted: true, url: parsed.toString() }; } }

export interface NativeCameraHandle { readonly kind: 'NATIVE_CAMERA_HANDLE'; readonly id: string; readonly sessionId: string; readonly state: 'OPEN' | 'CLOSED'; }
export interface NativeMicrophoneHandle { readonly kind: 'NATIVE_MICROPHONE_HANDLE'; readonly id: string; readonly sessionId: string; readonly state: 'OPEN' | 'CLOSED'; }
export interface NativeCameraHost { open(request: NativeHostRequest): Promise<NativeCameraHandle>; start(handle: NativeCameraHandle, options?: { width?: number; height?: number; fps?: number }): Promise<void>; stop(handle: NativeCameraHandle): Promise<void>; }
export interface NativeMicrophoneHost { open(request: NativeHostRequest): Promise<NativeMicrophoneHandle>; start(handle: NativeMicrophoneHandle): Promise<void>; stop(handle: NativeMicrophoneHandle): Promise<void>; }
export class UnavailableMediaHost implements NativeCameraHost, NativeMicrophoneHost { private unavailable(): never { throw new NativeHostError('UNSUPPORTED', 'Media device is unavailable on this host'); } open(): Promise<never> { return Promise.reject(this.unavailable()); } start(): Promise<void> { return Promise.reject(this.unavailable()); } stop(): Promise<void> { return Promise.reject(this.unavailable()); } }
export interface NativeAudioHost { play(reference: string, request: NativeHostRequest): Promise<{ playbackId: string }>; stop(playbackId: string, request: NativeHostRequest): Promise<void>; }
export class InMemoryAudioHost implements NativeAudioHost { private readonly active = new Set<string>(); async play(reference: string, request: NativeHostRequest): Promise<{ playbackId: string }> { if (request.capability !== 'audio.playback') throw new NativeHostError('POLICY_DENIED', 'Audio capability is required'); const playbackId = `audio:${randomId()}`; this.active.add(playbackId); return { playbackId }; } async stop(playbackId: string): Promise<void> { this.active.delete(playbackId); } }
export interface NativeWebRTCHost { createSession(request: NativeHostRequest): Promise<NativeWebRTCSession>; closeSession(session: NativeWebRTCSession): Promise<void>; }
export interface NativeWebRTCSession { readonly kind: 'NATIVE_WEBRTC_SESSION'; readonly id: string; readonly authenticated: false; readonly state: 'CREATED' | 'CLOSED'; }
export class UnavailableWebRTCHost implements NativeWebRTCHost { createSession(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Native WebRTC adapter is unavailable')); } closeSession(): Promise<void> { return Promise.resolve(); } }

export interface NativeNetworkSnapshot { readonly online: boolean; readonly lanAvailable: boolean; readonly metered: boolean | 'UNKNOWN'; readonly interfaceCount: number | 'UNKNOWN'; }
export interface NativeLanHost { snapshot(request: NativeHostRequest): Promise<NativeNetworkSnapshot>; discover(options: { maxResults?: number; durationMs?: number }, request: NativeHostRequest): Promise<readonly NativeLanPeer[]>; }
export interface NativeLanPeer { readonly endpointId: string; readonly transport: 'LAN'; readonly expiresAt: string; }
export class CoarseNativeLanHost implements NativeLanHost { async snapshot(): Promise<NativeNetworkSnapshot> { return { online: true, lanAvailable: false, metered: 'UNKNOWN', interfaceCount: 'UNKNOWN' }; } async discover(options: { maxResults?: number; durationMs?: number }, request: NativeHostRequest): Promise<readonly NativeLanPeer[]> { if (request.capability !== 'lan.discovery') throw new NativeHostError('POLICY_DENIED', 'LAN discovery capability is required'); if ((options.maxResults ?? 32) > 64 || (options.durationMs ?? 0) > 30_000) throw new NativeHostError('RESOURCE_EXHAUSTED', 'LAN discovery bounds exceeded'); return []; } }
export type NativeBluetoothAdapterState = 'UNKNOWN' | 'POWERED_OFF' | 'POWERED_ON' | 'UNAVAILABLE' | 'PERMISSION_REQUIRED';
export type NativeBluetoothPhy = 'LE_1M' | 'LE_2M' | 'LE_CODED' | 'UNKNOWN';
export interface NativeBluetoothCapability { readonly scanning: boolean; readonly advertising: boolean; readonly connections: boolean; readonly phys?: readonly NativeBluetoothPhy[]; readonly maxAdvertisementBytes?: number | 'UNKNOWN'; readonly maxWriteBytes?: number | 'UNKNOWN'; }
export interface NativeBluetoothScanSession { readonly kind: 'NATIVE_BLUETOOTH_SCAN'; readonly id: string; readonly expiresAt: string; readonly maxResults: number; }
export interface NativeBluetoothAdvertisementSession { readonly kind: 'NATIVE_BLUETOOTH_ADVERTISEMENT'; readonly id: string; readonly expiresAt: string; }
export interface NativeBluetoothConnection { readonly kind: 'NATIVE_BLUETOOTH_CONNECTION'; readonly id: string; readonly endpointId: string; readonly state: 'CONNECTED' | 'CLOSED'; }
/** Raw endpoint identifiers remain inside NativeHost/provider code and are
 * never social identities or user-visible device names. */
export interface NativeBluetoothEndpointObservation { readonly endpointId: string; readonly advertisement: Uint8Array; readonly observedAt: string; readonly expiresAt: string; readonly signalQuality?: number | 'UNKNOWN'; readonly phy?: NativeBluetoothPhy; }
export interface NativeBluetoothHost {
  state(request: NativeHostRequest): Promise<{ adapter: NativeBluetoothAdapterState; capability: NativeBluetoothCapability }>;
  scan(options: { durationMs: number; maxResults: number }, request: NativeHostRequest, onEndpoint?: (endpoint: NativeBluetoothEndpointObservation) => void | Promise<void>): Promise<NativeBluetoothScanSession>;
  stopScan(session: NativeBluetoothScanSession): Promise<void>;
  advertise(payload: Uint8Array, options: { durationMs: number; intervalMs?: number }, request: NativeHostRequest): Promise<NativeBluetoothAdvertisementSession>;
  stopAdvertising(session: NativeBluetoothAdvertisementSession): Promise<void>;
  connect(endpointId: string, request: NativeHostRequest): Promise<NativeBluetoothConnection>;
  onIncomingConnection(handler: (connection: NativeBluetoothConnection) => void | Promise<void>): () => void;
  receive(connection: NativeBluetoothConnection, handler: (bytes: Uint8Array) => void | Promise<void>): () => void;
  onDisconnect(connection: NativeBluetoothConnection, handler: () => void): () => void;
  send(connection: NativeBluetoothConnection, bytes: Uint8Array, request: NativeHostRequest): Promise<void>;
  close(connection: NativeBluetoothConnection): Promise<void>;
}
export class UnavailableBluetoothHost implements NativeBluetoothHost {
  async state(): Promise<{ adapter: NativeBluetoothAdapterState; capability: NativeBluetoothCapability }> { return { adapter: 'UNAVAILABLE', capability: { scanning: false, advertising: false, connections: false, phys: ['UNKNOWN'], maxAdvertisementBytes: 'UNKNOWN', maxWriteBytes: 'UNKNOWN' } }; }
  scan(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Bluetooth is unavailable')); }
  stopScan(): Promise<void> { return Promise.resolve(); }
  advertise(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Bluetooth is unavailable')); }
  stopAdvertising(): Promise<void> { return Promise.resolve(); }
  connect(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Bluetooth is unavailable')); }
  onIncomingConnection(): () => void { return () => undefined; }
  receive(): () => void { return () => undefined; }
  onDisconnect(): () => void { return () => undefined; }
  send(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Bluetooth is unavailable')); }
  close(): Promise<void> { return Promise.resolve(); }
}
export interface NativeWiFiDirectHost { state(request: NativeHostRequest): Promise<'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'PERMISSION_REQUIRED'>; connect(peer: string, request: NativeHostRequest): Promise<{ connectionId: string }>; close(connectionId: string, request: NativeHostRequest): Promise<void>; }
export class UnavailableWiFiDirectHost implements NativeWiFiDirectHost { state(): Promise<'UNSUPPORTED'> { return Promise.resolve('UNSUPPORTED'); } connect(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Wi-Fi Direct is unsupported by this adapter')); } close(): Promise<void> { return Promise.resolve(); } }
export interface NativeUsbDeviceHandle { readonly kind: 'NATIVE_USB_DEVICE_HANDLE'; readonly id: string; readonly state: 'CONNECTED' | 'CLOSED'; }
export interface NativeUsbHost { enumerate(request: NativeHostRequest): Promise<readonly { deviceId: string; vendorClass?: string }[]>; connect(deviceId: string, request: NativeHostRequest): Promise<NativeUsbDeviceHandle>; close(handle: NativeUsbDeviceHandle, request: NativeHostRequest): Promise<void>; }
export class UnavailableUsbHost implements NativeUsbHost { enumerate(): Promise<readonly never[]> { return Promise.resolve([]); } connect(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'USB host is unavailable')); } close(): Promise<void> { return Promise.resolve(); } }

// ---------------------------------------------------------------------------
// Host implementations and explicit adapter selection
// ---------------------------------------------------------------------------

export interface NativeHostAdapters {
  readonly secureStorage: NativeSecureStorage;
  readonly fileSystem: NativeFileSystemService;
  readonly processSandbox: NativeProcessSandboxHost;
  readonly media: NativeMediaHost;
  readonly background: NativeBackgroundTaskHost;
  readonly permissions: NativePermissionBroker;
  readonly notifications: NativeNotificationHost;
  readonly clipboard: NativeClipboard;
  readonly externalLinks: NativeExternalLinkGateway;
  readonly camera: NativeCameraHost;
  readonly microphone: NativeMicrophoneHost;
  readonly audio: NativeAudioHost;
  readonly webRtc: NativeWebRTCHost;
  readonly location: NativeLocationHost;
  readonly lan: NativeLanHost;
  readonly bluetooth: NativeBluetoothHost;
  readonly wifiDirect: NativeWiFiDirectHost;
  readonly usb: NativeUsbHost;
}
export interface NativeHostOptions { readonly root?: string; readonly policy?: NativeHostPolicy; readonly adapters?: Partial<NativeHostAdapters>; readonly now?: () => number; readonly featureOverrides?: Partial<Record<NativeHostFeature, NativeHostFeatureState>>; }
export class BaseNativeHost implements NativeHost {
  readonly environment: NativeHostEnvironment;
  readonly platform: NativeHostPlatform;
  private readonly adapters: NativeHostAdapters;
  private readonly policy: NativeHostPolicy;
  private readonly now: () => number;
  private readonly sessionId = `nhs:${randomId()}`;
  private lifecycleState: NativeLifecycleState = 'FOREGROUND';
  private readonly sessions = new Map<string, NativeHostSession>();
  private readonly events: NativeHostAuditEvent[] = [];
  private readonly featureRecords: NativeHostFeatureRecord[];
  constructor(platform: NativeHostPlatform, environment: NativeHostEnvironment, options: NativeHostOptions = {}) {
    this.platform = platform; this.environment = environment; this.now = options.now ?? Date.now; this.policy = options.policy ?? new DefaultNativeHostPolicy();
    const root = options.root ?? join(tmpdir(), `keystone-native-${environment.toLowerCase()}`); const fileSystem = options.adapters?.fileSystem ?? new NativeFileSystemService(root, () => this.sessionId, this.now, id => id === this.sessionId || this.sessions.has(id)); void fileSystem.init();
    this.adapters = { secureStorage: options.adapters?.secureStorage ?? (environment === 'TEST' ? new TestSecureStorage(this.now) : platform === 'linux' ? createLinuxProductionSecureStorage() : new UnavailableSecureStorage()), fileSystem, processSandbox: options.adapters?.processSandbox ?? ((environment === 'TEST' || platform === 'linux') ? new LinuxNativeProcessSandboxHost(this.now) : new UnavailableProcessSandboxHost()), media: options.adapters?.media ?? (environment === 'TEST' || platform !== 'linux' ? new UnavailableNativeMediaHost() : new LinuxNativeMediaHost()), background: options.adapters?.background ?? new InProcessBackgroundTaskHost(this.now), permissions: options.adapters?.permissions ?? new PlatformPermissionBroker(platform, this.now), notifications: options.adapters?.notifications ?? new InMemoryNotificationHost(), clipboard: options.adapters?.clipboard ?? new InMemoryClipboard(), externalLinks: options.adapters?.externalLinks ?? new CoreExternalLinkGateway(), camera: options.adapters?.camera ?? new UnavailableMediaHost(), microphone: options.adapters?.microphone ?? new UnavailableMediaHost(), audio: options.adapters?.audio ?? new InMemoryAudioHost(), webRtc: options.adapters?.webRtc ?? new UnavailableWebRTCHost(), location: options.adapters?.location ?? new UnavailableLocationHost(), lan: options.adapters?.lan ?? new CoarseNativeLanHost(), bluetooth: options.adapters?.bluetooth ?? new UnavailableBluetoothHost(), wifiDirect: options.adapters?.wifiDirect ?? new UnavailableWiFiDirectHost(), usb: options.adapters?.usb ?? new UnavailableUsbHost() };
    const feature = (name: NativeHostFeature, state: NativeHostFeatureState, reason?: string): NativeHostFeatureRecord => ({ feature: name, state, ...(reason ? { reason } : {}), checkedAt: new Date(this.now()).toISOString() });
    // Secret Service probing is asynchronous and must be explicit (see
    // PhysicalFeatureProbe). Until it has been verified, production reports
    // the conservative fail-closed state even when an OS adapter is present.
    const defaultStates: Record<NativeHostFeature, NativeHostFeatureState> = { secureStorage: environment === 'TEST' ? 'AVAILABLE' : this.adapters.secureStorage.kind === 'OS_SECURE_STORAGE' ? 'DEGRADED' : 'UNAVAILABLE', filesystem: 'AVAILABLE', notifications: 'DEGRADED', backgroundExecution: 'DEGRADED', camera: 'UNAVAILABLE', microphone: 'UNAVAILABLE', audio: 'DEGRADED', bluetooth: 'UNAVAILABLE', wifiDirect: 'UNSUPPORTED', lanDiscovery: 'DEGRADED', usb: 'UNAVAILABLE', webRtc: 'UNAVAILABLE', location: this.adapters.location instanceof UnavailableLocationHost ? 'UNAVAILABLE' : 'DEGRADED', processSandbox: (environment === 'TEST' || platform === 'linux') ? 'DEGRADED' : 'UNSUPPORTED', clipboard: 'DEGRADED', externalLinks: 'AVAILABLE', power: 'DEGRADED', thermal: 'DEGRADED', permissions: 'DEGRADED', mediaDecoder: this.adapters.media.capabilities().length ? 'AVAILABLE' : 'UNAVAILABLE' };
    this.featureRecords = NATIVE_HOST_FEATURES.map(name => feature(name, options.featureOverrides?.[name] ?? defaultStates[name], defaultStates[name] === 'UNAVAILABLE' ? 'No adapter was verified on this host' : undefined));
  }
  capabilities(): readonly NativeHostFeatureRecord[] { return this.featureRecords.map(value => ({ ...value })); }
  feature(feature: NativeHostFeature): NativeHostFeatureRecord { const value = this.featureRecords.find(item => item.feature === feature); if (!value) throw new NativeHostError('NOT_FOUND', `Unknown native feature: ${feature}`); return { ...value }; }
  health(): NativeHostHealth { const degraded = this.featureRecords.some(item => item.state === 'DEGRADED' || item.state === 'PERMISSION_REQUIRED'); return { state: degraded ? 'DEGRADED' : 'HEALTHY', features: this.capabilities() }; }
  openSession(principal: NativeHostPrincipal, ttlMs = 30 * 60_000): NativeHostSession { if (!principal?.id || !principal.kind || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 24 * 60 * 60_000) throw new NativeHostError('INVALID_REQUEST', 'Native host session is invalid'); const sessionId = `nhsession:${randomId()}`; const session: NativeHostSession = { sessionId, hostSessionId: this.sessionId, principal: structuredClone(principal), createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + ttlMs).toISOString(), active: true }; this.sessions.set(sessionId, session); return structuredClone(session); }
  closeSession(sessionId: string): void { this.sessions.delete(sessionId); this.adapters.fileSystem.revokeSession(sessionId); }
  audit(): readonly NativeHostAuditEvent[] { return this.events.map(value => structuredClone(value)); }
  lifecycle(): NativeLifecycleState { return this.lifecycleState; }
  setLifecycle(state: NativeLifecycleState): void { this.lifecycleState = state; if (state === 'TERMINATING' || state === 'SUSPENDED') for (const [id, session] of this.sessions) this.closeSession(id); }
  power(): NativePowerState { return { batteryClass: 'UNKNOWN', charging: 'UNKNOWN', powerSaver: 'UNKNOWN', source: 'UNAVAILABLE' }; }
  thermal(): NativeThermalState { return { class: 'UNKNOWN', source: 'UNAVAILABLE' }; }
  location(): NativeLocationHost { return this.adapters.location; }
  media(): NativeMediaHost { return this.adapters.media; }
  async requestPermission(request: NativePermissionRequest): Promise<NativePermissionState> { if (request.principal.kind !== 'OWNER_UI' || request.explicitOwnerAction !== true) { this.record({ requestId: request.requestId, principal: request.principal.kind, capability: 'permissions.request', decision: 'DENY', reason: 'Explicit owner action is required' }); return { permission: request.permission, status: 'DENIED', changedAt: new Date(this.now()).toISOString(), reason: 'Explicit owner action is required' }; } return this.adapters.permissions.request(request); }
  async request<T>(request: NativeHostRequest, operation: () => Promise<T> | T): Promise<NativeHostResult<T>> { if (request.principal.kind !== 'CORE_TRUSTED_SUBSYSTEM') { this.record({ requestId: request.requestId, principal: request.principal.kind, capability: request.capability, decision: 'DENY', reason: 'Generic host execution is restricted to trusted Core adapters', resource: request.resource }); return { requestId: request.requestId, accepted: false, error: 'POLICY_DENIED' }; } const feature = featureForCapability(request.capability); const record = this.feature(feature); const decision = this.policy.authorize(request, record.state); this.record({ requestId: request.requestId, principal: request.principal.kind, capability: request.capability, decision: decision.allowed ? 'ALLOW' : 'DENY', reason: decision.reason, resource: request.resource }); if (!decision.allowed) return { requestId: request.requestId, accepted: false, error: record.state === 'UNSUPPORTED' || record.state === 'UNAVAILABLE' ? 'UNSUPPORTED' : 'POLICY_DENIED' }; try { const value = await operation(); return { requestId: request.requestId, accepted: true, value }; } catch (error) { const mapped = mapNativeError(error); this.record({ requestId: request.requestId, principal: request.principal.kind, capability: request.capability, decision: 'ERROR', reason: mapped.message, resource: request.resource }); return { requestId: request.requestId, accepted: false, error: mapped.code }; } }
  private record(input: Omit<NativeHostAuditEvent, 'id' | 'at'>): void { this.events.push({ ...input, id: `nha:${randomId()}`, at: new Date(this.now()).toISOString() }); if (this.events.length > 512) this.events.shift(); }
}

export class TestNativeHost extends BaseNativeHost {
  constructor(options: Omit<NativeHostOptions, 'featureOverrides'> & { featureOverrides?: NativeHostOptions['featureOverrides'] } = {}) { super('unknown', 'TEST', { ...options, featureOverrides: { ...options.featureOverrides, secureStorage: options.featureOverrides?.secureStorage ?? 'AVAILABLE', processSandbox: options.featureOverrides?.processSandbox ?? 'AVAILABLE' } }); }
  assertTestOnly(): void { if (this.environment !== 'TEST') throw new NativeHostError('POLICY_DENIED', 'TestNativeHost cannot masquerade as production'); }
}
export class LinuxNativeHost extends BaseNativeHost { constructor(options: NativeHostOptions = {}) { super('linux', 'PRODUCTION', options); } }
export class WindowsNativeHost extends BaseNativeHost { constructor(options: NativeHostOptions = {}) { super('windows', 'PRODUCTION', options); } }
export class MacOSNativeHost extends BaseNativeHost { constructor(options: NativeHostOptions = {}) { super('macos', 'PRODUCTION', options); } }
export class AndroidNativeHost extends BaseNativeHost { constructor(options: NativeHostOptions = {}) { super('android', 'PRODUCTION', options); } }
export class IOSNativeHost extends BaseNativeHost { constructor(options: NativeHostOptions = {}) { super('ios', 'PRODUCTION', options); } }
export function detectNativePlatform(): NativeHostPlatform { const value = process.platform; if (value === 'linux') return 'linux'; if (value === 'win32') return 'windows'; if (value === 'darwin') return 'macos'; return 'unknown'; }
export function createProductionNativeHost(options: NativeHostOptions = {}): NativeHost { const platform = detectNativePlatform(); if (platform === 'linux') return new LinuxNativeHost(options); if (platform === 'windows') return new WindowsNativeHost(options); if (platform === 'macos') return new MacOSNativeHost(options); throw new NativeHostError('UNSUPPORTED', `No production NativeHost adapter for ${platform}`); }
export function createTestNativeHost(options: NativeHostOptions = {}): TestNativeHost { return new TestNativeHost(options); }

function featureForCapability(capability: NativeHostCapability): NativeHostFeature { const prefix = capability.split('.')[0]; const mapping: Record<string, NativeHostFeature> = { 'secure-storage': 'secureStorage', filesystem: 'filesystem', process: 'processSandbox', media: 'mediaDecoder', background: 'backgroundExecution', notifications: 'notifications', clipboard: 'clipboard', 'external-link': 'externalLinks', camera: 'camera', microphone: 'microphone', audio: 'audio', webrtc: 'webRtc', lan: 'lanDiscovery', bluetooth: 'bluetooth', 'wifi-direct': 'wifiDirect', usb: 'usb', power: 'power', thermal: 'thermal', permissions: 'permissions', location: 'location' }; return mapping[prefix] ?? 'filesystem'; }
function mapNativeError(error: unknown): NativeHostError { if (error instanceof NativeHostError) return error; return new NativeHostError('PLATFORM_FAILURE', error instanceof Error ? error.message : 'Native operation failed'); }
function randomId(): string { return randomBytes(12).toString('hex'); }
function digest(key: Uint8Array, data: Uint8Array): Uint8Array { return new Uint8Array(createHash('sha256').update(key).update(data).digest()); }
function isUnsafeHost(hostname: string): boolean { const host = hostname.toLowerCase().replace(/\.$/, ''); return host === 'localhost' || host === '::1' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host); }

export * from './runtime.js';
export * from './media.js';
export * from './documents.js';
