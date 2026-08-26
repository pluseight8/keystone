import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import { FileService } from './files.js';
import { fileObjectSchema, unsignedObject, type FileObject } from './object-model.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';

const TYPE = 'social.file_object';
const MAX_LIFETIME_MS = 10 * 60_000;
const MAX_OBJECT_BYTES = 512 * 1024;

export interface FileReplicationOptions { onAccepted?: (file: FileObject) => void | Promise<void>; }

/** Direct signed FileObject exchange. It never carries file bytes; providers serve content chunks separately. */
export class FileReplicationService {
  private readonly unsubscribe: () => void;
  private readonly seen = new Set<string>();
  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly files: FileService, private readonly crypto: CryptoProvider, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now(), private readonly options: FileReplicationOptions = {}, private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()))) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); }
  async publish(peer: NodeId, file: FileObject): Promise<void> {
    const parsed = fileObjectSchema.parse(file); if (!(await this.crypto.verify(canonicalJson(unsignedObject(parsed)), parsed.signature, parsed.author))) throw new Error('Invalid signed FileObject');
    if (!(await this.eligible(parsed))) throw new Error('FileObject failed mandatory SafetySurfaceGate');
    const encoded = canonicalJson(parsed); if (new TextEncoder().encode(encoded).byteLength > MAX_OBJECT_BYTES) throw new Error('FileObject exceeds protocol limit');
    const unsigned: UnsignedEnvelope = { version: 1, type: TYPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body: { file: parsed } };
    await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }
  private async eligible(file: FileObject): Promise<boolean> { if (file.visibility === 'private') return false; const domain = file.visibility === 'public' ? 'PUBLIC' as const : file.visibility === 'community' ? 'COMMUNITY' as const : 'DIRECT_SHARED' as const; return (await this.protectedSurfaces.evaluate('FILES', { objectId: file.id, value: file, content: file.payload, text: JSON.stringify(file.payload), domain, sourceType: 'file', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.type !== TYPE || envelope.recipient !== this.local.nodeId) return; const expiry = Date.parse(envelope.expiresAt); if (!Number.isFinite(expiry) || expiry <= this.now() || expiry - this.now() > MAX_LIFETIME_MS || this.seen.has(envelope.nonce) || !(await this.security.verify(envelope))) return; this.seen.add(envelope.nonce); if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value as string); const candidate = envelope.body && typeof envelope.body === 'object' ? (envelope.body as { file?: unknown }).file : undefined; const file = fileObjectSchema.safeParse(candidate); if (!file.success || !(await this.files.ingest(file.data))) return; await this.options.onAccepted?.(file.data);
  }
}
