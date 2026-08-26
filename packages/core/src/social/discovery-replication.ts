import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import { parseDiscoveryObject, type UnifiedDiscoveryService } from './discovery.js';
import { unsignedObject, type KeystoneObject } from './object-model.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';

export const DISCOVERY_OBJECT_ENVELOPE = 'social.discovery_object';
const MAX_LIFETIME_MS = 10 * 60_000;
const MAX_OBJECT_BYTES = 512 * 1024;
const MAX_SEEN_NONCES = 4096;
export interface DiscoveryReplicationOptions { onAccepted?: (object: KeystoneObject) => void | Promise<void>; }

/**
 * Signed metadata replication over the existing authenticated Transport.
 * It carries references and object metadata only; media chunks continue to use
 * the existing content protocol and no global discovery server is involved.
 */
export class DiscoveryReplicationService {
  private readonly unsubscribe: () => void;
  private readonly seen = new Set<string>();
  private readonly blocked = new Set<NodeId>();
  private acceptedCount = 0;
  private rejectedCount = 0;
  constructor(
    private readonly transport: KeystoneDeliveryInterface,
    private readonly discovery: UnifiedDiscoveryService,
    private readonly crypto: CryptoProvider,
    private readonly security: EnvelopeSecurity,
    private readonly local: DeviceSessionKeys,
    private readonly now: () => number = () => Date.now(),
    private readonly options: DiscoveryReplicationOptions = {},
    private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime())),
  ) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); }
  block(peer: NodeId): void { this.blocked.add(peer); }
  unblock(peer: NodeId): void { this.blocked.delete(peer); }
  stats(): { accepted: number; rejected: number } { return { accepted: this.acceptedCount, rejected: this.rejectedCount }; }
  async publish(peer: NodeId, object: KeystoneObject): Promise<void> {
    if (object.visibility !== 'public') throw new Error('Public discovery accepts only public objects');
    const parsed = parseDiscoveryObject(object);
    if (!parsed || !(await this.crypto.verify(canonicalJson(unsignedObject(parsed)), parsed.signature, parsed.author))) throw new Error('Invalid signed discovery object');
    if (!(await this.protectedSurfaces.evaluate('DISCOVERY', { objectId: parsed.id, value: parsed, content: parsed.payload, text: JSON.stringify(parsed.payload), domain: 'PUBLIC', sourceType: 'discovery', verified: true, authorized: true, sharing: true }))) throw new Error('Discovery object failed mandatory SafetySurfaceGate');
    const encoded = canonicalJson(parsed);
    if (new TextEncoder().encode(encoded).byteLength > MAX_OBJECT_BYTES) throw new Error('Discovery object exceeds protocol limit');
    const unsigned: UnsignedEnvelope = { version: 1, type: DISCOVERY_OBJECT_ENVELOPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body: { object: parsed } };
    await this.transport.connect(peer);
    await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }
  async publishMany(peer: NodeId, objects: readonly KeystoneObject[]): Promise<void> { for (const object of objects) await this.publish(peer, object); }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.type !== DISCOVERY_OBJECT_ENVELOPE || envelope.recipient !== this.local.nodeId || this.blocked.has(envelope.sender)) return;
    const expiresAt = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt - this.now() > MAX_LIFETIME_MS || this.seen.has(envelope.nonce) || !(await this.security.verify(envelope))) { this.rejectedCount++; return; }
    this.seen.add(envelope.nonce);
    if (this.seen.size > MAX_SEEN_NONCES) this.seen.delete(this.seen.values().next().value as string);
    const body = envelope.body && typeof envelope.body === 'object' ? envelope.body as { object?: unknown } : {};
    const object = parseDiscoveryObject(body.object);
    if (!object || object.visibility !== 'public' || !(await this.crypto.verify(canonicalJson(unsignedObject(object)), object.signature, object.author))) { this.rejectedCount++; return; }
    const accepted = await this.discovery.ingest(object, 'public');
    if (accepted) { this.acceptedCount++; await this.options.onAccepted?.(object); } else this.rejectedCount++;
  }
}
