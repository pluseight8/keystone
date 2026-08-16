import type { ContentCache, ContentDownloadProgress, ContentManifest, ContentProvider } from './content.js';
import { ContentFetcher, parseContentUri } from './content.js';
import type { MessageAttachment } from './object-model.js';

export interface AttachmentDirectory { manifest(contentId: ReturnType<typeof parseContentUri>): Promise<ContentManifest | undefined>; providers(contentId: ReturnType<typeof parseContentUri>): Promise<readonly ContentProvider[]>; }
export interface AttachmentTransferState { attachment: MessageAttachment; status: 'idle' | 'downloading' | 'complete' | 'cancelled' | 'failed'; progress?: ContentDownloadProgress; error?: string; }
/** UI-facing transfer coordinator. It carries no blob over a message transport. */
export class AttachmentTransferController {
  private readonly states = new Map<string, AttachmentTransferState>(); private readonly controllers = new Map<string, AbortController>(); private readonly listeners = new Set<(state: AttachmentTransferState) => void>();
  constructor(private readonly cache: ContentCache, private readonly directory: AttachmentDirectory) {}
  subscribe(listener: (state: AttachmentTransferState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  state(attachment: MessageAttachment): AttachmentTransferState { return this.states.get(attachment.contentUri) ?? { attachment, status: 'idle' }; }
  async download(attachment: MessageAttachment): Promise<Uint8Array> {
    const contentId = parseContentUri(attachment.contentUri); const controller = new AbortController(); this.controllers.get(attachment.contentUri)?.abort(); this.controllers.set(attachment.contentUri, controller); this.set({ attachment, status: 'downloading' });
    try { const manifest = await this.directory.manifest(contentId); if (!manifest || manifest.byteLength !== attachment.size) throw new Error('Attachment manifest is unavailable or mismatched'); const providers = await this.directory.providers(contentId); const bytes = await new ContentFetcher(this.cache).download(manifest, providers, { signal: controller.signal, onProgress: progress => this.set({ attachment, status: 'downloading', progress }) }); this.set({ attachment, status: 'complete' }); return bytes; }
    catch (error) { const cancelled = controller.signal.aborted; this.set({ attachment, status: cancelled ? 'cancelled' : 'failed', ...(cancelled ? {} : { error: error instanceof Error ? error.message : 'Attachment transfer failed' }) }); throw error; }
    finally { if (this.controllers.get(attachment.contentUri) === controller) this.controllers.delete(attachment.contentUri); }
  }
  cancel(attachment: MessageAttachment): void { this.controllers.get(attachment.contentUri)?.abort(); }
  retry(attachment: MessageAttachment): Promise<Uint8Array> { return this.download(attachment); }
  private set(value: AttachmentTransferState): void { this.states.set(value.attachment.contentUri, value); this.listeners.forEach(listener => listener(value)); }
}
