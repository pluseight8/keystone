/**
 * Local desktop bootstrap for the first usable Keystone build.
 *
 * The renderer only owns typed adapters and bounded JSON state. The business
 * rules still live in Core services; this module supplies the small local
 * persistence boundary that lets those services work before a richer native
 * host is connected.
 */
import { AISettingsService, CaptureService, createCaptureDestinationRegistry, ContentCacheFolderContentStore, DocumentService, IdentityManager, PersistentDiscoveryStorage, SharedFolderService, TaskError, TaskService, UnifiedDiscoveryService, signCanonical, verifyCanonical } from '@keystone/core';
import { SodiumCryptoProvider } from '../../../packages/core/src/browser.js';
import type {
  DocumentFileRef,
  DocumentRevisionRef,
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
import { DOCUMENT_FILES_KEY, DOCUMENT_FILES_STATE_KEY, isPersistedLocalFile, LocalDocumentFileSource } from './desktop-local-document-files';
import { TauriSecureSecretHost, createDesktopIdentitySigner, removeDesktopIdentity } from './desktop-host-bridge';
import { createDesktopFilesRuntime, installDesktopFilesRuntime, type DesktopFilesRuntime } from './desktop-files-runtime';
import { createDesktopLocalMediaRuntimes, type DesktopLocalMediaRuntimes } from './desktop-local-media-runtime';
import { installDesktopMusicRuntime, installDesktopShortsRuntime, installDesktopVideoRuntime } from './desktop-media-runtime';

const PROFILE_KEY = 'keystone.local.identity.v1';
const CAPTURE_STATE_KEY = 'keystone.local.capture.v1';
const TASK_STATE_KEY = 'keystone.local.tasks.v1';
const DOCUMENT_STATE_KEY = 'keystone.local.documents.metadata.v1';
const AI_SETTINGS_KEY = 'keystone.local.ai-settings.v1';
const DISCOVERY_STATE_KEY = 'keystone.local.discovery.v1';
const FILES_STATE_KEY = 'keystone.local.files.v1';

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
  /** Source text of a local text or Markdown document, for editing. */
  readText(fileId: string): Promise<string | undefined>;
  /** Saves a new content revision under the existing document ID. */
  updateText(input: { readonly fileId: string; readonly baseRevision: DocumentRevisionRef['revisionId']; readonly filename: string; readonly content: string }): Promise<DocumentFileRef>;
  deleteFile(fileId: string): Promise<void>;
}

/**
 * Durable state for tasks, capture, document metadata, AI settings and discovery.
 *
 * It lives in IndexedDB: localStorage is capped at about 5 MB and a failed write
 * there used to be swallowed, so new tasks vanished on restart. A write that fails
 * now rejects, and the owning service reports it. State written by earlier builds
 * is read from localStorage once and never deleted.
 */
export class DesktopJsonStateStore implements CaptureStateStore, TaskStateStore, DocumentStateStore {
  private memory?: unknown;

  constructor(private readonly key: string, private readonly durable: Pick<DesktopIndexedDbStateStore, 'read' | 'write'> = new DesktopIndexedDbStateStore(key)) {}

  async read(): Promise<unknown | undefined> {
    if (this.memory !== undefined) return clone(this.memory);
    this.memory = await this.durable.read() ?? this.readLegacy();
    return clone(this.memory);
  }

  async write(value: unknown): Promise<void> {
    const next = clone(value);
    await this.durable.write(next);
    this.memory = next;
  }

  private readLegacy(): unknown | undefined {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(this.key); } catch { return undefined; }
    if (!raw) return undefined;
    try { return JSON.parse(raw); }
    catch {
      // Keep the unreadable bytes: the next write would otherwise replace data that may still be recoverable.
      try { window.localStorage.setItem(`${this.key}.corrupt`, raw); } catch { /* the original key is left untouched either way */ }
      return undefined;
    }
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
  for (const key of [`${AI_SETTINGS_KEY}:${profile.ownerIdentityId}`, `${DISCOVERY_STATE_KEY}:${profile.ownerIdentityId}`]) {
    try { window.localStorage.removeItem(key); } catch { /* best-effort rollback */ }
  }
}

export async function clearDesktopIndexedDbState(ownerIdentityId: string): Promise<void> {
  await Promise.all([
    new DesktopIndexedDbStateStore(`keystone.local.content.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`keystone.local.music.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`keystone.local.video.v1:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`${FILES_STATE_KEY}:${ownerIdentityId}`).delete(),
    new DesktopIndexedDbStateStore(`${DOCUMENT_FILES_STATE_KEY}:${ownerIdentityId}`).delete(),
    ...[TASK_STATE_KEY, CAPTURE_STATE_KEY, DOCUMENT_STATE_KEY, AI_SETTINGS_KEY, DISCOVERY_STATE_KEY].map(key => new DesktopIndexedDbStateStore(`${key}:${ownerIdentityId}`).delete()),
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
    const tasks = new TaskService({
      identityId: profile.ownerIdentityId,
      deviceId: profile.deviceId,
      store: new DesktopJsonStateStore(`${TASK_STATE_KEY}:${profile.ownerIdentityId}`),
    });
    const capture = new CaptureService({
      state: new DesktopJsonStateStore(`${CAPTURE_STATE_KEY}:${profile.ownerIdentityId}`),
      ownerIdentityId: profile.ownerIdentityId,
      deviceId: profile.deviceId,
      destinations: createCaptureDestinationRegistry({
        task: {
          supports: item => item.provenance.dataClass !== 'SECRET' && (item.payload.kind === 'TEXT' || item.payload.kind === 'URL'),
          create: async ({ item, operationId }) => {
            const payload = item.payload;
            if (payload.kind !== 'TEXT' && payload.kind !== 'URL') throw new Error('Only text or links can be turned into a task');
            const id = `task:${operationId}`;
            let task;
            try { task = tasks.getTask(id, { includeTrash: true }); }
            catch (reason) {
              if (!(reason instanceof TaskError) || reason.code !== 'NOT_FOUND') throw reason;
              task = await tasks.createTask({ id, title: item.title, note: payload.kind === 'TEXT' ? payload.text : payload.url });
            }
            return { type: 'task', id: task.id, label: task.title, ownerId: profile.ownerIdentityId, dataClass: 'PRIVATE' };
          },
        },
      }),
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
        sign: payload => signCanonical(payload, canonicalBytes => folderSigner.sign(canonicalBytes)),
        verify: (payload, signature, signer) => verifyCanonical(payload, signature, (canonicalBytes, rawSignature) => folderCrypto.verify(canonicalBytes, rawSignature, signer)),
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
      readText: fileId => source.readText(fileId),
      updateText: async input => {
        const ref = await source.replaceText(input.fileId, input.baseRevision, input.filename, input.content);
        notifyDocumentRuntime(documentRuntime);
        return ref;
      },
      deleteFile: async fileId => {
        await source.remove(fileId);
        notifyDocumentRuntime(documentRuntime);
      },
    };
    // Install all adapters only after every local store has hydrated and the
    // root folder exists. This keeps a failed first-run bootstrap atomic from
    // the renderer's point of view.
    installDesktopCaptureRuntime(createDesktopCaptureRuntime(capture, { hostConnected: true, destinations: ['TASK'] }));
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
