import { sha256Hex } from './plugin-integrity.js';
import { validatePluginPackage } from './plugin-manifest.js';
import {
  type PluginAvailabilityRecord,
  type PluginChunk,
  type PluginContentAddress,
  type PluginDiscoveryResult,
  type PluginDistributionOptions,
  type PluginDistributionRecord,
  type PluginDownloadPlan,
  type PluginInstallCandidate,
  type PluginPackage,
  type PluginPackageDescriptor,
  type PluginPackageReference,
  type PluginPackageTransfer,
  type PluginRecoveryPlan,
  type PluginRevisionArchive,
  type PluginRevision,
  type PluginSourceDescriptor,
  type PluginSourceId,
  type PluginSourceRegistration,
  type PluginSourceTrust,
  type PluginTransferReceipt,
  type PluginTransferState,
  type PluginUpdateCandidate,
  type PluginUpdateCheckResult,
  type PluginUpdatePolicy,
  type PluginPublisherIdentity,
  type PluginDependency,
  type PluginCapability,
  type PluginInstallRecord,
  type PluginDistributionAuditEvent,
  type PluginUpdatePlan,
} from './plugin-types.js';
import { PluginPlatformError } from './plugin-platform.js';
import { assertPackageBounds, DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY, verifyPluginSupplyChain } from './plugin-supply-chain.js';

const DEFAULT_MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_MAX_CHUNKS = 65_536;
const DEFAULT_MAX_SOURCES = 64;
const DEFAULT_MAX_RESULTS = 100;
const CORE_SOURCE_IDS = new Set(['keystone.official', 'keystone.core']);

export interface PluginSourceRegistrySnapshot { readonly sources: readonly PluginSourceDescriptor[]; readonly availability: readonly PluginAvailabilityRecord[]; }

/** Owner-managed source registry. Source trust is provenance only, never package authority. */
export class PluginSourceRegistry {
  private readonly entries = new Map<PluginSourceId, PluginSourceRegistration>();
  private readonly availabilityMap = new Map<string, PluginAvailabilityRecord>();

  register(input: PluginSourceRegistration): PluginSourceDescriptor {
    const descriptor = normalizeSource(input.descriptor, false);
    if (this.entries.size >= DEFAULT_MAX_SOURCES && !this.entries.has(descriptor.id!)) throw new PluginPlatformError('QUOTA', 'Plugin source limit exceeded');
    this.entries.set(descriptor.id!, { ...input, descriptor });
    return structuredClone(descriptor);
  }
  add(input: PluginSourceRegistration): PluginSourceDescriptor { return this.register(input); }
  registerCore(input: PluginSourceRegistration): PluginSourceDescriptor { const descriptor = normalizeSource(input.descriptor, true); this.entries.set(descriptor.id!, { ...input, descriptor }); return structuredClone(descriptor); }
  remove(id: PluginSourceId): boolean { const value = this.entries.get(id); if (value?.descriptor.trust === 'CORE_RESERVED') throw new PluginPlatformError('POLICY_DENIED', 'Core-reserved Plugin sources cannot be removed'); return this.entries.delete(id); }
  enable(id: PluginSourceId, enabled = true): void { const value = this.require(id); this.entries.set(id, { ...value, descriptor: { ...value.descriptor, enabled, health: enabled ? (value.descriptor.health ?? 'AVAILABLE') : 'DISABLED' } }); }
  disable(id: PluginSourceId): void { this.enable(id, false); }
  setHealth(id: PluginSourceId, health: NonNullable<PluginSourceDescriptor['health']>): void { const value = this.require(id); this.entries.set(id, { ...value, descriptor: { ...value.descriptor, health, enabled: health !== 'DISABLED' } }); }
  get(id: PluginSourceId): PluginSourceRegistration | undefined { const value = this.entries.get(id); return value && { ...value, descriptor: structuredClone(value.descriptor) }; }
  require(id: PluginSourceId): PluginSourceRegistration { const value = this.get(id); if (!value) throw new PluginPlatformError('NOT_FOUND', `Plugin source not found: ${id}`); return value; }
  list(options: { readonly enabledOnly?: boolean } = {}): readonly PluginSourceRegistration[] { return [...this.entries.values()].filter(value => !options.enabledOnly || value.descriptor.enabled !== false).map(value => ({ ...value, descriptor: structuredClone(value.descriptor) })); }
  setAvailability(record: PluginAvailabilityRecord): void { this.availabilityMap.set(record.contentAddress, structuredClone(record)); }
  availability(contentAddress: PluginContentAddress): PluginAvailabilityRecord | undefined { const value = this.availabilityMap.get(contentAddress); return value && structuredClone(value); }
  snapshot(): PluginSourceRegistrySnapshot { return { sources: this.list().map(value => value.descriptor), availability: [...this.availabilityMap.values()].map(value => structuredClone(value)) }; }
}

/**
 * Content-addressed package distribution. It never installs or enables a
 * package implicitly. A source only supplies bytes/metadata; the existing
 * quarantine and installer remain the sole activation path.
 */
export class PluginDistributionService {
  private readonly records = new Map<string, PluginDistributionRecord>();
  private readonly packages = new Map<string, PluginPackage>();
  private readonly plans = new Map<string, PluginDownloadPlan>();
  private readonly archives = new Map<string, PluginRevisionArchive[]>();
  private readonly pendingUpdates = new Map<string, PluginPackageReference>();
  private readonly partialChunks = new Map<string, Map<number, PluginChunk>>();
  private readonly sourceRegistry: PluginSourceRegistry;
  private readonly options: Required<Pick<PluginDistributionOptions, 'maxConcurrentTransfers' | 'maxConcurrentChunks' | 'maxChunkBytes' | 'maxPackageBytes' | 'sourceTimeoutMs'>> & PluginDistributionOptions;
  private activeTransfers = 0;
  private sequence = 0;
  private readonly revoked = new Map<string, import('./plugin-types.js').PluginRevocationRecord>();

  constructor(sourceRegistry = new PluginSourceRegistry(), options: PluginDistributionOptions = {}) {
    this.sourceRegistry = sourceRegistry;
    this.options = { ...options, maxConcurrentTransfers: Math.max(1, Math.min(options.maxConcurrentTransfers ?? 2, 8)), maxConcurrentChunks: Math.max(1, Math.min(options.maxConcurrentChunks ?? 4, 16)), maxChunkBytes: Math.max(1024, Math.min(options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_CHUNK_BYTES)), maxPackageBytes: Math.max(1024, Math.min(options.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES, DEFAULT_MAX_PACKAGE_BYTES)), sourceTimeoutMs: Math.max(100, Math.min(options.sourceTimeoutMs ?? 30_000, 120_000)) };
    for (const record of options.revocations ?? []) this.revoked.set(`${record.kind}:${record.subject}`, structuredClone(record));
  }
  addRevocation(record: import('./plugin-types.js').PluginRevocationRecord): void { this.revoked.set(`${record.kind}:${record.subject}`, structuredClone(record)); }
  revocations(): readonly import('./plugin-types.js').PluginRevocationRecord[] { return [...this.revoked.values()].map(value => structuredClone(value)); }
  async restore(): Promise<void> { if (this.options.store) for (const record of await this.options.store.read()) this.records.set(key(record.reference), structuredClone(record)); if (this.options.chunkStore) for (const record of this.records.values()) { const chunks = await this.options.chunkStore.read(record.reference.contentAddress); if (chunks.length) this.partialChunks.set(record.reference.contentAddress, new Map(chunks.map(chunk => [chunk.index, chunk]))); } }
  async persist(): Promise<void> { await this.options.store?.write(this.snapshot()); }
  sources(): PluginSourceRegistry { return this.sourceRegistry; }
  availability(contentAddress: PluginContentAddress): PluginAvailabilityRecord | undefined { return this.sourceRegistry.availability(contentAddress); }
  advertise(record: PluginAvailabilityRecord): void { this.sourceRegistry.setAvailability({ ...record, sourceIds: [...record.sourceIds].slice(0, DEFAULT_MAX_SOURCES), lastSeenAt: record.lastSeenAt }); }
  snapshot(): readonly PluginDistributionRecord[] { return [...this.records.values()].map(value => structuredClone(value)); }
  package(reference: PluginPackageReference): PluginPackage | undefined { const value = this.packages.get(reference.contentAddress); return value && structuredClone(value); }
  plan(reference: PluginPackageReference, sourceIds?: readonly PluginSourceId[]): PluginDownloadPlan {
    const sources = this.selectSources(sourceIds);
    const plan: PluginDownloadPlan = { id: `transfer:${++this.sequence}`, reference: structuredClone(reference), sourceIds: sources.map(value => value.descriptor.id!), deliveryClass: 'BACKGROUND', maxConcurrentChunks: this.options.maxConcurrentChunks, createdAt: iso(this.now()), offlineQueued: Boolean(this.options.offline) };
    this.plans.set(plan.id, plan);
    this.setRecord(reference, { state: this.options.offline ? 'QUEUED' : 'DISCOVERED', receivedBytes: this.records.get(key(reference))?.receivedBytes ?? 0, receivedChunks: this.records.get(key(reference))?.receivedChunks ?? [], sourceIds: plan.sourceIds });
    return structuredClone(plan);
  }
  async discover(query: { readonly text?: string; readonly pluginId?: string; readonly version?: string; readonly sourceIds?: readonly PluginSourceId[]; readonly limit?: number; readonly channel?: import('./plugin-types.js').PluginUpdateChannel } = {}): Promise<readonly PluginDiscoveryResult[]> {
    const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_MAX_RESULTS, DEFAULT_MAX_RESULTS));
    const results: PluginDiscoveryResult[] = [];
    for (const source of this.selectSources(query.sourceIds)) {
      if (!source.provider.discover) continue;
      try { const values = await withTimeout(source.provider.discover({ text: query.text, pluginId: query.pluginId, version: query.version, channel: query.channel, limit }), this.options.sourceTimeoutMs); if (!Array.isArray(values) || values.length > DEFAULT_MAX_RESULTS * 10) throw new PluginPlatformError('QUOTA', 'Plugin source discovery catalog is too large'); for (const item of values.slice(0, limit - results.length)) results.push({ ...sanitizeDiscovery(item), source: { ...source.descriptor }, metadataTrust: source.descriptor.trust === 'CORE_RESERVED' ? 'SOURCE_AUTHENTICATED' : 'UNTRUSTED' });
      } catch { /* one malicious/dead source cannot block other sources */ }
      if (results.length >= limit) break;
    }
    return results;
  }
  async acquire(reference: PluginPackageReference, sourceIds?: readonly PluginSourceId[]): Promise<PluginDistributionRecord> {
    const existing = this.records.get(key(reference));
    if (existing?.state === 'COMPLETE' || existing?.state === 'VERIFIED') return structuredClone(existing);
    if (existing?.state === 'QUEUED' && this.options.offline) throw new PluginPlatformError('OFFLINE', 'Plugin acquisition remains queued while offline');
    if (this.options.offline && !this.packages.has(reference.contentAddress)) { this.plan(reference, sourceIds); throw new PluginPlatformError('OFFLINE', 'Plugin acquisition queued while offline'); }
    if (this.activeTransfers >= this.options.maxConcurrentTransfers) { this.plan(reference, sourceIds); throw new PluginPlatformError('QUOTA', 'Plugin transfer concurrency limit reached'); }
    const sources = this.selectSources(sourceIds); if (!sources.length) { this.setRecord(reference, { state: 'FAILED', receivedBytes: 0, receivedChunks: [], sourceIds: [], error: failure('UNAVAILABLE', 'No enabled Plugin source is available') }); return this.requireRecord(reference); }
    this.activeTransfers++;
    try {
      this.setRecord(reference, { state: 'ACQUIRING', receivedBytes: existing?.receivedBytes ?? 0, receivedChunks: existing?.receivedChunks ?? [], sourceIds: sources.map(value => value.descriptor.id!) });
      let lastError: unknown;
      for (const source of sources) {
        try {
          const received = await withTimeout(source.provider.acquire(reference, undefined, { receivedChunks: existing?.receivedChunks ?? [] }), this.options.sourceTimeoutMs);
          const plugin = await this.materialize(reference, received, (bytes, chunks) => this.setRecord(reference, { state: 'PARTIAL', receivedBytes: bytes, receivedChunks: chunks, sourceIds: sources.map(value => value.descriptor.id!) }));
          await this.verifyExactReference(reference, plugin);
          assertPackageBounds(plugin, this.options.supplyChainPolicy ?? DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY);
          const verification = await verifyPluginSupplyChain(plugin, { policy: this.options.supplyChainPolicy, revocations: this.revocations() });
          if (verification.security === 'REJECTED') throw new PluginPlatformError('POLICY_DENIED', 'Plugin supply-chain verification rejected the package');
          this.setRecord(reference, { state: 'QUARANTINED', receivedBytes: packageBytes(plugin), receivedChunks: [], sourceIds: sources.map(value => value.descriptor.id!) });
          await this.options.quarantine?.inspect(plugin);
          this.packages.set(reference.contentAddress, structuredClone(plugin));
          for (const source of sources) this.sourceRegistry.setAvailability({ contentAddress: reference.contentAddress, available: true, sourceIds: sources.map(value => value.descriptor.id!), lastSeenAt: iso(this.now()) });
          this.audit({ type: 'PACKAGE_RECEIVED', pluginId: reference.pluginId, contentAddress: reference.contentAddress, sourceIds: sources.map(value => value.descriptor.id!) });
          this.setRecord(reference, { state: 'VERIFIED', receivedBytes: packageBytes(plugin), receivedChunks: [], sourceIds: sources.map(value => value.descriptor.id!) });
          return this.requireRecord(reference);
        } catch (error) { lastError = error; }
      }
      const code = lastError instanceof PluginPlatformError ? lastError.code : 'UNAVAILABLE';
      const previous = this.records.get(key(reference));
      const retryable = code === 'TIMEOUT' || code === 'UNAVAILABLE' || code === 'OFFLINE' || code === 'CANCELLED' || code === 'INCOMPLETE';
      this.setRecord(reference, { state: retryable && previous?.receivedChunks.length ? 'PARTIAL' : 'FAILED', receivedBytes: previous?.receivedBytes ?? 0, receivedChunks: previous?.receivedChunks ?? [], sourceIds: sources.map(value => value.descriptor.id!), error: failure(code, lastError instanceof Error ? lastError.message : 'Plugin package acquisition failed') });
      this.audit({ type: 'VERIFICATION_FAILED', pluginId: reference.pluginId, contentAddress: reference.contentAddress, sourceIds: sources.map(value => value.descriptor.id!), details: lastError instanceof Error ? lastError.message : 'acquisition failed' });
      return this.requireRecord(reference);
    } finally { this.activeTransfers--; }
  }
  /** Explicit owner-facing handoff: VERIFIED package enters normal receive/review, never installation. */
  async prepareInstall(reference: PluginPackageReference): Promise<PluginInstallCandidate> {
    const plugin = this.packages.get(reference.contentAddress); if (!plugin) throw new PluginPlatformError('NOT_FOUND', 'Verified Plugin package is not available');
    const manifest = await validatePluginPackage(plugin); if (manifest.id !== reference.pluginId || manifest.version !== reference.version) throw new PluginPlatformError('INTEGRITY', 'Package identity does not match requested reference');
    if (this.isRevoked(reference.contentAddress, manifest.signatureMetadata?.signerIdentity)) throw new PluginPlatformError('POLICY_DENIED', 'Security-revoked Plugin revision cannot be installed');
    if (!this.options.installer) throw new PluginPlatformError('UNAVAILABLE', 'Plugin installer is not configured');
    await this.options.installer.receive(plugin);
    this.audit({ type: 'INSTALL_READY', pluginId: reference.pluginId, contentAddress: reference.contentAddress });
    this.setRecord(reference, { state: 'READY', receivedBytes: packageBytes(plugin), receivedChunks: [], sourceIds: this.records.get(key(reference))?.sourceIds ?? [] });
    return { package: descriptorFromPackage(plugin), reviewRequired: true, installedDisabled: true };
  }
  /** Explicit owner action. This convenience method still delegates to the existing installer. */
  async install(reference: PluginPackageReference): Promise<PluginInstallRecord> {
    if (!this.options.installer?.install) throw new PluginPlatformError('UNAVAILABLE', 'Plugin installer is not configured');
    await this.prepareInstall(reference);
    return this.options.installer.install(reference.pluginId);
  }
  async stageUpdate(pluginId: string, reference: PluginPackageReference): Promise<PluginUpdatePlan> {
    if (!this.options.installer?.update) throw new PluginPlatformError('UNAVAILABLE', 'Plugin update installer is not configured');
    const plugin = this.packages.get(reference.contentAddress); if (!plugin) throw new PluginPlatformError('NOT_FOUND', 'Verified update package is not available');
    await this.verifyExactReference(reference, plugin); const plan = await this.options.installer.update(pluginId, plugin); this.audit({ type: 'UPDATE_STAGED', pluginId, contentAddress: reference.contentAddress }); return plan;
  }
  async applyUpdate(pluginId: string, approvePermissions = false): Promise<PluginInstallRecord> { if (!this.options.installer?.applyUpdate) throw new PluginPlatformError('UNAVAILABLE', 'Plugin update installer is not configured'); const record = await this.options.installer.applyUpdate(pluginId, approvePermissions); this.audit({ type: 'UPDATE_APPLIED', pluginId, contentAddress: `sha256:${record.currentRevision.packageHash}` }); return record; }
  async updateCheck(pluginId: string, current: PluginRevision, policy: PluginUpdatePolicy = this.options.policy ?? { mode: 'NOTIFY_ONLY' }): Promise<PluginUpdateCheckResult> {
    const results = await this.discover({ pluginId, channel: policy.channel, sourceIds: policy.allowedSourceIds, limit: DEFAULT_MAX_RESULTS });
    const candidates: PluginUpdateCandidate[] = [];
    for (const item of results) {
      if (item.version === current.version && item.contentAddress === (`sha256:${current.packageHash}` as PluginContentAddress)) continue;
      const permissionExpansion = item.requestedCapabilities?.filter(request => !this.hasCapability(current, request.capability)).map(request => request.capability) ?? [];
      const currentPackage = this.packages.get(`sha256:${current.packageHash}`);
      const currentPublisher = current.publisherId ?? currentPackage?.manifest.signatureMetadata?.signerIdentity;
      const publisherChanged = Boolean(currentPublisher && (!item.publisher || item.publisher.publisherId !== currentPublisher));
      const dependencyChanged = Boolean(currentPackage && item.dependencies && !sameDependencies(currentPackage.manifest.dependencies, item.dependencies));
      const sameVersionConflict = item.version === current.version && item.contentAddress !== (`sha256:${current.packageHash}` as PluginContentAddress);
      const revoked = item.securityRevoked || this.isRevoked(item.contentAddress, item.publisher?.publisherId);
      const reasons = [ ...(permissionExpansion.length ? ['capability expansion requires owner review'] : []), ...(publisherChanged ? ['publisher identity changed'] : []), ...(dependencyChanged ? ['dependency graph changed'] : []), ...(sameVersionConflict ? ['same version has a different immutable revision hash'] : []), ...(revoked ? ['revision is security revoked'] : []) ];
      const decision = revoked ? 'REJECT' : reasons.length ? 'REVIEW' : 'ALLOW';
      candidates.push({ ...item, current, permissionExpansion, publisherChanged, dependencyChanged, decision, reasons });
    }
    return { pluginId, current: structuredClone(current), candidates, checkedAt: iso(this.now()), stale: false };
  }
  queueUpdate(pluginId: string, reference: PluginPackageReference): void { this.pendingUpdates.set(pluginId, structuredClone(reference)); }
  pendingUpdate(pluginId: string): PluginPackageReference | undefined { const value = this.pendingUpdates.get(pluginId); return value && structuredClone(value); }
  clearPendingUpdate(pluginId: string): void { this.pendingUpdates.delete(pluginId); }
  recoveryPlan(record: PluginInstallRecord, availableSourceIds?: readonly PluginSourceId[]): PluginRecoveryPlan {
    const revision = record.currentRevision; const state = this.isRevoked(revision.packageHash, undefined) ? 'SECURITY_QUARANTINED' : this.packages.has(`sha256:${revision.packageHash}`) ? 'HEALTHY' : 'NEEDS_REPAIR';
    return { pluginId: record.pluginId, revision: structuredClone(revision), state, exactContentAddress: `sha256:${revision.packageHash}`, allowedSourceIds: availableSourceIds ? [...availableSourceIds] : this.sourceRegistry.list({ enabledOnly: true }).map(value => value.descriptor.id!), ownerActionRequired: state !== 'HEALTHY', createdAt: iso(this.now()), ...(state === 'NEEDS_REPAIR' ? { reason: 'Exact immutable revision bytes are unavailable' } : {}) };
  }
  async repair(record: PluginInstallRecord, sourceIds?: readonly PluginSourceId[]): Promise<{ readonly state: 'REPAIRED' | 'REJECTED' | 'UNAVAILABLE'; readonly contentAddress: PluginContentAddress; readonly package?: PluginPackage }> {
    const reference: PluginPackageReference = { pluginId: record.pluginId, version: record.currentRevision.version, contentAddress: `sha256:${record.currentRevision.packageHash}` };
    if (this.isRevoked(record.currentRevision.packageHash, undefined)) return { state: 'REJECTED', contentAddress: reference.contentAddress };
    try { const result = await this.acquire(reference, sourceIds); if (result.state !== 'VERIFIED' && result.state !== 'COMPLETE') return { state: 'UNAVAILABLE', contentAddress: reference.contentAddress }; return { state: 'REPAIRED', contentAddress: reference.contentAddress, package: this.package(reference) }; } catch { return { state: 'UNAVAILABLE', contentAddress: reference.contentAddress }; }
  }
  archive(record: PluginInstallRecord, knownGood = true): void { const list = this.archives.get(record.pluginId) ?? []; const value: PluginRevisionArchive = { pluginId: record.pluginId, revision: structuredClone(record.currentRevision), archivedAt: iso(this.now()), knownGood, securityState: record.revisionSecurity?.[record.currentRevision.packageHash] ?? 'UNKNOWN' }; this.archives.set(record.pluginId, [value, ...list.filter(item => item.revision.packageHash !== value.revision.packageHash)].slice(0, 3)); }
  archivesFor(pluginId: string): readonly PluginRevisionArchive[] { return structuredClone(this.archives.get(pluginId) ?? []); }
  receipt(reference: PluginPackageReference): PluginTransferReceipt | undefined { const record = this.records.get(key(reference)); if (!record) return undefined; const plan = [...this.plans.values()].find(value => value.reference.contentAddress === reference.contentAddress); return { transferId: plan?.id ?? `transfer:${record.reference.contentAddress}`, reference: structuredClone(reference), sourceId: record.sourceIds[0], receivedChunks: [...record.receivedChunks], bytes: record.receivedBytes, ...(record.state === 'VERIFIED' || record.state === 'COMPLETE' ? { completedAt: record.updatedAt } : {}), integrity: record.state === 'VERIFIED' || record.state === 'COMPLETE' ? 'VERIFIED' : record.state === 'FAILED' ? 'FAILED' : 'PENDING' }; }
  private async materialize(reference: PluginPackageReference, value: PluginPackage | PluginPackageTransfer, onChunk?: (bytes: number, chunks: readonly number[]) => void): Promise<PluginPackage> {
    if ('manifest' in value && value.manifest) return structuredClone(value);
    const transfer = value as PluginPackageTransfer;
    if (transfer.package) return structuredClone(transfer.package);
    if (transfer.serializedPackage) {
      if (!this.options.decodePackage) throw new PluginPlatformError('UNSUPPORTED', 'Serialized Plugin package decoding must be supplied by the host boundary');
      const bytes = typeof transfer.serializedPackage === 'string' ? new TextEncoder().encode(transfer.serializedPackage) : transfer.serializedPackage;
      if (bytes.byteLength > this.options.maxPackageBytes) throw new PluginPlatformError('QUOTA', 'Plugin transfer exceeds package limit');
      onChunk?.(bytes.byteLength, []);
      return await this.options.decodePackage(bytes, reference);
    }
    if (!transfer.chunks) throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin source returned no package or chunks');
    const incoming = Array.isArray(transfer.chunks) ? await validateAndDeduplicateChunks(transfer.chunks, reference.contentAddress, this.options.maxChunkBytes, this.options.maxPackageBytes, onChunk) : await collectChunks(transfer.chunks as AsyncIterable<PluginChunk>, reference.contentAddress, this.options.maxConcurrentChunks, this.options.maxChunkBytes, this.options.maxPackageBytes, onChunk);
    const chunks = mergePartialChunks(reference.contentAddress, incoming, this.partialChunks);
    await this.options.chunkStore?.write(reference.contentAddress, chunks);
    const serialized = assembleChunkBytes(chunks, this.options.maxPackageBytes);
    this.partialChunks.delete(reference.contentAddress);
    await this.options.chunkStore?.delete(reference.contentAddress);
    onChunk?.(serialized.byteLength, chunks.map(chunk => chunk.index));
    if (this.options.decodePackage) return await this.options.decodePackage(serialized, reference);
    return deserializePluginPackage(serialized);
  }
  private async verifyExactReference(reference: PluginPackageReference, plugin: PluginPackage): Promise<void> { const manifest = await validatePluginPackage(plugin); if (manifest.id !== reference.pluginId || manifest.version !== reference.version || (`sha256:${manifest.integrity.packageHash}` as PluginContentAddress) !== reference.contentAddress) throw new PluginPlatformError('INTEGRITY', 'Plugin content address mismatch'); }
  private selectSources(ids?: readonly PluginSourceId[]): readonly PluginSourceRegistration[] { const values = ids ? ids.map(id => this.sourceRegistry.get(id)).filter((value): value is PluginSourceRegistration => Boolean(value)) : this.sourceRegistry.list({ enabledOnly: true }); return values.filter(value => value.descriptor.enabled !== false && value.descriptor.health !== 'INVALID' && value.descriptor.health !== 'DISABLED'); }
  private setRecord(reference: PluginPackageReference, value: Pick<PluginDistributionRecord, 'state' | 'receivedBytes' | 'receivedChunks' | 'sourceIds'> & Partial<Pick<PluginDistributionRecord, 'error'>>): void { const previous = this.records.get(key(reference)); const record: PluginDistributionRecord = { reference: structuredClone(reference), ...(previous?.descriptor ? { descriptor: previous.descriptor } : {}), state: value.state, receivedBytes: value.receivedBytes, ...(previous?.totalBytes ? { totalBytes: previous.totalBytes } : {}), receivedChunks: [...value.receivedChunks], sourceIds: [...value.sourceIds], firstReceivedAt: previous?.firstReceivedAt ?? iso(this.now()), updatedAt: iso(this.now()), ...(value.error ? { error: value.error } : {}) }; this.records.set(key(reference), record); void this.options.onRecord?.(structuredClone(record)); void this.options.store?.write(this.snapshot()); }
  private requireRecord(reference: PluginPackageReference): PluginDistributionRecord { const value = this.records.get(key(reference)); if (!value) throw new PluginPlatformError('NOT_FOUND', 'Plugin transfer record not found'); return structuredClone(value); }
  private hasCapability(current: PluginRevision, capability: PluginCapability): boolean { const packageValue = this.packages.get(`sha256:${current.packageHash}`); return Boolean(packageValue?.manifest.requestedCapabilities.some(request => request.capability === capability)); }
  private isRevoked(packageHash: string, publisher?: string): boolean { return this.revocations().some(value => (value.kind === 'REVISION' && (value.subject === packageHash || value.subject === `sha256:${packageHash}`)) || (value.kind === 'PUBLISHER' && publisher && value.subject === publisher)); }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private audit(value: Omit<PluginDistributionAuditEvent, 'id' | 'at'>): void { void this.options.onAudit?.({ ...value, id: `plugin-audit:${++this.sequence}`, at: iso(this.now()) }); }
}

function normalizeSource(input: PluginSourceDescriptor, coreReserved: boolean): PluginSourceDescriptor {
  const candidate = input.id ?? input.reference;
  const id = candidate && /^[a-z0-9][a-z0-9.:-]{0,127}$/.test(candidate) ? candidate : `${input.kind.toLowerCase().replace(/_/g, '.')}:${hashId(JSON.stringify(input))}`;
  if (CORE_SOURCE_IDS.has(id) && !coreReserved) throw new PluginPlatformError('POLICY_DENIED', 'Reserved Core source identity can only be registered by Core');
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(id)) throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin source id is invalid');
  const displayName = input.displayName?.slice(0, 120); return { ...structuredClone(input), id, type: input.type ?? input.kind, ...(displayName ? { displayName } : {}), trust: coreReserved ? 'CORE_RESERVED' : input.trust ?? 'UNKNOWN', enabled: input.enabled !== false, health: input.health ?? 'AVAILABLE' };
}
function descriptorFromPackage(plugin: PluginPackage): PluginPackageDescriptor { return { pluginId: plugin.manifest.id, name: plugin.manifest.name, description: plugin.manifest.description, version: plugin.manifest.version, contentAddress: `sha256:${plugin.manifest.integrity.packageHash}`, packageSize: packageBytes(plugin), ...(plugin.manifest.signatureMetadata ? { publisher: { publisherId: plugin.manifest.signatureMetadata.signerIdentity, keyId: plugin.manifest.signatureMetadata.keyId ?? plugin.manifest.signatureMetadata.signerIdentity, algorithm: 'ED25519' as const, ...(plugin.manifest.signatureMetadata.publicKey ? { publicKey: plugin.manifest.signatureMetadata.publicKey } : {}) } } : {}), requestedCapabilities: plugin.manifest.requestedCapabilities, dependencies: plugin.manifest.dependencies, compatibility: plugin.manifest.platformCompatibility, discoveredAt: new Date().toISOString() };
}
function sanitizeDiscovery(value: PluginDiscoveryResult): PluginPackageDescriptor { return { pluginId: String(value.pluginId).slice(0, 253), ...(value.name ? { name: String(value.name).slice(0, 120) } : {}), ...(value.description ? { description: String(value.description).slice(0, 4000) } : {}), version: String(value.version).slice(0, 80), contentAddress: value.contentAddress, ...(value.packageSize !== undefined && Number.isSafeInteger(value.packageSize) && value.packageSize >= 0 ? { packageSize: value.packageSize } : {}), ...(value.publisher ? { publisher: { ...value.publisher } } : {}), ...(value.sourceId ? { sourceId: String(value.sourceId).slice(0, 128) } : {}), ...(value.requestedCapabilities ? { requestedCapabilities: value.requestedCapabilities.slice(0, 64) } : {}), ...(value.dependencies ? { dependencies: value.dependencies.slice(0, 32) } : {}), ...(value.channel ? { channel: value.channel } : {}), ...(value.securityRevoked ? { securityRevoked: true } : {}), discoveredAt: value.discoveredAt }; }
function packageBytes(plugin: PluginPackage): number { return plugin.executable.byteLength + Object.values(plugin.resources ?? {}).reduce((sum, value) => sum + value.byteLength, 0) + (plugin.uiBundle?.byteLength ?? 0) + Object.values(plugin.schemas ?? {}).reduce((sum, value) => sum + value.byteLength, 0) + Object.values(plugin.migrations ?? {}).reduce((sum, value) => sum + value.byteLength, 0); }
function key(reference: PluginPackageReference): string { return reference.contentAddress; }
function iso(now: number): string { return new Date(now).toISOString(); }
function failure(code: string, message: string): { readonly code: string; readonly message: string; readonly at: string; readonly recoverable: boolean } { return { code, message: message.slice(0, 512), at: new Date().toISOString(), recoverable: code !== 'INTEGRITY' }; }
function hashId(value: string): string { let hash = 2166136261; for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
async function collectChunks(chunks: AsyncIterable<PluginChunk>, _address: PluginContentAddress, maxConcurrent: number, maxChunkBytes: number, maxPackageBytes: number, onChunk?: (bytes: number, chunks: readonly number[]) => void): Promise<PluginChunk[]> { const output: PluginChunk[] = []; let total = 0; const seen = new Map<number, PluginChunk>(); for await (const chunk of chunks) { validateChunk(chunk, maxChunkBytes); await verifyChunkHash(chunk); const added = addUniqueChunk(seen, chunk); if (!added) continue; total += chunk.bytes.byteLength; if (total > maxPackageBytes) throw new PluginPlatformError('QUOTA', 'Plugin transfer exceeds package limit'); if (seen.size > DEFAULT_MAX_CHUNKS) throw new PluginPlatformError('QUOTA', 'Plugin transfer contains too many chunks'); output.push(chunk); onChunk?.(total, output.map(item => item.index)); } void maxConcurrent; return output; }
async function validateAndDeduplicateChunks(chunks: readonly PluginChunk[], _address: PluginContentAddress, maxChunkBytes: number, maxPackageBytes: number, onChunk?: (bytes: number, chunks: readonly number[]) => void): Promise<PluginChunk[]> { const output: PluginChunk[] = []; const seen = new Map<number, PluginChunk>(); let total = 0; for (const chunk of chunks) { validateChunk(chunk, maxChunkBytes); await verifyChunkHash(chunk); const added = addUniqueChunk(seen, chunk); if (!added) continue; total += chunk.bytes.byteLength; if (total > maxPackageBytes) throw new PluginPlatformError('QUOTA', 'Plugin transfer exceeds package limit'); if (seen.size > DEFAULT_MAX_CHUNKS) throw new PluginPlatformError('QUOTA', 'Plugin transfer contains too many chunks'); output.push(chunk); onChunk?.(total, output.map(item => item.index)); } return output; }
function addUniqueChunk(seen: Map<number, PluginChunk>, chunk: PluginChunk): boolean { const previous = seen.get(chunk.index); if (!previous) { seen.set(chunk.index, chunk); return true; } if (previous.hash.toLowerCase() !== chunk.hash.toLowerCase() || previous.bytes.byteLength !== chunk.bytes.byteLength || previous.bytes.some((value, index) => value !== chunk.bytes[index])) throw new PluginPlatformError('INTEGRITY', `Conflicting Plugin transfer chunk ${chunk.index}`); return false; }
function mergePartialChunks(address: PluginContentAddress, incoming: readonly PluginChunk[], partial: Map<string, Map<number, PluginChunk>>): PluginChunk[] { const map = partial.get(address) ?? new Map<number, PluginChunk>(); for (const chunk of incoming) addUniqueChunk(map, chunk); partial.set(address, map); return [...map.values()]; }
function assembleChunkBytes(chunks: readonly PluginChunk[], maxPackageBytes: number): Uint8Array { if (!chunks.length) throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin transfer is empty'); const ordered = [...chunks].sort((a, b) => a.index - b.index); const total = ordered[0]!.total; if (ordered.length < total) throw new PluginPlatformError('INCOMPLETE', 'Plugin transfer is incomplete'); if (total !== ordered.length || ordered.some((chunk, index) => chunk.index !== index || chunk.total !== total)) throw new PluginPlatformError('INTEGRITY', 'Plugin transfer has missing or duplicate chunks'); const bytes = new Uint8Array(ordered.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)); let offset = 0; for (const chunk of ordered) { bytes.set(chunk.bytes, offset); offset += chunk.bytes.byteLength; } if (bytes.byteLength > maxPackageBytes) throw new PluginPlatformError('QUOTA', 'Plugin transfer exceeds package limit'); return bytes; }
function validateChunk(chunk: PluginChunk, maxChunkBytes: number): void { if (!Number.isSafeInteger(chunk.index) || !Number.isSafeInteger(chunk.total) || chunk.index < 0 || chunk.total < 1 || chunk.index >= chunk.total || !(chunk.bytes instanceof Uint8Array) || chunk.bytes.byteLength > maxChunkBytes || typeof chunk.hash !== 'string') throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin transfer chunk is invalid'); }
async function verifyChunkHash(chunk: PluginChunk): Promise<void> { const actual = await sha256Hex(chunk.bytes); if (actual.toLowerCase() !== chunk.hash.toLowerCase()) throw new PluginPlatformError('INTEGRITY', `Plugin transfer chunk ${chunk.index} failed integrity verification`); }
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new PluginPlatformError('TIMEOUT', 'Plugin source operation timed out')), timeoutMs); })]); } finally { if (timer) clearTimeout(timer); } }

export type { PluginSourceTrust };

/** Host-neutral, bounded JSON envelope useful for USB/chunk transports. */
export function serializePluginPackage(plugin: PluginPackage): Uint8Array {
  const value = { manifest: plugin.manifest, executable: bytes(plugin.executable), resources: Object.fromEntries(Object.entries(plugin.resources ?? {}).map(([path, data]) => [path, bytes(data)])), schemas: Object.fromEntries(Object.entries(plugin.schemas ?? {}).map(([path, data]) => [path, bytes(data)])), uiBundle: plugin.uiBundle ? bytes(plugin.uiBundle) : undefined, migrations: Object.fromEntries(Object.entries(plugin.migrations ?? {}).map(([path, data]) => [path, bytes(data)])), source: plugin.source, provenance: plugin.provenance };
  return new TextEncoder().encode(JSON.stringify(value));
}

function deserializePluginPackage(value: Uint8Array): PluginPackage {
  let parsed: any;
  try { parsed = JSON.parse(new TextDecoder().decode(value)); } catch { throw new PluginPlatformError('INVALID_ARGUMENT', 'Serialized Plugin package is not JSON'); }
  if (!parsed || typeof parsed !== 'object' || !parsed.manifest || typeof parsed.source !== 'object') throw new PluginPlatformError('INVALID_ARGUMENT', 'Serialized Plugin package envelope is invalid');
  const executable = fromHex(parsed.executable); const resources = fromHexRecord(parsed.resources); const schemas = fromHexRecord(parsed.schemas); const migrations = fromHexRecord(parsed.migrations); const uiBundle = parsed.uiBundle === undefined ? undefined : fromHex(parsed.uiBundle);
  return { manifest: parsed.manifest, executable, resources, ...(Object.keys(schemas).length ? { schemas } : {}), ...(uiBundle ? { uiBundle } : {}), ...(Object.keys(migrations).length ? { migrations } : {}), source: parsed.source, ...(parsed.provenance ? { provenance: parsed.provenance } : {}) };
}
function bytes(value: Uint8Array): string { let output = ''; for (const byte of value) output += byte.toString(16).padStart(2, '0'); return output; }
function fromHex(value: unknown): Uint8Array { if (typeof value !== 'string' || value.length % 2 !== 0 || !/^[a-f0-9]*$/i.test(value)) throw new PluginPlatformError('INVALID_ARGUMENT', 'Serialized Plugin bytes are invalid'); const output = new Uint8Array(value.length / 2); for (let index = 0; index < output.length; index++) output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16); return output; }
function fromHexRecord(value: unknown): Record<string, Uint8Array> { if (value === undefined) return {}; if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PluginPlatformError('INVALID_ARGUMENT', 'Serialized Plugin resource record is invalid'); const output: Record<string, Uint8Array> = {}; for (const [path, item] of Object.entries(value)) output[path] = fromHex(item); return output; }
function sameDependencies(a: readonly PluginDependency[], b: readonly PluginDependency[]): boolean { return JSON.stringify(a.map(value => ({ id: value.id, version: value.version, integrity: value.integrity ?? '' })).sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify(b.map(value => ({ id: value.id, version: value.version, integrity: value.integrity ?? '' })).sort((x, y) => x.id.localeCompare(y.id))); }
