/**
 * R0P59: hostile/untrusted content containment.
 *
 * This module deliberately treats every byte arriving from a peer, browser,
 * shared space or package source as data.  It does not execute files and it
 * does not make a scanner, a file name, or a clean classification an
 * authority.  Hosts can replace the in-memory stores/decoder boundaries with
 * an OS sandbox, but the fail-closed state machine lives in core.
 */

import { sha256, type ContentId } from '../social/content.js';

export const UNTRUSTED_CONTENT_VERSION = 1 as const;

export const CONTENT_TRUST_CLASSES = [
  'REMOTE_UNTRUSTED', 'QUARANTINED', 'INSPECTED_UNTRUSTED',
  'PREVIEW_SAFE', 'OWNER_RELEASED', 'OWNER_LOCAL',
] as const;
export type ContentTrustClass = (typeof CONTENT_TRUST_CLASSES)[number];

export const FILE_RISK_CLASSES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN'] as const;
export type FileRiskClass = (typeof FILE_RISK_CLASSES)[number];

export const QUARANTINE_STATES = [
  'RECEIVING', 'QUARANTINED', 'INSPECTING', 'INSPECTED', 'PREVIEW_ELIGIBLE',
  'OWNER_RELEASED', 'TRANSFER_FAILED', 'INSPECTION_FAILED', 'BLOCKED',
  'KNOWN_MALICIOUS', 'RELEASE_DENIED',
] as const;
export type QuarantineState = (typeof QUARANTINE_STATES)[number];

export const EXECUTABLE_RISKS = ['NONE', 'POSSIBLE', 'HIGH', 'CRITICAL'] as const;
export type ExecutableRisk = (typeof EXECUTABLE_RISKS)[number];

export const CONTAINER_RISKS = ['NONE', 'ARCHIVE', 'NESTED', 'BOMB', 'MALFORMED', 'TRAVERSAL', 'SYMLINK_ESCAPE'] as const;
export type ContainerRisk = (typeof CONTAINER_RISKS)[number];

export const PREVIEW_SAFETY_DECISIONS = ['ALLOW_BOUNDED', 'ALLOW_WITH_WARNING', 'DENY', 'UNAVAILABLE'] as const;
export type PreviewSafetyDecision = (typeof PREVIEW_SAFETY_DECISIONS)[number];

export const RELEASE_DECISIONS = ['OWNER_CONFIRMED', 'DENIED', 'NOT_READY', 'EXPIRED', 'MISMATCH'] as const;
export type ReleaseDecision = (typeof RELEASE_DECISIONS)[number];
const QUARANTINE_RELEASE_TOKEN = Symbol('keystone:owner-file-release');

export interface ContentProvenanceLink {
  readonly kind: 'REMOTE' | 'EXTRACTED' | 'DERIVED' | 'SHARED' | 'BROWSER_DOWNLOAD' | 'P2P_TRANSFER';
  readonly objectId?: string;
  readonly transferId?: string;
  readonly sourceIdentity?: string;
  readonly contentHash: string;
  readonly parentHash?: string;
  readonly at: string;
}

/** A chain is intentionally data-only and survives archive/media derivation. */
export type ContentProvenanceChain = readonly ContentProvenanceLink[];

export interface RemoteFileDescriptor {
  readonly version: 1;
  readonly transferId: string;
  readonly sourceIdentity: string;
  readonly objectId?: string;
  readonly contentId?: ContentId | string;
  readonly filename?: string;
  readonly mimeType?: string;
  readonly size: number;
  readonly visibility?: 'private' | 'community' | 'public' | 'contacts' | 'shared';
  readonly encrypted?: boolean;
  readonly receivedAt?: string;
  readonly provenance?: ContentProvenanceChain;
}

export interface QuarantineStorageBudget {
  readonly maxPendingBytes: number;
  readonly maxPerPeerBytes: number;
  readonly maxPerTransferBytes: number;
  readonly maxIncompleteObjects: number;
  readonly maxEntries: number;
  readonly retentionMs: number;
}

/** Mandatory floors cannot be disabled by ordinary user configuration. */
export const DEFAULT_QUARANTINE_STORAGE_BUDGET: QuarantineStorageBudget = Object.freeze({
  maxPendingBytes: 512 * 1024 * 1024,
  maxPerPeerBytes: 128 * 1024 * 1024,
  maxPerTransferBytes: 128 * 1024 * 1024,
  maxIncompleteObjects: 256,
  maxEntries: 2_048,
  retentionMs: 7 * 24 * 60 * 60 * 1_000,
});

export interface BoundedIncomingTransferSnapshot {
  readonly version: 1;
  readonly transferId: string;
  readonly sourceIdentity: string;
  readonly receivedBytes: number;
  readonly expectedBytes: number;
  readonly state: 'RECEIVING' | 'COMPLETE' | 'FAILED';
}

/** Bounded streaming accumulator. It never uses a remote path or shell. */
export class BoundedIncomingTransfer {
  private readonly parts: Uint8Array[] = [];
  private received = 0;
  private state: BoundedIncomingTransferSnapshot['state'] = 'RECEIVING';
  constructor(
    readonly descriptor: RemoteFileDescriptor,
    private readonly maxBytes = DEFAULT_QUARANTINE_STORAGE_BUDGET.maxPerTransferBytes,
    private readonly hooks: { readonly beforeAppend?: (bytes: number, nextReceived: number) => void; readonly changed?: () => void } = {},
  ) {
    validateDescriptor(descriptor);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || descriptor.size > maxBytes) throw new Error('Incoming transfer exceeds its mandatory bound');
  }
  append(bytes: Uint8Array): void {
    if (this.state !== 'RECEIVING') throw new Error('Incoming transfer is no longer writable');
    if (!(bytes instanceof Uint8Array) || this.received + bytes.byteLength > this.maxBytes || this.received + bytes.byteLength > this.descriptor.size) {
      this.state = 'FAILED';
      this.hooks.changed?.();
      throw new Error('Incoming transfer exceeds its bounded size');
    }
    try { this.hooks.beforeAppend?.(bytes.byteLength, this.received + bytes.byteLength); } catch (error) { this.state = 'FAILED'; this.hooks.changed?.(); throw error; }
    this.parts.push(bytes.slice()); this.received += bytes.byteLength;
    this.hooks.changed?.();
  }
  complete(): Uint8Array {
    if (this.state !== 'RECEIVING' || this.received !== this.descriptor.size) throw new Error('Incoming transfer is incomplete');
    const output = new Uint8Array(this.received); let offset = 0;
    for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; }
    this.state = 'COMPLETE'; this.hooks.changed?.(); return output;
  }
  fail(): void { this.state = 'FAILED'; this.parts.length = 0; this.received = 0; this.hooks.changed?.(); }
  /** Restore bounded bytes after a process restart; no trust state is inferred. */
  restore(bytes: Uint8Array): void {
    if (this.state !== 'RECEIVING' || !(bytes instanceof Uint8Array) || bytes.byteLength > this.maxBytes || bytes.byteLength > this.descriptor.size) throw new Error('Invalid incomplete transfer snapshot');
    if (bytes.byteLength) { this.parts.push(bytes.slice()); this.received = bytes.byteLength; }
  }
  bytes(): Uint8Array { const output = new Uint8Array(this.received); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; } return output; }
  snapshot(): BoundedIncomingTransferSnapshot { return { version: 1, transferId: this.descriptor.transferId, sourceIdentity: this.descriptor.sourceIdentity, receivedBytes: this.received, expectedBytes: this.descriptor.size, state: this.state }; }
}

export interface QuarantineMetadata {
  readonly version: 1;
  readonly entryId: string;
  readonly transferId: string;
  readonly sourceIdentity: string;
  readonly objectId?: string;
  readonly contentHash: string;
  readonly originalFilename?: string;
  readonly senderMimeType?: string;
  readonly declaredSize: number;
  readonly receivedAt: string;
  /** Generated by Keystone; never derived from remote filename. */
  readonly generatedPath: string;
  readonly encrypted: boolean;
  readonly provenance: ContentProvenanceChain;
}

export interface QuarantinedBlob {
  readonly kind: 'QuarantinedBlob';
  readonly trust: 'QUARANTINED' | 'INSPECTED_UNTRUSTED' | 'PREVIEW_SAFE' | 'OWNER_RELEASED';
  readonly metadata: QuarantineMetadata;
  readonly contentHash: string;
  readonly bytes: Uint8Array;
}

export interface StructurallyInspectedBlob extends Omit<QuarantinedBlob, 'kind' | 'trust'> {
  readonly kind: 'StructurallyInspectedBlob';
  readonly trust: 'INSPECTED_UNTRUSTED';
  readonly inspection: FileInspectionResult;
}

export interface ClassifiedFileObject extends Omit<StructurallyInspectedBlob, 'kind' | 'trust'> {
  readonly kind: 'ClassifiedFileObject';
  readonly classification: FileInspectionResult;
}

export interface SafePreviewObject {
  readonly kind: 'SafePreviewObject';
  readonly trust: 'PREVIEW_SAFE';
  readonly objectId: string;
  readonly sourceHash: string;
  readonly decision: 'ALLOW_BOUNDED' | 'ALLOW_WITH_WARNING';
  readonly mimeType: string;
  readonly representation: 'TEXT' | 'STATIC_IMAGE' | 'VIDEO_FRAME' | 'AUDIO_METADATA' | 'DOCUMENT_TEXT' | 'SANITIZED_MARKUP';
  readonly value: unknown;
  readonly provenance: ContentProvenanceChain;
}

export interface UserReleasedFileObject {
  readonly kind: 'UserReleasedFileObject';
  readonly trust: 'OWNER_RELEASED';
  readonly objectId: string;
  readonly sourceHash: string;
  readonly filename?: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly release: { readonly decision: 'OWNER_CONFIRMED'; readonly intentId: string; readonly at: string; readonly risk: FileRiskClass };
  /** Release is not an execute permission. A future host launcher must ask again. */
  readonly executableAuthority: false;
  readonly provenance: ContentProvenanceChain;
}

export interface FileTypeEvidence {
  readonly extensionHint?: string;
  readonly senderMimeHint?: string;
  readonly magic?: string;
  readonly detectedMime: string;
  readonly detectedType: string;
  readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly mismatch: boolean;
  readonly executableRisk: ExecutableRisk;
  readonly containerRisk: ContainerRisk;
  readonly reasons: readonly string[];
}

export interface MalwareScanResult {
  readonly version: 1;
  readonly status: 'CLEAN' | 'SUSPICIOUS' | 'KNOWN_MALICIOUS' | 'UNKNOWN' | 'SCAN_FAILED';
  readonly engine?: string;
  readonly signatureId?: string;
  readonly scannedHash: string;
  readonly scannedAt: string;
  readonly reason?: string;
}

export interface MalwareScanner {
  scan(input: { readonly bytes: Uint8Array; readonly contentHash: string; readonly mimeType?: string }): Promise<MalwareScanResult> | MalwareScanResult;
}
export interface MalwareScannerAdapter extends MalwareScanner {}

export interface ArchiveBudget {
  readonly maxEntries: number;
  readonly maxExpandedBytes: number;
  readonly maxCompressionRatio: number;
  readonly maxArchiveDepth: number;
  readonly maxSingleEntrySize: number;
  readonly maxPathLength: number;
}
/** Backwards/host naming alias: the limits are specifically for archive inspection. */
export type ArchiveInspectionBudget = ArchiveBudget;

export const DEFAULT_ARCHIVE_BUDGET: ArchiveBudget = Object.freeze({
  maxEntries: 10_000,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 250,
  maxArchiveDepth: 3,
  maxSingleEntrySize: 256 * 1024 * 1024,
  maxPathLength: 512,
});
export const DEFAULT_ARCHIVE_INSPECTION_BUDGET: ArchiveInspectionBudget = DEFAULT_ARCHIVE_BUDGET;

export interface ArchiveEntryInspection {
  readonly name: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly directory: boolean;
  readonly symlink: boolean;
  readonly safePath: string;
  readonly nestedArchive: boolean;
  readonly risk: ContainerRisk;
}

export interface ArchiveInspectionResult {
  readonly isArchive: boolean;
  readonly accepted: boolean;
  readonly risk: ContainerRisk;
  readonly entries: readonly ArchiveEntryInspection[];
  readonly expandedBytes: number;
  readonly depth: number;
  readonly reason?: string;
}

export interface ArchiveExtractionPlan {
  readonly accepted: true;
  readonly destinationId: string;
  readonly entries: readonly { readonly sourceName: string; readonly generatedPath: string; readonly safePath: string }[];
  readonly provenance: ContentProvenanceChain;
}

export interface MediaDecodeBudget {
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxFrames: number;
  readonly maxDurationMs: number;
  readonly maxMemoryBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxNesting: number;
}

export const DEFAULT_MEDIA_DECODE_BUDGET: MediaDecodeBudget = Object.freeze({ maxWidth: 16_384, maxHeight: 16_384, maxPixels: 64_000_000, maxFrames: 240, maxDurationMs: 3 * 60 * 60 * 1_000, maxMemoryBytes: 256 * 1024 * 1024, maxMetadataBytes: 2 * 1024 * 1024, maxNesting: 3 });

export interface MediaDecodeRequest {
  readonly sourceHash: string;
  readonly objectId: string;
  readonly mimeType?: string;
  readonly bytes: Uint8Array;
  readonly budget?: Partial<MediaDecodeBudget>;
  readonly provenance: ContentProvenanceChain;
}

export interface DecodedMediaArtifact {
  readonly kind: 'DecodedMediaArtifact';
  readonly trust: 'UNTRUSTED_DERIVED';
  readonly sourceHash: string;
  readonly objectId: string;
  readonly mimeType: string;
  readonly dimensions?: { readonly width: number; readonly height: number; readonly pixels: number };
  readonly framesDecoded: number;
  readonly durationMs?: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly bytes?: Uint8Array;
  readonly provenance: ContentProvenanceChain;
}

export interface DocumentPreviewArtifact {
  readonly kind: 'DocumentPreviewArtifact';
  readonly trust: 'UNTRUSTED_DERIVED';
  readonly sourceHash: string;
  readonly objectId: string;
  readonly text?: string;
  readonly sanitizedMarkup?: string;
  readonly externalLinks: readonly string[];
  readonly macrosDisabled: true;
  readonly scriptsDisabled: true;
  readonly externalFetchDisabled: true;
  readonly provenance: ContentProvenanceChain;
}

export interface DocumentPreviewRequest {
  readonly sourceHash: string;
  readonly objectId: string;
  readonly mimeType?: string;
  readonly bytes: Uint8Array;
  readonly maxTextBytes?: number;
  readonly provenance: ContentProvenanceChain;
}

export interface DocumentPreviewHost {
  preview(request: DocumentPreviewRequest): Promise<DocumentPreviewArtifact> | DocumentPreviewArtifact;
}

export interface OwnerRequestedFileReleaseIntent {
  readonly version: 1;
  readonly intentId: string;
  readonly explicitOwnerRequest: true;
  readonly source: 'OWNER' | 'REMOTE_AGENT' | 'SKILL' | 'PLUGIN';
  readonly ownerIdentityId: string;
  readonly objectId: string;
  readonly contentHash: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly confirmed: boolean;
  readonly riskAcknowledged?: boolean;
  readonly fresh?: true;
  readonly nonce?: string;
  readonly signature?: string;
  readonly deviceId?: string;
  readonly sessionId?: string;
}

export interface FileInspectionResult {
  readonly version: 1;
  readonly contentHash: string;
  readonly state: QuarantineState;
  readonly trustClass: ContentTrustClass;
  readonly typeEvidence: FileTypeEvidence;
  readonly riskClass: FileRiskClass;
  readonly executableRisk: ExecutableRisk;
  readonly containerRisk: ContainerRisk;
  readonly preview: PreviewSafetyDecision;
  readonly scanner: MalwareScanResult;
  readonly inspectedAt: string;
  readonly reason: string;
  readonly provenance: ContentProvenanceChain;
}

export interface QuarantineEntry extends QuarantinedBlob {
  readonly metadata: QuarantineMetadata;
  readonly provenance: ContentProvenanceChain;
  readonly state: QuarantineState;
  readonly inspection?: FileInspectionResult;
  readonly releasedAt?: string;
}

export interface QuarantineStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

/** Host filesystem boundary. Implementations must reject caller-supplied paths
 * and create files without executable permissions where the platform supports it. */
export interface QuarantineFileSystem {
  writeGenerated(path: string, bytes: Uint8Array, options: { readonly executable: false }): Promise<void>;
  readGenerated(path: string): Promise<Uint8Array | undefined>;
  removeGenerated(path: string): Promise<void>;
}

export class InMemoryQuarantineFileSystem implements QuarantineFileSystem {
  private readonly files = new Map<string, Uint8Array>();
  async writeGenerated(path: string, bytes: Uint8Array, options: { readonly executable: false }): Promise<void> { if (options.executable !== false || !/^quarantine\/[A-Za-z0-9._:-]+\.blob$/.test(path)) throw new Error('Unsafe generated quarantine path'); this.files.set(path, bytes.slice()); }
  async readGenerated(path: string): Promise<Uint8Array | undefined> { const value = this.files.get(path); return value?.slice(); }
  async removeGenerated(path: string): Promise<void> { this.files.delete(path); }
}

export class InMemoryQuarantineStateStore implements QuarantineStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface QuarantineStoreOptions {
  readonly budget?: Partial<QuarantineStorageBudget>;
  readonly stateStore?: QuarantineStateStore;
  readonly now?: () => number;
  readonly filesystem?: QuarantineFileSystem;
}

type StoredQuarantineState = { readonly version: 1; readonly entries: readonly { readonly entry: Omit<QuarantineEntry, 'bytes'>; readonly bytes: number[] }[]; readonly incoming?: readonly { readonly descriptor: RemoteFileDescriptor; readonly bytes: number[] }[] };

/** In-memory deterministic implementation. Hosts can persist its opaque state in encrypted storage. */
export class QuarantineStore {
  readonly budget: QuarantineStorageBudget;
  private readonly entries = new Map<string, QuarantineEntry>();
  private readonly incoming = new Map<string, BoundedIncomingTransfer>();
  private readonly now: () => number;
  private readonly filesystem?: QuarantineFileSystem;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  constructor(options: QuarantineStoreOptions = {}) {
    this.budget = normalizeStorageBudget(options.budget);
    this.now = options.now ?? (() => Date.now());
    this.filesystem = options.filesystem;
    this.persistStore = options.stateStore;
    this.readyPromise = this.hydrate(options.stateStore);
  }
  async ready(): Promise<void> { await this.readyPromise; }
  async flush(): Promise<void> { await this.ready(); await this.writes; }
  async receive(descriptor: RemoteFileDescriptor, bytes: Uint8Array): Promise<QuarantineEntry> {
    await this.ready(); validateDescriptor(descriptor);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.size) throw new Error('Incoming bytes do not match descriptor size');
    if (bytes.byteLength > this.budget.maxPerTransferBytes) throw new Error('Transfer exceeds quarantine per-transfer budget');
    const contentHash = `sha256-${await sha256(bytes)}`;
    if (descriptor.contentId && descriptor.contentId !== contentHash) throw new Error('Incoming content hash does not match descriptor');
    const peerBytes = this.bytesForPeer(descriptor.sourceIdentity);
    const existing = this.entriesByTransfer(descriptor.transferId);
    if (existing) { if (existing.contentHash !== contentHash) throw new Error('Transfer ID was replayed with different bytes'); return cloneEntry(existing); }
    const duplicate = [...this.entries.values()].find(entry => entry.contentHash === contentHash);
    if (duplicate) return cloneEntry(duplicate);
    if (!existing && this.entries.size >= this.budget.maxEntries) { this.evictStale(); if (this.entries.size >= this.budget.maxEntries) throw new Error('Quarantine entry budget exceeded'); }
    if (!existing && peerBytes + bytes.byteLength > this.budget.maxPerPeerBytes) throw new Error('Quarantine per-peer budget exceeded');
    if (!existing && this.pendingBytes() + bytes.byteLength > this.budget.maxPendingBytes) { this.evictStale(); if (this.pendingBytes() + bytes.byteLength > this.budget.maxPendingBytes) throw new Error('Quarantine storage budget exceeded'); }
    const entryId = `quarantine-${crypto.randomUUID()}`;
    const at = new Date(this.now()).toISOString();
    const provenance = descriptor.provenance?.length ? [...descriptor.provenance] : [{ kind: 'REMOTE' as const, contentHash, ...(descriptor.objectId ? { objectId: descriptor.objectId } : {}), transferId: descriptor.transferId, sourceIdentity: descriptor.sourceIdentity, at }];
    if (provenance.at(-1)?.contentHash !== contentHash) throw new Error('Incoming provenance hash does not match content');
    const metadata: QuarantineMetadata = { version: 1, entryId, transferId: descriptor.transferId, sourceIdentity: descriptor.sourceIdentity, ...(descriptor.objectId ? { objectId: descriptor.objectId } : {}), contentHash, ...(descriptor.filename ? { originalFilename: descriptor.filename.slice(0, 255) } : {}), ...(descriptor.mimeType ? { senderMimeType: descriptor.mimeType.slice(0, 255) } : {}), declaredSize: descriptor.size, receivedAt: descriptor.receivedAt ?? at, generatedPath: `quarantine/${entryId}.blob`, encrypted: descriptor.encrypted === true, provenance };
    const entry: QuarantineEntry = { kind: 'QuarantinedBlob', trust: 'QUARANTINED', metadata, contentHash, bytes: bytes.slice(), state: 'QUARANTINED', provenance };
    this.entries.set(entryId, entry);
    try {
      await this.filesystem?.writeGenerated(metadata.generatedPath, bytes, { executable: false });
      await this.persist();
    } catch (error) {
      this.entries.delete(entryId);
      await this.filesystem?.removeGenerated(metadata.generatedPath).catch(() => undefined);
      throw error;
    }
    return cloneEntry(entry);
  }
  /** Alias used by transfer adapters. */
  put(descriptor: RemoteFileDescriptor, bytes: Uint8Array): Promise<QuarantineEntry> { return this.receive(descriptor, bytes); }
  add(descriptor: RemoteFileDescriptor, bytes: Uint8Array): Promise<QuarantineEntry> { return this.receive(descriptor, bytes); }
  beginTransfer(descriptor: RemoteFileDescriptor): BoundedIncomingTransfer {
    if (this.incoming.size >= this.budget.maxIncompleteObjects) throw new Error('Incomplete quarantine transfer budget exceeded');
    if (this.incoming.has(descriptor.transferId)) throw new Error('Duplicate incoming transfer');
    validateDescriptor(descriptor);
    const transfer = new BoundedIncomingTransfer(descriptor, this.budget.maxPerTransferBytes, {
      beforeAppend: bytes => {
        if (this.pendingBytes() + bytes > this.budget.maxPendingBytes) throw new Error('Quarantine storage budget exceeded');
        if (this.bytesForPeer(descriptor.sourceIdentity) + bytes > this.budget.maxPerPeerBytes) throw new Error('Quarantine per-peer budget exceeded');
      },
      changed: () => { void this.persist().catch(() => undefined); },
    });
    this.incoming.set(descriptor.transferId, transfer); void this.persist().catch(() => undefined); return transfer;
  }
  async completeTransfer(transfer: BoundedIncomingTransfer): Promise<QuarantineEntry> { await this.ready(); const bytes = transfer.complete(); this.incoming.delete(transfer.descriptor.transferId); await this.persist(); return this.receive(transfer.descriptor, bytes); }
  abortTransfer(transferId: string): void { const transfer = this.incoming.get(transferId); transfer?.fail(); this.incoming.delete(transferId); void this.persist().catch(() => undefined); }
  async incompleteTransfers(): Promise<readonly BoundedIncomingTransferSnapshot[]> { await this.ready(); return [...this.incoming.values()].map(value => value.snapshot()); }
  async resumeTransfer(transferId: string): Promise<BoundedIncomingTransfer | undefined> { await this.ready(); return this.incoming.get(transferId); }
  async get(entryId: string): Promise<QuarantineEntry | undefined> { await this.ready(); const entry = this.entries.get(entryId); return entry && cloneEntry(entry); }
  getEntry(entryId: string): Promise<QuarantineEntry | undefined> { return this.get(entryId); }
  async getByObjectId(objectId: string): Promise<QuarantineEntry | undefined> { await this.ready(); const entry = [...this.entries.values()].find(value => value.metadata.objectId === objectId); return entry && cloneEntry(entry); }
  async read(entryId: string): Promise<Uint8Array | undefined> { const entry = await this.get(entryId); return entry?.bytes.slice(); }
  async list(): Promise<readonly QuarantineEntry[]> { await this.ready(); return [...this.entries.values()].map(cloneEntry); }
  entriesList(): Promise<readonly QuarantineEntry[]> { return this.list(); }
  async mark(entryId: string, state: QuarantineState, inspection?: FileInspectionResult): Promise<QuarantineEntry> {
    await this.ready(); const current = this.entries.get(entryId); if (!current) throw new Error('Unknown quarantine entry');
    if (state === 'OWNER_RELEASED') throw new Error('Owner release requires QuarantineReleaseService authority');
    if (!allowedQuarantineTransition(current.state, state)) throw new Error(`Invalid quarantine state transition ${current.state} -> ${state}`);
    const trust = state === 'PREVIEW_ELIGIBLE' ? 'PREVIEW_SAFE' : state === 'INSPECTED' ? 'INSPECTED_UNTRUSTED' : 'QUARANTINED';
    const next: QuarantineEntry = { ...current, state, trust, ...(inspection ? { inspection: clone(inspection) } : {}) };
    this.entries.set(entryId, next); await this.persist(); return cloneEntry(next);
  }
  async markOwnerReleased(entryId: string, token: typeof QUARANTINE_RELEASE_TOKEN): Promise<QuarantineEntry> {
    if (token !== QUARANTINE_RELEASE_TOKEN) throw new Error('Owner release authority denied');
    await this.ready(); const current = this.entries.get(entryId); if (!current || !['INSPECTED', 'PREVIEW_ELIGIBLE'].includes(current.state)) throw new Error('File is not ready for owner release');
    const next: QuarantineEntry = { ...current, state: 'OWNER_RELEASED', trust: 'OWNER_RELEASED', releasedAt: new Date(this.now()).toISOString() }; this.entries.set(entryId, next); await this.persist(); return cloneEntry(next);
  }
  async delete(entryId: string): Promise<boolean> { await this.ready(); const current = this.entries.get(entryId); const removed = this.entries.delete(entryId); if (removed) { await this.filesystem?.removeGenerated(current!.metadata.generatedPath); await this.persist(); } return removed; }
  pendingBytes(): number { return [...this.entries.values()].reduce((sum, entry) => sum + (entry.state === 'OWNER_RELEASED' ? 0 : entry.bytes.byteLength), 0) + [...this.incoming.values()].reduce((sum, transfer) => sum + transfer.snapshot().receivedBytes, 0); }
  bytesForPeer(peer: string): number { return [...this.entries.values()].filter(entry => entry.metadata.sourceIdentity === peer && entry.state !== 'OWNER_RELEASED').reduce((sum, entry) => sum + entry.bytes.byteLength, 0) + [...this.incoming.values()].filter(transfer => transfer.descriptor.sourceIdentity === peer).reduce((sum, transfer) => sum + transfer.snapshot().receivedBytes, 0); }
  metrics(): { readonly entries: number; readonly pendingBytes: number; readonly peers: number } { return { entries: this.entries.size, pendingBytes: this.pendingBytes(), peers: new Set([...this.entries.values()].map(value => value.metadata.sourceIdentity)).size }; }
  private entriesByTransfer(transferId: string): QuarantineEntry | undefined { return [...this.entries.values()].find(entry => entry.metadata.transferId === transferId); }
  private evictStale(): void {
    const cutoff = this.now() - this.budget.retentionMs;
    for (const [id, entry] of this.entries) if (entry.state !== 'OWNER_RELEASED' && Date.parse(entry.metadata.receivedAt) < cutoff) {
      this.entries.delete(id);
      // Eviction is allowed to be synchronous for admission checks, but the
      // host quarantine artifact must be removed as well.
      void this.filesystem?.removeGenerated(entry.metadata.generatedPath).catch(() => undefined);
    }
    for (const [id, transfer] of this.incoming) if (Date.parse(transfer.descriptor.receivedAt ?? '') < cutoff) { transfer.fail(); this.incoming.delete(id); }
  }
  private async hydrate(store?: QuarantineStateStore): Promise<void> { if (!store) return; const raw = await store.read(); if (!raw || typeof raw !== 'object') return; const state = raw as StoredQuarantineState; if (state.version !== 1 || !Array.isArray(state.entries)) return; for (const item of state.entries.slice(0, this.budget.maxEntries)) { const candidate = item?.entry as Partial<QuarantineEntry>; if (!candidate || candidate.kind !== 'QuarantinedBlob' || typeof candidate.metadata?.entryId !== 'string' || !Array.isArray(item.bytes)) continue; const bytes = Uint8Array.from(item.bytes); if (bytes.length !== candidate.metadata.declaredSize || `sha256-${await sha256(bytes)}` !== candidate.contentHash) continue; if (this.pendingBytes() + bytes.length > this.budget.maxPendingBytes || this.bytesForPeer(candidate.metadata.sourceIdentity) + bytes.length > this.budget.maxPerPeerBytes) continue; this.entries.set(candidate.metadata.entryId, { ...(candidate as QuarantineEntry), bytes }); } const incoming = Array.isArray(state.incoming) ? state.incoming.slice(0, this.budget.maxIncompleteObjects) : []; for (const item of incoming) { try { if (!item?.descriptor || !Array.isArray(item.bytes) || this.incoming.has(item.descriptor.transferId)) continue; const bytes = Uint8Array.from(item.bytes); if (bytes.length > this.budget.maxPerTransferBytes || this.pendingBytes() + bytes.length > this.budget.maxPendingBytes || this.bytesForPeer(item.descriptor.sourceIdentity) + bytes.length > this.budget.maxPerPeerBytes) continue; const transfer = new BoundedIncomingTransfer(item.descriptor, this.budget.maxPerTransferBytes, { beforeAppend: bytes => { if (this.pendingBytes() + bytes > this.budget.maxPendingBytes) throw new Error('Quarantine storage budget exceeded'); if (this.bytesForPeer(item.descriptor.sourceIdentity) + bytes > this.budget.maxPerPeerBytes) throw new Error('Quarantine per-peer budget exceeded'); }, changed: () => { void this.persist().catch(() => undefined); } }); transfer.restore(bytes); this.incoming.set(item.descriptor.transferId, transfer); } catch { /* corrupted/incompatible incomplete transfers remain absent and quarantined */ } } }
  private async persist(store?: QuarantineStateStore): Promise<void> {
    const backend = store ?? this.persistStore;
    if (!backend) return;
    const snapshot: StoredQuarantineState = { version: 1, entries: [...this.entries.values()].map(entry => { const { bytes, ...metadata } = entry; return { entry: metadata, bytes: [...bytes] }; }), incoming: [...this.incoming.values()].filter(value => value.snapshot().state === 'RECEIVING').map(value => ({ descriptor: value.descriptor, bytes: [...value.bytes()] })) };
    const operation = this.writes.then(() => backend.write(structuredClone(snapshot)));
    this.writes = operation.catch(() => undefined);
    await operation;
  }
  private persistStore?: QuarantineStateStore;
}

/** Rebinds persistence without exposing the backend to content/renderer code. */
export function attachQuarantinePersistence(store: QuarantineStore, backend: QuarantineStateStore): void {
  (store as unknown as { persistStore?: QuarantineStateStore }).persistStore = backend;
}

export class FileTypeDetector {
  detect(input: { readonly bytes: Uint8Array; readonly filename?: string; readonly mimeType?: string }): FileTypeEvidence {
    const bytes = input.bytes; const extension = extensionOf(input.filename); const senderMime = normalizeMime(input.mimeType); const magic = detectMagic(bytes);
    const executable = executableFor(magic, extension, senderMime, bytes); const container = containerFor(magic, bytes);
    const detectedMime = magicMime(magic, bytes); const detectedType = magicType(magic, bytes);
    const mismatch = Boolean((extension && extensionMismatch(extension, detectedType)) || (senderMime && mimeMismatch(senderMime, detectedMime, detectedType)));
    const reasons: string[] = []; if (mismatch) reasons.push('filename or sender MIME does not match content evidence'); if (executable !== 'NONE') reasons.push('executable or interpreter-like content detected'); if (container !== 'NONE') reasons.push('container/archive content requires bounded inspection');
    if (!magic && !senderMime && !extension) reasons.push('content type is unknown');
    const confidence = magic ? 'HIGH' : senderMime || extension ? 'LOW' : 'LOW';
    return { ...(extension ? { extensionHint: extension } : {}), ...(senderMime ? { senderMimeHint: senderMime } : {}), ...(magic ? { magic } : {}), detectedMime, detectedType, confidence, mismatch, executableRisk: executable, containerRisk: container, reasons };
  }
  detectType(input: { readonly bytes: Uint8Array; readonly filename?: string; readonly mimeType?: string }): FileTypeEvidence { return this.detect(input); }
  inspect(input: { readonly bytes: Uint8Array; readonly filename?: string; readonly mimeType?: string }): FileTypeEvidence { return this.detect(input); }
}

export class ArchiveInspectionService {
  readonly budget: ArchiveBudget;
  constructor(budget: Partial<ArchiveBudget> = {}) { this.budget = normalizeArchiveBudget(budget); }
  inspect(bytes: Uint8Array, options: { readonly filename?: string; readonly depth?: number } = {}): ArchiveInspectionResult {
    const magic = detectMagic(bytes); const archive = ['ZIP', 'GZIP', 'RAR', 'SEVEN_ZIP', 'TAR'].includes(magic ?? '') || /\.(?:zip|gz|tgz|tar|rar|7z)$/i.test(options.filename ?? '');
    if (!archive) return { isArchive: false, accepted: true, risk: 'NONE', entries: [], expandedBytes: bytes.byteLength, depth: options.depth ?? 0 };
    const depth = options.depth ?? 0; if (depth > this.budget.maxArchiveDepth) return { isArchive: true, accepted: false, risk: 'NESTED', entries: [], expandedBytes: 0, depth, reason: 'archive nesting depth exceeded' };
    if (!magic) return { isArchive: true, accepted: false, risk: 'MALFORMED', entries: [], expandedBytes: 0, depth, reason: 'archive filename has no recognized container signature' };
    try {
      if (magic === 'ZIP') return this.inspectZip(bytes, depth);
      if (magic === 'TAR') return this.inspectTar(bytes, depth);
      // Compressed single-stream formats have no safe generic expansion plan.
      const ratio = bytes.byteLength ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, declaredCompressedSize(bytes, magic) / bytes.byteLength)) : Number.MAX_SAFE_INTEGER;
      if (ratio > this.budget.maxCompressionRatio) return { isArchive: true, accepted: false, risk: 'BOMB', entries: [], expandedBytes: 0, depth, reason: 'compression ratio exceeds mandatory bound' };
      return { isArchive: true, accepted: bytes.byteLength <= this.budget.maxExpandedBytes, risk: 'ARCHIVE', entries: [], expandedBytes: bytes.byteLength, depth, ...(bytes.byteLength > this.budget.maxExpandedBytes ? { reason: 'archive exceeds expanded-size bound' } : {}) };
    } catch (error) { return { isArchive: true, accepted: false, risk: 'MALFORMED', entries: [], expandedBytes: 0, depth, reason: error instanceof Error ? error.message : 'malformed archive' }; }
  }
  inspectArchive(bytes: Uint8Array, options: { readonly filename?: string; readonly depth?: number } = {}): ArchiveInspectionResult { return this.inspect(bytes, options); }
  boundedExtractionPlan(input: { readonly bytes: Uint8Array; readonly sourceHash: string; readonly objectId: string; readonly filename?: string; readonly provenance: ContentProvenanceChain }): ArchiveExtractionPlan | undefined {
    const result = this.inspect(input.bytes, { filename: input.filename }); if (!result.accepted) return undefined;
    const destinationId = `extract-${crypto.randomUUID()}`; return { accepted: true, destinationId, entries: result.entries.map(entry => ({ sourceName: entry.name, safePath: entry.safePath, generatedPath: `${destinationId}/${entry.safePath}` })), provenance: appendProvenance(input.provenance, { kind: 'EXTRACTED', contentHash: input.sourceHash, objectId: input.objectId }) };
  }
  createExtractionPlan(input: { readonly bytes: Uint8Array; readonly sourceHash: string; readonly objectId: string; readonly filename?: string; readonly provenance: ContentProvenanceChain }): ArchiveExtractionPlan | undefined { return this.boundedExtractionPlan(input); }
  private inspectZip(bytes: Uint8Array, depth: number): ArchiveInspectionResult {
    const eocd = findSignature(bytes, 0x06054b50, Math.max(0, bytes.length - 65_557)); if (eocd < 0) throw new Error('ZIP end-of-directory record is missing');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const entriesCount = view.getUint16(eocd + 10, true); const centralSize = view.getUint32(eocd + 12, true); const centralOffset = view.getUint32(eocd + 16, true);
    if (entriesCount > this.budget.maxEntries || centralOffset + centralSize > bytes.length) return { isArchive: true, accepted: false, risk: entriesCount > this.budget.maxEntries ? 'BOMB' : 'MALFORMED', entries: [], expandedBytes: 0, depth, reason: entriesCount > this.budget.maxEntries ? 'archive entry count exceeded' : 'ZIP central directory is outside the file' };
    const entries: ArchiveEntryInspection[] = []; const seen = new Set<string>(); let offset = centralOffset; let expanded = 0;
    for (let index = 0; index < entriesCount; index++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('ZIP central directory entry is malformed');
      const flags = view.getUint16(offset + 8, true); const compressed = view.getUint32(offset + 20, true); const uncompressed = view.getUint32(offset + 24, true); const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true); const attributes = view.getUint32(offset + 38, true); const recordEnd = offset + 46 + nameLength + extraLength + commentLength; if (recordEnd > bytes.length) throw new Error('ZIP central directory record exceeds the file'); const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength); const name = new TextDecoder().decode(nameBytes); offset = recordEnd;
      if (name.length > this.budget.maxPathLength) return this.rejectArchive(entries, expanded, depth, 'archive path is too long', 'TRAVERSAL');
      const pathResult = safeArchivePath(name); if (!pathResult.safe) return this.rejectArchive(entries, expanded, depth, pathResult.reason, pathResult.reason.includes('symlink') ? 'SYMLINK_ESCAPE' : 'TRAVERSAL');
      const collisionKey = archiveCollisionKey(pathResult.path); if (seen.has(collisionKey)) return this.rejectArchive(entries, expanded, depth, 'duplicate/collision archive path', 'TRAVERSAL'); seen.add(collisionKey);
      const directory = /\/$/.test(name); const modeType = attributes & 0xF0000000; const symlink = modeType === 0xA0000000; const device = modeType === 0x60000000 || modeType === 0x20000000 || modeType === 0x10000000; if (symlink) return this.rejectArchive(entries, expanded, depth, 'symlink archive entry is not allowed', 'SYMLINK_ESCAPE'); if (device) return this.rejectArchive(entries, expanded, depth, 'device/FIFO archive entry is not allowed', 'TRAVERSAL');
      if (uncompressed > this.budget.maxSingleEntrySize || expanded + uncompressed > this.budget.maxExpandedBytes) return this.rejectArchive(entries, expanded, depth, 'archive expanded-size limit exceeded', 'BOMB');
      const ratio = compressed === 0 ? (uncompressed > 0 ? Number.POSITIVE_INFINITY : 1) : uncompressed / compressed; if (ratio > this.budget.maxCompressionRatio) return this.rejectArchive(entries, expanded, depth, 'archive compression ratio exceeded', 'BOMB');
      expanded += uncompressed; const nested = /\.(?:zip|gz|tgz|tar|rar|7z|jar|apk|xpi)$/i.test(name); entries.push({ name: name.slice(0, this.budget.maxPathLength), compressedBytes: compressed, expandedBytes: uncompressed, directory, symlink, safePath: pathResult.path, nestedArchive: nested, risk: nested && depth + 1 > this.budget.maxArchiveDepth ? 'NESTED' : nested ? 'ARCHIVE' : 'NONE' });
    }
    if (entries.some(entry => entry.nestedArchive && depth + 1 > this.budget.maxArchiveDepth)) return this.rejectArchive(entries, expanded, depth, 'archive nesting depth exceeded', 'NESTED');
    return { isArchive: true, accepted: true, risk: entries.some(entry => entry.nestedArchive) ? 'NESTED' : 'ARCHIVE', entries, expandedBytes: expanded, depth };
  }
  private inspectTar(bytes: Uint8Array, depth: number): ArchiveInspectionResult {
    const entries: ArchiveEntryInspection[] = []; const seen = new Set<string>(); let offset = 0; let expanded = 0;
    while (offset + 512 <= bytes.length && entries.length <= this.budget.maxEntries) {
      const block = bytes.subarray(offset, offset + 512); if (block.every(byte => byte === 0)) break; const name = new TextDecoder().decode(block.subarray(0, 100)).replace(/\0.*$/, ''); const sizeText = new TextDecoder().decode(block.subarray(124, 136)).replace(/\0.*$/, '').trim(); const size = parseInt(sizeText || '0', 8); const pathResult = safeArchivePath(name); if (!pathResult.safe) return this.rejectArchive(entries, expanded, depth, pathResult.reason, 'TRAVERSAL'); const collisionKey = archiveCollisionKey(pathResult.path); if (seen.has(collisionKey)) return this.rejectArchive(entries, expanded, depth, 'duplicate/collision archive path', 'TRAVERSAL'); seen.add(collisionKey); if (!Number.isFinite(size) || size < 0 || size > this.budget.maxSingleEntrySize || expanded + size > this.budget.maxExpandedBytes) return this.rejectArchive(entries, expanded, depth, 'archive expanded-size limit exceeded', 'BOMB'); const type = String.fromCharCode(block[156] ?? 0); const symlink = type === '2' || type === '1'; const device = type === '3' || type === '4' || type === '6'; if (symlink) return this.rejectArchive(entries, expanded, depth, 'link archive entry is not allowed', 'SYMLINK_ESCAPE'); if (device) return this.rejectArchive(entries, expanded, depth, 'device/FIFO archive entry is not allowed', 'TRAVERSAL'); const blocks = Math.ceil(size / 512); if (offset + 512 + blocks * 512 > bytes.length) return this.rejectArchive(entries, expanded, depth, 'TAR entry exceeds the archive', 'MALFORMED'); expanded += size; entries.push({ name, compressedBytes: size, expandedBytes: size, directory: type === '5', symlink: false, safePath: pathResult.path, nestedArchive: /\.(?:zip|tar|gz|7z|rar)$/i.test(name), risk: 'NONE' }); offset += 512 + blocks * 512;
    }
    if (entries.length > this.budget.maxEntries) return this.rejectArchive(entries, expanded, depth, 'archive entry count exceeded', 'BOMB');
    if (entries.some(entry => entry.nestedArchive && depth + 1 > this.budget.maxArchiveDepth)) return this.rejectArchive(entries, expanded, depth, 'archive nesting depth exceeded', 'NESTED');
    return { isArchive: true, accepted: true, risk: entries.some(entry => entry.nestedArchive) ? 'NESTED' : 'ARCHIVE', entries, expandedBytes: expanded, depth };
  }
  private rejectArchive(entries: readonly ArchiveEntryInspection[], expandedBytes: number, depth: number, reason: string, risk: ContainerRisk): ArchiveInspectionResult { return { isArchive: true, accepted: false, risk, entries, expandedBytes, depth, reason }; }
}

/** Typed media boundary. The default implementation only reads bounded headers. */
export class SandboxedMediaDecoder {
  async decode(request: MediaDecodeRequest, budgetInput: Partial<MediaDecodeBudget> = {}): Promise<DecodedMediaArtifact> {
    const budget = normalizeMediaBudget({ ...request.budget, ...budgetInput });
    if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength > budget.maxMemoryBytes) throw new Error('Media decode budget exceeded');
    const dimensions = imageDimensions(request.bytes, request.mimeType); if (dimensions && (dimensions.width > budget.maxWidth || dimensions.height > budget.maxHeight || dimensions.pixels > budget.maxPixels)) throw new Error('Image dimensions exceed media decode budget');
    const declared = mediaDeclarations(request.bytes); if (declared.frames > budget.maxFrames || declared.durationMs > budget.maxDurationMs || declared.metadataBytes > budget.maxMetadataBytes || declared.nesting > budget.maxNesting || declared.tracks > 32) throw new Error('Media metadata exceeds decode budget');
    const metadata = { decoder: 'bounded-core-header-v1', metadataBytes: Math.min(declared.metadataBytes, budget.maxMetadataBytes), ...(declared.tracks ? { tracks: declared.tracks } : {}) }; return { kind: 'DecodedMediaArtifact', trust: 'UNTRUSTED_DERIVED', sourceHash: request.sourceHash, objectId: request.objectId, mimeType: normalizeMime(request.mimeType) ?? detectMagic(request.bytes) ?? 'application/octet-stream', ...(dimensions ? { dimensions } : {}), framesDecoded: Math.min(declared.frames, budget.maxFrames), ...(declared.durationMs ? { durationMs: declared.durationMs } : {}), metadata, provenance: appendProvenance(request.provenance, { kind: 'DERIVED', contentHash: request.sourceHash, objectId: request.objectId }) };
  }
  decodeBounded(request: MediaDecodeRequest, budget?: Partial<MediaDecodeBudget>): Promise<DecodedMediaArtifact> { return this.decode(request, budget); }
}

export class DocumentPreviewService {
  constructor(private readonly host?: DocumentPreviewHost) {}
  async preview(request: DocumentPreviewRequest): Promise<DocumentPreviewArtifact | undefined> {
    if (this.host) {
      try { const value = await this.host.preview(request); return validateDocumentArtifact(value, request); } catch { return undefined; }
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(request.bytes.subarray(0, Math.min(request.bytes.length, request.maxTextBytes ?? 256 * 1024)));
    const markup = /(?:text\/html|image\/svg\+xml)/i.test(request.mimeType ?? '') ? sanitizeActiveMarkup(text) : undefined;
    return { kind: 'DocumentPreviewArtifact', trust: 'UNTRUSTED_DERIVED', sourceHash: request.sourceHash, objectId: request.objectId, ...(markup !== undefined ? { sanitizedMarkup: markup } : { text: text.slice(0, request.maxTextBytes ?? 256 * 1024) }), externalLinks: [...text.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map(match => match[0]!).slice(0, 128), macrosDisabled: true, scriptsDisabled: true, externalFetchDisabled: true, provenance: appendProvenance(request.provenance, { kind: 'DERIVED', contentHash: request.sourceHash, objectId: request.objectId }) };
  }
}

export function sanitizeActiveMarkup(input: string): string {
  return input.slice(0, 256 * 1024)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|src|xlink:href)\s*=\s*(?:"|')?\s*(?:javascript:|data:text\/html)[^"'\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');
}

export class QuarantineReleaseService {
  constructor(private readonly store: QuarantineStore, private readonly options: { readonly ownerIdentityId: string; readonly now?: () => number; readonly lifetimeMs?: number }) { if (!options.ownerIdentityId) throw new Error('Owner identity is required for file release'); }
  async release(entryId: string, intent: OwnerRequestedFileReleaseIntent): Promise<UserReleasedFileObject> {
    const entry = await this.store.get(entryId); const now = (this.options.now ?? (() => Date.now()))(); const expires = Date.parse(intent.expiresAt);
    if (!entry || entry.metadata.entryId !== entryId || !entry.inspection) throw new Error('File is not ready for owner release');
    if (intent.source !== 'OWNER' || intent.explicitOwnerRequest !== true || intent.ownerIdentityId !== this.options.ownerIdentityId || intent.objectId !== (entry.metadata.objectId ?? entryId) || intent.contentHash !== entry.contentHash || !intent.confirmed) throw new Error('Owner release authority denied');
    if (!intent.intentId || !Number.isFinite(Date.parse(intent.requestedAt)) || !Number.isFinite(expires) || expires <= now || expires - now > (this.options.lifetimeMs ?? 10 * 60_000)) throw new Error('Owner release intent is stale or invalid');
    if (entry.state === 'KNOWN_MALICIOUS' || entry.state === 'BLOCKED' || entry.state === 'INSPECTION_FAILED') throw new Error('Malicious or failed content cannot be released');
    if ((entry.inspection.riskClass === 'HIGH' || entry.inspection.riskClass === 'CRITICAL' || entry.inspection.executableRisk !== 'NONE') && intent.riskAcknowledged !== true) throw new Error('Explicit risk acknowledgement is required');
    await this.store.markOwnerReleased(entryId, QUARANTINE_RELEASE_TOKEN); return { kind: 'UserReleasedFileObject', trust: 'OWNER_RELEASED', objectId: entry.metadata.objectId ?? entryId, sourceHash: entry.contentHash, ...(entry.metadata.originalFilename ? { filename: entry.metadata.originalFilename } : {}), mimeType: entry.inspection.typeEvidence.detectedMime, bytes: entry.bytes.slice(), release: { decision: 'OWNER_CONFIRMED', intentId: intent.intentId, at: new Date(now).toISOString(), risk: entry.inspection.riskClass }, executableAuthority: false, provenance: entry.metadata.provenance };
  }
  async releaseForAgent(_entryId: string): Promise<never> { throw new Error('Remote Agent cannot release quarantined content'); }
  releaseFile(entryId: string, intent: OwnerRequestedFileReleaseIntent): Promise<UserReleasedFileObject> { return this.release(entryId, intent); }
  async exportToHost(file: UserReleasedFileObject, host: { chooseDestination(): Promise<string>; write(destination: string, bytes: Uint8Array, options: { readonly overwrite: false; readonly filename?: string }): Promise<void> }): Promise<string> { const destination = await host.chooseDestination(); if (!destination || destination.includes('\0')) throw new Error('Invalid explicit destination'); await host.write(destination, file.bytes.slice(), { overwrite: false, ...(file.filename ? { filename: file.filename } : {}) }); return destination; }
}

export interface FileContainmentOptions {
  readonly store?: QuarantineStore;
  /** Host-provided current owner identity; without it direct release fails closed. */
  readonly ownerIdentityId?: string;
  readonly detector?: FileTypeDetector;
  readonly archive?: ArchiveInspectionService;
  readonly scanner?: MalwareScannerAdapter;
  readonly mediaDecoder?: SandboxedMediaDecoder;
  readonly documentPreview?: DocumentPreviewService;
  readonly now?: () => number;
}

export interface FileContainmentMetrics {
  readonly filesQuarantined: number;
  readonly typeMismatches: number;
  readonly parserFailures: number;
  readonly archiveRejects: number;
  readonly storageQuotaRejects: number;
  readonly scanResults: Readonly<Record<MalwareScanResult['status'], number>>;
  readonly ownerReleases: number;
  readonly previewFailures: number;
}

/** Facade used by file/browser/P2P adapters. */
export class FileContainmentService {
  readonly store: QuarantineStore;
  readonly detector: FileTypeDetector;
  readonly archive: ArchiveInspectionService;
  private readonly scanner?: MalwareScannerAdapter;
  readonly mediaDecoder: SandboxedMediaDecoder;
  readonly documentPreview: DocumentPreviewService;
  private readonly now: () => number;
  private readonly ownerIdentityId?: string;
  private readonly counters = { filesQuarantined: 0, typeMismatches: 0, parserFailures: 0, archiveRejects: 0, storageQuotaRejects: 0, scanResults: { CLEAN: 0, SUSPICIOUS: 0, KNOWN_MALICIOUS: 0, UNKNOWN: 0, SCAN_FAILED: 0 } as Record<MalwareScanResult['status'], number>, ownerReleases: 0, previewFailures: 0 };
  constructor(options: FileContainmentOptions = {}) { this.store = options.store ?? new QuarantineStore({ now: options.now }); this.detector = options.detector ?? new FileTypeDetector(); this.archive = options.archive ?? new ArchiveInspectionService(); this.scanner = options.scanner; this.mediaDecoder = options.mediaDecoder ?? new SandboxedMediaDecoder(); this.documentPreview = options.documentPreview ?? new DocumentPreviewService(); this.now = options.now ?? (() => Date.now()); this.ownerIdentityId = options.ownerIdentityId; }
  async receive(descriptor: RemoteFileDescriptor, bytes: Uint8Array): Promise<QuarantineEntry> {
    try { const entry = await this.store.receive(descriptor, bytes); this.counters.filesQuarantined += 1; return entry; }
    catch (error) { if (/budget/i.test(error instanceof Error ? error.message : String(error))) this.counters.storageQuotaRejects += 1; throw error; }
  }
  ingest(descriptor: RemoteFileDescriptor, bytes: Uint8Array): Promise<QuarantineEntry> { return this.receive(descriptor, bytes); }
  async inspect(entryId: string): Promise<StructurallyInspectedBlob> {
    const entry = await this.store.get(entryId); if (!entry) throw new Error('Unknown quarantine entry'); if (entry.state === 'OWNER_RELEASED') throw new Error('Released content is no longer in quarantine'); await this.store.mark(entryId, 'INSPECTING');
    let result: FileInspectionResult; try {
      if (entry.metadata.encrypted) {
        const opaque = opaqueCiphertextInspection(entry, this.now);
        this.counters.parserFailures += 1;
        const marked = await this.store.mark(entryId, 'INSPECTION_FAILED', opaque);
        return { ...marked, kind: 'StructurallyInspectedBlob', trust: 'INSPECTED_UNTRUSTED', inspection: opaque };
      }
      const evidence = this.detector.detect({ bytes: entry.bytes, filename: entry.metadata.originalFilename, mimeType: entry.metadata.senderMimeType }); if (evidence.mismatch) this.counters.typeMismatches += 1; const archiveHint = evidence.containerRisk !== 'NONE' || /\.(?:zip|gz|tgz|tar|rar|7z)$/i.test(entry.metadata.originalFilename ?? '') || /(?:zip|compressed|tar|rar|7z)/i.test(entry.metadata.senderMimeType ?? ''); const archive = archiveHint ? this.archive.inspect(entry.bytes, { filename: entry.metadata.originalFilename }) : undefined; if (archive?.accepted === false) this.counters.archiveRejects += 1; let scanner: MalwareScanResult;
      if (this.scanner) { try { scanner = normalizeScan(await this.scanner.scan({ bytes: entry.bytes.slice(), contentHash: entry.contentHash, mimeType: evidence.detectedMime }), entry.contentHash, this.now); } catch (error) { scanner = { version: 1, status: 'SCAN_FAILED', scannedHash: entry.contentHash, scannedAt: new Date(this.now()).toISOString(), reason: error instanceof Error ? error.message : 'scanner failed' }; } } else scanner = { version: 1, status: 'UNKNOWN', scannedHash: entry.contentHash, scannedAt: new Date(this.now()).toISOString(), reason: 'No local malware scanner adapter is configured' };
      this.counters.scanResults[scanner.status] += 1; const riskClass = riskFor(evidence, archive, scanner); const state: QuarantineState = scanner.status === 'KNOWN_MALICIOUS' ? 'KNOWN_MALICIOUS' : scanner.status === 'SCAN_FAILED' || archive?.accepted === false ? 'INSPECTION_FAILED' : 'INSPECTED'; const preview = state === 'INSPECTED' && riskClass === 'LOW' && evidence.executableRisk === 'NONE' && scanner.status !== 'SUSPICIOUS' ? 'ALLOW_BOUNDED' : state === 'INSPECTED' && riskClass === 'UNKNOWN' && scanner.status === 'UNKNOWN' && evidence.executableRisk === 'NONE' && evidence.containerRisk === 'NONE' ? 'ALLOW_WITH_WARNING' : state === 'INSPECTED' && riskClass === 'MEDIUM' ? 'ALLOW_WITH_WARNING' : 'DENY'; result = { version: 1, contentHash: entry.contentHash, state, trustClass: 'INSPECTED_UNTRUSTED', typeEvidence: evidence, riskClass, executableRisk: evidence.executableRisk, containerRisk: archive?.risk ?? evidence.containerRisk, preview, scanner, inspectedAt: new Date(this.now()).toISOString(), reason: scanner.reason ?? (archive?.reason ?? (evidence.reasons.join('; ') || 'bounded inspection completed')), provenance: entry.metadata.provenance };
    } catch (error) { this.counters.parserFailures += 1; result = failedInspection(entry, error, this.now); this.counters.scanResults.SCAN_FAILED += 1; }
    const state = result.state === 'INSPECTED' && result.preview !== 'DENY' ? 'PREVIEW_ELIGIBLE' : result.state; const final = { ...result, state, trustClass: state === 'PREVIEW_ELIGIBLE' ? 'PREVIEW_SAFE' as const : result.trustClass }; const marked = await this.store.mark(entryId, state, final); return { ...marked, kind: 'StructurallyInspectedBlob', trust: 'INSPECTED_UNTRUSTED', inspection: final };
  }
  async classify(entryId: string): Promise<ClassifiedFileObject> { const inspected = await this.inspect(entryId); return { ...inspected, kind: 'ClassifiedFileObject', classification: inspected.inspection }; }
  inspectFile(entryId: string): Promise<StructurallyInspectedBlob> { return this.inspect(entryId); }
  async preview(entryId: string): Promise<SafePreviewObject | undefined> {
    const entry = await this.store.get(entryId); if (!entry?.inspection || entry.state !== 'PREVIEW_ELIGIBLE') return undefined; const inspection = entry.inspection; if (inspection.preview === 'DENY') return undefined; const mime = inspection.typeEvidence.detectedMime; const provenance = entry.metadata.provenance;
    try {
      if (mime === 'text/html' || mime === 'image/svg+xml' || mime === 'application/pdf' || mime.startsWith('text/')) { const document = await this.documentPreview.preview({ sourceHash: entry.contentHash, objectId: entry.metadata.objectId ?? entryId, mimeType: mime, bytes: entry.bytes.slice(), provenance }); if (!document) return undefined; return { kind: 'SafePreviewObject', trust: 'PREVIEW_SAFE', objectId: entry.metadata.objectId ?? entryId, sourceHash: entry.contentHash, decision: inspection.preview === 'ALLOW_WITH_WARNING' ? 'ALLOW_WITH_WARNING' : 'ALLOW_BOUNDED', mimeType: mime, representation: document.sanitizedMarkup ? 'SANITIZED_MARKUP' : 'DOCUMENT_TEXT', value: document, provenance: document.provenance }; }
      if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) { const decoded = await this.mediaDecoder.decode({ sourceHash: entry.contentHash, objectId: entry.metadata.objectId ?? entryId, mimeType: mime, bytes: entry.bytes.slice(), provenance }); return { kind: 'SafePreviewObject', trust: 'PREVIEW_SAFE', objectId: entry.metadata.objectId ?? entryId, sourceHash: entry.contentHash, decision: inspection.preview === 'ALLOW_WITH_WARNING' ? 'ALLOW_WITH_WARNING' : 'ALLOW_BOUNDED', mimeType: mime, representation: mime.startsWith('image/') ? 'STATIC_IMAGE' : mime.startsWith('video/') ? 'VIDEO_FRAME' : 'AUDIO_METADATA', value: decoded, provenance: appendProvenance(provenance, { kind: 'DERIVED', contentHash: entry.contentHash, objectId: entry.metadata.objectId ?? entryId }) }; }
      return undefined;
    } catch { this.counters.previewFailures += 1; await this.store.mark(entryId, 'INSPECTION_FAILED', { ...inspection, state: 'INSPECTION_FAILED', preview: 'UNAVAILABLE', reason: 'preview decoder failed' }); return undefined; }
  }
  createPreview(entryId: string): Promise<SafePreviewObject | undefined> { return this.preview(entryId); }
  releaseService(ownerIdentityId: string): QuarantineReleaseService { if (!this.ownerIdentityId || ownerIdentityId !== this.ownerIdentityId) throw new Error('Owner release authority is not configured for this containment host'); return new QuarantineReleaseService(this.store, { ownerIdentityId: this.ownerIdentityId, now: this.now }); }
  async release(entryId: string, intent: OwnerRequestedFileReleaseIntent): Promise<UserReleasedFileObject> { if (!this.ownerIdentityId || intent.ownerIdentityId !== this.ownerIdentityId) throw new Error('Owner release authority is not configured for this containment host'); const value = await this.releaseService(this.ownerIdentityId).release(entryId, intent); this.counters.ownerReleases += 1; return value; }
  async inspectAndPreview(entryId: string): Promise<SafePreviewObject | undefined> { const entry = await this.store.get(entryId); if (!entry?.inspection) await this.inspect(entryId); return this.preview(entryId); }
  async canEnterProcessExecution(value: unknown): Promise<false> { void value; return false; }
  metrics(): FileContainmentMetrics { return { ...this.counters, scanResults: { ...this.counters.scanResults } }; }
}

export interface BrowserDownloadContainmentBoundary {
  quarantine(download: { readonly filename?: string; readonly mimeType: string; readonly size: number; readonly bytes?: Uint8Array; readonly contentId?: string; readonly sourceUrl: string }, context: { readonly sessionId: string; readonly ownerAgentId: string }): Promise<{ readonly quarantine: 'UNTRUSTED'; readonly sha256: string; readonly filename?: string; readonly mimeType: string; readonly size: number; readonly sourceUrl: string; readonly objectId?: string }>;
}

/** Structural adapter for BrowserAgentRuntime; browser-engine stays core-independent. */
export function createBrowserDownloadContainmentBoundary(containment: FileContainmentService): BrowserDownloadContainmentBoundary {
  return { async quarantine(download, context) {
    if (!download.bytes) throw new Error('Browser download bytes are required before quarantine');
    const objectId = `browser-download:${crypto.randomUUID()}`;
    const transferId = `browser:${context.sessionId}:${crypto.randomUUID()}`;
    const contentHash = `sha256-${await sha256(download.bytes)}`;
    const entry = await containment.receive({ version: 1, transferId, sourceIdentity: context.ownerAgentId, objectId, ...(download.contentId ? { contentId: download.contentId } : {}), ...(download.filename ? { filename: download.filename } : {}), mimeType: download.mimeType, size: download.size, visibility: 'private', provenance: [{ kind: 'BROWSER_DOWNLOAD', contentHash, objectId, transferId, sourceIdentity: context.ownerAgentId, at: new Date().toISOString() }] }, download.bytes);
    return { quarantine: 'UNTRUSTED', sha256: entry.contentHash.slice('sha256-'.length), ...(entry.metadata.originalFilename ? { filename: entry.metadata.originalFilename } : {}), mimeType: download.mimeType, size: download.size, sourceUrl: download.sourceUrl, objectId: entry.metadata.objectId! };
  } };
}

export interface FileFuzzResult { readonly cases: number; readonly rejected: number; readonly violations: readonly string[]; }
export class FileFuzzHarness {
  constructor(private readonly containment = new FileContainmentService()) {}
  async run(fixtures: readonly Uint8Array[]): Promise<FileFuzzResult> { const violations: string[] = []; let rejected = 0; for (const [index, bytes] of fixtures.entries()) { try { const entry = await this.containment.receive({ version: 1, transferId: `fuzz-${index}`, sourceIdentity: 'synthetic-hostile', filename: `fixture-${index}`, mimeType: 'application/octet-stream', size: bytes.length }, bytes); await this.containment.inspect(entry.metadata.entryId); } catch { rejected++; } } return { cases: fixtures.length, rejected, violations }; }
}
export class ContainerFuzzHarness extends FileFuzzHarness {}

/** Runtime marker used by ToolPolicy. A plain FileObject is not quarantined. */
export function isQuarantinedContent(value: unknown): boolean {
  return isQuarantinedContentInternal(value, new WeakSet<object>());
}
function isQuarantinedContentInternal(value: unknown, seen: WeakSet<object>): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  const candidate = value as { kind?: unknown; trust?: unknown; state?: unknown };
  // A caller cannot forge release authority by changing a trust string on a
  // quarantine-shaped object.  Only the dedicated release/preview artifact
  // kinds are eligible for their respective privileged paths.
  if (candidate.kind === 'QuarantinedBlob' || candidate.kind === 'StructurallyInspectedBlob' || candidate.kind === 'ClassifiedFileObject') return true;
  if (candidate.state && typeof candidate.state === 'string' && ['RECEIVING', 'QUARANTINED', 'INSPECTING', 'INSPECTION_FAILED', 'BLOCKED', 'KNOWN_MALICIOUS'].includes(candidate.state)) return true;
  if (Array.isArray(value)) return value.some(item => isQuarantinedContentInternal(item, seen));
  return Object.values(value as Record<string, unknown>).some(item => isQuarantinedContentInternal(item, seen));
}

export function isDangerousFileTool(toolId: string): boolean {
  return /(?:process|execute|shell|spawn|exec|extract|unzip|install|open(?:external|file|path|attachment)|launch|run|protocolhandler|startup)/i.test(toolId);
}

export function createSyntheticAdversarialFixtures(): readonly Uint8Array[] {
  const pe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); const truncatedZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]); const pngBomb = new Uint8Array(32); pngBomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); new DataView(pngBomb.buffer).setUint32(16, 0xfffffff0, false); new DataView(pngBomb.buffer).setUint32(20, 0xfffffff0, false); return [new Uint8Array(), new TextEncoder().encode('../escape'), pe, truncatedZip, pngBomb, new TextEncoder().encode('<svg><script>alert(1)</script></svg>')];
}

export function createProvenanceChain(input: { readonly contentHash: string; readonly objectId?: string; readonly transferId?: string; readonly sourceIdentity?: string; readonly kind?: ContentProvenanceLink['kind']; readonly at?: string }): ContentProvenanceChain { return [{ kind: input.kind ?? 'REMOTE', contentHash: input.contentHash, ...(input.objectId ? { objectId: input.objectId } : {}), ...(input.transferId ? { transferId: input.transferId } : {}), ...(input.sourceIdentity ? { sourceIdentity: input.sourceIdentity } : {}), at: input.at ?? new Date().toISOString() }]; }
export function appendProvenance(chain: ContentProvenanceChain, link: Omit<ContentProvenanceLink, 'at'> & { readonly at?: string }): ContentProvenanceChain { return [...chain, { ...link, at: link.at ?? new Date().toISOString() }]; }

function normalizeStorageBudget(input?: Partial<QuarantineStorageBudget>): QuarantineStorageBudget { const v = (key: keyof QuarantineStorageBudget, fallback: number, min: number): number => { const candidate = input?.[key]; return Number.isSafeInteger(candidate) && (candidate as number) >= min ? Math.min(candidate as number, fallback) : fallback; }; return { maxPendingBytes: v('maxPendingBytes', DEFAULT_QUARANTINE_STORAGE_BUDGET.maxPendingBytes, 1), maxPerPeerBytes: v('maxPerPeerBytes', DEFAULT_QUARANTINE_STORAGE_BUDGET.maxPerPeerBytes, 1), maxPerTransferBytes: v('maxPerTransferBytes', DEFAULT_QUARANTINE_STORAGE_BUDGET.maxPerTransferBytes, 1), maxIncompleteObjects: v('maxIncompleteObjects', DEFAULT_QUARANTINE_STORAGE_BUDGET.maxIncompleteObjects, 1), maxEntries: v('maxEntries', DEFAULT_QUARANTINE_STORAGE_BUDGET.maxEntries, 1), retentionMs: v('retentionMs', DEFAULT_QUARANTINE_STORAGE_BUDGET.retentionMs, 1) }; }
function allowedQuarantineTransition(from: QuarantineState, to: QuarantineState): boolean {
  if (from === to) return true;
  if (from === 'QUARANTINED' && ['INSPECTING', 'BLOCKED', 'TRANSFER_FAILED'].includes(to)) return true;
  if (from === 'INSPECTION_FAILED' && ['INSPECTING', 'BLOCKED'].includes(to)) return true;
  if (from === 'INSPECTING' && ['INSPECTED', 'PREVIEW_ELIGIBLE', 'INSPECTION_FAILED', 'BLOCKED', 'KNOWN_MALICIOUS'].includes(to)) return true;
  if (from === 'INSPECTED' && ['INSPECTING', 'PREVIEW_ELIGIBLE', 'INSPECTION_FAILED', 'BLOCKED', 'KNOWN_MALICIOUS'].includes(to)) return true;
  if (from === 'PREVIEW_ELIGIBLE' && ['INSPECTING', 'INSPECTION_FAILED', 'BLOCKED', 'KNOWN_MALICIOUS'].includes(to)) return true;
  return false;
}
function normalizeArchiveBudget(input: Partial<ArchiveBudget>): ArchiveBudget { return { maxEntries: bounded(input.maxEntries, DEFAULT_ARCHIVE_BUDGET.maxEntries, 1), maxExpandedBytes: bounded(input.maxExpandedBytes, DEFAULT_ARCHIVE_BUDGET.maxExpandedBytes, 1), maxCompressionRatio: bounded(input.maxCompressionRatio, DEFAULT_ARCHIVE_BUDGET.maxCompressionRatio, 1), maxArchiveDepth: bounded(input.maxArchiveDepth, DEFAULT_ARCHIVE_BUDGET.maxArchiveDepth, 0), maxSingleEntrySize: bounded(input.maxSingleEntrySize, DEFAULT_ARCHIVE_BUDGET.maxSingleEntrySize, 1), maxPathLength: bounded(input.maxPathLength, DEFAULT_ARCHIVE_BUDGET.maxPathLength, 1) }; }
function normalizeMediaBudget(input: Partial<MediaDecodeBudget>): MediaDecodeBudget { return { maxWidth: bounded(input.maxWidth, DEFAULT_MEDIA_DECODE_BUDGET.maxWidth, 1), maxHeight: bounded(input.maxHeight, DEFAULT_MEDIA_DECODE_BUDGET.maxHeight, 1), maxPixels: bounded(input.maxPixels, DEFAULT_MEDIA_DECODE_BUDGET.maxPixels, 1), maxFrames: bounded(input.maxFrames, DEFAULT_MEDIA_DECODE_BUDGET.maxFrames, 1), maxDurationMs: bounded(input.maxDurationMs, DEFAULT_MEDIA_DECODE_BUDGET.maxDurationMs, 1), maxMemoryBytes: bounded(input.maxMemoryBytes, DEFAULT_MEDIA_DECODE_BUDGET.maxMemoryBytes, 1), maxMetadataBytes: bounded(input.maxMetadataBytes, DEFAULT_MEDIA_DECODE_BUDGET.maxMetadataBytes, 1), maxNesting: bounded(input.maxNesting, DEFAULT_MEDIA_DECODE_BUDGET.maxNesting, 0) }; }
function bounded(value: number | undefined, fallback: number, min: number): number { return Number.isSafeInteger(value) && value! >= min ? Math.min(value!, fallback) : fallback; }
function validateDescriptor(value: RemoteFileDescriptor): void { if (!value || value.version !== 1 || !value.transferId || !value.sourceIdentity || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > DEFAULT_QUARANTINE_STORAGE_BUDGET.maxPerTransferBytes) throw new Error('Invalid remote file descriptor'); if (value.filename && value.filename.length > 255) throw new Error('Remote filename is too long'); if (value.mimeType && value.mimeType.length > 255) throw new Error('Remote MIME is too long'); }
function cloneEntry(value: QuarantineEntry): QuarantineEntry { return { ...value, metadata: { ...value.metadata, provenance: value.metadata.provenance.map(link => ({ ...link })) }, bytes: value.bytes.slice(), provenance: value.provenance.map(link => ({ ...link })), ...(value.inspection ? { inspection: cloneInspection(value.inspection) } : {}) }; }
function cloneInspection(value: FileInspectionResult): FileInspectionResult { return { ...value, typeEvidence: { ...value.typeEvidence, reasons: [...value.typeEvidence.reasons] }, scanner: { ...value.scanner }, provenance: value.provenance.map(link => ({ ...link })) }; }
function clone<T>(value: T): T { return structuredClone(value); }
function extensionOf(filename?: string): string | undefined { if (!filename) return undefined; const base = filename.split(/[\\/]/).pop() ?? filename; const index = base.lastIndexOf('.'); return index > 0 ? base.slice(index + 1).toLowerCase() : undefined; }
function normalizeMime(value?: string): string | undefined { const mime = value?.trim().toLowerCase(); return mime && /^[a-z0-9.+-]+\/[a-z0-9.+*-]+$/.test(mime) ? mime.slice(0, 255) : undefined; }
function detectMagic(bytes: Uint8Array): string | undefined { if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'PE'; if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'ELF'; if (bytes.length >= 4 && ((bytes[0] === 0xfe && bytes[1] === 0xed && bytes[2] === 0xfa && (bytes[3] === 0xce || bytes[3] === 0xcf)) || (bytes[0] === 0xcf && bytes[1] === 0xfa && bytes[2] === 0xed && (bytes[3] === 0xfe || bytes[3] === 0xff)))) return 'MACHO'; if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG'; if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG'; if (bytes.length >= 6 && new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF89a' || bytes.length >= 6 && new TextDecoder().decode(bytes.subarray(0, 6)) === 'GIF87a') return 'GIF'; if (bytes.length >= 4 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF') return 'RIFF'; if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return 'ZIP'; if (bytes.length >= 4 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'GZIP'; if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'PDF'; if (bytes.length >= 4 && bytes[0] === 0x37 && bytes[1] === 0xaf && bytes[2] === 0xbc && bytes[3] === 0xaf) return 'SEVEN_ZIP'; if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) return 'RAR'; if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 && bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1) return 'OLE'; const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 128))); if (/^#!\s*\/(?:usr\/bin\/env\s+)?(?:sh|bash|zsh|python|node|pwsh|perl|ruby)/i.test(text)) return 'SCRIPT'; if (/^<\s*(?:svg|html|!doctype\s+html)/i.test(text)) return 'ACTIVE_MARKUP'; if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(4, 8)) === 'ftyp') return 'MP4'; if (bytes.length >= 4 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'OggS') return 'OGG'; if (bytes.length >= 262 && new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar') return 'TAR'; return undefined; }
function magicMime(magic: string | undefined, bytes: Uint8Array): string { switch (magic) { case 'PE': return 'application/vnd.microsoft.portable-executable'; case 'ELF': return 'application/x-elf'; case 'MACHO': return 'application/x-mach-binary'; case 'PNG': return 'image/png'; case 'JPEG': return 'image/jpeg'; case 'GIF': return 'image/gif'; case 'PDF': return 'application/pdf'; case 'ZIP': return 'application/zip'; case 'GZIP': return 'application/gzip'; case 'RAR': return 'application/vnd.rar'; case 'SEVEN_ZIP': return 'application/x-7z-compressed'; case 'OLE': return 'application/vnd.ms-office'; case 'MP4': return 'video/mp4'; case 'OGG': return 'application/ogg'; case 'TAR': return 'application/x-tar'; case 'ACTIVE_MARKUP': return /^<\s*svg/i.test(new TextDecoder().decode(bytes.subarray(0, 32))) ? 'image/svg+xml' : 'text/html'; case 'SCRIPT': return 'text/x-script'; default: return printable(bytes) ? 'text/plain' : 'application/octet-stream'; } }
function magicType(magic: string | undefined, bytes: Uint8Array): string { return magic ?? (printable(bytes) ? 'text' : 'binary'); }
function executableFor(magic: string | undefined, extension: string | undefined, mime: string | undefined, bytes: Uint8Array): ExecutableRisk { if (magic === 'PE' || magic === 'ELF' || magic === 'MACHO') return 'CRITICAL'; if (magic === 'SCRIPT' || ['sh', 'bash', 'ps1', 'bat', 'cmd', 'js', 'mjs', 'cjs', 'py', 'pl', 'rb', 'vbs', 'wasm'].includes(extension ?? '') || /(?:script|executable|x-msdownload|x-sh|x-python)/i.test(mime ?? '') || /^\s*(?:import\s+os|const\s+child_process|powershell\b)/i.test(new TextDecoder().decode(bytes.subarray(0, 512)))) return 'HIGH'; if (['msi', 'app', 'dmg', 'deb', 'rpm', 'apk', 'ipa', 'jar', 'desktop', 'docm', 'dotm', 'xlsm', 'xlam', 'pptm', 'ppsm', 'sldm'].includes(extension ?? '') || magic === 'OLE' && ['doc', 'dot', 'xls', 'xlt', 'ppt', 'pot', 'pps', 'docm', 'dotm', 'xlsm', 'xlam', 'pptm', 'ppsm', 'sldm'].includes(extension ?? '')) return 'HIGH'; return 'NONE'; }
function containerFor(magic: string | undefined, bytes: Uint8Array): ContainerRisk { if (magic === 'ZIP' || magic === 'GZIP' || magic === 'RAR' || magic === 'SEVEN_ZIP' || magic === 'TAR' || magic === 'OLE') return 'ARCHIVE'; if (bytes.length > 0 && magic === undefined && bytes.length > 128 * 1024 * 1024) return 'BOMB'; return 'NONE'; }
function extensionMismatch(extension: string, detectedType: string): boolean { if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return !['PNG', 'JPEG', 'GIF', 'RIFF'].includes(detectedType); if (['exe', 'dll', 'scr', 'com'].includes(extension)) return !['PE', 'ELF', 'MACHO'].includes(detectedType); if (['zip', 'jar', 'apk', 'xpi'].includes(extension)) return detectedType !== 'ZIP'; if (['gz', 'tgz'].includes(extension)) return detectedType !== 'GZIP'; if (['rar'].includes(extension)) return detectedType !== 'RAR'; if (['7z'].includes(extension)) return detectedType !== 'SEVEN_ZIP'; if (['pdf'].includes(extension)) return detectedType !== 'PDF'; if (['html', 'htm', 'svg'].includes(extension)) return detectedType !== 'ACTIVE_MARKUP'; return false; }
function mimeMismatch(mime: string, detected: string, type: string): boolean { if (mime.startsWith('image/')) return !detected.startsWith('image/'); if (mime.startsWith('video/')) return !detected.startsWith('video/') && type !== 'RIFF'; if (mime === 'application/pdf') return type !== 'PDF'; if (mime.includes('zip') || mime.includes('compressed')) return !['ZIP', 'GZIP', 'RAR', 'SEVEN_ZIP', 'TAR'].includes(type); if (mime.includes('executable')) return !['PE', 'ELF', 'MACHO'].includes(type); return false; }
function printable(bytes: Uint8Array): boolean { if (!bytes.length) return true; const sample = bytes.subarray(0, Math.min(bytes.length, 4_096)); let printableCount = 0; for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || byte >= 32) printableCount++; return printableCount / sample.length > 0.92; }
function imageDimensions(bytes: Uint8Array, mime?: string): { readonly width: number; readonly height: number; readonly pixels: number } | undefined { if (detectMagic(bytes) === 'PNG' && bytes.length >= 24) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const width = view.getUint32(16, false); const height = view.getUint32(20, false); return { width, height, pixels: width * height }; } if (detectMagic(bytes) === 'GIF' && bytes.length >= 10) { const width = bytes[6]! | (bytes[7]! << 8); const height = bytes[8]! | (bytes[9]! << 8); return { width, height, pixels: width * height }; } void mime; return undefined; }
function mediaDeclarations(bytes: Uint8Array): { readonly frames: number; readonly durationMs: number; readonly metadataBytes: number; readonly nesting: number; readonly tracks: number } { const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 8_192))); const read = (name: string): number => { const match = new RegExp(`(?:["']?${name}["']?)\\s*[:=]\\s*(\\d+)`, 'i').exec(text); return match ? Number(match[1]) : 0; }; return { frames: read('frames') || read('frameCount'), durationMs: read('durationMs') || read('duration'), metadataBytes: read('metadataBytes') || Math.min(bytes.byteLength, 2 * 1024 * 1024), nesting: read('nesting') || read('depth'), tracks: read('tracks') || read('trackCount') }; }
function declaredCompressedSize(bytes: Uint8Array, magic?: string): number { if (magic === 'GZIP' && bytes.length >= 4) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return view.getUint32(bytes.byteLength - 4, true); } return bytes.byteLength; }
function riskFor(evidence: FileTypeEvidence, archive: ArchiveInspectionResult | undefined, scanner: MalwareScanResult): FileRiskClass { if (scanner.status === 'KNOWN_MALICIOUS' || evidence.executableRisk === 'CRITICAL' || archive?.risk === 'BOMB' || archive?.risk === 'TRAVERSAL' || archive?.risk === 'SYMLINK_ESCAPE') return 'CRITICAL'; if (scanner.status === 'SUSPICIOUS' || evidence.executableRisk === 'HIGH' || evidence.mismatch || archive?.accepted === false) return 'HIGH'; if (evidence.containerRisk !== 'NONE' || archive?.risk === 'ARCHIVE' || archive?.risk === 'NESTED') return 'MEDIUM'; if (scanner.status === 'SCAN_FAILED' || scanner.status === 'UNKNOWN') return 'UNKNOWN'; return 'LOW'; }
function normalizeScan(value: MalwareScanResult, hash: string, now: () => number): MalwareScanResult { if (!value || value.version !== 1 || !['CLEAN', 'SUSPICIOUS', 'KNOWN_MALICIOUS', 'UNKNOWN', 'SCAN_FAILED'].includes(value.status) || value.scannedHash !== hash) return { version: 1, status: 'SCAN_FAILED', scannedHash: hash, scannedAt: new Date(now()).toISOString(), reason: 'Scanner returned malformed or mismatched result' }; return { ...value, scannedAt: Number.isFinite(Date.parse(value.scannedAt)) ? value.scannedAt : new Date(now()).toISOString() }; }
function failedInspection(entry: QuarantineEntry, error: unknown, now: () => number): FileInspectionResult { const reason = error instanceof Error ? error.message : 'inspection failed'; return { version: 1, contentHash: entry.contentHash, state: 'INSPECTION_FAILED', trustClass: 'QUARANTINED', typeEvidence: { detectedMime: 'application/octet-stream', detectedType: 'unknown', confidence: 'LOW', mismatch: false, executableRisk: 'POSSIBLE', containerRisk: 'MALFORMED', reasons: [reason] }, riskClass: 'UNKNOWN', executableRisk: 'POSSIBLE', containerRisk: 'MALFORMED', preview: 'UNAVAILABLE', scanner: { version: 1, status: 'SCAN_FAILED', scannedHash: entry.contentHash, scannedAt: new Date(now()).toISOString(), reason }, inspectedAt: new Date(now()).toISOString(), reason, provenance: entry.metadata.provenance }; }
function opaqueCiphertextInspection(entry: QuarantineEntry, now: () => number): FileInspectionResult { const at = new Date(now()).toISOString(); return { version: 1, contentHash: entry.contentHash, state: 'INSPECTION_FAILED', trustClass: 'QUARANTINED', typeEvidence: { senderMimeHint: entry.metadata.senderMimeType, detectedMime: 'application/octet-stream', detectedType: 'encrypted-ciphertext', confidence: 'HIGH', mismatch: false, executableRisk: 'NONE', containerRisk: 'NONE', reasons: ['encrypted private bytes remain opaque until authorized materialization'] }, riskClass: 'UNKNOWN', executableRisk: 'NONE', containerRisk: 'NONE', preview: 'UNAVAILABLE', scanner: { version: 1, status: 'UNKNOWN', scannedHash: entry.contentHash, scannedAt: at, reason: 'Encrypted ciphertext is not scanned as plaintext content' }, inspectedAt: at, reason: 'Encrypted ciphertext requires an authorized decrypt/materialization boundary', provenance: entry.metadata.provenance }; }
function findSignature(bytes: Uint8Array, signature: number, start: number): number { for (let i = Math.min(start, bytes.length - 4); i >= 0; i--) { if ((bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0 === signature) return i; } return -1; }
function safeArchivePath(value: string): { readonly safe: true; readonly path: string } | { readonly safe: false; readonly reason: string } { const normalized = value.normalize('NFKC').replaceAll('\\', '/'); const trimmed = normalized.replace(/\/+$/, ''); if (!trimmed || trimmed.startsWith('/') || trimmed.startsWith('//') || /^[A-Za-z]:/.test(trimmed) || trimmed.split('/').some(part => part === '..' || part === '')) return { safe: false, reason: 'archive path traversal or absolute path' }; if (/^(?:dev|proc|sys)\//i.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) return { safe: false, reason: 'special archive path is not allowed' }; return { safe: true, path: trimmed }; }
function archiveCollisionKey(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().replace(/[а-яё]/g, char => ({ а: 'a', б: 'b', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', х: 'x' } as Record<string, string>)[char] ?? char); }
function validateDocumentArtifact(value: DocumentPreviewArtifact, request: DocumentPreviewRequest): DocumentPreviewArtifact { if (!value || value.kind !== 'DocumentPreviewArtifact' || value.trust !== 'UNTRUSTED_DERIVED' || value.sourceHash !== request.sourceHash || value.macrosDisabled !== true || value.scriptsDisabled !== true || value.externalFetchDisabled !== true) throw new Error('Document preview host returned an unsafe artifact'); return { ...value, ...(value.text !== undefined ? { text: value.text.slice(0, request.maxTextBytes ?? 256 * 1024) } : {}), ...(value.sanitizedMarkup !== undefined ? { sanitizedMarkup: sanitizeActiveMarkup(value.sanitizedMarkup) } : {}), externalLinks: value.externalLinks.filter(link => /^https?:\/\//i.test(link)).slice(0, 128), provenance: value.provenance.map(link => ({ ...link })) }; }
