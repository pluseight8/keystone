import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';
import type { NodeId } from '../types.js';
import { LiveBroadcastService, type LiveObject } from './streams.js';

const TYPE = 'social.live_object'; const MAX_LIFETIME_MS = 10 * 60_000;
export interface LiveReplicationOptions { onAccepted?: (object: LiveObject) => void | Promise<void>; }
/** Replicates signed lifecycle/chat objects; media remains on the existing WebRTC host boundary. */
export class LiveReplicationService {
  private readonly unsubscribe: () => void;
  constructor(private readonly transport: Transport, private readonly live: LiveBroadcastService, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now(), private readonly blocked: ReadonlySet<string> = new Set(), private readonly options: LiveReplicationOptions = {}) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close() { this.unsubscribe(); }
  async publish(peer: NodeId, object: LiveObject): Promise<void> { if (this.blocked.has(peer)) throw new Error('Blocked live peer rejected'); if (object.visibility === 'contacts') throw new Error('Contacts-only Live replication requires encrypted group objects'); if (object.visibility === 'community' && object.type === 'live_broadcast' && !object.payload.communityId) throw new Error('Community Live requires a community reference'); const unsigned: UnsignedEnvelope = { version: 1, type: TYPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body: { object } }; await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); }
  private async receive(envelope: Envelope) { if (envelope.type !== TYPE || envelope.recipient !== this.local.nodeId || this.blocked.has(envelope.sender)) return; const expiresAt = Date.parse(envelope.expiresAt); if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt - this.now() > MAX_LIFETIME_MS || !(await this.security.verify(envelope))) return; const object = (envelope.body as { object?: unknown } | undefined)?.object; if (!object || typeof object !== 'object' || (object as { visibility?: unknown }).visibility === 'contacts') return; if ((object as { visibility?: unknown }).visibility === 'community' && (object as { type?: unknown; payload?: { communityId?: unknown } }).type === 'live_broadcast' && !(object as { payload?: { communityId?: unknown } }).payload?.communityId) return; const accepted = await this.live.ingest(object); if (accepted) await this.options.onAccepted?.(accepted); }
}
