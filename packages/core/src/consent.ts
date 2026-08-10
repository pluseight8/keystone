import type { AuditEvent, DisclosureRequest, SignedApproval } from './types.js';
import type { CryptoProvider } from './crypto.js';
export type ConsentAction = 'crdt_sync' | 'handoff' | 'clipboard' | 'browser_tab' | 'file_offer' | 'os_automation' | 'data_disclosure' | 'external_side_effect' | 'addon_life_map_read' | 'addon_p2p_request';
export type ConsentDecision = { mode: 'implicit'; allowed: true } | { mode: 'double_confirmation'; allowed: false };
export class DoubleConfirmation {
  private readonly consumedNonces = new Set<string>();
  constructor(private readonly crypto: CryptoProvider, private readonly audit: AuditEvent[] = [], private readonly now: () => number = Date.now, private readonly maxTtlMs = 5 * 60_000) {}
  async create(request: Omit<DisclosureRequest, 'id' | 'nonce'>): Promise<DisclosureRequest> { const expiresAt = Date.parse(request.expiresAt); if (!Number.isFinite(expiresAt) || expiresAt <= this.now() || expiresAt - this.now() > this.maxTtlMs) throw new Error('Disclosure request TTL is invalid'); return { ...request, id: await this.crypto.randomNonce(), nonce: await this.crypto.randomNonce() }; }
  async approveOwner(request: DisclosureRequest, signer: string, privateKey: string): Promise<SignedApproval> { return this.approve(request, signer, privateKey, 'owner_approved'); }
  async approveRequester(request: DisclosureRequest, signer: string, privateKey: string): Promise<SignedApproval> { return this.approve(request, signer, privateKey, 'requester_approved'); }
  async authorize(request: DisclosureRequest, owner: SignedApproval, requester: SignedApproval): Promise<boolean> {
    const value = `${request.id}|${request.actionHash}|${request.nonce}`;
    const valid = owner.signer === request.owner && requester.signer === request.requester &&
      owner.requestId === request.id && requester.requestId === request.id &&
      owner.actionHash === request.actionHash && requester.actionHash === request.actionHash &&
      await this.crypto.verify(value, owner.signature, owner.signer) && await this.crypto.verify(value, requester.signature, requester.signer) &&
      Date.parse(request.expiresAt) > this.now() && Date.parse(request.expiresAt) - this.now() <= this.maxTtlMs && !this.consumedNonces.has(request.nonce);
    if (valid) { this.consumedNonces.add(request.nonce); this.audit.push({ id: await this.crypto.randomNonce(), type: 'disclosure_authorized', actor: requester.signer, timestamp: new Date(this.now()).toISOString(), metadata: { requestId: request.id } }); }
    return valid;
  }
  /** Returns true for actions that must be gated by the target device's swipe UI. */
  requiresDoubleConfirmation(role: import('./types.js').Role, action: ConsentAction): boolean {
    return !(role === 'Self' && ['crdt_sync','handoff','clipboard','browser_tab','file_offer'].includes(action));
  }
  requiresConfirmation(role: import('./types.js').Role, action: ConsentAction): boolean { return this.requiresDoubleConfirmation(role, action); }
  /** Self is convenience, not authority: only non-critical data-plane actions bypass UI. */
  async evaluateNodeAction(input: { actor: string; role: import('./types.js').Role; action: ConsentAction; target?: string }): Promise<ConsentDecision> {
    const implicit = !this.requiresDoubleConfirmation(input.role, input.action);
    if (implicit) { this.audit.push({ id: await this.crypto.randomNonce(), type:'implicit_trust_authorized', actor:input.actor, timestamp:new Date(this.now()).toISOString(), metadata:{ action:input.action, ...(input.target ? { target:input.target } : {}) } }); return { mode:'implicit', allowed:true }; }
    this.audit.push({ id: await this.crypto.randomNonce(), type:'double_confirmation_required', actor:input.actor, timestamp:new Date(this.now()).toISOString(), metadata:{ action:input.action, ...(input.target ? { target:input.target } : {}) } }); return { mode:'double_confirmation', allowed:false };
  }
  /** Addon data/P2P access is never implicitly trusted, including on Self nodes. */
  async evaluateAddonAction(input: { addonId: string; addonName: string; action: 'addon_life_map_read' | 'addon_p2p_request' }): Promise<ConsentDecision> {
    this.audit.push({ id: await this.crypto.randomNonce(), type:'double_confirmation_required', actor:input.addonId, timestamp:new Date(this.now()).toISOString(), metadata:{ action:input.action, addonName:input.addonName } });
    return { mode:'double_confirmation', allowed:false };
  }
  getAudit(): readonly AuditEvent[] { return this.audit; }
  private async approve(request: DisclosureRequest, signer: string, privateKey: string, type: string): Promise<SignedApproval> { if (Date.parse(request.expiresAt) <= this.now()) throw new Error('Disclosure request expired'); const value = `${request.id}|${request.actionHash}|${request.nonce}`; const approval = { requestId: request.id, signer, actionHash: request.actionHash, approvedAt: new Date(this.now()).toISOString(), signature: await this.crypto.sign(value, privateKey) }; this.audit.push({ id: await this.crypto.randomNonce(), type, actor: signer, timestamp: approval.approvedAt, metadata: { requestId: request.id } }); return approval; }
}
