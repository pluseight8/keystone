/**
 * Local desktop bootstrap for the first usable Keystone build.
 *
 * The renderer only owns typed adapters and bounded JSON state. The business
 * rules still live in Core services; this module supplies the small local
 * persistence boundary that lets those services work before a richer native
 * host is connected.
 */
import {
  AISettingsService,
  CaptureService,
  canonicalJson,
  ContentCacheFolderContentStore,
  DocumentService,
  IdentityManager,
  PersistentDiscoveryStorage,
  SharedFolderService,
  TaskService,
  UnifiedDiscoveryService,
  sha256,
} from '@keystone/core';
import { SodiumCryptoProvider } from '../../../packages/core/src/browser.js';
import type {
  DocumentFileRef,
  DocumentFileSource,
  DocumentStateStore,
  TaskStateStore,
  CaptureStateStore,
  FolderId,
} from '@keystone/core';
import type { NodeId } from '@keystone/core';
import { createDesktopCaptureRuntime, installDesktopCaptureRuntime } from './desktop-capture-runtime';
import { createDesktopDocumentsRuntime, installDesktopDocumentsRuntime, type DesktopDocumentsRuntime } from './desktop-documents-runtime';
import { createDesktopTasksRuntime, installDesktopTasksRuntime } from './desktop-tasks-runtime';
import { createDesktopAIRuntime, installDesktopAIRuntime, type DesktopAIRuntime } from './desktop-ai-runtime';
import { createDesktopDiscoveryRuntime, installDesktopDiscoveryRuntime, type DesktopDiscoveryRuntime } from './desktop-discovery-runtime';
import { createDesktopNetworkRuntime, installDesktopNetworkRuntime, type DesktopNetworkRuntime } from './desktop-network-runtime';
import { DesktopIndexedDbStateStore } from './desktop-browser-state';
import { TauriSecureSecretHost, createDesktopIdentitySigner, removeDesktopIdentity } from './desktop-host-bridge';
import { createDesktopFilesRuntime, installDesktopFilesRuntime, type DesktopFilesRuntime } from './desktop-files-runtime';
import { createDesktopLocalMediaRuntimes, type DesktopLocalMediaRuntimes } from './desktop-local-media-runtime';
import { installDesktopMusicRuntime, installDesktopShortsRuntime, installDesktopVideoRuntime } from './desktop-media-runtime';

const PROFILE_KEY = 'keystone.local.identity.v1';
const CAPTURE_STATE_KEY = 'keystone.local.capture.v1';
const TASK_STATE_KEY = 'keystone.local.tasks.v1';
const DOCUMENT_STATE_KEY = 'keystone.local.documents.metadata.v1';
const DOCUMENT_FILES_KEY = 'keystone.local.documents.files.v1';
const AI_SETTINGS_KEY = 'keystone.local.ai-settings.v1';
const DISCOVERY_STATE_KEY = 'keystone.local.discovery.v1';
const FILES_STATE_KEY = 'keystone.local.files.v1';
const DOCUMENT_FILES_STATE_KEY = 'keystone.local.documents.files.v2';
const MAX_LOCAL_DOCUMENTS = 64;
const MAX_LOCAL_DOCUMENT_BYTES = 8 * 1024 * 1024;

export interface LocalDesktopProfile {
  readonly version: 1;
  readonly displayName: string;
  readonly deviceName: string;
  readonly ownerIdentityId: NodeId;
  readonly deviceId: string;
  readonly nodeId: NodeId;
  readonly publicKey: string;
  readonly encryptionPublicKey: string;
  readonly createdAt: string;
}

export interface DesktopLocalDocumentsRuntime extends DesktopDocumentsRuntime {
  createText(input: { readonly filename: string; readonly content: string }): Promise<DocumentFileRef>;
  importFile(input: { readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array }): Promise<DocumentFileRef>;
}

export class DesktopJsonStateStore implements CaptureStateStore, TaskStateStore, DocumentStateStore {
  private memory?: unknown;

  constructor(private readonly key: string) {}

  async read(): Promise<unknown | undefined> {
    if (this.memory !== undefined) return clone(this.memory);
    try {
      const raw = window.localStorage.getItem(this.key);
      this.memory = raw ? JSON.parse(raw) : undefined;
    } catch {
      this.memory = undefined;
    }
    return clone(this.memory);
  }

  async write(value: unknown): Promise<void> {
    const next = clone(value);
    this.memory = next;
    try {
      window.localStorage.setItem(this.key, JSON.stringify(next));
    } catch {
      // Core services surface their own persistence state. A private browsing
      // quota failure must not turn a usable local session into a blank screen.
    }
  }
}

interface PersistedLocalFile {
  readonly version: 1;
  readonly fileId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
  readonly contentId: NonNullable<DocumentFileRef['contentId']>;
  readonly bytes: string;
  readonly createdAt: string;
  readonly ownerId: string;
}

interface IndexedDbLocalFile extends Omit<PersistedLocalFile, 'bytes'> {
  readonly bytes: Uint8Array;
}

class LocalDocumentFileSource implements DocumentFileSource {
  private readonly files = new Map<string, { readonly ref: DocumentFileRef; readonly bytes: Uint8Array; readonly createdAt: string }>();
  private readonly state: DesktopIndexedDbStateStore;
  private readonly hydration: Promise<void>;

  constructor(private readonly ownerId: string) {
    this.state = new DesktopIndexedDbStateStore(`${DOCUMENT_FILES_STATE_KEY}:${ownerId}`);
    this.hydration = this.hydrate();
  }

  async ready(): Promise<void> { await this.hydration; }

  async register(filename: string, mimeType: string, bytes: Uint8Array): Promise<DocumentFileRef> {
    await this.ready();
    if (!filename.trim() || filename.length > 255) throw new Error('Document filename is invalid');
    if (!mimeType.trim() || mimeType.length > 255) throw new Error('Document MIME type is invalid');
    if (bytes.byteLength > MAX_LOCAL_DOCUMENT_BYTES) throw new Error('Local document is larger than 8 MiB');
    const copy = bytes.slice();
    const contentId = `sha256-${await sha256(copy)}` as NonNullable<DocumentFileRef['contentId']>;
    const fileId = `local-document:${contentId}`;
    const createdAt = new Date().toISOString();
    const ref: DocumentFileRef = {
      fileId,
      revision: { version: 1, fileId, revisionId: contentId, contentId },
      filename: filename.trim().slice(0, 255),
      mimeType: mimeType.trim().slice(0, 255),
      size: copy.byteLength,
      contentId,
      visibility: 'private',
      ownerId: this.ownerId,
      scope: 'LOCAL_ONLY',
    };
    const previous = this.files.get(fileId);
    this.files.set(fileId, { ref, bytes: copy, createdAt });
    try { await this.persist(); }
    catch (error) { if (previous) this.files.set(fileId, previous); else this.files.delete(fileId); throw error; }
    return clone(ref);
  }

  async getFile(fileId: string): Promise<DocumentFileRef | undefined> {
    await this.ready();
    return clone(this.files.get(fileId)?.ref);
  }

  async readFile(file: DocumentFileRef): Promise<Uint8Array | undefined> {
    await this.ready();
    const value = this.files.get(file.fileId);
    return value && value.ref.revision.revisionId === file.revision.revisionId ? value.bytes.slice() : undefined;
  }

  async listFiles(): Promise<readonly DocumentFileRef[]> {
    await this.ready();
    return [...this.files.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(value => clone(value.ref));
  }

  private async hydrate(): Promise<void> {
    const stored = await this.state.read();
    const storedFiles = stored && typeof stored === 'object' && Array.isArray((stored as { readonly files?: unknown }).files)
      ? (stored as { readonly files: unknown[] }).files
      : [];
    let loaded = await this.loadIndexedFiles(storedFiles);
    if (!loaded.length) {
      const legacy = this.readLegacyFiles();
      loaded = await this.loadLegacyFiles(legacy);
      if (loaded.length) await this.persistValues(loaded);
    }
    loaded.forEach(value => this.files.set(value.ref.fileId, value));
  }

  private async persist(): Promise<void> {
    const values = [...this.files.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_LOCAL_DOCUMENTS)
      .map(value => ({
        version: 1 as const,
        fileId: value.ref.fileId,
        filename: value.ref.filename,
        mimeType: value.ref.mimeType,
        size: value.bytes.byteLength,
        contentId: (value.ref.contentId ?? value.ref.revision.contentId) as NonNullable<DocumentFileRef['contentId']>,
        bytes: value.bytes.slice(),
        createdAt: value.createdAt,
        ownerId: this.ownerId,
      } satisfies IndexedDbLocalFile));
    await this.persistValues(values.map(value => ({ ref: this.refFor(value), bytes: value.bytes, createdAt: value.createdAt })));
  }

  private async persistValues(values: readonly { readonly ref: DocumentFileRef; readonly bytes: Uint8Array; readonly createdAt: string }[]): Promise<void> {
    await this.state.write({ version: 1, files: values.map(value => ({
      version: 1,
      fileId: value.ref.fileId,
      filename: value.ref.filename,
      mimeType: value.ref.mimeType,
      size: value.bytes.byteLength,
      contentId: (value.ref.contentId ?? value.ref.revision.contentId) as NonNullable<DocumentFileRef['contentId']>,
      bytes: value.bytes.slice(),
      createdAt: value.createdAt,
      ownerId: this.ownerId,
    } satisfies IndexedDbLocalFile)) });
  }

  private refFor(candidate: IndexedDbLocalFile): DocumentFileRef {
    return {
      fileId: candidate.fileId,
      revision: { version: 1, fileId: candidate.fileId, revisionId: candidate.contentId, contentId: candidate.contentId },
      filename: candidate.filename,
      mimeType: candidate.mimeType,
      size: candidate.size,
      contentId: candidate.contentId,
      visibility: 'private',
      ownerId: this.ownerId,
      scope: 'LOCAL_ONLY',
    };
  }

  private async loadIndexedFiles(values: readonly unknown[]): Promise<readonly { readonly ref: DocumentFileRef; readonly bytes: Uint8Array; readonly createdAt: string }[]> {
    const loaded: { ref: DocumentFileRef; bytes: Uint8Array; createdAt: string }[] = [];
    for (const value of values.slice(0, MAX_LOCAL_DOCUMENTS)) {
      if (!isIndexedDbLocalFile(value) || value.ownerId !== this.ownerId) continue;
      const bytes = value.bytes.slice();
      if (bytes.byteLength !== value.size || !(await contentMatches(bytes, value.contentId))) continue;
      loaded.push({ ref: this.refFor(value), bytes, createdAt: value.createdAt });
    }
    return loaded;
  }

  private readLegacyFiles(): readonly unknown[] {
    try {
      const raw = window.localStorage.getItem(DOCUMENT_FILES_KEY);
      const values = raw ? JSON.parse(raw) : undefined;
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }

  private async loadLegacyFiles(values: readonly unknown[]): Promise<readonly { readonly ref: DocumentFileRef; readonly bytes: Uint8Array; readonly createdAt: string }[]> {
    const loaded: { ref: DocumentFileRef; bytes: Uint8Array; createdAt: string }[] = [];
    for (const value of values.slice(0, MAX_LOCAL_DOCUMENTS)) {
      if (!isPersistedLocalFile(value) || value.ownerId !== this.ownerId) continue;
      const bytes = decodeBase64(value.bytes);
      if (!bytes || bytes.byteLength !== value.size || !(await contentMatches(bytes, value.contentId))) continue;
      loaded.push({ ref: this.refFor({ ...value, bytes }), bytes, createdAt: value.createdAt });
    }
    return loaded;
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

function readProfile(): LocalDesktopProfile | undefined {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    const value = raw ? JSON.parse(raw) : undefined;
    return isLocalDesktopProfile(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function getLocalDesktopProfile(): LocalDesktopProfile | undefined {
  return readProfile();
}

export async function createLocalDesktopProfile(displayName: string, deviceName: string): Promise<LocalDesktopProfile> {
  const name = cleanLabel(displayName, 80);
  const device = cleanLabel(deviceName, 80);
  if (!name) throw new Error('A display name is required');
  if (!device) throw new Error('A device name is required');
  const deviceId = `device:${globalThis.crypto.randomUUID()}`;
  try {
    const identity = await IdentityManager.generate({ secretHost: new TauriSecureSecretHost(deviceId) });
    const publicIdentity = await identity.devicePublicIdentity(deviceId);
    // Provisioning happens inside IdentityManager's typed signing boundary. A
    // short-lived capability check makes onboarding fail before any profile is
    // persisted if the native key store is unavailable.
    const capability = await identity.createIdentitySigningCapability(deviceId);
    capability.close();
    return {
      version: 1,
      displayName: name,
      deviceName: device,
      ownerIdentityId: publicIdentity.nodeId,
      deviceId,
      nodeId: publicIdentity.nodeId,
      publicKey: publicIdentity.publicKey,
      encryptionPublicKey: publicIdentity.encryptionPublicKey,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    await removeDesktopIdentity(deviceId).catch(() => undefined);
    throw error;
  }
}

export function persistLocalDesktopProfile(profile: LocalDesktopProfile): void {
  persistProfile({ ...profile, displayName: cleanLabel(profile.displayName, 80), deviceName: cleanLabel(profile.deviceName, 80) });
}

/**
 * Remove state that a failed first-run bootstrap may have initialized for a
 * profile which was never committed. Existing owner-scoped state is left
 * untouched unless it belongs to this exact transactional profile.
 */
export function clearLocalDesktopRuntimeState(profile: Pick<LocalDesktopProfile, 'ownerIdentityId'>): void {
  for (const key of [
    `${CAPTURE_STATE_KEY}:${profile.ownerIdentityId}`,
    `${TASK_STATE_KEY}:${profile.ownerIdentityId}`,
    `${DOCUMENT_STATE_KEY}:${profile.ownerIdentityId}`,
  ]) {
    try { window.localStorage.removeItem(key); } catch { /* best-effort rollback */ }
  }
  try {
    const raw = window.localStorage.getItem(DOCUMENT_FILES_KEY);
    const values = raw ? JSON.parse(raw) : undefined;
    if (Array.isArray(values)) {
      const remaining = values.filter(value => !isPersistedLocalFile(value) || value.ownerId !== profile.ownerIdentityId);
      if (remaining.length) window.localStorage.setItem(DOCUMENT_FILES_KEY, JSON.stringify(remaining));
      else window.localStorage.removeItem(DOCUMENT_FILES_KEY);
    }
  } catch {
    // A storage failure must not mask the original bootstrap error.
  }
  for (const key of [AI_SETTINGS_KEY, DISCOVERY_STATE_KEY, `${AI_SETTINGS_KEY}:${profile.ownerIdentityId}`, `${DISCOVERY_STATE_KEY}:${profile.ownerIdentityId}`]) {
    try { window.localStorage.removeItem(key); } catch { /* best-effort rollback */ }
  }
  void clearDesktopIndexedDbState(profile.ownerIdentityId);
}

export async function clearDesktopIndexedDbState(ownerIdentityId: string): Promise<void> {
  await Promise.all([
    new DesktopIndexedDbStateStore(`keystone.local.content.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`keystone.local.music.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`keystone.local.video.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`${FILES_STATE_KEY}:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`${DOCUMENT_FILES_STATE_KEY}:${ownerIdentityId}`).delete(),
  ]).catch(() => undefined);
}

function persistProfile(profile: LocalDesktopProfile): void {
  try {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    throw new Error('Local profile could not be persisted');
  }
}

export interface DesktopLocalRuntime {
  readonly profile: LocalDesktopProfile;
  readonly capture: CaptureService;
  readonly tasks: TaskService;
  readonly documents: DocumentService;
  readonly ai: DesktopAIRuntime;
  readonly discovery: DesktopDiscoveryRuntime;
  readonly network: DesktopNetworkRuntime;
  readonly files: DesktopFilesRuntime;
  readonly media: DesktopLocalMediaRuntimes;
}

let bootstrapPromise: Promise<DesktopLocalRuntime> | undefined;
let bootstrappedOwner: string | undefined;

export async function bootstrapDesktopLocalRuntime(profile = readProfile()): Promise<DesktopLocalRuntime> {
  if (!profile) throw new Error('A local profile is required before starting Keystone');
  if (bootstrapPromise && bootstrappedOwner === profile.ownerIdentityId) return bootstrapPromise;
  bootstrappedOwner = profile.ownerIdentityId;
  const pending = (async () => {
    const capture = new CaptureService({
      state: new DesktopJsonStateStore(`${CAPTURE_STATE_KEY}:${profile.ownerIdentityId}`),
      ownerIdentityId: profile.ownerIdentityId,
      deviceId: profile.deviceId,
    });
    const tasks = new TaskService({
      identityId: profile.ownerIdentityId,
      deviceId: profile.deviceId,
      store: new DesktopJsonStateStore(`${TASK_STATE_KEY}:${profile.ownerIdentityId}`),
    });
    const source = new LocalDocumentFileSource(profile.ownerIdentityId);
    await source.ready();
    const documents = new DocumentService({
      files: source,
      ownerId: profile.ownerIdentityId,
      stateStore: new DesktopJsonStateStore(`${DOCUMENT_STATE_KEY}:${profile.ownerIdentityId}`),
    });
    const aiSettings = new AISettingsService(new DesktopJsonStateStore(`${AI_SETTINGS_KEY}:${profile.ownerIdentityId}`));
    const discovery = new UnifiedDiscoveryService({ storage: new PersistentDiscoveryStorage(new DesktopJsonStateStore(`${DISCOVERY_STATE_KEY}:${profile.ownerIdentityId}`)) });
    await Promise.all([capture.ready(), tasks.ready(), documents.ready(), aiSettings.ready(), discovery.ready()]);
    // Desktop local AI is deliberately local-only. A host may later install
    // an explicitly scoped provider, but this bootstrap never enables a remote
    // fallback merely because the settings object has a default value.
    await aiSettings.update({ remoteEnabled: false, personalTarget: 'this-device' });
    const ai = createDesktopAIRuntime(aiSettings);
    await ai.ready();
    await aiSettings.bindRouter(ai.router);
    const discoveryRuntime = createDesktopDiscoveryRuntime(discovery);
    const networkRuntime = createDesktopNetworkRuntime();
    const media = await createDesktopLocalMediaRuntimes(profile);
    const folderCrypto = new SodiumCryptoProvider();
    const folderSigner = createDesktopIdentitySigner(profile.deviceId);
    const folderService = new SharedFolderService({
      localIdentityId: profile.ownerIdentityId,
      localDeviceId: profile.deviceId,
      content: new ContentCacheFolderContentStore(media.cache),
      stateStore: new DesktopIndexedDbStateStore(`${FILES_STATE_KEY}:${profile.ownerIdentityId}`),
      signer: {
        sign: payload => folderSigner.sign(canonicalJson(payload)),
        verify: (payload, signature, signer) => folderCrypto.verify(canonicalJson(payload), signature, signer),
      },
      requireSignedChanges: true,
    });
    await folderService.ready();
    const root = folderService.listFolders()[0] ?? await folderService.createFolder({ name: 'Keystone Files', scope: 'PRIVATE' });
    const files = createDesktopFilesRuntime(folderService, { defaultFolderId: root.id as FolderId });
    const baseDocumentRuntime = createDesktopDocumentsRuntime(documents);
    const documentRuntime: DesktopLocalDocumentsRuntime = {
      ...baseDocumentRuntime,
      createText: async input => {
        const ref = await source.register(input.filename, 'text/markdown', new TextEncoder().encode(input.content));
        notifyDocumentRuntime(documentRuntime);
        return ref;
      },
      importFile: async input => {
        const ref = await source.register(input.filename, input.mimeType || 'application/octet-stream', input.bytes);
        notifyDocumentRuntime(documentRuntime);
        return ref;
      },
    };
    // Install all adapters only after every local store has hydrated and the
    // root folder exists. This keeps a failed first-run bootstrap atomic from
    // the renderer's point of view.
    installDesktopCaptureRuntime(createDesktopCaptureRuntime(capture, { hostConnected: true }));
    installDesktopTasksRuntime(createDesktopTasksRuntime(tasks));
    installDesktopAIRuntime(ai);
    installDesktopDiscoveryRuntime(discoveryRuntime);
    installDesktopNetworkRuntime(networkRuntime);
    installDesktopDocumentsRuntime(documentRuntime);
    installDesktopFilesRuntime(files);
    installDesktopMusicRuntime(media.music);
    installDesktopVideoRuntime(media.video);
    installDesktopShortsRuntime(media.shorts);
    return { profile, capture, tasks, documents, ai, discovery: discoveryRuntime, network: networkRuntime, files, media };
  })();
  bootstrapPromise = pending.catch(error => {
    bootstrapPromise = undefined;
    bootstrappedOwner = undefined;
    throw error;
  });
  return bootstrapPromise;
}

function notifyDocumentRuntime(runtime: DesktopLocalDocumentsRuntime): void {
  // The public runtime exposes subscribe for host-originated changes. Local
  // document creation is immediately visible through a fresh list call; the
  // shell also refreshes after each explicit action. No second document store
  // is introduced here.
  void runtime;
}

function cleanLabel(value: string, max: number): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function isLocalDesktopProfile(value: unknown): value is LocalDesktopProfile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LocalDesktopProfile>;
  return candidate.version === 1
    && [candidate.displayName, candidate.deviceName, candidate.ownerIdentityId, candidate.deviceId, candidate.nodeId, candidate.publicKey, candidate.encryptionPublicKey, candidate.createdAt].every(item => typeof item === 'string' && item.length > 0 && item.length <= 512);
}

function isPersistedLocalFile(value: unknown): value is PersistedLocalFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedLocalFile>;
  return candidate.version === 1
    && typeof candidate.fileId === 'string' && candidate.fileId.startsWith('local-document:')
    && typeof candidate.filename === 'string' && candidate.filename.length > 0 && candidate.filename.length <= 255
    && typeof candidate.mimeType === 'string' && candidate.mimeType.length > 0 && candidate.mimeType.length <= 255
    && Number.isSafeInteger(candidate.size) && candidate.size! >= 0 && candidate.size! <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.contentId === 'string' && /^sha256-[a-f0-9]{64}$/i.test(candidate.contentId)
    && typeof candidate.bytes === 'string' && candidate.bytes.length <= MAX_LOCAL_DOCUMENT_BYTES * 2
    && typeof candidate.createdAt === 'string' && typeof candidate.ownerId === 'string';
}

function isIndexedDbLocalFile(value: unknown): value is IndexedDbLocalFile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IndexedDbLocalFile>;
  return candidate.version === 1
    && typeof candidate.fileId === 'string' && candidate.fileId.startsWith('local-document:')
    && typeof candidate.filename === 'string' && candidate.filename.length > 0 && candidate.filename.length <= 255
    && typeof candidate.mimeType === 'string' && candidate.mimeType.length > 0 && candidate.mimeType.length <= 255
    && Number.isSafeInteger(candidate.size) && candidate.size! >= 0 && candidate.size! <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.contentId === 'string' && /^sha256-[a-f0-9]{64}$/i.test(candidate.contentId)
    && candidate.bytes instanceof Uint8Array && candidate.bytes.byteLength <= MAX_LOCAL_DOCUMENT_BYTES
    && typeof candidate.createdAt === 'string' && typeof candidate.ownerId === 'string';
}

async function contentMatches(bytes: Uint8Array, contentId: string): Promise<boolean> {
  return `sha256-${await sha256(bytes)}`.toLowerCase() === contentId.toLowerCase();
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) output += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(output);
}

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}
