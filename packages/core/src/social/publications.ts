import { canonicalJson, type CryptoProvider, signCanonical, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from '../connectivity.js';
import {
  ContentCache,
  contentManifestSchema,
  createContentManifest,
  type ContentCachePolicy,
  type ContentId,
  type ContentManifest,
  sha256,
} from './content.js';
import { DistributedContentService, type DistributedContentRequest, type DistributedContentSource } from './distributed-content.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry, type ProtectedSurfaceId } from '../security/safety-surfaces.js';

/**
 * Keystone Personal Web is a signed object layer, not a web server.  A
 * publication is immutable at a revision address; only the authenticated
 * latest pointer is mutable.  Bytes remain in the R0P74 content layer.
 */
export const PUBLICATION_PROTOCOL = 'keystone-publication-v1';
export const PUBLICATION_VERSION = 1 as const;
export const PUBLICATION_MAX_TITLE = 300;
export const PUBLICATION_MAX_SUMMARY = 4_000;
export const PUBLICATION_MAX_SLUG = 160;
export const PUBLICATION_MAX_BLOCKS = 4_096;
export const PUBLICATION_MAX_REFERENCES = 256;
export const PUBLICATION_MAX_ATTACHMENTS = 128;
export const PUBLICATION_MAX_METADATA_BYTES = 512 * 1024;
export const PUBLICATION_MAX_REVISIONS = 10_000;
/** Keep chunk responses below the bounded transport frame budget after
 * envelope/base64 overhead. Hosts may re-publish a different rendition via
 * the existing content layer, but publication revisions use this safe
 * baseline so large pages remain fetchable over production Fabric. */
export const PUBLICATION_CONTENT_CHUNK_SIZE = 16 * 1024;

export const PUBLICATION_VISIBILITIES = [
  'PUBLIC', 'UNLISTED', 'CONTACTS', 'FOLLOWERS', 'SELECTED_IDENTITIES', 'SPACE',
] as const;
export type PublicationVisibility = typeof PUBLICATION_VISIBILITIES[number];
export type PublicationStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED';
export const PUBLICATION_KINDS = [
  'PAGE', 'POST', 'ARTICLE', 'NOTE', 'DOCUMENT', 'IMAGE_GALLERY', 'AUDIO', 'VIDEO', 'COLLECTION', 'PROFILE',
] as const;
export type PublicationKind = typeof PUBLICATION_KINDS[number];

export type PublicationBlock =
  | { readonly type: 'heading'; readonly level?: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly ordered?: boolean; readonly items: readonly string[] }
  | { readonly type: 'code'; readonly language?: string; readonly text: string }
  | { readonly type: 'image' | 'media'; readonly contentUri: string; readonly alt?: string; readonly caption?: string }
  | { readonly type: 'link'; readonly label: string; readonly url: string }
  | { readonly type: 'object'; readonly objectId: string; readonly objectType?: string; readonly label?: string };
export type PublicationContent = string | readonly PublicationBlock[];

export interface PublicationSourceReference {
  readonly objectId: string;
  readonly objectType?: string;
  readonly visibility?: 'private' | 'contacts' | 'community' | 'public';
}

export interface PublicationAttachmentReference {
  readonly contentUri: string;
  readonly contentId: ContentId;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  /** The manifest is retained as metadata only; bytes are served by R0P74. */
  readonly manifest?: ContentManifest;
  /** Explicit owner disclosure for a reference whose source policy is not
   * available in this process. This does not bypass content verification. */
  readonly explicitlyPublic?: true;
}

export interface PublicationDraft {
  readonly version: typeof PUBLICATION_VERSION;
  readonly protocol: typeof PUBLICATION_PROTOCOL;
  readonly draftId: string;
  readonly publicationId?: string;
  readonly publisherIdentity: string;
  readonly kind: PublicationKind;
  readonly title: string;
  readonly summary?: string;
  readonly slug?: string;
  readonly content: PublicationContent;
  readonly attachments: readonly PublicationAttachmentReference[];
  readonly references: readonly string[];
  readonly source?: PublicationSourceReference;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublicationRevision {
  readonly version: typeof PUBLICATION_VERSION;
  readonly protocol: typeof PUBLICATION_PROTOCOL;
  readonly publicationId: string;
  /** Hash of the immutable revision payload (before revisionAddress and signature). */
  readonly revisionAddress: ContentId;
  readonly revisionNumber: number;
  readonly publisherIdentity: string;
  readonly kind: PublicationKind;
  readonly title: string;
  readonly summary?: string;
  readonly slug?: string;
  readonly visibility: PublicationVisibility;
  readonly content: PublicationContent;
  readonly contentManifest: ContentManifest;
  readonly attachments: readonly PublicationAttachmentReference[];
  readonly references: readonly string[];
  readonly source?: PublicationSourceReference;
  readonly createdAt: string;
  readonly publishedAt: string;
  readonly signature: string;
}

export interface PublicationPointer {
  readonly version: typeof PUBLICATION_VERSION;
  readonly protocol: typeof PUBLICATION_PROTOCOL;
  readonly publicationId: string;
  readonly publisherIdentity: string;
  readonly pointerRevision: number;
  readonly revisionNumber: number;
  readonly revisionAddress?: ContentId;
  readonly status: Exclude<PublicationStatus, 'DRAFT'>;
  readonly visibility: PublicationVisibility;
  readonly updatedAt: string;
  readonly signature: string;
}

export interface PublicationRecord {
  readonly publicationId: string;
  readonly publisherIdentity: string;
  readonly kind: PublicationKind;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: PublicationStatus;
  readonly visibility: PublicationVisibility;
  readonly slug?: string;
  readonly revisionAddresses: readonly ContentId[];
  readonly latestPointer?: PublicationPointer;
}

export interface PublicationState {
  readonly version: typeof PUBLICATION_VERSION;
  readonly drafts: Record<string, PublicationDraft>;
  readonly revisions: Record<string, PublicationRevision>;
  readonly pointers: Record<string, PublicationPointer>;
  readonly records: Record<string, PublicationRecord>;
}

export interface PublicationStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryPublicationStateStore implements PublicationStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export class PublicationError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'INVALID_SIGNATURE' | 'REPLAY' | 'POLICY_DENIED' | 'INTEGRITY' | 'UNAVAILABLE' | 'INVALID_STATE' | 'UNSUPPORTED_VERSION', message: string) {
    super(message);
    this.name = 'PublicationError';
  }
}

export interface PublicationPreview {
  readonly draftId: string;
  readonly title: string;
  readonly kind: PublicationKind;
  readonly visibility: PublicationVisibility;
  readonly publisherIdentity: string;
  readonly attachments: readonly Pick<PublicationAttachmentReference, 'contentUri' | 'name' | 'mimeType' | 'size'>[];
  readonly externalLinks: readonly { readonly url: string; readonly safe: boolean; readonly warning?: string }[];
  readonly render: SafePublicationRender;
}

export interface SafePublicationRender {
  readonly title: string;
  readonly summary?: string;
  readonly blocks: readonly SafePublicationBlock[];
  readonly unresolvedReferences: readonly string[];
}

export type SafePublicationBlock =
  | { readonly type: 'heading' | 'paragraph' | 'code'; readonly text: string; readonly level?: number; readonly language?: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'media'; readonly contentUri: string; readonly alt?: string; readonly caption?: string }
  | { readonly type: 'link'; readonly label: string; readonly url: string; readonly external: boolean; readonly warning?: string }
  | { readonly type: 'object'; readonly objectId: string; readonly objectType?: string; readonly label?: string; readonly available: boolean };

export interface PublicationServiceOptions {
  readonly stateStore?: PublicationStateStore;
  readonly contentCache?: ContentCache;
  readonly protectedSurfaces?: MandatorySafetySurfaceRegistry;
  readonly now?: () => number;
  readonly maxPublications?: number;
  readonly maxRevisions?: number;
}

/** A bounded local-first publication database. Hosts supply encrypted storage. */
export class PublicationService {
  readonly contentCache: ContentCache;
  readonly protectedSurfaces: MandatorySafetySurfaceRegistry;
  private readonly stateStore?: PublicationStateStore;
  private readonly crypto: CryptoProvider;
  private readonly local: DeviceSessionKeys;
  private readonly now: () => number;
  private readonly maxPublications: number;
  private readonly maxRevisions: number;
  private state: PublicationState = emptyState();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;

  constructor(crypto: CryptoProvider, local: DeviceSessionKeys, options: PublicationServiceOptions = {}) {
    this.crypto = crypto;
    this.local = local;
    this.stateStore = options.stateStore;
    this.contentCache = options.contentCache ?? new ContentCache(64 * 1024 * 1024);
    this.protectedSurfaces = options.protectedSurfaces ?? new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()));
    this.now = options.now ?? Date.now;
    this.maxPublications = boundedInt(options.maxPublications ?? 4_096, 1, 100_000);
    this.maxRevisions = boundedInt(options.maxRevisions ?? PUBLICATION_MAX_REVISIONS, 1, PUBLICATION_MAX_REVISIONS);
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  async flush(): Promise<void> { await this.writes; }
  snapshot(): PublicationState { return structuredClone(this.state); }

  async createDraft(input: {
    draftId?: string;
    publicationId?: string;
    kind?: PublicationKind;
    title: string;
    summary?: string;
    slug?: string;
    content?: PublicationContent;
    attachments?: readonly PublicationAttachmentReference[];
    references?: readonly string[];
    source?: PublicationSourceReference;
  }): Promise<PublicationDraft> {
    await this.ready();
    const draft: PublicationDraft = {
      version: PUBLICATION_VERSION,
      protocol: PUBLICATION_PROTOCOL,
      draftId: safeId(input.draftId ?? crypto.randomUUID()),
      ...(input.publicationId ? { publicationId: safeId(input.publicationId) } : {}),
      publisherIdentity: this.local.nodeId,
      kind: parseKind(input.kind ?? 'PAGE'),
      title: boundedText(input.title, PUBLICATION_MAX_TITLE, true),
      ...(input.summary ? { summary: boundedText(input.summary, PUBLICATION_MAX_SUMMARY) } : {}),
      ...(input.slug ? { slug: safeSlug(input.slug) } : {}),
      content: normalizeContent(input.content ?? ''),
      attachments: normalizeAttachments(input.attachments ?? []),
      references: normalizeReferences(input.references ?? []),
      ...(input.source ? { source: normalizeSource(input.source) } : {}),
      createdAt: iso(this.now()),
      updatedAt: iso(this.now()),
    };
    if (this.state.drafts[draft.draftId]) throw new PublicationError('INVALID_ARGUMENT', 'Draft already exists');
    this.state = { ...this.state, drafts: { ...this.state.drafts, [draft.draftId]: draft } };
    await this.persist();
    return structuredClone(draft);
  }

  async updateDraft(draftId: string, patch: Partial<Pick<PublicationDraft, 'title' | 'summary' | 'slug' | 'content' | 'attachments' | 'references' | 'source'>>): Promise<PublicationDraft> {
    await this.ready();
    const current = this.state.drafts[draftId];
    if (!current) throw new PublicationError('NOT_FOUND', 'Draft not found');
    if (current.publisherIdentity !== this.local.nodeId) throw new PublicationError('UNAUTHORIZED', 'Only the publisher may edit a draft');
    const next: PublicationDraft = {
      ...current,
      ...(patch.title !== undefined ? { title: boundedText(patch.title, PUBLICATION_MAX_TITLE, true) } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary ? boundedText(patch.summary, PUBLICATION_MAX_SUMMARY) : undefined } : {}),
      ...(patch.slug !== undefined ? { slug: patch.slug ? safeSlug(patch.slug) : undefined } : {}),
      ...(patch.content !== undefined ? { content: normalizeContent(patch.content) } : {}),
      ...(patch.attachments !== undefined ? { attachments: normalizeAttachments(patch.attachments) } : {}),
      ...(patch.references !== undefined ? { references: normalizeReferences(patch.references) } : {}),
      ...(patch.source !== undefined ? { source: patch.source ? normalizeSource(patch.source) : undefined } : {}),
      updatedAt: iso(this.now()),
    };
    const drafts = { ...this.state.drafts, [draftId]: next };
    this.state = { ...this.state, drafts };
    await this.persist();
    return structuredClone(next);
  }

  async draft(draftId: string): Promise<PublicationDraft | undefined> { await this.ready(); return clone(this.state.drafts[draftId]); }
  async drafts(): Promise<readonly PublicationDraft[]> { await this.ready(); return Object.values(this.state.drafts).map(value => structuredClone(value)).sort(compareCreated); }

  /** Preview is owner-local and does not announce, index or cache the draft. */
  async previewDraft(draftId: string, visibility: PublicationVisibility = 'PUBLIC'): Promise<PublicationPreview> {
    const draft = await this.draft(draftId);
    if (!draft) throw new PublicationError('NOT_FOUND', 'Draft not found');
    const render = renderContent(draft.title, draft.summary, draft.content, this.localObjectResolver());
    return {
      draftId: draft.draftId,
      title: draft.title,
      kind: draft.kind,
      visibility: parseVisibility(visibility),
      publisherIdentity: draft.publisherIdentity,
      attachments: draft.attachments.map(({ contentUri, name, mimeType, size }) => ({ contentUri, name, mimeType, size })),
      externalLinks: collectLinks(draft.content),
      render,
    };
  }

  /**
   * Explicit owner action. Network reachability is never consulted here and
   * publication is persisted before any optional replication announcement.
   */
  async publishDraft(draftId: string, options: { visibility?: PublicationVisibility; ownerConfirmed?: boolean } = {}): Promise<{ revision: PublicationRevision; pointer: PublicationPointer }> {
    await this.ready();
    const draft = this.state.drafts[draftId];
    if (!draft) throw new PublicationError('NOT_FOUND', 'Draft not found');
    if (draft.publisherIdentity !== this.local.nodeId) throw new PublicationError('UNAUTHORIZED', 'Only the owner can publish this draft');
    if (options.ownerConfirmed !== true) throw new PublicationError('UNAUTHORIZED', 'Explicit owner confirmation is required to publish');
    const visibility = parseVisibility(options.visibility ?? 'PUBLIC');
    const sourceDisclosureConfirmed = draft.source?.visibility && draft.source.visibility !== 'public' ? options.ownerConfirmed === true : true;
    if (!sourceDisclosureConfirmed) throw new PublicationError('POLICY_DENIED', 'A private source requires an explicit public disclosure snapshot');
    return this.createRevisionFromDraft(draft, visibility, sourceDisclosureConfirmed);
  }

  /** Creates an immutable new revision from an already-published object. */
  async updatePublication(publicationId: string, patch: Omit<Parameters<PublicationService['createDraft']>[0], 'draftId' | 'publicationId' | 'kind' | 'title'> & { title?: string; kind?: PublicationKind; visibility?: PublicationVisibility }): Promise<{ revision: PublicationRevision; pointer: PublicationPointer }> {
    await this.ready();
    const latest = this.resolveLatestLocal(publicationId);
    if (!latest || latest.publisherIdentity !== this.local.nodeId) throw new PublicationError('UNAUTHORIZED', 'Only the publisher can update this publication');
    const draft = await this.createDraft({
      publicationId,
      kind: patch.kind ?? latest.kind,
      title: patch.title ?? latest.title,
      summary: patch.summary ?? latest.summary,
      slug: patch.slug ?? latest.slug,
      content: patch.content ?? latest.content,
      attachments: patch.attachments ?? latest.attachments,
      references: patch.references ?? latest.references,
      source: patch.source ?? latest.source,
    });
    return this.publishDraft(draft.draftId, { visibility: patch.visibility ?? latest.visibility, ownerConfirmed: true });
  }

  async unpublish(publicationId: string): Promise<PublicationPointer> {
    await this.ready();
    const record = this.state.records[publicationId];
    const current = this.state.pointers[publicationId];
    if (!record || !current) throw new PublicationError('NOT_FOUND', 'Publication not found');
    if (record.publisherIdentity !== this.local.nodeId) throw new PublicationError('UNAUTHORIZED', 'Only the publisher can unpublish');
    const unsigned = {
      version: PUBLICATION_VERSION,
      protocol: PUBLICATION_PROTOCOL as typeof PUBLICATION_PROTOCOL,
      publicationId,
      publisherIdentity: this.local.nodeId,
      pointerRevision: current.pointerRevision + 1,
      revisionNumber: current.revisionNumber,
      status: 'UNPUBLISHED' as const,
      visibility: current.visibility,
      updatedAt: iso(this.now()),
    };
    const pointer = { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) };
    const nextRecord: PublicationRecord = { ...record, status: 'UNPUBLISHED', updatedAt: unsigned.updatedAt, latestPointer: pointer };
    this.state = { ...this.state, pointers: { ...this.state.pointers, [publicationId]: pointer }, records: { ...this.state.records, [publicationId]: nextRecord } };
    await this.persist();
    return structuredClone(pointer);
  }

  async getPublication(publicationId: string): Promise<PublicationRecord | undefined> { await this.ready(); return clone(this.state.records[publicationId]); }
  async listPublications(options: { publisherIdentity?: string; includeUnlisted?: boolean } = {}): Promise<readonly PublicationRecord[]> {
    await this.ready();
    return Object.values(this.state.records).filter(record => record.status === 'PUBLISHED' && isSharedVisibility(record.visibility) && (!options.publisherIdentity || record.publisherIdentity === options.publisherIdentity) && (options.includeUnlisted !== false || record.visibility !== 'UNLISTED')).map(value => structuredClone(value)).sort(compareCreated);
  }
  async latestPointer(publicationId: string): Promise<PublicationPointer | undefined> { await this.ready(); return clone(this.state.pointers[publicationId]); }
  async revision(revisionAddress: ContentId): Promise<PublicationRevision | undefined> { await this.ready(); return clone(this.state.revisions[revisionAddress]); }

  async resolveLatest(publicationId: string, options: { allowUnlisted?: boolean; canView?: (revision: PublicationRevision) => boolean | Promise<boolean> } = {}): Promise<PublicationRevision | undefined> {
    await this.ready();
    const pointer = this.state.pointers[publicationId];
    if (!pointer || pointer.status !== 'PUBLISHED' || (!options.allowUnlisted && pointer.visibility === 'UNLISTED')) return undefined;
    if (!(await this.verifyPointer(pointer))) return undefined;
    const revision = pointer.revisionAddress ? this.state.revisions[pointer.revisionAddress] : undefined;
    if (!revision || revision.revisionNumber !== pointer.revisionNumber || !(await this.verifyRevision(revision))) return undefined;
    if (revision.visibility !== pointer.visibility) return undefined;
    // A latest pointer is only a publisher-authenticated routing hint.  It is
    // not an authorization grant for scoped publications.  PUBLIC/UNLISTED
    // follow their explicit visibility semantics; all other scopes must pass
    // the caller's existing policy boundary before any revision is returned.
    if (revision.visibility !== 'PUBLIC' && revision.visibility !== 'UNLISTED') {
      if (!options.canView || !(await options.canView(revision))) return undefined;
    } else if (options.canView && !(await options.canView(revision))) return undefined;
    return structuredClone(revision);
  }

  async resolveExact(publicationId: string, revisionAddress: ContentId, options: { canView?: (revision: PublicationRevision) => boolean | Promise<boolean> } = {}): Promise<PublicationRevision | undefined> {
    await this.ready();
    const revision = this.state.revisions[revisionAddress];
    if (!revision || revision.publicationId !== publicationId || !(await this.verifyRevision(revision))) return undefined;
    if (revision.visibility !== 'PUBLIC' && revision.visibility !== 'UNLISTED' && !(options.canView && await options.canView(revision))) return undefined;
    return structuredClone(revision);
  }

  /** Recipient-local signed revision ingestion. Stale pointers can never roll back a known pointer. */
  async ingestRevision(value: unknown, pointer?: unknown): Promise<PublicationRevision | undefined> {
    await this.ready();
    const revision = parsePublicationRevision(value);
    if (!revision || !(await this.verifyRevision(revision))) return undefined;
    if (revision.visibility === 'PUBLIC' || revision.visibility === 'UNLISTED' || isSharedVisibility(revision.visibility)) {
      const eligible = await this.surfaceEligible(revision);
      if (!eligible) return undefined;
    }
    const existing = this.state.revisions[revision.revisionAddress];
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(revision)) throw new PublicationError('INTEGRITY', 'Revision address collision');
    } else if (Object.keys(this.state.revisions).length >= this.maxRevisions) throw new PublicationError('INVALID_STATE', 'Publication revision limit reached');
    const currentRecord = this.state.records[revision.publicationId];
    if (currentRecord && currentRecord.publisherIdentity !== revision.publisherIdentity) throw new PublicationError('UNAUTHORIZED', 'Publication publisher changed');
    const record: PublicationRecord = currentRecord ?? {
      publicationId: revision.publicationId,
      publisherIdentity: revision.publisherIdentity,
      kind: revision.kind,
      createdAt: revision.createdAt,
      updatedAt: revision.publishedAt,
      status: 'PUBLISHED',
      visibility: revision.visibility,
      ...(revision.slug ? { slug: revision.slug } : {}),
      revisionAddresses: [],
    };
    const revisions = existing ? this.state.revisions : { ...this.state.revisions, [revision.revisionAddress]: revision };
    const nextRecord: PublicationRecord = { ...record, updatedAt: revision.publishedAt, status: 'PUBLISHED', visibility: revision.visibility, revisionAddresses: existing ? record.revisionAddresses : [...record.revisionAddresses, revision.revisionAddress] };
    let pointers = this.state.pointers;
    let records = { ...this.state.records, [revision.publicationId]: nextRecord };
    if (pointer !== undefined) {
      const parsedPointer = parsePublicationPointer(pointer);
      if (!parsedPointer || parsedPointer.publicationId !== revision.publicationId || !(await this.verifyPointer(parsedPointer))) throw new PublicationError('INVALID_SIGNATURE', 'Invalid publication pointer');
      const current = pointers[parsedPointer.publicationId];
      if (current && (parsedPointer.pointerRevision < current.pointerRevision || parsedPointer.pointerRevision === current.pointerRevision && parsedPointer.revisionAddress !== current.revisionAddress || parsedPointer.revisionNumber < current.revisionNumber)) throw new PublicationError('REPLAY', 'Stale publication pointer');
      if (parsedPointer.status === 'PUBLISHED' && (parsedPointer.revisionAddress !== revision.revisionAddress || parsedPointer.revisionNumber !== revision.revisionNumber)) throw new PublicationError('INTEGRITY', 'Pointer does not reference revision');
      pointers = { ...pointers, [parsedPointer.publicationId]: parsedPointer };
      records = { ...records, [revision.publicationId]: { ...nextRecord, status: parsedPointer.status, visibility: parsedPointer.visibility, latestPointer: parsedPointer, updatedAt: parsedPointer.updatedAt } };
    }
    this.state = { ...this.state, revisions, pointers, records };
    await this.persist();
    return structuredClone(revision);
  }

  async ingestPointer(value: unknown): Promise<PublicationPointer | undefined> {
    await this.ready();
    const pointer = parsePublicationPointer(value);
    if (!pointer || !(await this.verifyPointer(pointer))) return undefined;
    const current = this.state.pointers[pointer.publicationId];
    if (current && (pointer.pointerRevision < current.pointerRevision || pointer.pointerRevision === current.pointerRevision && pointer.revisionAddress !== current.revisionAddress || pointer.revisionNumber < current.revisionNumber)) throw new PublicationError('REPLAY', 'Stale publication pointer');
    if (pointer.status === 'PUBLISHED') {
      const revision = pointer.revisionAddress ? this.state.revisions[pointer.revisionAddress] : undefined;
      if (!revision || revision.revisionNumber !== pointer.revisionNumber || revision.publisherIdentity !== pointer.publisherIdentity) throw new PublicationError('INTEGRITY', 'Pointer references unavailable revision');
    }
    const record = this.state.records[pointer.publicationId];
    if (!record || record.publisherIdentity !== pointer.publisherIdentity) throw new PublicationError('UNAUTHORIZED', 'Unknown publication authority');
    this.state = { ...this.state, pointers: { ...this.state.pointers, [pointer.publicationId]: pointer }, records: { ...this.state.records, [pointer.publicationId]: { ...record, status: pointer.status, visibility: pointer.visibility, updatedAt: pointer.updatedAt, latestPointer: pointer } } };
    await this.persist();
    return structuredClone(pointer);
  }

  /** Safe, bounded local render of an already safety-eligible revision. */
  async renderRevision(value: unknown): Promise<SafePublicationRender | undefined> {
    await this.ready();
    const revision = parsePublicationRevision(value);
    if (!revision || !(await this.verifyRevision(revision))) return undefined;
    const eligible = await this.surfaceEligible(revision);
    if (!eligible) return undefined;
    return renderContent(revision.title, revision.summary, revision.content, this.localObjectResolver());
  }

  /** Private drafts use the same renderer but never enter a shared surface. */
  renderPreview(draft: PublicationDraft): SafePublicationRender { return renderContent(draft.title, draft.summary, draft.content, this.localObjectResolver()); }

  /** Local verified source for R0P74. It never grants publication authorship. */
  contentSource(contentId: ContentId, scope: 'LOCAL' | 'PUBLIC_CACHE' = 'LOCAL'): DistributedContentSource {
    return {
      id: `publication-cache:${contentId}`,
      scope: scope === 'PUBLIC_CACHE' ? 'PUBLIC_CACHE' : 'LOCAL',
      canServe: manifest => manifest.contentId === contentId,
      getChunk: async (id, index) => {
        if (id !== contentId) throw new Error('Unknown publication content');
        const chunk = this.contentCache.chunk(id, index);
        if (!chunk) throw new PublicationError('UNAVAILABLE', 'Publication content is not available locally');
        return chunk;
      },
    };
  }

  async fetchContent(revision: PublicationRevision, distributed: DistributedContentService, request: Omit<DistributedContentRequest, 'manifest' | 'sources' | 'authorization'> & { sources?: readonly DistributedContentSource[] } = {}): Promise<Uint8Array> {
    if (!(await this.verifyRevision(revision))) throw new PublicationError('INVALID_SIGNATURE', 'Publication revision is invalid');
    if (revision.visibility === 'PUBLIC' || revision.visibility === 'UNLISTED') return distributed.download({ ...request, manifest: revision.contentManifest, sources: request.sources ?? [this.contentSource(revision.contentManifest.contentId, 'PUBLIC_CACHE')], authorization: { scope: 'PUBLIC' } });
    throw new PublicationError('POLICY_DENIED', 'Scoped publication requires an explicit authorization adapter');
  }

  /** Metadata-only announcement; full content is always fetched through R0P74. */
  announcement(publicationId: string): { readonly publicationId: string; readonly pointer: PublicationPointer; readonly revision: PublicationRevision } | undefined {
    const pointer = this.state.pointers[publicationId];
    if (!pointer || pointer.status !== 'PUBLISHED' || !pointer.revisionAddress) return undefined;
    const revision = this.state.revisions[pointer.revisionAddress];
    if (!revision) return undefined;
    return { publicationId, pointer: structuredClone(pointer), revision: structuredClone(revision) };
  }

  publicationLink(publicationId: string): string { return `keystone://publication/${encodeURIComponent(safeId(publicationId))}`; }
  revisionLink(publicationId: string, revisionAddress: ContentId): string { if (!isContentId(revisionAddress)) throw new PublicationError('INVALID_ARGUMENT', 'Invalid revision address'); return `${this.publicationLink(publicationId)}/revision/${revisionAddress}`; }
  static parseLink(value: string): { readonly publicationId: string; readonly revisionAddress?: ContentId } {
    try {
      const url = new URL(value);
      if (url.protocol !== 'keystone:' || url.hostname !== 'publication') throw new Error('Invalid Keystone publication link');
      const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (!path[0] || path.length > 3) throw new Error('Invalid Keystone publication link');
      if (path.length === 1) return { publicationId: safeId(path[0]!) };
      if (path.length !== 3 || path[1] !== 'revision' || !isContentId(path[2]!)) throw new Error('Invalid Keystone publication link');
      return { publicationId: safeId(path[0]!), revisionAddress: path[2] as ContentId };
    } catch { throw new PublicationError('INVALID_ARGUMENT', 'Invalid Keystone publication link'); }
  }

  /** A bounded, non-authoritative local discovery projection. */
  discoveryMetadata(publicationId: string): PublicationDiscoveryMetadata | undefined {
    const pointer = this.state.pointers[publicationId];
    const record = this.state.records[publicationId];
    if (!pointer || !record || pointer.status !== 'PUBLISHED' || (pointer.visibility !== 'PUBLIC' && pointer.visibility !== 'UNLISTED')) return undefined;
    const revision = pointer.revisionAddress ? this.state.revisions[pointer.revisionAddress] : undefined;
    if (!revision) return undefined;
    if (revision.visibility !== 'PUBLIC' && revision.visibility !== 'UNLISTED') return undefined;
    return { id: publicationId, publicationId, type: 'publication', publisherIdentity: record.publisherIdentity, title: revision.title, kind: revision.kind, visibility: revision.visibility, revisionAddress: revision.revisionAddress, updatedAt: revision.publishedAt, slug: revision.slug };
  }

  private async createRevisionFromDraft(draft: PublicationDraft, visibility: PublicationVisibility, sourceDisclosureConfirmed = false): Promise<{ revision: PublicationRevision; pointer: PublicationPointer }> {
    const publicationId = draft.publicationId ?? safeId(crypto.randomUUID());
    const record = this.state.records[publicationId];
    if (!record && Object.keys(this.state.records).length >= this.maxPublications) throw new PublicationError('INVALID_STATE', 'Publication limit reached');
    if (record && record.publisherIdentity !== this.local.nodeId) throw new PublicationError('UNAUTHORIZED', 'Publication authority mismatch');
    const revisionNumber = (record?.revisionAddresses.length ?? 0) + 1;
    if (revisionNumber > this.maxRevisions) throw new PublicationError('INVALID_STATE', 'Revision limit reached');
    this.validateDisclosure(draft, visibility, sourceDisclosureConfirmed);
    const bodyBytes = new TextEncoder().encode(canonicalJson(normalizeContent(draft.content)));
    const contentManifest = await createContentManifest(bodyBytes, { mimeType: 'application/json', name: `publication-${publicationId}.json`, chunkSize: PUBLICATION_CONTENT_CHUNK_SIZE, contentPolicy: contentPolicyFor(visibility) });
    await this.contentCache.putManifest(contentManifest);
    for (let index = 0; index < contentManifest.chunks.length; index++) {
      const start = index * contentManifest.chunkSize;
      await this.contentCache.putVerifiedChunk(contentManifest, index, bodyBytes.subarray(start, Math.min(bodyBytes.length, start + contentManifest.chunkSize)));
    }
    const unsignedBase = {
      version: PUBLICATION_VERSION,
      protocol: PUBLICATION_PROTOCOL as typeof PUBLICATION_PROTOCOL,
      publicationId,
      revisionNumber,
      publisherIdentity: this.local.nodeId,
      kind: draft.kind,
      title: draft.title,
      ...(draft.summary ? { summary: draft.summary } : {}),
      ...(draft.slug ? { slug: draft.slug } : {}),
      visibility,
      content: normalizeContent(draft.content),
      contentManifest,
      attachments: draft.attachments,
      references: draft.references,
      // A publication may be explicitly disclosed from a private source, but
      // the source's private object id is never copied into the shared
      // revision.  Public source references are already safe to disclose.
      ...(draft.source?.visibility === 'public' ? { source: draft.source } : {}),
      createdAt: draft.createdAt,
      publishedAt: iso(this.now()),
    };
    const revisionAddress = await revisionContentAddress(unsignedBase);
    const unsigned = { ...unsignedBase, revisionAddress };
    const revision: PublicationRevision = { ...unsigned, signature: await signCanonical(unsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) };
    const pointerUnsigned = {
      version: PUBLICATION_VERSION,
      protocol: PUBLICATION_PROTOCOL as typeof PUBLICATION_PROTOCOL,
      publicationId,
      publisherIdentity: this.local.nodeId,
      pointerRevision: (record?.latestPointer?.pointerRevision ?? 0) + 1,
      revisionNumber,
      revisionAddress,
      status: 'PUBLISHED' as const,
      visibility,
      updatedAt: revision.publishedAt,
    };
    const pointer: PublicationPointer = { ...pointerUnsigned, signature: await signCanonical(pointerUnsigned, canonicalBytes => this.crypto.sign(canonicalBytes, this.local.privateKey)) };
    if (!(await this.surfaceEligible(revision))) throw new PublicationError('POLICY_DENIED', 'Publication failed mandatory SafetySurfaceGate');
    const nextRecord: PublicationRecord = {
      publicationId,
      publisherIdentity: this.local.nodeId,
      kind: draft.kind,
      createdAt: record?.createdAt ?? draft.createdAt,
      updatedAt: revision.publishedAt,
      status: 'PUBLISHED',
      visibility,
      ...(draft.slug ? { slug: draft.slug } : {}),
      revisionAddresses: [...(record?.revisionAddresses ?? []), revisionAddress],
      latestPointer: pointer,
    };
    this.state = { ...this.state, revisions: { ...this.state.revisions, [revisionAddress]: revision }, pointers: { ...this.state.pointers, [publicationId]: pointer }, records: { ...this.state.records, [publicationId]: nextRecord }, drafts: omit(this.state.drafts, draft.draftId) };
    await this.persist();
    return { revision: structuredClone(revision), pointer: structuredClone(pointer) };
  }

  private validateDisclosure(draft: PublicationDraft, visibility: PublicationVisibility, sourceDisclosureConfirmed = false): void {
    if (isSharedVisibility(visibility)) {
      if (draft.attachments.length > PUBLICATION_MAX_ATTACHMENTS) throw new PublicationError('INVALID_ARGUMENT', 'Too many publication attachments');
      for (const attachment of draft.attachments) {
        // Explicit owner disclosure does not turn a private manifest into a
        // public one.  The bytes must be marked PUBLIC_CACHEABLE in the
        // existing content layer before a shared publication can reference
        // them.  A manifest-less reference is accepted only when the owner
        // explicitly attests that its provider is public.
        if (attachment.manifest && attachment.manifest.contentPolicy !== 'PUBLIC_CACHEABLE') throw new PublicationError('POLICY_DENIED', 'A private attachment cannot be included in a shared publication');
        if (!attachment.manifest && attachment.explicitlyPublic !== true) throw new PublicationError('POLICY_DENIED', 'A shared attachment needs a public manifest or explicit owner disclosure');
        if (attachment.manifest && attachment.manifest.contentId !== attachment.contentId) throw new PublicationError('INTEGRITY', 'Attachment manifest does not match content reference');
      }
    }
    if (draft.source?.visibility && draft.source.visibility !== 'public' && isSharedVisibility(visibility) && !sourceDisclosureConfirmed) throw new PublicationError('POLICY_DENIED', 'Private source disclosure requires a fresh explicit snapshot');
    if (serializedBytes(draft) > PUBLICATION_MAX_METADATA_BYTES) throw new PublicationError('INVALID_ARGUMENT', 'Publication metadata exceeds bounds');
  }

  private async surfaceEligible(revision: PublicationRevision): Promise<boolean> {
    if (!isSharedVisibility(revision.visibility)) return true;
    const domain = revision.visibility === 'PUBLIC' || revision.visibility === 'UNLISTED' ? 'PUBLIC' as const : revision.visibility === 'SPACE' ? 'SHARED_SPACE' as const : revision.visibility === 'CONTACTS' || revision.visibility === 'FOLLOWERS' || revision.visibility === 'SELECTED_IDENTITIES' ? 'DIRECT_SHARED' as const : 'PUBLIC' as const;
    // SafetyRuntime derives its own bounded fingerprint from the publication
    // payload. The R0P74 body manifest hash is a different address and must not
    // be passed as if it described the metadata being classified.
    const eligible = await this.protectedSurfaces.evaluate('PUBLICATIONS' as ProtectedSurfaceId, { objectId: revision.revisionAddress, value: revision, content: revision.content, text: typeof revision.content === 'string' ? revision.content : JSON.stringify(revision.content), domain, sourceType: 'publication', verified: true, authorized: true, sharing: true });
    return eligible !== undefined;
  }

  private async verifyRevision(value: PublicationRevision): Promise<boolean> {
    if (!parsePublicationRevision(value)) return false;
    const { signature: _signature, revisionAddress: _revisionAddress, ...withoutAddress } = value;
    if (await revisionContentAddress(withoutAddress) !== value.revisionAddress) return false;
    const manifest = contentManifestSchema.safeParse(value.contentManifest);
    if (!manifest.success) return false;
    const expectedContentId = `sha256-${await sha256(new TextEncoder().encode(canonicalJson(value.content)))}`;
    if (manifest.data.contentId !== expectedContentId || manifest.data.contentPolicy !== contentPolicyFor(value.visibility)) return false;
    return verifyCanonical(stripSignature(value), value.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, value.publisherIdentity));
  }
  private async verifyPointer(value: PublicationPointer): Promise<boolean> {
    if (!parsePublicationPointer(value)) return false;
    return verifyCanonical(stripSignature(value), value.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, value.publisherIdentity));
  }
  private resolveLatestLocal(publicationId: string): PublicationRevision | undefined { const pointer = this.state.pointers[publicationId]; return pointer?.revisionAddress ? this.state.revisions[pointer.revisionAddress] : undefined; }
  private async hydrate(): Promise<void> {
    if (!this.stateStore) return;
    const raw = await this.stateStore.read();
    const parsed = parseState(raw, this.maxPublications, this.maxRevisions);
    // Local persistence is not an authority boundary.  Re-verify every
    // signed object on restore so a damaged/tampered state store cannot make
    // an invalid revision or pointer eligible for a renderer/index.
    const revisions: Record<string, PublicationRevision> = {};
    for (const [address, revision] of Object.entries(parsed.revisions)) if (await this.verifyRevision(revision) && address === revision.revisionAddress) revisions[address] = revision;
    const pointers: Record<string, PublicationPointer> = {};
    for (const [publicationId, pointer] of Object.entries(parsed.pointers)) {
      if (!(await this.verifyPointer(pointer)) || publicationId !== pointer.publicationId) continue;
      if (pointer.status === 'PUBLISHED') {
        const revision = pointer.revisionAddress ? revisions[pointer.revisionAddress] : undefined;
        if (!revision || revision.publisherIdentity !== pointer.publisherIdentity || revision.revisionNumber !== pointer.revisionNumber || revision.visibility !== pointer.visibility) continue;
      }
      pointers[publicationId] = pointer;
    }
    const records: Record<string, PublicationRecord> = {};
    for (const [publicationId, record] of Object.entries(parsed.records)) {
      if (publicationId !== record.publicationId || record.revisionAddresses.some(address => !revisions[address])) continue;
      const pointer = pointers[publicationId];
      records[publicationId] = pointer
        ? { ...record, status: pointer.status, visibility: pointer.visibility, updatedAt: pointer.updatedAt, latestPointer: pointer }
        : { ...record, status: 'UNPUBLISHED', latestPointer: undefined };
    }
    this.state = { version: PUBLICATION_VERSION, drafts: parsed.drafts, revisions, pointers, records };
  }
  private async persist(): Promise<void> { if (!this.stateStore) return; const snapshot = structuredClone(this.state); const operation = this.writes.then(() => this.stateStore!.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private localObjectResolver(): (id: string) => boolean { return id => Boolean(this.state.records[id]); }
}

export interface PublicationDiscoveryMetadata {
  readonly id: string;
  readonly publicationId: string;
  readonly type: 'publication';
  readonly publisherIdentity: string;
  readonly title: string;
  readonly kind: PublicationKind;
  readonly visibility: 'PUBLIC' | 'UNLISTED';
  readonly revisionAddress: ContentId;
  readonly updatedAt: string;
  readonly slug?: string;
}

/** Converts a verified publication projection into the existing discovery
 * index shape. The body/revision is not copied into discovery. */
export function publicationDiscoveryEntry(metadata: PublicationDiscoveryMetadata): import('./discovery.js').PublicationDiscoveryEntry {
  return {
    id: metadata.id,
    type: 'publication',
    author: metadata.publisherIdentity,
    createdAt: metadata.updatedAt,
    visibility: metadata.visibility === 'PUBLIC' ? 'public' : 'unlisted',
    references: [],
    payload: {
      publicationId: metadata.publicationId,
      title: metadata.title,
      kind: metadata.kind,
      revisionAddress: metadata.revisionAddress,
      ...(metadata.slug ? { slug: metadata.slug } : {}),
    },
  };
}

export interface PublicationReplicationOptions { readonly now?: () => number; readonly maxAnnouncementBytes?: number; }
const PUBLICATION_ENVELOPE_TYPE = 'publication.update';

/** Sends signed publication metadata through the canonical Fabric interface. */
export class PublicationReplicationService {
  private readonly unsubscribe: () => void;
  private readonly seen = new Set<string>();
  private readonly now: () => number;
  private readonly maxAnnouncementBytes: number;
  private readonly local: DeviceSessionKeys;
  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly security: EnvelopeSecurity, local: DeviceSessionKeys, private readonly publications: PublicationService, options: PublicationReplicationOptions = {}) {
    this.local = local;
    this.now = options.now ?? Date.now;
    this.maxAnnouncementBytes = boundedInt(options.maxAnnouncementBytes ?? 256 * 1024, 1_024, 512 * 1024);
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); });
  }
  close(): void { this.unsubscribe(); this.seen.clear(); }
  async publish(peer: string, publicationId: string): Promise<void> {
    const announcement = this.publications.announcement(publicationId);
    if (!announcement) throw new PublicationError('NOT_FOUND', 'Publication is not currently published');
    const unsigned: UnsignedEnvelope = { version: 1, type: PUBLICATION_ENVELOPE_TYPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + 5 * 60_000).toISOString(), body: announcement };
    if (serializedBytes(unsigned) > this.maxAnnouncementBytes) throw new PublicationError('INVALID_ARGUMENT', 'Publication announcement exceeds bounds');
    await this.transport.connect(peer);
    await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.type !== PUBLICATION_ENVELOPE_TYPE || envelope.recipient !== this.local.nodeId || Date.parse(envelope.expiresAt) <= this.now()) return;
    if (this.seen.has(envelope.nonce) || this.seen.size >= 4_096) return;
    if (!(await this.security.verify(envelope))) return;
    this.seen.add(envelope.nonce);
    const body = envelope.body && typeof envelope.body === 'object' ? envelope.body as Record<string, unknown> : undefined;
    const revision = body?.revision;
    const pointer = body?.pointer;
    if (!revision || !pointer || serializedBytes(body) > this.maxAnnouncementBytes) return;
    try { await this.publications.ingestRevision(revision, pointer); } catch { /* recipient-local rejection is fail-closed */ }
  }
}

export function publicationLink(publicationId: string): string { return `keystone://publication/${encodeURIComponent(safeId(publicationId))}`; }
export function publicationRevisionLink(publicationId: string, revisionAddress: ContentId): string { if (!isContentId(revisionAddress)) throw new PublicationError('INVALID_ARGUMENT', 'Invalid revision address'); return `${publicationLink(publicationId)}/revision/${revisionAddress}`; }
export function parsePublicationLink(value: string): { readonly publicationId: string; readonly revisionAddress?: ContentId } {
  try {
    const url = new URL(value);
    if (url.protocol !== 'keystone:' || url.hostname !== 'publication') throw new Error('invalid');
    const path = url.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    if (!path[0] || path.length > 3) throw new Error('invalid');
    if (path.length === 1) return { publicationId: safeId(path[0]!) };
    if (path.length !== 3 || path[1] !== 'revision' || !isContentId(path[2]!)) throw new Error('invalid');
    return { publicationId: safeId(path[0]!), revisionAddress: path[2] as ContentId };
  } catch { throw new PublicationError('INVALID_ARGUMENT', 'Invalid Keystone publication link'); }
}

export function publicationStatusLabel(status: PublicationStatus, locale: 'en' | 'ru' = 'en'): string {
  const labels = locale === 'ru' ? { DRAFT: 'Черновик', PUBLISHED: 'Опубликовано', UNPUBLISHED: 'Не опубликовано' } : { DRAFT: 'Draft', PUBLISHED: 'Published', UNPUBLISHED: 'Unpublished' };
  return labels[status];
}
export function publicationVisibilityExplanation(visibility: PublicationVisibility, locale: 'en' | 'ru' = 'en'): string {
  if (locale === 'ru') {
    if (visibility === 'PUBLIC') return 'Публично: публикацию сможет открыть любой пользователь Keystone, который её найдёт или получит ссылку. Публичные данные могут сохраниться на других устройствах и в кэшах.';
    if (visibility === 'UNLISTED') return 'По ссылке: публикация не показывается в обычном публичном поиске, но её сможет открыть тот, у кого есть ссылка. Это не секрет.';
    return 'Ограниченная публикация: доступ определяется существующей политикой Keystone и не выдаётся одним знанием хэша.';
  }
  if (visibility === 'PUBLIC') return 'Public: any Keystone user who discovers or receives the link may open it. Public bytes may remain on other devices and caches.';
  if (visibility === 'UNLISTED') return 'By link: excluded from ordinary public discovery, but anyone with the link may open it. This is not a secret.';
  return 'Scoped publication: existing Keystone authorization applies; knowing a hash or link is not authorization.';
}

function emptyState(): PublicationState { return { version: PUBLICATION_VERSION, drafts: {}, revisions: {}, pointers: {}, records: {} }; }
function parseState(value: unknown, maxPublications: number, maxRevisions: number): PublicationState {
  if (!value) return emptyState();
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== PUBLICATION_VERSION) return emptyState();
  const candidate = value as Partial<PublicationState>;
  const drafts: Record<string, PublicationDraft> = {};
  const revisions: Record<string, PublicationRevision> = {};
  const pointers: Record<string, PublicationPointer> = {};
  const records: Record<string, PublicationRecord> = {};
  for (const [id, draft] of Object.entries(candidate.drafts ?? {}).slice(-maxPublications)) { if (safeDraft(draft) && draft.draftId === id) drafts[id] = structuredClone(draft); }
  for (const [id, revision] of Object.entries(candidate.revisions ?? {}).slice(-maxRevisions)) { const parsed = parsePublicationRevision(revision); if (parsed && parsed.revisionAddress === id) revisions[id] = parsed; }
  for (const [id, pointer] of Object.entries(candidate.pointers ?? {}).slice(-maxPublications)) { const parsed = parsePublicationPointer(pointer); if (parsed && parsed.publicationId === id) pointers[id] = parsed; }
  for (const [id, record] of Object.entries(candidate.records ?? {}).slice(-maxPublications)) { if (safeRecord(record) && record.publicationId === id && record.revisionAddresses.every(address => Boolean(revisions[address]))) records[id] = structuredClone(record); }
  for (const [id, pointer] of Object.entries(pointers)) if (records[id]) records[id] = { ...records[id]!, latestPointer: pointer, status: pointer.status, visibility: pointer.visibility };
  return { version: PUBLICATION_VERSION, drafts, revisions, pointers, records };
}

function parsePublicationRevision(value: unknown): PublicationRevision | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PublicationRevision>;
  if (candidate.version !== PUBLICATION_VERSION || candidate.protocol !== PUBLICATION_PROTOCOL || typeof candidate.publicationId !== 'string' || typeof candidate.revisionAddress !== 'string' || !Number.isSafeInteger(candidate.revisionNumber) || typeof candidate.publisherIdentity !== 'string' || !isPublicationKind(candidate.kind) || !isPublicationVisibility(candidate.visibility) || !candidate.contentManifest || !Array.isArray(candidate.attachments) || !Array.isArray(candidate.references) || typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt)) || typeof candidate.publishedAt !== 'string' || !Number.isFinite(Date.parse(candidate.publishedAt)) || typeof candidate.signature !== 'string' || candidate.signature.length < 8) return undefined;
  const publicationId = candidate.publicationId;
  const revisionAddress = candidate.revisionAddress;
  const revisionNumber = candidate.revisionNumber;
  if (!safeId(publicationId) || !isContentId(revisionAddress) || typeof revisionNumber !== 'number' || revisionNumber < 1) return undefined;
  try { normalizeContent(candidate.content); normalizeAttachments(candidate.attachments); normalizeReferences(candidate.references); if (candidate.summary !== undefined) boundedText(candidate.summary, PUBLICATION_MAX_SUMMARY); if (candidate.slug !== undefined) safeSlug(candidate.slug); if (serializedBytes(candidate) > PUBLICATION_MAX_METADATA_BYTES) return undefined; return structuredClone(candidate as PublicationRevision); } catch { return undefined; }
}
function parsePublicationPointer(value: unknown): PublicationPointer | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PublicationPointer>;
  if (candidate.version !== PUBLICATION_VERSION || candidate.protocol !== PUBLICATION_PROTOCOL || typeof candidate.publicationId !== 'string' || typeof candidate.publisherIdentity !== 'string' || !Number.isSafeInteger(candidate.pointerRevision) || !Number.isSafeInteger(candidate.revisionNumber) || !['PUBLISHED', 'UNPUBLISHED'].includes(String(candidate.status)) || !isPublicationVisibility(candidate.visibility) || typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.updatedAt)) || typeof candidate.signature !== 'string' || candidate.signature.length < 8 || (candidate.revisionAddress !== undefined && !isContentId(candidate.revisionAddress))) return undefined;
  const publicationId = candidate.publicationId;
  const pointerRevision = candidate.pointerRevision;
  const revisionNumber = candidate.revisionNumber;
  if (!safeId(publicationId) || typeof pointerRevision !== 'number' || typeof revisionNumber !== 'number' || pointerRevision < 1 || revisionNumber < 1) return undefined;
  return structuredClone(candidate as PublicationPointer);
}
function safeDraft(value: unknown): value is PublicationDraft { if (!value || typeof value !== 'object') return false; const candidate = value as Partial<PublicationDraft>; try { return candidate.version === PUBLICATION_VERSION && candidate.protocol === PUBLICATION_PROTOCOL && typeof candidate.draftId === 'string' && safeId(candidate.draftId) === candidate.draftId && typeof candidate.publisherIdentity === 'string' && isPublicationKind(candidate.kind) && typeof candidate.title === 'string' && candidate.title.length > 0 && Array.isArray(candidate.attachments) && Array.isArray(candidate.references) && typeof candidate.createdAt === 'string' && typeof candidate.updatedAt === 'string' && normalizeContent(candidate.content) !== undefined; } catch { return false; } }
function safeRecord(value: unknown): value is PublicationRecord { if (!value || typeof value !== 'object') return false; const candidate = value as Partial<PublicationRecord>; return typeof candidate.publicationId === 'string' && safeId(candidate.publicationId) === candidate.publicationId && typeof candidate.publisherIdentity === 'string' && isPublicationKind(candidate.kind) && ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'].includes(String(candidate.status)) && isPublicationVisibility(candidate.visibility) && Array.isArray(candidate.revisionAddresses) && candidate.revisionAddresses.every(isContentId); }
function stripSignature<T extends { readonly signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...unsigned } = value; return unsigned; }
async function revisionContentAddress(value: unknown): Promise<ContentId> { return `sha256-${await sha256(new TextEncoder().encode(canonicalJson(value)))}` as ContentId; }
function safeId(value: string): string { if (typeof value !== 'string' || value.length < 1 || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new PublicationError('INVALID_ARGUMENT', 'Invalid publication identifier'); return value; }
function safeSlug(value: string): string { const normalized = value.normalize('NFKC').trim(); if (!normalized || normalized.length > PUBLICATION_MAX_SLUG || /[\u0000-\u001f\u007f]/.test(normalized) || normalized.includes('/') || normalized.includes('\\') || normalized === '.' || normalized === '..') throw new PublicationError('INVALID_ARGUMENT', 'Invalid publication slug'); return normalized; }
function boundedText(value: unknown, max: number, required = false): string { if (typeof value !== 'string') throw new PublicationError('INVALID_ARGUMENT', 'Publication text is invalid'); const normalized = value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim(); if (required && !normalized) throw new PublicationError('INVALID_ARGUMENT', 'Publication title is required'); if (normalized.length > max) throw new PublicationError('INVALID_ARGUMENT', 'Publication text exceeds bounds'); return normalized; }
function normalizeContent(value: unknown): PublicationContent { if (typeof value === 'string') return boundedText(value, PUBLICATION_MAX_METADATA_BYTES); if (!Array.isArray(value) || value.length > PUBLICATION_MAX_BLOCKS) throw new PublicationError('INVALID_ARGUMENT', 'Publication content is invalid'); return value.map(block => normalizeBlock(block)); }
function normalizeBlock(value: unknown): PublicationBlock { if (!value || typeof value !== 'object') throw new PublicationError('INVALID_ARGUMENT', 'Publication block is invalid'); const candidate = value as Record<string, unknown>; const type = candidate.type; if (type === 'heading' || type === 'paragraph' || type === 'code') { const text = boundedText(candidate.text, 32_768, type !== 'code'); return { type, text, ...(type === 'heading' ? { level: candidate.level === 2 || candidate.level === 3 ? candidate.level : 1 } : {}), ...(type === 'code' && typeof candidate.language === 'string' ? { language: boundedText(candidate.language, 80) } : {}) } as PublicationBlock; } if (type === 'list') { if (!Array.isArray(candidate.items) || candidate.items.length > PUBLICATION_MAX_BLOCKS) throw new PublicationError('INVALID_ARGUMENT', 'Publication list is invalid'); return { type, ordered: candidate.ordered === true, items: candidate.items.map(item => boundedText(item, 8_000, true)) }; } if (type === 'image' || type === 'media') { const uri = safeContentUri(candidate.contentUri); return { type, contentUri: uri, ...(typeof candidate.alt === 'string' ? { alt: boundedText(candidate.alt, 1_000) } : {}), ...(typeof candidate.caption === 'string' ? { caption: boundedText(candidate.caption, 2_000) } : {}) }; } if (type === 'link') { const label = boundedText(candidate.label, 1_000, true); const url = safePublicationUrl(candidate.url); return { type, label, url }; } if (type === 'object') { const objectId = safeId(String(candidate.objectId ?? '')); return { type, objectId, ...(typeof candidate.objectType === 'string' ? { objectType: boundedText(candidate.objectType, 96) } : {}), ...(typeof candidate.label === 'string' ? { label: boundedText(candidate.label, 1_000) } : {}) }; } throw new PublicationError('INVALID_ARGUMENT', 'Unsupported publication block'); }
function normalizeAttachments(value: unknown): readonly PublicationAttachmentReference[] { if (!Array.isArray(value) || value.length > PUBLICATION_MAX_ATTACHMENTS) throw new PublicationError('INVALID_ARGUMENT', 'Publication attachments are invalid'); return value.map(item => { if (!item || typeof item !== 'object') throw new PublicationError('INVALID_ARGUMENT', 'Publication attachment is invalid'); const candidate = item as Partial<PublicationAttachmentReference>; const contentId = candidate.contentId; const size = candidate.size; if (!isContentId(contentId) || candidate.contentUri !== `keystone://content/${contentId}` || typeof candidate.name !== 'string' || !candidate.name || candidate.name.length > 255 || typeof candidate.mimeType !== 'string' || !candidate.mimeType || candidate.mimeType.length > 255 || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > 2 ** 40) throw new PublicationError('INVALID_ARGUMENT', 'Publication attachment metadata is invalid'); if (candidate.manifest && (!contentManifestSchema.safeParse(candidate.manifest).success || candidate.manifest.contentId !== contentId)) throw new PublicationError('INTEGRITY', 'Attachment content manifest is invalid'); return structuredClone({ ...candidate, contentId, size } as PublicationAttachmentReference); }); }
function normalizeReferences(value: unknown): readonly string[] { if (!Array.isArray(value) || value.length > PUBLICATION_MAX_REFERENCES) throw new PublicationError('INVALID_ARGUMENT', 'Publication references are invalid'); return [...new Set(value.map(item => safeId(String(item))))]; }
function normalizeSource(value: PublicationSourceReference): PublicationSourceReference { if (!value || typeof value.objectId !== 'string') throw new PublicationError('INVALID_ARGUMENT', 'Publication source is invalid'); return { objectId: safeId(value.objectId), ...(value.objectType ? { objectType: boundedText(value.objectType, 96) } : {}), ...(value.visibility ? { visibility: value.visibility } : {}) }; }
function parseKind(value: unknown): PublicationKind { if (!isPublicationKind(value)) throw new PublicationError('INVALID_ARGUMENT', 'Publication kind is invalid'); return value; }
function parseVisibility(value: unknown): PublicationVisibility { if (!isPublicationVisibility(value)) throw new PublicationError('INVALID_ARGUMENT', 'Publication visibility is invalid'); return value; }
function isPublicationKind(value: unknown): value is PublicationKind { return typeof value === 'string' && (PUBLICATION_KINDS as readonly string[]).includes(value); }
function isPublicationVisibility(value: unknown): value is PublicationVisibility { return typeof value === 'string' && (PUBLICATION_VISIBILITIES as readonly string[]).includes(value); }
/** Every persisted publication visibility is a shared/publication surface;
 * drafts are represented separately and never reach this predicate. */
function isSharedVisibility(_value: PublicationVisibility): boolean { return true; }
function contentPolicyFor(visibility: PublicationVisibility): ContentCachePolicy { return visibility === 'PUBLIC' || visibility === 'UNLISTED' ? 'PUBLIC_CACHEABLE' : 'PRIVATE_NO_STRANGER_CACHE'; }
function safeContentUri(value: unknown): string { if (typeof value !== 'string' || !/^keystone:\/\/content\/sha256-[a-f0-9]{64}$/i.test(value)) throw new PublicationError('INVALID_ARGUMENT', 'Publication media reference is invalid'); return value; }
function safePublicationUrl(value: unknown): string { if (typeof value !== 'string' || value.length > 2_048) throw new PublicationError('INVALID_ARGUMENT', 'Publication link is invalid'); if (value.startsWith('keystone://')) return value; let url: URL; try { url = new URL(value); } catch { throw new PublicationError('INVALID_ARGUMENT', 'Publication link is invalid'); } if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new PublicationError('POLICY_DENIED', 'Unsafe publication URL scheme'); if (url.protocol !== 'mailto:' && isPrivateHost(url.hostname)) throw new PublicationError('POLICY_DENIED', 'Private or local publication URL is not allowed'); return url.toString(); }
function isPrivateHost(host: string): boolean { const normalized = host.toLowerCase(); return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '::1' || normalized === '0.0.0.0' || normalized.startsWith('127.') || normalized.startsWith('10.') || normalized.startsWith('192.168.') || normalized.startsWith('169.254.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) || normalized.endsWith('.local'); }
function renderContent(title: string, summary: string | undefined, content: PublicationContent, resolver: (id: string) => boolean): SafePublicationRender { const blocks = typeof content === 'string' ? [{ type: 'paragraph' as const, text: sanitizeText(content) }] : content.map(block => renderBlock(block, resolver)).filter((block): block is SafePublicationBlock => block !== undefined); const unresolvedReferences = blocks.flatMap(block => block.type === 'object' && !block.available ? [block.objectId] : []); return { title: sanitizeText(title), ...(summary ? { summary: sanitizeText(summary) } : {}), blocks, unresolvedReferences }; }
function renderBlock(block: PublicationBlock, resolver: (id: string) => boolean): SafePublicationBlock | undefined { if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'code') return { ...block, text: sanitizeText(block.text), ...(block.type === 'heading' ? { level: block.level ?? 1 } : {}) }; if (block.type === 'list') return { type: 'list', ordered: block.ordered === true, items: block.items.slice(0, PUBLICATION_MAX_BLOCKS).map(sanitizeText) }; if (block.type === 'image' || block.type === 'media') return { type: 'media', contentUri: block.contentUri, ...(block.alt ? { alt: sanitizeText(block.alt) } : {}), ...(block.caption ? { caption: sanitizeText(block.caption) } : {}) }; if (block.type === 'link') { const safe = safeLinkForRender(block.url); return { type: 'link', label: sanitizeText(block.label), url: safe.url, external: !safe.url.startsWith('keystone://'), ...(safe.warning ? { warning: safe.warning } : {}) }; } if (block.type === 'object') return { type: 'object', objectId: block.objectId, ...(block.objectType ? { objectType: block.objectType } : {}), ...(block.label ? { label: sanitizeText(block.label) } : {}), available: resolver(block.objectId) }; return undefined; }
function safeLinkForRender(url: string): { url: string; warning?: string } { try { const safe = safePublicationUrl(url); return { url: safe, ...(safe.startsWith('http') ? { warning: 'External link: leaving Keystone may reveal reader metadata to the provider.' } : {}) }; } catch { return { url: 'about:blank', warning: 'Unsafe link removed' }; } }
function sanitizeText(value: string): string { return value.replace(/<\/?script\b[^>]*>/gi, '').replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript\s*:/gi, '').slice(0, 32_768); }
function collectLinks(content: PublicationContent): readonly { readonly url: string; readonly safe: boolean; readonly warning?: string }[] { const values = typeof content === 'string' ? [] : content.filter((block): block is Extract<PublicationBlock, { type: 'link' }> => block.type === 'link').map(block => { try { return { url: safePublicationUrl(block.url), safe: true }; } catch { return { url: block.url.slice(0, 2_048), safe: false, warning: 'Unsafe link rejected' }; } }); return values.slice(0, PUBLICATION_MAX_REFERENCES); }
function compareCreated(a: { createdAt?: string; updatedAt?: string; publicationId?: string; draftId?: string }, b: { createdAt?: string; updatedAt?: string; publicationId?: string; draftId?: string }): number { return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '') || (a.publicationId ?? a.draftId ?? '').localeCompare(b.publicationId ?? b.draftId ?? ''); }
function serializedBytes(value: unknown): number { try { return new TextEncoder().encode(canonicalJson(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; } }
function boundedInt(value: number, min: number, max: number): number { if (!Number.isSafeInteger(value) || value < min || value > max) throw new PublicationError('INVALID_ARGUMENT', 'Publication bound is invalid'); return value; }
function clone<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }
function omit<T extends Record<string, unknown>>(value: T, key: string): T { const { [key]: _removed, ...rest } = value; return rest as T; }
function isContentId(value: unknown): value is ContentId { return typeof value === 'string' && /^sha256-[a-f0-9]{64}$/i.test(value); }
function iso(at: number): string { return new Date(at).toISOString(); }
