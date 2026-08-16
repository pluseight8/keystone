import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';
import type { NodeId } from '../types.js';
import type { MusicObject } from './music.js';
import { MusicService } from './music.js';

const TYPE = 'social.music_object'; const MAX_LIFETIME_MS = 10 * 60_000;
export interface MusicReplicationOptions { onAccepted?: (object: MusicObject) => void | Promise<void>; }
/** Sends the original signed Music object. References in chat/community remain its stable object ID. */
export class MusicReplicationService {
  private readonly unsubscribe: () => void;
  constructor(private readonly transport: Transport, private readonly music: MusicService, private readonly security: EnvelopeSecurity, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now(), private readonly options: MusicReplicationOptions = {}) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); }
  async publish(peer: NodeId, object: MusicObject): Promise<void> { if (object.visibility !== 'public') throw new Error('Music replication currently supports public objects only'); const unsigned: UnsignedEnvelope = { version: 1, type: TYPE, id: crypto.randomUUID(), sender: this.local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(), body: { object } }; await this.transport.connect(peer); await this.transport.send(peer, { ...unsigned, signature: await this.security.sign(unsigned) }); }
  private async receive(envelope: Envelope): Promise<void> { if (envelope.type !== TYPE || envelope.recipient !== this.local.nodeId) return; const expiresAt = Date.parse(envelope.expiresAt); if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt - this.now() > MAX_LIFETIME_MS || !(await this.security.verify(envelope))) return; const object = (envelope.body as { object?: unknown } | undefined)?.object; if (object) { const accepted = await this.music.ingest(object); if (accepted) await this.options.onAccepted?.(accepted); } }
}
