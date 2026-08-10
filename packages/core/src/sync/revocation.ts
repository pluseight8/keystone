import * as Y from 'yjs';
import type { NodeId } from '../types.js';

export interface RevocationRecord { nodeId: NodeId; revokedAt: string; revokedBy: NodeId; reason: string; signature: string; }
export interface RevocationSecurity { sign(record: Omit<RevocationRecord, 'signature'>): Promise<string>; verify(record: RevocationRecord): Promise<boolean>; }

/** A CRDT grow-only blacklist. Remote deletion cannot resurrect a device. */
export class DeviceRevocation {
  private readonly map: Y.Map<RevocationRecord>; private readonly seen = new Map<NodeId, RevocationRecord>();
  constructor(document: Y.Doc, private readonly localNodeId: NodeId, private readonly security: RevocationSecurity) { this.map = document.getMap('deviceBlacklist.v1'); this.capture(); this.map.observe(this.onChange); }
  isRevoked(nodeId: NodeId): boolean { return this.seen.has(nodeId); }
  get records(): readonly RevocationRecord[] { return [...this.seen.values()]; }
  async revoke(nodeId: NodeId, reason: string): Promise<RevocationRecord> {
    if (!nodeId || nodeId === this.localNodeId) throw new Error('Cannot revoke the local or empty node id');
    if (!reason.trim()) throw new Error('Revocation reason is required');
    const unsigned = { nodeId, revokedAt: new Date().toISOString(), revokedBy: this.localNodeId, reason: reason.trim() };
    const record = { ...unsigned, signature: await this.security.sign(unsigned) }; this.seen.set(nodeId, record); this.map.set(nodeId, record); return record;
  }
  async validateRemoteRecords(): Promise<void> { for (const [id, record] of this.map) { if (record.nodeId !== id || !(await this.security.verify(record))) { this.map.delete(id); continue; } this.seen.set(id, record); } }
  destroy(): void { this.map.unobserve(this.onChange); }
  private readonly onChange = (): void => { this.capture(); for (const [id, record] of this.seen) if (!this.map.has(id)) this.map.set(id, record); };
  private capture(): void { for (const [id, record] of this.map) if (record?.nodeId === id) this.seen.set(id, record); }
}
export interface RevocationGuard { isRevoked(nodeId: NodeId): boolean; }
