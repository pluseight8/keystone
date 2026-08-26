import { canonicalJson, type CryptoProvider } from '../crypto.js';
import type { DeviceSessionKeys } from '../identity.js';
import type { NodeId } from '../types.js';
import { KEYSTONE_OBJECT_VERSION, type FollowObject, followObjectSchema, type ObjectVisibility, type ProfileObject, type ProfilePayload, profileObjectSchema, profilePayloadSchema, unsignedObject } from './object-model.js';
import type { LocalRelationship, SocialGraphStorage } from './storage.js';
import { SafetyRuntime, SafetySurfaceGate } from '../security/content-safety.js';
import { MandatorySafetySurfaceRegistry } from '../security/safety-surfaces.js';

export type SocialGraphEvent = Readonly<{ kind: 'profile' | 'follow'; object: ProfileObject | FollowObject }>;

/** Local-first social graph. Remote objects are accepted only after schema and author-signature verification. */
export class SocialGraphService {
  private readonly listeners = new Set<(event: SocialGraphEvent) => void>();
  private lastCreatedAt = 0;
  constructor(private readonly storage: SocialGraphStorage, private readonly crypto: CryptoProvider, private readonly local: DeviceSessionKeys, private readonly now: () => number = () => Date.now(), private readonly protectedSurfaces = new MandatorySafetySurfaceRegistry(new SafetySurfaceGate(new SafetyRuntime()))) {}
  subscribe(listener: (event: SocialGraphEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async publishProfile(payload: ProfilePayload, visibility: Extract<ObjectVisibility, 'contacts' | 'public'> = 'public'): Promise<ProfileObject> {
    const previous = await this.storage.getProfile(this.local.nodeId); const timestamp = Math.max(this.now(), this.lastCreatedAt + 1); this.lastCreatedAt = timestamp; const updatedAt = new Date(timestamp).toISOString();
    const parsedPayload = profilePayloadSchema.parse(payload); const normalizedPayload = { ...parsedPayload, joinedAt: parsedPayload.joinedAt ?? previous?.payload.joinedAt ?? previous?.createdAt ?? updatedAt };
    const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'identity.profile' as const, id: crypto.randomUUID(), author: this.local.nodeId, createdAt: updatedAt, visibility, references: [], payload: normalizedPayload, ...(previous ? { updatedAt, supersedes: previous.id } : {}) };
    const profile: ProfileObject = profileObjectSchema.parse({ ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }); if (!await this.profileEligible(profile)) throw new Error('Profile failed mandatory SafetySurfaceGate'); await this.storage.saveProfile(profile); this.emit({ kind: 'profile', object: profile }); return profile;
  }
  async follow(target: NodeId, visibility: Extract<ObjectVisibility, 'contacts' | 'public'> = 'public'): Promise<FollowObject> { return this.publishFollow(target, 'follow', visibility); }
  async unfollow(target: NodeId, visibility: Extract<ObjectVisibility, 'contacts' | 'public'> = 'public'): Promise<FollowObject> { return this.publishFollow(target, 'unfollow', visibility); }
  async ingest(value: unknown): Promise<ProfileObject | FollowObject | undefined> {
    const candidate = value && typeof value === 'object' ? value as { type?: unknown } : undefined; if (!candidate) return undefined;
    if (candidate.type === 'identity.profile') { const profile = profileObjectSchema.safeParse(value); if (!profile.success || !(await this.verify(profile.data)) || !await this.protectedSurfaces.evaluate('PROFILES', { objectId: profile.data.id, value: profile.data, content: profile.data.payload, text: JSON.stringify(profile.data.payload), domain: profile.data.visibility === 'public' ? 'PUBLIC' : 'DIRECT_SHARED', sourceType: 'profile', verified: true, authorized: true, sharing: true }) || !(await this.storage.saveProfile(profile.data))) return undefined; this.emit({ kind: 'profile', object: profile.data }); return profile.data; }
    if (candidate.type === 'follow') { const follow = followObjectSchema.safeParse(value); if (!follow.success || follow.data.author === follow.data.payload.target || !(await this.verify(follow.data)) || !(await this.protectedSurfaces.evaluate('PROFILES', { objectId: follow.data.id, value: follow.data, content: follow.data.payload, text: JSON.stringify(follow.data.payload), domain: follow.data.visibility === 'public' ? 'PUBLIC' : 'DIRECT_SHARED', sourceType: 'profile', verified: true, authorized: true, sharing: true })) || (await this.relationship(follow.data.author)).blocked || !(await this.storage.saveFollow(follow.data))) return undefined; this.emit({ kind: 'follow', object: follow.data }); return follow.data; }
    return undefined;
  }
  async profile(identity: NodeId): Promise<ProfileObject | undefined> { const value = await this.storage.getProfile(identity); if (!value) return undefined; return await this.profileEligible(value) ? value : undefined; }
  async following(identity = this.local.nodeId): Promise<readonly NodeId[]> { const values = await this.storage.follows(identity); const safe = (await Promise.all(values.map(async value => await this.followEligible(value) ? value : undefined))).filter((value): value is FollowObject => !!value); return this.filterBlocked(this.resolve(safe)); }
  async followers(identity = this.local.nodeId): Promise<readonly NodeId[]> {
    const all = await this.storage.followers(identity); const safe = (await Promise.all(all.map(async value => await this.followEligible(value) ? value : undefined))).filter((value): value is FollowObject => !!value); const byAuthor = new Map<NodeId, FollowObject>(); for (const event of safe) { const old = byAuthor.get(event.author); if (!old || compare(old, event) < 0) byAuthor.set(event.author, event); } return this.filterBlocked([...byAuthor.values()].filter(event => event.payload.action === 'follow').map(event => event.author).sort());
  }
  async mutuals(identity = this.local.nodeId): Promise<readonly NodeId[]> { const [following, followers] = await Promise.all([this.following(identity), this.followers(identity)]); const right = new Set(followers); return following.filter(value => right.has(value)); }
  async mutualFollowing(target: NodeId, identity = this.local.nodeId): Promise<boolean> { const [left, right] = await Promise.all([this.following(identity), this.following(target)]); return left.includes(target) && right.includes(identity); }
  async relationship(target: NodeId): Promise<LocalRelationship> { return (await this.storage.getLocalRelationship(target)) ?? { target, blocked: false, muted: false, trust: 'unknown', updatedAt: new Date(this.now()).toISOString() }; }
  async isBlocked(target: NodeId): Promise<boolean> { return (await this.relationship(target)).blocked; }
  async isMuted(target: NodeId): Promise<boolean> { return (await this.relationship(target)).muted; }
  async setBlocked(target: NodeId, blocked: boolean): Promise<LocalRelationship> { return this.setLocal(target, { blocked }); }
  async setMuted(target: NodeId, muted: boolean): Promise<LocalRelationship> { return this.setLocal(target, { muted }); }
  async setTrust(target: NodeId, trust: LocalRelationship['trust']): Promise<LocalRelationship> { return this.setLocal(target, { trust }); }
  private async publishFollow(target: NodeId, action: 'follow' | 'unfollow', visibility: Extract<ObjectVisibility, 'contacts' | 'public'>): Promise<FollowObject> {
    if (!target || target === this.local.nodeId) throw new Error('Cannot follow this identity'); if (action === 'follow' && (await this.relationship(target)).blocked) throw new Error('Cannot follow a blocked identity'); const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'follow' as const, id: crypto.randomUUID(), author: this.local.nodeId, createdAt: new Date(this.now()).toISOString(), visibility, references: [], payload: { target, action } };
    const follow: FollowObject = followObjectSchema.parse({ ...unsigned, signature: await this.crypto.sign(canonicalJson(unsigned), this.local.privateKey) }); if (!await this.followEligible(follow)) throw new Error('Follow event failed mandatory SafetySurfaceGate'); await this.storage.saveFollow(follow); this.emit({ kind: 'follow', object: follow }); return follow;
  }
  private async verify(value: ProfileObject | FollowObject): Promise<boolean> { return this.crypto.verify(canonicalJson(unsignedObject(value)), value.signature, value.author); }
  private async setLocal(target: NodeId, changes: Partial<Pick<LocalRelationship, 'blocked' | 'muted' | 'trust'>>): Promise<LocalRelationship> { if (!target || target === this.local.nodeId) throw new Error('Invalid local relationship target'); const current = await this.relationship(target); const value = { ...current, ...changes, updatedAt: new Date(this.now()).toISOString() }; await this.storage.saveLocalRelationship(value); return value; }
  private async filterBlocked(ids: readonly NodeId[]): Promise<readonly NodeId[]> { const values = await Promise.all(ids.map(async id => (await this.relationship(id)).blocked ? undefined : id)); return values.filter((value): value is NodeId => !!value); }
  private async profileEligible(value: ProfileObject): Promise<boolean> { const domain = value.visibility === 'public' ? 'PUBLIC' as const : 'DIRECT_SHARED' as const; return (await this.protectedSurfaces.evaluate('PROFILES', { objectId: value.id, value, content: value.payload, text: JSON.stringify(value.payload), domain, sourceType: 'profile', verified: true, authorized: true, sharing: true })) !== undefined; }
  private async followEligible(value: FollowObject): Promise<boolean> { const domain = value.visibility === 'public' ? 'PUBLIC' as const : 'DIRECT_SHARED' as const; return (await this.protectedSurfaces.evaluate('PROFILES', { objectId: value.id, value, content: value.payload, text: JSON.stringify(value.payload), domain, sourceType: 'profile', verified: true, authorized: true, sharing: true })) !== undefined; }
  private emit(event: SocialGraphEvent): void { this.listeners.forEach(listener => listener(event)); }
  private resolve(events: readonly FollowObject[]): readonly NodeId[] { const latest = new Map<NodeId, FollowObject>(); for (const event of events) { const old = latest.get(event.payload.target); if (!old || compare(old, event) < 0) latest.set(event.payload.target, event); } return [...latest.values()].filter(event => event.payload.action === 'follow').map(event => event.payload.target).sort(); }
}
function compare(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number { return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); }
