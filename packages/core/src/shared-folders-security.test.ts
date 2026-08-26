import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from './crypto.js';
import { ContentCache } from './social/content.js';
import { ContentCacheFolderContentStore, CryptoFolderSigner, InMemoryFolderStateStore, SharedFolderService, type SharedFolderServiceOptions } from './shared-folders.js';
import type { NodeId } from './types.js';

function service(identityId: string, options: Omit<SharedFolderServiceOptions, 'localIdentityId' | 'content'> = {}): SharedFolderService {
  return new SharedFolderService({ localIdentityId: identityId as NodeId, content: new ContentCacheFolderContentStore(new ContentCache(32 * 1024 * 1024)), ...options });
}

describe('R0P90 Shared Folders security boundaries', () => {
  it('requires signed invitations and rejects role escalation or signature tampering', async () => {
    const crypto = new SodiumCryptoProvider();
    const owner = await crypto.generateIdentity();
    const recipient = await crypto.generateIdentity();
    const ownerService = service(owner.publicKey, { signer: new CryptoFolderSigner(crypto, owner.privateKey) });
    const recipientService = service(recipient.publicKey, { signer: new CryptoFolderSigner(crypto, recipient.privateKey) });
    const folder = await ownerService.createFolder({ name: 'Secure' });
    await expect(ownerService.invite(folder.id, { recipientIdentityId: recipient.publicKey, role: 'OWNER' as never })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const invitation = await ownerService.invite(folder.id, { recipientIdentityId: recipient.publicKey, role: 'EDITOR' });
    await recipientService.receiveInvitation(invitation);
    await expect(recipientService.receiveInvitation({ ...invitation, role: 'CONTRIBUTOR' })).rejects.toMatchObject({ code: 'INTEGRITY' });
    await expect(recipientService.receiveInvitation({ ...invitation, signature: undefined })).rejects.toMatchObject({ code: 'INTEGRITY' });
  });

  it('rejects malformed persisted state instead of widening the authority surface', async () => {
    const store = new InMemoryFolderStateStore();
    await store.write({ version: 99, protocol: 'unknown', folders: [] });
    const restarted = service('owner', { stateStore: store });
    await expect(restarted.ready()).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('does not let a content hash substitute for folder authorization', async () => {
    const files = service('owner');
    const folder = await files.createFolder({ name: 'Private' });
    const file = await files.createFile({ folderId: folder.id, name: 'secret.txt', bytes: new TextEncoder().encode('secret'), mimeType: 'text/plain' });
    await expect(files.readFile(file.file.id, { actorIdentityId: 'not-a-member' as NodeId })).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });
});
