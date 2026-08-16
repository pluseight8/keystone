export type NodeId = string;
export type Role = 'owner' | 'family' | 'friend' | 'agent' | 'custom' | 'Self';
/** Keystone is non-commercial: no payment or purchase capability exists. */
export type Permission = 'read_profile' | 'read_address' | 'send_message' | 'start_call';
export interface NodeIdentity { nodeId: NodeId; publicKey: string; createdAt: string; }
export interface Capability { id: string; issuer: NodeId; subject: NodeId; role: Role; permissions: Permission[]; expiresAt: string; }
export interface DisclosureRequest { id: string; requester: NodeId; owner: NodeId; fields: string[]; purpose: string; actionHash: string; nonce: string; expiresAt: string; }
export interface SignedApproval { requestId: string; signer: NodeId; actionHash: string; approvedAt: string; signature: string; }
export interface AuditEvent { id: string; type: string; actor: NodeId; timestamp: string; metadata: Record<string, string>; }
