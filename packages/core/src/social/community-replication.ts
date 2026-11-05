import type { DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';
import type { NodeId } from '../types.js';
import type { CommunityEvent } from './community-storage.js';
import { CommunityService } from './communities.js';

const TYPE = 'social.community_event';
const MAX_LIFETIME_MS = 10 * 60_000;
const MAX_SEEN_NONCES = 4_096;
export interface CommunityReplicationOptions { onAccepted?: (event: CommunityEvent) => void | Promise<void>; }
export interface CommunityReplicationStats { accepted: number; rejected: number; duplicate: number; }

/**
 * Routes existing signed community objects over the existing signed envelope
 * transport. CommunityService remains the only object validator and authority
 * projector; this class adds no parallel community protocol.
 */
export class CommunityReplicationService {
  private readonly unsubscribe: () => void;
  private readonly seen = new Set<string>();
  private readonly blocked = new Set<NodeId>();
  private acceptedCount = 0;
  private rejectedCount = 0;
  private duplicateCount = 0;

  constructor(
    private readonly transport: KeystoneDeliveryInterface,
    private readonly communities: CommunityService,
    private readonly security: EnvelopeSecurity,
    private readonly local: DeviceSessionKeys,
    private readonly now: () => number = () => Date.now(),
    private readonly options: CommunityReplicationOptions = {},
  ) {
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); });
  }

  close(): void { this.unsubscribe(); }
  stats(): CommunityReplicationStats { return { accepted: this.acceptedCount, rejected: this.rejectedCount, duplicate: this.duplicateCount }; }
  block(peer: NodeId): void { this.blocked.add(peer); }
  unblock(peer: NodeId): void { this.blocked.delete(peer); }

  async publish(peer: NodeId, event: CommunityEvent): Promise<void> {
    if (this.blocked.has(peer)) throw new Error('Blocked community peer rejected');
    const checked = await this.communities.ingest(event);
    if (!checked) throw new Error('Invalid signed community event');
    await this.assertPublicCommunity(event);
    const unsigned: UnsignedEnvelope = {
      version: 1,
      type: TYPE,
      id: crypto.randomUUID(),
      sender: this.local.nodeId,
      recipient: peer,
      nonce: crypto.randomUUID(),
      expiresAt: new Date(this.now() + MAX_LIFETIME_MS).toISOString(),
      body: { event },
    };
    const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) };
    await this.transport.connect(peer);
    await this.transport.send(peer, envelope);
  }

  /**
   * Community payloads currently travel in a signed, but not group-encrypted,
   * envelope. Do not expose a contacts-only community until group-key
   * distribution and rotation exist in the protocol.
   */
  private async assertPublicCommunity(event: CommunityEvent): Promise<void> {
    const communityId = event.payload.communityId;
    const community = event.type === 'community'
      ? event
      : (await this.communities.projection(communityId))?.community;
    if (!community) throw new Error('Community is not known on this device yet');
    if (community.visibility !== 'public') {
      throw new Error('Community replication currently supports public communities only');
    }
  }

  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.type !== TYPE || envelope.recipient !== this.local.nodeId || this.blocked.has(envelope.sender)) return;
    const expiry = Date.parse(envelope.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= this.now() || expiry - this.now() > MAX_LIFETIME_MS) { this.rejectedCount++; return; }
    if (this.seen.has(envelope.nonce)) { this.duplicateCount++; return; }
    if (!(await this.security.verify(envelope))) { this.rejectedCount++; return; }
    this.seen.add(envelope.nonce); if (this.seen.size > MAX_SEEN_NONCES) this.seen.delete(this.seen.values().next().value as string);
    const body = envelope.body as { event?: unknown } | undefined;
    if (!body?.event) { this.rejectedCount++; return; }
    const accepted = await this.communities.ingest(body.event); if (accepted) { this.acceptedCount++; await this.options.onAccepted?.(accepted); } else this.rejectedCount++;
  }
}
