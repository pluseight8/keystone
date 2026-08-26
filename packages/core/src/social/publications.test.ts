import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';
import { PublicationService, InMemoryPublicationStateStore, parsePublicationLink, publicationDiscoveryEntry, publicationRevisionLink, publicationVisibilityExplanation, type PublicationAttachmentReference } from './publications.js';
import { createContentManifest } from './content.js';
import { UnifiedDiscoveryService } from './discovery.js';
import { DistributedContentService } from './distributed-content.js';
import { ContentCache } from './content.js';

async function identity(label: string) { return (await IdentityManager.generate()).sessionKeys(label); }

describe('Keystone Personal Web publications', () => {
  it('keeps drafts local, creates immutable signed revisions and resolves latest/exact links', async () => {
    const keys = await identity('alice'), crypto = new SodiumCryptoProvider(), service = new PublicationService(crypto, keys);
    const draft = await service.createDraft({ title: 'My page', content: [{ type: 'heading', text: 'Hello' }, { type: 'paragraph', text: 'Offline first.' }], slug: 'hello' });
    expect((await service.listPublications()).length).toBe(0);
    expect((await service.previewDraft(draft.draftId)).render.blocks).toHaveLength(2);
    await expect(service.publishDraft(draft.draftId, { visibility: 'PUBLIC' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const first = await service.publishDraft(draft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    expect(first.revision.revisionNumber).toBe(1);
    expect(first.revision.revisionAddress).toMatch(/^sha256-/);
    expect(await service.resolveLatest(first.revision.publicationId)).toMatchObject({ revisionAddress: first.revision.revisionAddress });
    expect(await service.resolveLatest(first.revision.publicationId, { allowUnlisted: true })).toMatchObject({ revisionAddress: first.revision.revisionAddress });
    expect(await service.resolveExact(first.revision.publicationId, first.revision.revisionAddress)).toMatchObject({ title: 'My page' });
    expect(parsePublicationLink(publicationRevisionLink(first.revision.publicationId, first.revision.revisionAddress))).toEqual({ publicationId: first.revision.publicationId, revisionAddress: first.revision.revisionAddress });
    const second = await service.updatePublication(first.revision.publicationId, { title: 'Updated', content: 'new body', visibility: 'PUBLIC' });
    expect(second.revision.revisionNumber).toBe(2);
    expect(await service.resolveExact(first.revision.publicationId, first.revision.revisionAddress)).toMatchObject({ title: 'My page' });
    expect(await service.resolveLatest(first.revision.publicationId, { allowUnlisted: true })).toMatchObject({ title: 'Updated' });
    const { signature: _pointerSignature, ...secondPointerUnsigned } = second.pointer;
    const rollbackUnsigned = { ...secondPointerUnsigned, pointerRevision: second.pointer.pointerRevision + 1, revisionNumber: first.revision.revisionNumber, revisionAddress: first.revision.revisionAddress };
    const rollback = { ...rollbackUnsigned, signature: await crypto.sign(canonicalJson(rollbackUnsigned), keys.privateKey) };
    await expect(service.ingestPointer(rollback)).rejects.toMatchObject({ code: 'REPLAY' });
    await service.unpublish(first.revision.publicationId);
    expect(await service.resolveLatest(first.revision.publicationId, { allowUnlisted: true })).toBeUndefined();
  });

  it('rejects forged/stale pointers, private attachment disclosure and unsafe links', async () => {
    const keys = await identity('owner'), service = new PublicationService(new SodiumCryptoProvider(), keys);
    const draft = await service.createDraft({ title: '<script>alert(1)</script>', content: [{ type: 'paragraph', text: '<script>bad()</script>safe' }] });
    const published = await service.publishDraft(draft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    expect((await service.renderRevision(published.revision))?.blocks[0]).toMatchObject({ type: 'paragraph', text: 'bad()safe' });
    expect(await service.ingestPointer({ ...published.pointer, revisionAddress: published.revision.revisionAddress, signature: 'forged' })).toBeUndefined();
    expect(await service.ingestPointer({ ...published.pointer, pointerRevision: published.pointer.pointerRevision - 1 })).toBeUndefined();
    const privateManifest = await createContentManifest(Uint8Array.from([1, 2, 3]), { mimeType: 'application/octet-stream', contentPolicy: 'PRIVATE_NO_STRANGER_CACHE' });
    const attachment: PublicationAttachmentReference = { contentUri: `keystone://content/${privateManifest.contentId}`, contentId: privateManifest.contentId, name: 'secret.bin', mimeType: privateManifest.mimeType, size: privateManifest.byteLength, manifest: privateManifest };
    const privateDraft = await service.createDraft({ title: 'Leak', content: 'no', attachments: [attachment] });
    await expect(service.publishDraft(privateDraft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const explicitPrivateDraft = await service.createDraft({ title: 'Still private', content: 'no', attachments: [{ ...attachment, explicitlyPublic: true }] });
    await expect(service.publishDraft(explicitPrivateDraft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    const sourceDraft = await service.createDraft({ title: 'Snapshot', content: 'safe snapshot', source: { objectId: 'private-source', objectType: 'file', visibility: 'private' } });
    const sourcePublished = await service.publishDraft(sourceDraft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    expect(sourcePublished.revision.source).toBeUndefined();
    await expect(service.createDraft({ title: 'Unsafe', content: [{ type: 'link', label: 'bad', url: 'javascript:alert(1)' }] })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(publicationVisibilityExplanation('UNLISTED', 'ru')).toContain('не секрет');
  });

  it('persists across restart and fails closed when the mandatory publication gate is unavailable', async () => {
    const backend = new InMemoryPublicationStateStore(), keys = await identity('persisted'), crypto = new SodiumCryptoProvider();
    const first = new PublicationService(crypto, keys, { stateStore: backend });
    const draft = await first.createDraft({ title: 'Persisted', content: 'body' });
    const published = await first.publishDraft(draft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    const restarted = new PublicationService(crypto, keys, { stateStore: backend });
    expect(await restarted.resolveLatest(published.revision.publicationId, { allowUnlisted: true })).toMatchObject({ revisionAddress: published.revision.revisionAddress });
    const tampered = first.snapshot() as any;
    tampered.pointers[published.revision.publicationId] = { ...tampered.pointers[published.revision.publicationId], signature: 'tampered' };
    await backend.write(tampered);
    const hardenedRestart = new PublicationService(crypto, keys, { stateStore: backend });
    expect(await hardenedRestart.latestPointer(published.revision.publicationId)).toBeUndefined();
    expect(await hardenedRestart.resolveLatest(published.revision.publicationId, { allowUnlisted: true })).toBeUndefined();
    const denied = new PublicationService(crypto, keys, { protectedSurfaces: new MandatorySafetySurfaceRegistry(undefined) });
    const deniedDraft = await denied.createDraft({ title: 'No gate', content: 'body' });
    await expect(denied.publishDraft(deniedDraft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('keeps unlisted and scoped publications distinct at resolution and discovery boundaries', async () => {
    const keys = await identity('scope-owner'), service = new PublicationService(new SodiumCryptoProvider(), keys);
    const unlistedDraft = await service.createDraft({ title: 'By link', content: 'unlisted body' });
    const unlisted = await service.publishDraft(unlistedDraft.draftId, { visibility: 'UNLISTED', ownerConfirmed: true });
    expect(await service.resolveLatest(unlisted.revision.publicationId)).toBeUndefined();
    expect(await service.resolveLatest(unlisted.revision.publicationId, { allowUnlisted: true })).toMatchObject({ revisionAddress: unlisted.revision.revisionAddress });
    const discovery = new UnifiedDiscoveryService();
    const metadata = service.discoveryMetadata(unlisted.revision.publicationId);
    expect(metadata).toBeDefined();
    // A by-link publication is only indexed locally after the owner/reader has
    // obtained its explicit link; ordinary public gossip must not advertise it.
    expect(await discovery.ingestPublication(publicationDiscoveryEntry(metadata!), 'local')).toBe(true);
    expect((await discovery.search({ query: 'by link', scope: 'public' })).items).toHaveLength(0);
    expect((await discovery.search({ query: 'by link', scope: 'local' })).items).toHaveLength(1);

    const scopedDraft = await service.createDraft({ title: 'Contacts only', content: 'scoped body' });
    const scoped = await service.publishDraft(scopedDraft.draftId, { visibility: 'CONTACTS', ownerConfirmed: true });
    expect(await service.resolveLatest(scoped.revision.publicationId)).toBeUndefined();
    expect(await service.resolveLatest(scoped.revision.publicationId, { canView: () => false })).toBeUndefined();
    expect(await service.resolveLatest(scoped.revision.publicationId, { canView: () => true })).toMatchObject({ revisionAddress: scoped.revision.revisionAddress });
    expect(await service.resolveExact(scoped.revision.publicationId, scoped.revision.revisionAddress)).toBeUndefined();
    expect(await service.resolveExact(scoped.revision.publicationId, scoped.revision.revisionAddress, { canView: () => true })).toMatchObject({ revisionAddress: scoped.revision.revisionAddress });
  });

  it('projects public publication metadata into existing Home/Search surfaces without copying the body', async () => {
    const keys = await identity('discovery-owner'), service = new PublicationService(new SodiumCryptoProvider(), keys);
    const draft = await service.createDraft({ title: 'Public project', summary: 'A discoverable page', content: [{ type: 'paragraph', text: 'body stays in the content layer' }] });
    const published = await service.publishDraft(draft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    const metadata = service.discoveryMetadata(published.revision.publicationId);
    expect(metadata).toBeDefined();
    const discovery = new UnifiedDiscoveryService();
    expect(await discovery.ingestPublication(publicationDiscoveryEntry(metadata!), 'public')).toBe(true);
    const result = await discovery.search({ query: 'public project', scope: 'public' });
    expect(result.items[0]?.object).toMatchObject({ id: published.revision.publicationId, type: 'publication', author: keys.nodeId });
    expect(result.items[0]?.object.payload).not.toHaveProperty('content');
    expect((await discovery.feed({ surface: 'home' })).items[0]?.object.id).toBe(published.revision.publicationId);
  });

  it('fetches publication bytes through the existing distributed content layer and rejects private hash access', async () => {
    const keys = await identity('content-owner'), service = new PublicationService(new SodiumCryptoProvider(), keys);
    const draft = await service.createDraft({ title: 'Content address', content: 'verified publication bytes' });
    const published = await service.publishDraft(draft.draftId, { visibility: 'PUBLIC', ownerConfirmed: true });
    const distributed = new DistributedContentService({ cache: new ContentCache(4 * 1024 * 1024) });
    const bytes = await service.fetchContent(published.revision, distributed);
    expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify('verified publication bytes'));
    const scopedDraft = await service.createDraft({ title: 'Scoped', content: 'not for strangers' });
    const scoped = await service.publishDraft(scopedDraft.draftId, { visibility: 'CONTACTS', ownerConfirmed: true });
    await expect(service.fetchContent(scoped.revision, distributed)).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});
