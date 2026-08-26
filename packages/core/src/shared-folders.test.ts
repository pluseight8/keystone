import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from './crypto.js';
import { ContentCache } from './social/content.js';
import {
  ContentCacheFolderContentStore,
  CryptoFolderSigner,
  SharedFolderError,
  SharedFolderService,
  type SharedFolderServiceOptions,
  type FolderId,
} from './shared-folders.js';
import type { NodeId } from './types.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function service(identityId: string, options: Omit<SharedFolderServiceOptions, 'localIdentityId' | 'content'> = {}): SharedFolderService {
  return new SharedFolderService({
    localIdentityId: identityId as NodeId,
    content: new ContentCacheFolderContentStore(new ContentCache(64 * 1024 * 1024)),
    ...options,
  });
}

describe('R0P90 Shared Folders and Files', () => {
  it('keeps stable folder/file identities across nested moves and versions content', async () => {
    const files = service('owner');
    const root = await files.createFolder({ name: 'Project' });
    const child = await files.createFolder({ name: 'Drafts', parentFolderId: root.id });
    const childEntry = (await files.listChildren(root.id)).items.find(value => value.kind === 'FOLDER');
    expect(childEntry?.kind).toBe('FOLDER');
    if (!childEntry || childEntry.kind !== 'FOLDER') throw new Error('child entry missing');

    await expect(files.moveEntry(childEntry.id, child.id)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const created = await files.createFile({ folderId: child.id, name: 'Report.txt', bytes: text('v1'), mimeType: 'text/plain' });
    const initialRevision = created.revision.id;
    const originalEntryId = created.entry.id;
    await expect(files.createFile({ folderId: child.id, name: 'report.TXT', bytes: text('collision'), mimeType: 'text/plain' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const renamed = await files.renameEntry(created.entry.id, 'Final.txt');
    expect(renamed.id).toBe(originalEntryId);
    const moved = await files.moveEntry(renamed.id, root.id);
    expect(moved.id).toBe(originalEntryId);
    expect(files.relativePathOf(moved)).toBe('Final.txt');

    await files.updateFile(created.file.id, text('v1'));
    expect(await files.versionHistory(created.file.id)).toHaveLength(1);
    await files.updateFile(created.file.id, text('v2'));
    expect(await files.versionHistory(created.file.id)).toHaveLength(2);
    const restored = await files.restoreRevision(created.file.id, initialRevision, true);
    expect(restored.revision.contentId).toBe(created.revision.contentId);
    expect(await files.versionHistory(created.file.id)).toHaveLength(3);

    await files.deleteEntry(created.entry.id);
    expect((await files.listChildren(root.id)).items.some(value => value.id === created.entry.id)).toBe(false);
    expect(files.listTrash(root.id).some(value => value.id === created.entry.id)).toBe(true);
    await files.restoreEntry(created.entry.id);
    await files.permanentlyDelete(created.entry.id, true);
    expect(files.listTrash(root.id).some(value => value.id === created.entry.id)).toBe(false);
  });

  it('enforces invitation roles, explicit authorization, content delivery and epoch boundaries', async () => {
    const crypto = new SodiumCryptoProvider();
    const aliceKeys = await crypto.generateIdentity();
    const bobKeys = await crypto.generateIdentity();
    const alice = service(aliceKeys.publicKey, { signer: new CryptoFolderSigner(crypto, aliceKeys.privateKey) });
    const invitationTarget = service(bobKeys.publicKey, {
      signer: new CryptoFolderSigner(crypto, bobKeys.privateKey),
      contentDelivery: {
        async acquire(input) {
          expect(input.authorization.subjectId).toBe(bobKeys.publicKey);
          return text('shared bytes');
        },
      },
    });
    const folder = await alice.createFolder({ name: 'Shared' });
    const invitation = await alice.invite(folder.id, { recipientIdentityId: bobKeys.publicKey, role: 'VIEWER' });
    await invitationTarget.receiveInvitation(invitation);
    await invitationTarget.acceptInvitation(invitation.id);
    await alice.confirmInvitationAcceptance(invitation.id);
    const created = await alice.createFile({ folderId: folder.id, name: 'shared.txt', bytes: text('shared bytes'), mimeType: 'text/plain' });
    for (const change of alice.exportChanges().items) await invitationTarget.applyChange(change);

    expect((await invitationTarget.describeFile(created.file.id)).availability).toBe('METADATA_ONLY');
    await expect(invitationTarget.updateFile(created.file.id, text('viewer write'))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    expect(await invitationTarget.readFile(created.file.id)).toEqual(text('shared bytes'));
    await expect(alice.readFile(created.file.id, { actorIdentityId: 'unauthorized' as NodeId })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });

    await alice.revokeMember(folder.id, bobKeys.publicKey, true);
    await expect(alice.readFile(created.file.id, { actorIdentityId: bobKeys.publicKey })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    const afterRevocation = await alice.createFile({ folderId: folder.id, name: 'new.txt', bytes: text('new'), mimeType: 'text/plain' });
    const newChange = alice.exportChanges().items.find(value => value.kind === 'CREATE_FILE' && value.objectId === afterRevocation.file.id);
    expect(newChange).toBeDefined();
    await expect(invitationTarget.applyChange(newChange!)).rejects.toMatchObject({ code: 'STALE_EPOCH' });
  });

  it('keeps Drop Zones upload-only and owner-enumerated', async () => {
    const files = service('owner');
    const zone = await files.createDropZone({ name: 'Incoming', allowedIdentityIds: ['guest' as NodeId], maxUploads: 1 });
    const receipt = await files.uploadToDropZone(zone.id, { uploaderIdentityId: 'guest' as NodeId, name: 'payload.bin', bytes: text('payload'), mimeType: 'application/octet-stream' });
    expect(receipt.fileId).toBeUndefined();
    expect(await files.listDropZone(zone.id)).toHaveLength(1);
    await expect(files.uploadToDropZone(zone.id, { uploaderIdentityId: 'guest' as NodeId, name: 'second.bin', bytes: text('second'), mimeType: 'application/octet-stream' })).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
    await files.revokeDropUploader(zone.id, 'guest' as NodeId, true);
    await expect(files.uploadToDropZone(zone.id, { uploaderIdentityId: 'guest' as NodeId, name: 'third.bin', bytes: text('third'), mimeType: 'application/octet-stream' })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('rejects unsafe external paths before touching folder state', async () => {
    const files = service('owner');
    const folder = await files.createFolder({ name: 'Bound' });
    for (const path of ['../escape.txt', '/absolute.txt', 'C:\\escape.txt', 'nested/../../escape.txt', 'CON.txt']) {
      await expect(files.importExternalFile(folder.id as FolderId, path, text('blocked'), 'text/plain')).rejects.toMatchObject({ code: 'PATH_UNSAFE' });
    }
    expect((await files.listChildren(folder.id)).items).toHaveLength(0);
  });
});
