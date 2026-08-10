import type { NodeId } from '../types.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';

export type HandoffPayload =
  | { kind: 'clipboard'; text: string }
  | { kind: 'browser_tab'; url: string; title?: string }
  | { kind: 'file_offer'; transferId: string; name: string; size: number; mimeType?: string; sha256?: string };
export interface FileChunk { transferId: string; offset: number; data: string; final: boolean; }
export interface DeviceSyncOptions { localNodeId: NodeId; selfPeers?: readonly NodeId[]; expiresInMs?: number; security?: EnvelopeSecurity; }
export type HandoffHandler = (payload: HandoffPayload, sender: NodeId) => void | Promise<void>;

/** Cross-device context handoff. Only explicitly registered Self peers are routable. */
export class DeviceSync {
  private readonly seenNonces = new Set<string>(); private readonly peers = new Set<NodeId>(); private readonly handlers = new Set<HandoffHandler>(); private readonly chunkHandlers = new Set<(chunk: FileChunk, sender: NodeId) => void | Promise<void>>(); private readonly unsubscribe: () => void;
  constructor(private readonly transport: Transport, private readonly options: DeviceSyncOptions) { (options.selfPeers ?? []).forEach(peer => this.peers.add(peer)); this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope).catch(() => undefined); }); }
  addSelfPeer(peer: NodeId): void { this.peers.add(peer); }
  onPayload(handler: HandoffHandler): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  onFileChunk(handler: (chunk: FileChunk, sender: NodeId) => void | Promise<void>): () => void { this.chunkHandlers.add(handler); return () => this.chunkHandlers.delete(handler); }
  async send(peer: NodeId, payload: HandoffPayload): Promise<void> { this.assertPeer(peer); validatePayload(payload); await this.transport.connect(peer); await this.sendEnvelope(peer, 'handoff.request', payload); }
  sendClipboard(peer: NodeId, text: string): Promise<void> { return this.send(peer, { kind: 'clipboard', text }); }
  sendBrowserTab(peer: NodeId, url: string, title?: string): Promise<void> { return this.send(peer, { kind: 'browser_tab', url, ...(title ? { title } : {}) }); }
  sendFileOffer(peer: NodeId, offer: Extract<HandoffPayload, { kind: 'file_offer' }>): Promise<void> { return this.send(peer, offer); }
  async sendFileChunk(peer: NodeId, chunk: FileChunk): Promise<void> { this.assertPeer(peer); validateChunk(chunk); await this.transport.connect(peer); await this.sendEnvelope(peer, 'handoff.file_chunk', chunk); }
  /** Offer and stream a file without routing bytes through a server. */
  async sendFile(peer: NodeId, offer: Extract<HandoffPayload, { kind: 'file_offer' }>, chunks: AsyncIterable<Uint8Array>, chunkSize = 64 * 1024): Promise<void> {
    this.assertPeer(peer); validatePayload(offer);
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 1024 * 1024) throw new Error('Invalid chunk size');
    await this.send(peer, offer);
    let offset = 0;
    for await (const input of chunks) {
      for (let start = 0; start < input.byteLength; start += chunkSize) {
        const data = input.subarray(start, Math.min(start + chunkSize, input.byteLength));
        await this.sendFileChunk(peer, { transferId: offer.transferId, offset, data: toBase64(data), final: false });
        offset += data.byteLength;
      }
    }
    await this.sendFileChunk(peer, { transferId: offer.transferId, offset, data: '', final: true });
    if (offset !== offer.size) throw new Error(`File size mismatch: expected ${offer.size}, sent ${offset}`);
  }
  async stop(): Promise<void> { this.unsubscribe(); }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.recipient !== this.options.localNodeId || !this.peers.has(envelope.sender)) return;
    if (Date.parse(envelope.expiresAt) <= Date.now() || this.seenNonces.has(envelope.nonce)) return;
    if (this.options.security && !(await this.options.security.verify(envelope))) return;
    this.seenNonces.add(envelope.nonce); if (envelope.type === 'handoff.request') { const payload = envelope.body as HandoffPayload; validatePayload(payload); await Promise.all([...this.handlers].map(handler => handler(payload, envelope.sender))); } else if (envelope.type === 'handoff.file_chunk') { const chunk = validateChunk(envelope.body); await Promise.all([...this.chunkHandlers].map(handler => handler(chunk, envelope.sender))); } }
  private async sendEnvelope(peer: NodeId, type: string, body: unknown): Promise<void> {
    const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.options.localNodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + (this.options.expiresInMs ?? 60_000)).toISOString(), body };
    const envelope: Envelope = { ...unsigned, signature: this.options.security ? await this.options.security.sign(unsigned) : '' };
    await this.transport.send(peer, envelope);
  }
  private assertPeer(peer: NodeId): void { if (!this.peers.has(peer)) throw new Error(`Peer is not a trusted Self device: ${peer}`); }
}
function validatePayload(payload: HandoffPayload): void { if (!payload || typeof payload !== 'object') throw new Error('Invalid handoff payload'); if (payload.kind === 'clipboard') { if (typeof payload.text !== 'string' || payload.text.length > 1_000_000) throw new Error('Invalid clipboard payload'); return; } if (payload.kind === 'browser_tab') { if (typeof payload.url !== 'string' || !/^https?:\/\//i.test(payload.url)) throw new Error('Only http(s) browser tabs may be handed off'); return; } if (payload.kind === 'file_offer') { if (!payload.transferId || !payload.name || !Number.isSafeInteger(payload.size) || payload.size < 0 || payload.size > 10 * 1024 ** 3) throw new Error('Invalid file offer'); return; } throw new Error('Unsupported handoff payload'); }
function validateChunk(value: unknown): FileChunk { if (!value || typeof value !== 'object') throw new Error('Invalid file chunk'); const v = value as Record<string, unknown>; if (typeof v.transferId !== 'string' || typeof v.offset !== 'number' || !Number.isSafeInteger(v.offset) || v.offset < 0 || typeof v.data !== 'string' || typeof v.final !== 'boolean') throw new Error('Invalid file chunk'); try { const bytes = fromBase64(v.data); if (bytes.length > 1024 * 1024) throw new Error('chunk too large'); } catch { throw new Error('Invalid file chunk data'); } return { transferId: v.transferId, offset: v.offset, data: v.data, final: v.final } as FileChunk; }
function toBase64(value: Uint8Array): string { let binary = ''; value.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function fromBase64(value: string): Uint8Array { const binary = atob(value); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
