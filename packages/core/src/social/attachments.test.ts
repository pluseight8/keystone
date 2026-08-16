import { describe, expect, it } from 'vitest';
import { AttachmentTransferController } from './attachments.js';
import { ContentCache, type ContentManifest, type ContentProvider, contentUri, createContentManifest } from './content.js';
import type { MessageAttachment } from './object-model.js';

class Provider implements ContentProvider { calls = 0; constructor(readonly id: string, private readonly source: Uint8Array, private readonly manifest: ContentManifest, private failures = 0) {} async getChunk(_id: ContentManifest['contentId'], index: number, signal?: AbortSignal) { this.calls++; if (signal?.aborted) throw new DOMException('cancelled', 'AbortError'); if (this.failures-- > 0) throw new Error('temporary failure'); const start = index * this.manifest.chunkSize; return this.source.subarray(start, Math.min(this.source.length, start + this.manifest.chunkSize)); } }

describe('AttachmentTransferController', () => {
  it('downloads an attachment by content reference with progress and retry', async () => {
    const source = Uint8Array.from({ length: 20_000 }, (_, index) => index % 251), manifest = await createContentManifest(source, { mimeType: 'audio/ogg', chunkSize: 16 * 1024 }), attachment: MessageAttachment = { contentUri: contentUri(manifest.contentId), name: 'sound.ogg', mimeType: 'audio/ogg', size: source.length }; const provider = new Provider('peer', source, manifest, 1); const controller = new AttachmentTransferController(new ContentCache(100_000), { async manifest() { return manifest; }, async providers() { return [provider]; } }); await expect(controller.download(attachment)).rejects.toThrow('temporary failure'); expect(await controller.retry(attachment)).toEqual(source); expect(controller.state(attachment).status).toBe('complete');
  });
  it('rejects metadata whose manifest has a different size', async () => {
    const source = Uint8Array.from({ length: 20_000 }, (_, index) => index), manifest = await createContentManifest(source, { mimeType: 'application/octet-stream', chunkSize: 16 * 1024 }), attachment: MessageAttachment = { contentUri: contentUri(manifest.contentId), name: 'bad', mimeType: 'application/octet-stream', size: source.length + 1 }; const controller = new AttachmentTransferController(new ContentCache(100_000), { async manifest() { return manifest; }, async providers() { return []; } }); await expect(controller.download(attachment)).rejects.toThrow('mismatched'); expect(controller.state(attachment).status).toBe('failed');
  });
});
