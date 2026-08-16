import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, Transport } from '../transport.js';
import type { NodeId } from '../types.js';
import { CommunityReplicationService } from '../social/community-replication.js';
import { PersistentCommunityStorage } from '../social/community-storage.js';
import { CommunityService } from '../social/communities.js';
import { ContactEnvelopeSecurity, DirectMessageService, SodiumDirectMessageCipher, type SocialContact } from '../social/messaging.js';
import { GroupConversationService } from '../social/conversations.js';
import { ContentCache } from '../social/content.js';
import { LocalContentStore, MusicService, PersistentMusicStorage } from '../social/music.js';
import { MusicReplicationService } from '../social/music-replication.js';
import { PersistentVideoStorage, VideoContentStore, VideoService } from '../social/video.js';
import { VideoReplicationService } from '../social/video-replication.js';
import { LiveBroadcastService, PersistentLiveStorage } from '../social/streams.js';
import { LiveReplicationService } from '../social/live-replication.js';
import { DiscoveryReplicationService } from '../social/discovery-replication.js';
import { PersistentDiscoveryStorage, UnifiedDiscoveryService } from '../social/discovery.js';
import { PersistentSocialStorage, type EncryptedSocialStateStore } from '../social/storage.js';
import { SocialGraphService } from '../social/graph.js';
import { SocialGraphReplicationService } from '../social/graph-replication.js';
import { NotificationService, PersistentNotificationStorage } from '../social/notifications.js';
import { PersistentPrivateCommunityStateStorage, PrivateCommunityReplicationService, PrivateCommunityService } from '../social/private-communities.js';
import { FileService, FileStorageManager, PersistentFileStorage } from '../social/files.js';
import { FileReplicationService } from '../social/file-replication.js';
import { AgentVisitService } from '../ai/visits.js';
import { AgentMailbox } from '../ai/agent-social.js';
import { PersistentSharedSpaceStateStore, SharedSpaceService } from '../social/spaces.js';

export type QueuedEnvelope = Readonly<{ from: NodeId; to: NodeId; envelope: Envelope }>;

/** A deterministic network adapter at the Transport boundary. It never mocks cryptography, envelopes, or application services. */
export class ControlledNetwork {
  private readonly endpoints = new Map<NodeId, ControlledTransport>();
  private readonly online = new Set<NodeId>();
  private readonly blockedLinks = new Set<string>();
  private queued: QueuedEnvelope[] = [];
  private readonly sent: QueuedEnvelope[] = [];
  private paused = false;

  register(transport: ControlledTransport): void { this.endpoints.set(transport.nodeId, transport); this.online.add(transport.nodeId); }
  unregister(nodeId: NodeId): void { this.endpoints.delete(nodeId); this.online.delete(nodeId); }
  setOnline(nodeId: NodeId, online: boolean): void { if (online) this.online.add(nodeId); else this.online.delete(nodeId); }
  partition(a: NodeId, b: NodeId, blocked = true): void { const key = link(a, b); if (blocked) this.blockedLinks.add(key); else this.blockedLinks.delete(key); }
  pauseDelivery(paused = true): void { this.paused = paused; }
  pending(): readonly QueuedEnvelope[] { return this.queued.map(value => structuredClone(value)); }
  history(): readonly QueuedEnvelope[] { return this.sent.map(value => structuredClone(value)); }
  clearPending(): void { this.queued = []; }
  async drain(order?: readonly number[]): Promise<void> {
    const values = this.queued; this.queued = [];
    const sequence = order ? order.map(index => values[index]).filter((value): value is QueuedEnvelope => !!value) : values;
    for (const value of sequence) this.deliver(value);
    await settle();
  }
  inject(to: NodeId, envelope: Envelope): void { this.endpoints.get(to)?.deliver(structuredClone(envelope)); }
  async connect(from: NodeId, to: NodeId): Promise<void> { if (!this.reachable(from, to)) throw new Error('peer is offline or partitioned'); }
  async transmit(from: NodeId, to: NodeId, envelope: Envelope): Promise<void> {
    if (!this.reachable(from, to)) throw new Error('peer is offline or partitioned');
    const value = { from, to, envelope: structuredClone(envelope) }; this.sent.push(value);
    if (this.paused) this.queued.push(value); else this.deliver(value);
  }
  private deliver(value: QueuedEnvelope): void { this.endpoints.get(value.to)?.deliver(structuredClone(value.envelope)); }
  private reachable(a: NodeId, b: NodeId): boolean { return this.online.has(a) && this.online.has(b) && this.endpoints.has(b) && !this.blockedLinks.has(link(a, b)); }
}

export class ControlledTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: NodeId, private readonly network: ControlledNetwork) { network.register(this); }
  async connect(peer: NodeId): Promise<void> { await this.network.connect(this.nodeId, peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: NodeId, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: NodeId | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
    const peer = typeof peerOrEnvelope === 'string' ? peerOrEnvelope : envelope.recipient;
    if (envelope.sender !== this.nodeId || envelope.recipient !== peer) throw new Error('transport envelope identity mismatch');
    await this.network.transmit(this.nodeId, peer, envelope);
  }
  onMessage(handler: (envelope: Envelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: NodeId): boolean { return true; }
  async close(): Promise<void> { this.handlers.clear(); this.network.unregister(this.nodeId); }
  deliver(envelope: Envelope): void { this.handlers.forEach(handler => handler(envelope)); }
}

/** Test-only durable backend: atomic JSON files make restart and crash tests use the production persistence adapter. */
export class FileTestStateStore implements EncryptedSocialStateStore {
  constructor(private readonly path: string) {}
  async read(): Promise<unknown | undefined> { try { return JSON.parse(await readFile(this.path, 'utf8')); } catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; } }
  async write(value: unknown): Promise<void> { const temporary = `${this.path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, this.path); }
}

export type DistributedNode = {
  readonly name: string;
  readonly dataDir: string;
  readonly keys: DeviceSessionKeys;
  readonly messages: DirectMessageService;
  readonly groups: GroupConversationService;
  readonly messageStorage: PersistentSocialStorage;
  readonly graph: SocialGraphService;
  readonly graphReplication: SocialGraphReplicationService;
  readonly notifications: NotificationService;
  readonly communities: CommunityService;
  readonly communityReplication: CommunityReplicationService;
  readonly privateCommunities: PrivateCommunityService;
  readonly privateCommunityReplication: PrivateCommunityReplicationService;
  readonly music: MusicService;
  readonly musicReplication: MusicReplicationService;
  readonly content: LocalContentStore;
  readonly videos: VideoService;
  readonly videoContent: VideoContentStore;
  readonly videoReplication: VideoReplicationService;
  readonly live: LiveBroadcastService;
  readonly liveReplication: LiveReplicationService;
  readonly discovery: UnifiedDiscoveryService;
  readonly discoveryReplication: DiscoveryReplicationService;
  readonly files: FileService;
  readonly fileStorage: PersistentFileStorage;
  readonly filePolicy: FileStorageManager;
  readonly fileReplication: FileReplicationService;
  readonly visits: AgentVisitService;
  readonly agentSocial: AgentMailbox;
  readonly spaces: SharedSpaceService;
  readonly transport: ControlledTransport;
  close(): Promise<void>;
};

/** Creates independent identities, directories, durable stores, runtime services, and transport endpoints for integration tests. */
export class DistributedHarness {
  readonly network = new ControlledNetwork();
  private readonly nodes = new Map<string, DistributedNode>();
  private readonly keys = new Map<string, DeviceSessionKeys>();
  private constructor(private readonly rootDir: string) {}

  static async create(rootDir: string, names: readonly string[]): Promise<DistributedHarness> {
    const harness = new DistributedHarness(rootDir);
    await mkdir(rootDir, { recursive: true });
    for (const name of names) harness.keys.set(name, await (await IdentityManager.generate()).sessionKeys(name));
    for (const name of names) await harness.start(name);
    return harness;
  }
  node(name: string): DistributedNode { const node = this.nodes.get(name); if (!node) throw new Error(`Unknown test node: ${name}`); return node; }
  async restart(name: string): Promise<DistributedNode> { await this.node(name).close(); this.nodes.delete(name); await this.start(name); return this.node(name); }
  async close(): Promise<void> { await Promise.all([...this.nodes.values()].map(node => node.close())); this.nodes.clear(); }

  private async start(name: string): Promise<void> {
    const keys = this.keys.get(name); if (!keys) throw new Error(`Unknown identity: ${name}`);
    const dataDir = join(this.rootDir, name); await mkdir(dataDir, { recursive: true });
    const contacts = [...this.keys.values()].filter(value => value.nodeId !== keys.nodeId).map(toContact);
    const transport = new ControlledTransport(keys.nodeId, this.network);
    const crypto = new SodiumCryptoProvider();
    const messageStorage = new PersistentSocialStorage(new FileTestStateStore(join(dataDir, 'messages.json')));
    const security = new ContactEnvelopeSecurity(keys, contacts);
    const messages = new DirectMessageService(transport, messageStorage, crypto, keys, contacts, security, new SodiumDirectMessageCipher());
    const groups = new GroupConversationService(messages, messageStorage, crypto, keys);
    const graph = new SocialGraphService(messageStorage, crypto, keys);
    const notifications = new NotificationService(new PersistentNotificationStorage(new FileTestStateStore(join(dataDir, 'notifications.json'))), keys.nodeId, crypto, { policy: { isBlocked: actor => graph.isBlocked(actor), canNotify: object => graph.isMuted(object.author).then(muted => !muted) } });
    await notifications.ready();
    graph.subscribe(event => { if (event.kind === 'profile' && event.object.type === 'identity.profile' && event.object.author === keys.nodeId) void notifications.setLocalHandles(event.object.payload.handle ? [event.object.payload.handle] : []); });
    const existingProfile = await graph.profile(keys.nodeId); if (existingProfile?.payload.handle) await notifications.setLocalHandles([existingProfile.payload.handle]);
    messages.subscribe(event => { if (event.kind === 'message' && event.message) void notifications.ingest(event.message); });
    const graphReplication = new SocialGraphReplicationService(transport, graph, crypto, security, keys, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const communities = new CommunityService(new PersistentCommunityStorage(new FileTestStateStore(join(dataDir, 'communities.json'))), crypto, keys);
    const communityReplication = new CommunityReplicationService(transport, communities, security, keys, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const privateCommunities = new PrivateCommunityService(new PersistentPrivateCommunityStateStorage(new FileTestStateStore(join(dataDir, 'private-communities.json')), keys), communities, crypto, keys, { peers: [...this.keys.values()].filter(value => value.nodeId !== keys.nodeId) });
    const privateCommunityReplication = new PrivateCommunityReplicationService(transport, privateCommunities, security, keys);
    const music = new MusicService(new PersistentMusicStorage(new FileTestStateStore(join(dataDir, 'music.json'))), crypto, keys);
    const musicReplication = new MusicReplicationService(transport, music, security, keys, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const content = new LocalContentStore(`${name}-content`, new ContentCache(32 * 1024 * 1024));
    const fileStorage = new PersistentFileStorage(new FileTestStateStore(join(dataDir, 'files.json')));
    const files = new FileService(fileStorage, crypto, keys, content);
    const filePolicy = new FileStorageManager(content.cache, new FileTestStateStore(join(dataDir, 'file-storage.json')));
    const fileReplication = new FileReplicationService(transport, files, crypto, security, keys);
    const videoStorage = new PersistentVideoStorage(new FileTestStateStore(join(dataDir, 'video.json')));
    const videos = new VideoService(videoStorage, crypto, keys);
    const videoContent = new VideoContentStore(`${name}-video`, new ContentCache(32 * 1024 * 1024));
    const videoReplication = new VideoReplicationService(transport, videos, security, keys, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const live = new LiveBroadcastService(new PersistentLiveStorage(new FileTestStateStore(join(dataDir, 'live.json'))), crypto, keys);
    const liveReplication = new LiveReplicationService(transport, live, security, keys, () => Date.now(), new Set(), { onAccepted: object => { void notifications.ingest(object); } });
    const discovery = new UnifiedDiscoveryService({ storage: new PersistentDiscoveryStorage(new FileTestStateStore(join(dataDir, 'discovery.json'))) });
    const discoveryReplication = new DiscoveryReplicationService(transport, discovery, crypto, security, keys, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const visits = new AgentVisitService({ transport, crypto, security, local: keys, agentId: `${name}-agent`, storage: new FileTestStateStore(join(dataDir, 'agent-visits.json')), host: { onGuestRequest: async request => request.operation === 'talk_to_host_agent' ? { value: `${name} accepted`, dataClass: 'PUBLIC' } : undefined } });
    await visits.ready();
    const agentContacts = [...this.keys.values()].filter(value => value.nodeId !== keys.nodeId).map(value => ({ version: 1 as const, agent: { agentId: `${[...this.keys.entries()].find(([, candidate]) => candidate.nodeId === value.nodeId)?.[0] ?? 'peer'}-agent`, identityId: value.nodeId }, signingPublicKey: value.publicKey, encryptionPublicKey: value.encryptionPublicKey, trusted: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    const agentSocial = new AgentMailbox({ transport, crypto, security, local: keys, agentId: `${name}-agent`, contacts: agentContacts, storage: new FileTestStateStore(join(dataDir, 'agent-social.json')), policy: { mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: ['availability', 'coordination'], maxPending: 64 }, executor: { execute: async task => ({ value: { accepted: true, taskId: task.taskId, agent: `${name}-agent` }, dataClass: 'USER_EXPLICIT' }) } });
    await agentSocial.ready();
    const spaces = new SharedSpaceService({ transport, crypto, security, local: keys, peers: [...this.keys.values()].filter(value => value.nodeId !== keys.nodeId), storage: new PersistentSharedSpaceStateStore(new FileTestStateStore(join(dataDir, 'shared-spaces.json')), keys) });
    await spaces.ready();
    this.nodes.set(name, { name, dataDir, keys, messages, groups, messageStorage, graph, graphReplication, notifications, communities, communityReplication, privateCommunities, privateCommunityReplication, music, musicReplication, content, videos, videoContent, videoReplication, live, liveReplication, discovery, discoveryReplication, files, fileStorage, filePolicy, fileReplication, visits, agentSocial, spaces, transport, close: async () => { spaces.close(); agentSocial.close(); visits.close(); groups.close(); messages.close(); graphReplication.close(); communityReplication.close(); privateCommunityReplication.close(); musicReplication.close(); videoReplication.close(); liveReplication.close(); discoveryReplication.close(); fileReplication.close(); await transport.close(); } });
  }
}

export const settle = () => new Promise<void>(resolve => setTimeout(resolve, 50));
function toContact(keys: DeviceSessionKeys): SocialContact { return { nodeId: keys.nodeId, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey }; }
function link(a: NodeId, b: NodeId): string { return [a, b].sort().join(':'); }
