import { type CryptoProvider, verifyCanonical } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import { followObjectSchema, profileObjectSchema, type FollowObject, type ProfileObject, unsignedObject } from './object-model.js';
import { SocialGraphService } from './graph.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';

export const SOCIAL_GRAPH_ENVELOPE = 'social.graph_object';
const MAX_LIFETIME_MS = 10 * 60_000;
const MAX_SEEN_NONCES = 4096;
export type SocialGraphObject = ProfileObject | FollowObject;
export interface SocialGraphReplicationOptions { onAccepted?: (object: SocialGraphObject) => void | Promise<void>; }

/** Sends the original signed Profile/Follow object over the existing authenticated Transport. */
export class SocialGraphReplicationService {
  private readonly unsubscribe: () => void;
  private readonly seen = new Set<string>();
  private readonly blocked = new Set<NodeId>();
  private acceptedCount = 0;
  private rejectedCount = 0;
  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly graph: SocialGraphService, private readonly crypto: CryptoProvider, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now(), private readonly options: SocialGraphReplicationOptions = {}, private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()))) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); }
  block(peer: NodeId): void { this.blocked.add(peer); }
  unblock(peer: NodeId): void { this.blocked.delete(peer); }
  stats(): { accepted: number; rejected: number } { return { accepted: this.acceptedCount, rejected: this.rejectedCount }; }
  async publish(peer: NodeId, object: SocialGraphObject): Promise<void> {
    if (this.blocked.has(peer)) throw new Error('Blocked social graph peer rejected');
    if (object.visibility !== 'public') throw new Error('Social graph replication currently supports public objects only');
    const parsed = parseGraphObject(object); if (!parsed || !(await verifyCanonical(unsignedObject(parsed), parsed.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, parsed.author)))) throw new Error('Invalid signed social graph object');
    if (!(await this.eligible(parsed))) throw new Error('Social graph object failed mandatory SafetySurfaceGate');
    const unsigned: UnsignedEnvelope = { version: 1, type: SOCIAL_GRAPH_ENVELOPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: await this.crypto.randomNonce(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body: { object: parsed } };
    await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) });
  }
  private async eligible(object: SocialGraphObject): Promise<boolean> { return (await this.protectedSurfaces.evaluate('PROFILES', { objectId: object.id, value: object, content: object.payload, text: JSON.stringify(object.payload), domain: 'PUBLIC', sourceType: 'profile', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.type !== SOCIAL_GRAPH_ENVELOPE || envelope.recipient !== this.local.nodeId || this.blocked.has(envelope.sender)) return;
    const expiresAt = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt - this.now() > MAX_LIFETIME_MS || this.seen.has(envelope.nonce) || !(await this.security.verify(envelope))) { this.rejectedCount++; return; }
    this.seen.add(envelope.nonce); if (this.seen.size > MAX_SEEN_NONCES) this.seen.delete(this.seen.values().next().value as string);
    const object = parseGraphObject((envelope.body as { object?: unknown } | undefined)?.object);
    if (!object || object.visibility !== 'public' || !(await verifyCanonical(unsignedObject(object), object.signature, (canonicalBytes, rawSignature) => this.crypto.verify(canonicalBytes, rawSignature, object.author)))) { this.rejectedCount++; return; }
    const accepted = await this.graph.ingest(object); if (accepted) { this.acceptedCount++; await this.options.onAccepted?.(accepted); } else this.rejectedCount++;
  }
}
function parseGraphObject(value: unknown): SocialGraphObject | undefined { const candidate = value && typeof value === 'object' ? value as { type?: unknown } : undefined; if (candidate?.type === 'identity.profile') { const parsed = profileObjectSchema.safeParse(value); return parsed.success ? parsed.data : undefined; } if (candidate?.type === 'follow') { const parsed = followObjectSchema.safeParse(value); return parsed.success ? parsed.data : undefined; } return undefined; }
