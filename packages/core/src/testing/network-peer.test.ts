import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { CommunityReplicationService } from '../social/community-replication.js';
import { PersistentCommunityStorage } from '../social/community-storage.js';
import type { CommunityEvent } from '../social/community-storage.js';
import { CommunityService } from '../social/communities.js';
import { ContentCache, ContentFetcher, PersistentContentCache, createContentManifest, type ContentManifest, type ContentProvider } from '../social/content.js';
import { LocalContentStore, MusicService, PersistentMusicStorage, StreamingPlaybackSource } from '../social/music.js';
import { MusicReplicationService } from '../social/music-replication.js';
import { PersistentVideoStorage, VideoContentStore, VideoPlaybackSource, VideoService } from '../social/video.js';
import { VideoReplicationService } from '../social/video-replication.js';
import { buildShortFeed } from '../social/shorts.js';
import { LiveBroadcastService, PersistentLiveStorage } from '../social/streams.js';
import { LiveReplicationService } from '../social/live-replication.js';
import { DiscoveryReplicationService } from '../social/discovery-replication.js';
import { PersistentDiscoveryStorage, UnifiedDiscoveryService } from '../social/discovery.js';
import { SocialGraphService } from '../social/graph.js';
import { SocialGraphReplicationService } from '../social/graph-replication.js';
import { NotificationService, PersistentNotificationStorage } from '../social/notifications.js';
import { KEYSTONE_OBJECT_VERSION, profileObjectSchema, roleObjectSchema, type KeystoneObject } from '../social/object-model.js';
import { ContactEnvelopeSecurity, DirectMessageService, SodiumDirectMessageCipher, type SocialContact } from '../social/messaging.js';
import { GroupConversationService } from '../social/conversations.js';
import { PersistentSocialStorage, type EncryptedSocialStateStore } from '../social/storage.js';
import { PersistentPrivateCommunityStateStorage, PrivateCommunityReplicationService, PrivateCommunityService } from '../social/private-communities.js';
import { FileService, FileStorageManager, FileTransferManager, PersistentFileStorage, type FileProviderDirectory } from '../social/files.js';
import { FileReplicationService } from '../social/file-replication.js';
import { DeviceReplicationService, DeviceService, SecurityEventLog, type DevicePrivilegedEvent } from '../security/devices.js';
import { SettingsService } from '../security/settings.js';
import { BackupService, type KeystoneBackupState } from '../sync/backup-recovery.js';
import { PersonalAIHost, RemoteLocalAIRuntime } from '../ai/personal-mesh.js';
import { AgentVisitService, type AgentRef, type AgentRoomMessage, type AgentVisitOperation } from '../ai/visits.js';
import { AgentMailbox } from '../ai/agent-social.js';
import { PersistentSharedSpaceStateStore, SharedSpaceService } from '../social/spaces.js';
import type { AIProvider, AIProviderRequest } from '../ai/privacy.js';
import { createUnifiedContextSources, UnifiedContextResolver } from '../ai/context.js';
import type { Envelope, Transport } from '../transport.js';
import { HyperswarmTransport } from '../transport.js';
import { HyperswarmSignalingChannel, type CallSignal } from '../webrtc/protocol.js';

type Role = 'alice' | 'alice_device' | 'alice_phone' | 'alice_tablet' | 'bob' | 'charlie' | 'mallory';
type Config = { root: string; bootstrap: string; seeds: Record<Role, string> };
type Command = { id: string; action: 'sendText' | 'flush' | 'history' | 'contextRead' | 'replayLast' | 'groupCreate' | 'groupRead' | 'groupSend' | 'groupReply' | 'groupReact' | 'groupEdit' | 'groupDelete' | 'groupAdd' | 'groupRemove' | 'groupAttach' | 'groupStats' | 'communityPublish' | 'communityRead' | 'communityPhase24Create' | 'communityPhase24Join' | 'communityPhase24Moderate' | 'communityPhase24Relay' | 'communityPhase24Read' | 'communityPhase24SpoofRole' | 'communityPhase24Replay' | 'privateCreate' | 'privateInvite' | 'privateRead' | 'privateSend' | 'privateRemove' | 'privateLeave' | 'privateReplay' | 'privateSpoof' | 'privateTamper' | 'spaceCreate' | 'spacePublish' | 'spaceRead' | 'spaceDocument' | 'spaceEdit' | 'spaceGrantAgent' | 'spaceAgentEdit' | 'spaceRemove' | 'contentServe' | 'contentFetch' | 'musicPublish' | 'musicPlay' | 'videoPublish' | 'videoPlay' | 'filePublish' | 'fileRead' | 'fileFetch' | 'fileSeed' | 'webrtcOffer' | 'livePublish' | 'liveRead' | 'liveSignal' | 'liveAnswer' | 'liveChat' | 'liveEnd' | 'discoveryPublish' | 'discoveryRead' | 'discoveryFollow' | 'discoverySpoof' | 'discoveryStats' | 'profilePublish' | 'profileRead' | 'follow' | 'unfollow' | 'socialRead' | 'socialStats' | 'block' | 'mute' | 'notificationRead' | 'notificationStats' | 'socialSpoof' | 'deviceAuthorize' | 'deviceRead' | 'deviceRevoke' | 'devicePrivileged' | 'devicePrivilegedSpoof' | 'deviceSpoof' | 'deviceStats' | 'backupCreate' | 'backupInspect' | 'settingsSet' | 'settingsRead' | 'aiDiscover' | 'aiInfer' | 'aiStats' | 'aiRevoke' | 'visitInvite' | 'visitRead' | 'visitAccept' | 'visitRequest' | 'visitRevoke' | 'visitReplay' | 'visitSpoof' | 'visitCapabilitySpoof' | 'roomCreate' | 'roomPublish' | 'roomMessage' | 'roomRead' | 'agentTaskSend' | 'agentTaskAccept' | 'agentSocialRead' | 'agentSocialFlush' | 'agentPolicy' | 'agentRoomCreate' | 'agentRoomPost' | 'signals' | 'stop'; peer?: Role; providers?: Role[]; target?: Role; members?: Role[]; text?: string; fileId?: string; communityId?: string; channelId?: string; conversationId?: string; messageId?: string; visitId?: string; agentTaskId?: string; roomId?: string; spaceId?: string; operation?: AgentVisitOperation; broadcastId?: string; manifest?: ContentManifest; interruptAt?: number; visibility?: 'public' | 'private' };

const configPath = process.env.KEYSTONE_NETWORK_CONFIG;
const role = process.env.KEYSTONE_NETWORK_ROLE as Role | undefined;
if (!configPath || !role) throw new Error('Network peer requires KEYSTONE_NETWORK_CONFIG and KEYSTONE_NETWORK_ROLE');

class AtomicJsonStore implements EncryptedSocialStateStore {
  constructor(private readonly path: string) {}
  async read(): Promise<unknown | undefined> { try { return JSON.parse(await readFile(this.path, 'utf8')); } catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; } }
  async write(value: unknown): Promise<void> { const temporary = `${this.path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, this.path); }
}

/** Records production sends for a replay test without changing transport behavior. */
class RecordingTransport implements Transport {
  lastMessage?: Envelope;
  lastCommunity?: Envelope;
  lastPrivate?: Envelope;
  lastVisit?: Envelope;
  lastAgentSocial?: Envelope;
  lastSpace?: Envelope;
  constructor(private readonly inner: HyperswarmTransport) {}
  start(): Promise<void> { return this.inner.start(); }
  connect(peer: string): Promise<void> { return this.inner.connect(peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
    if (envelope.type === 'social.message') this.lastMessage = structuredClone(envelope);
    if (envelope.type === 'social.community_event') this.lastCommunity = structuredClone(envelope);
    if (envelope.type.startsWith('social.private_community_')) this.lastPrivate = structuredClone(envelope);
    if (envelope.type === 'ai.agent_visit') this.lastVisit = structuredClone(envelope);
    if (envelope.type === 'ai.agent_social') this.lastAgentSocial = structuredClone(envelope);
    if (envelope.type === 'social.shared_space') this.lastSpace = structuredClone(envelope);
    return maybeEnvelope ? this.inner.send(peerOrEnvelope as string, envelope) : this.inner.send(envelope);
  }
  onMessage(handler: (envelope: Envelope) => void): () => void { return this.inner.onMessage(handler); }
  isPeerConnected(peer: string): boolean { return this.inner.isPeerConnected(peer); }
  close(): Promise<void> { return this.inner.close(); }
}

describe('real network peer', () => {
  it('serves commands over an isolated production Hyperswarm network', async () => {
    const config = JSON.parse(await readFile(configPath!, 'utf8')) as Config;
    const allKeys = await Promise.all((Object.keys(config.seeds) as Role[]).map(async name => [name, await IdentityManager.fromMasterSeed(config.seeds[name]).sessionKeys(name)] as const));
    const peerKeys = Object.fromEntries(allKeys) as Record<Role, DeviceSessionKeys>;
    const restoreFile = process.env.KEYSTONE_NETWORK_RESTORE_FILE;
    const restoreSecretEnv = 'KEYSTONE_NETWORK_RESTORE_' + 'SECRET';
    const restoreSecret = process.env[restoreSecretEnv];
    let restoredState: KeystoneBackupState | undefined;
    let restoredMasterSeed: string | undefined;
    if (restoreFile) {
      if (!restoreSecret) throw new Error('Network backup restore requires KEYSTONE_NETWORK_RESTORE_SECRET');
      const bytes = new Uint8Array(await readFile(restoreFile));
      const restored = await new BackupService().restore(bytes, restoreSecret);
      restoredState = restored.state;
      const identity = restored.state.identitySecurity;
      if (!identity || typeof identity !== 'object' || typeof (identity as { masterSeed?: unknown }).masterSeed !== 'string') throw new Error('Backup does not contain identity master seed');
      restoredMasterSeed = (identity as { masterSeed: string }).masterSeed;
    }
    const local = restoredMasterSeed ? await IdentityManager.fromMasterSeed(restoredMasterSeed).sessionKeys(role!) : peerKeys[role!]; const contacts = (Object.keys(peerKeys) as Role[]).filter(name => name !== role).map(name => contact(peerKeys[name]));
    const directory = process.env.KEYSTONE_NETWORK_DIRECTORY ?? join(config.root, role!); await mkdir(directory, { recursive: true, mode: 0o700 });
    if (restoredState) await restoreNetworkState(directory, restoredState);
    const raw = new HyperswarmTransport(Buffer.from(local.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [config.bootstrap] }) }));
    const transport = new RecordingTransport(raw);
    const security = new ContactEnvelopeSecurity(local, contacts), cryptoProvider = new SodiumCryptoProvider();
    const persistedAIRevocations = await readJson<string[]>(join(directory, 'ai-revocations.json'));
    const aiRevoked = new Set<string>(Array.isArray(persistedAIRevocations) ? persistedAIRevocations.filter(value => typeof value === 'string') : []);
    const aiHost = role === 'alice' ? new PersonalAIHost(transport, security, local, {
      id: 'test-host', scope: 'local', models: [{ ref: { provider: 'test-host', model: 'qwen' }, scope: 'local', displayName: 'Qwen (Alice Laptop)', contextLimit: 8_192 }],
      async complete(request) { return { text: `Alice-host ${request.userText}`, toolIntents: [] }; },
      async *stream(request: AIProviderRequest) { if (request.signal?.aborted) return; yield 'Alice-host '; await pause(20); if (request.signal?.aborted) return; yield 'stream works'; },
    } satisfies AIProvider, { identityId: peerKeys.alice.nodeId, maxConcurrentRequests: 2, maxQueue: 8, isTrustedDevice: device => [peerKeys.alice_phone.nodeId, peerKeys.alice_tablet.nodeId].includes(device) && !aiRevoked.has(device), isRevoked: device => aiRevoked.has(device), signAdvertisement: value => cryptoProvider.sign(canonicalJson(value), local.privateKey) }) : undefined;
    const aiRuntime = role !== 'alice' ? new RemoteLocalAIRuntime(transport, security, local, peerKeys.alice.nodeId, { isTrustedDevice: device => (role === 'alice_phone' || role === 'alice_tablet') && device === peerKeys.alice.nodeId, verifyAdvertisement: (value, signature) => cryptoProvider.verify(canonicalJson(value), signature, peerKeys.alice.publicKey) }) : undefined;
    const isAliceTrustedDevice = role === 'alice_device' || role === 'alice_phone' || role === 'alice_tablet';
    const deviceIdentity = isAliceTrustedDevice ? peerKeys.alice : local;
    const deviceAuthority = isAliceTrustedDevice ? peerKeys.alice : local;
    const devices = new DeviceService(new AtomicJsonStore(join(directory, 'devices.json')), cryptoProvider, local, { identityId: deviceIdentity.nodeId, authorityKeys: deviceAuthority, events: new SecurityEventLog(new AtomicJsonStore(join(directory, 'security-events.json'))) });
    await devices.ready();
    const deviceReplication = new DeviceReplicationService(transport, devices, security, local);
    const socialStorage = new PersistentSocialStorage(new AtomicJsonStore(join(directory, 'messages.json')));
    const messages = new DirectMessageService(transport, socialStorage, cryptoProvider, local, contacts, security, new SodiumDirectMessageCipher());
    const groups = new GroupConversationService(messages, socialStorage, cryptoProvider, local);
    const graph = new SocialGraphService(socialStorage, cryptoProvider, local);
    const notifications = new NotificationService(new PersistentNotificationStorage(new AtomicJsonStore(join(directory, 'notifications.json'))), local.nodeId, cryptoProvider, { policy: { isBlocked: actor => graph.isBlocked(actor), canNotify: object => graph.isMuted(object.author).then(muted => !muted) } });
    await notifications.ready();
    graph.subscribe(event => { if (event.kind === 'profile' && event.object.type === 'identity.profile' && event.object.author === local.nodeId) void notifications.setLocalHandles(event.object.payload.handle ? [event.object.payload.handle] : []); });
    const existingProfile = await graph.profile(local.nodeId); if (existingProfile?.payload.handle) await notifications.setLocalHandles([existingProfile.payload.handle]);
    messages.subscribe(event => { if (event.kind === 'message' && event.message) void notifications.ingest(event.message); });
    const graphReplication = new SocialGraphReplicationService(transport, graph, cryptoProvider, security, local, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const communities = new CommunityService(new PersistentCommunityStorage(new AtomicJsonStore(join(directory, 'communities.json'))), cryptoProvider, local);
    const replication = new CommunityReplicationService(transport, communities, security, local, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const privateCommunities = new PrivateCommunityService(new PersistentPrivateCommunityStateStorage(new AtomicJsonStore(join(directory, 'private-communities.json')), local), communities, cryptoProvider, local, { peers: Object.values(peerKeys).filter(value => value.nodeId !== local.nodeId) });
    const privateCommunityReplication = new PrivateCommunityReplicationService(transport, privateCommunities, security, local);
    const content = new NetworkContentBridge(transport, security, local);
    const musicContent = new LocalContentStore(`${role}-music`, new ContentCache(512 * 1024));
    const music = new MusicService(new PersistentMusicStorage(new AtomicJsonStore(join(directory, 'music.json'))), cryptoProvider, local);
    const musicReplication = new MusicReplicationService(transport, music, security, local, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const videoContent = new VideoContentStore(`${role}-video`, new ContentCache(512 * 1024));
    const videos = new VideoService(new PersistentVideoStorage(new AtomicJsonStore(join(directory, 'video.json'))), cryptoProvider, local);
    const videoReplication = new VideoReplicationService(transport, videos, security, local, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const fileCache = new PersistentContentCache(8 * 1024 * 1024, new AtomicJsonStore(join(directory, 'file-cache.json'))); await fileCache.ready();
    const fileContent = new LocalContentStore(`${role}-files`, fileCache);
    const files = new FileService(new PersistentFileStorage(new AtomicJsonStore(join(directory, 'files.json'))), cryptoProvider, local, fileContent);
    const filePolicy = new FileStorageManager(fileContent.cache, new AtomicJsonStore(join(directory, 'file-storage.json')));
    const fileReplication = new FileReplicationService(transport, files, cryptoProvider, security, local);
    const live = new LiveBroadcastService(new PersistentLiveStorage(new AtomicJsonStore(join(directory, 'live.json'))), cryptoProvider, local);
    const liveReplication = new LiveReplicationService(transport, live, security, local, () => Date.now(), new Set(), { onAccepted: object => { void notifications.ingest(object); } });
    const discovery = new UnifiedDiscoveryService({ storage: new PersistentDiscoveryStorage(new AtomicJsonStore(join(directory, 'discovery.json'))) });
    const discoveryReplication = new DiscoveryReplicationService(transport, discovery, cryptoProvider, security, local, () => Date.now(), { onAccepted: object => { void notifications.ingest(object); } });
    const settings = new SettingsService(new AtomicJsonStore(join(directory, 'settings.json'))); await settings.ready();
    const backup = new BackupService();
    const discoveryObjects = new Map<string, KeystoneObject>();
    const roomMessages: AgentRoomMessage[] = [];
    const visits = new AgentVisitService({
      transport,
      crypto: cryptoProvider,
      security,
      local,
      agentId: `${role}-agent`,
      storage: new AtomicJsonStore(join(directory, 'agent-visits.json')),
      host: {
        async onGuestRequest(request) {
          // The production boundary intentionally returns only a bounded public
          // acknowledgement. Memory, files and private tools are never wired in.
          if (request.operation === 'talk_to_host_agent') return { value: `${role} agent accepted: ${String(request.input ?? '')}`.slice(0, 2_000), dataClass: 'PUBLIC' };
          if (request.operation === 'read_shared_context') return { value: { host: `${role}-agent`, shared: true }, dataClass: 'PUBLIC' };
          if (request.operation === 'search_public_objects') return { value: { matches: [] }, dataClass: 'PUBLIC' };
          if (request.operation === 'write_shared_workspace') return { value: 'workspace write acknowledged', dataClass: 'PUBLIC' };
          return undefined;
        },
      },
      onRoomMessage: async message => { roomMessages.push(message); if (roomMessages.length > 256) roomMessages.shift(); },
    });
    await visits.ready();
    const agentContacts = (Object.keys(peerKeys) as Role[]).filter(name => name !== role).map(name => ({ version: 1 as const, agent: { agentId: `${name}-agent`, identityId: peerKeys[name].nodeId }, signingPublicKey: peerKeys[name].publicKey, encryptionPublicKey: peerKeys[name].encryptionPublicKey, trusted: name.startsWith('alice_') || name === 'alice' || name === 'bob' || name === 'charlie', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    const agentSocial = new AgentMailbox({ transport, crypto: cryptoProvider, security, local, agentId: `${role}-agent`, contacts: agentContacts, storage: new AtomicJsonStore(join(directory, 'agent-social.json')), executor: { execute: async task => ({ value: { accepted: true, taskId: task.taskId, agent: `${role}-agent` }, dataClass: 'USER_EXPLICIT' }) }, policy: { mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: ['availability', 'coordination'], maxPending: 64 } });
    await agentSocial.ready();
    const spaces = new SharedSpaceService({ transport, crypto: cryptoProvider, security, local, peers: Object.values(peerKeys).filter(value => value.nodeId !== local.nodeId), storage: new PersistentSharedSpaceStateStore(new AtomicJsonStore(join(directory, 'shared-spaces.json')), local) });
    await spaces.ready();
    const agentSpaces = new SharedSpaceService({ transport, crypto: cryptoProvider, security, local, localAgentId: `${role}-agent`, peers: Object.values(peerKeys).filter(value => value.nodeId !== local.nodeId), storage: new PersistentSharedSpaceStateStore(new AtomicJsonStore(join(directory, 'agent-shared-spaces.json')), local) });
    await agentSpaces.ready();
    const contextResolver = new UnifiedContextResolver({ viewerId: local.nodeId, sources: createUnifiedContextSources({ messages, spaces, communities, files, music, videos, live, discovery, notifications }, local.nodeId) });
    const signals: Array<{ peer: string; signal: CallSignal }> = [];
    const signaling = new HyperswarmSignalingChannel(transport, async (peer, signal) => {
      const unsigned = { version: 1 as const, type: 'webrtc.signal', id: crypto.randomUUID(), sender: local.nodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: signal };
      return { ...unsigned, signature: await security.sign(unsigned) };
    }, envelope => security.verify(envelope));
    const unsubscribeSignals = signaling.subscribe((peer, signal) => signals.push({ peer, signal }));
    await transport.start(); await pause(1_000); await atomicWrite(join(directory, 'ready.json'), { nodeId: local.nodeId });
    let lastCommand = '';
    try {
      while (true) {
        const command = await readJson<Command>(join(directory, 'command.json'));
        if (!command || command.id === lastCommand) { await pause(25); continue; }
        lastCommand = command.id;
        try {
          const result = await execute(command, { local, peerKeys, messages, groups, graph, graphReplication, notifications, communities, replication, privateCommunities, privateCommunityReplication, transport, content, musicContent, music, musicReplication, videoContent, videos, videoReplication, fileContent, files, filePolicy, fileReplication, live, liveReplication, discovery, discoveryReplication, discoveryObjects, cryptoProvider, security, signals, signaling, devices, deviceReplication, settings, backup, visits, agentSocial, spaces, agentSpaces, contextResolver, roomMessages, directory, masterSeed: restoredMasterSeed ?? config.seeds[role!], aiHost, aiRuntime, aiRevoked });
          await atomicWrite(join(directory, `response-${command.id}.json`), { ok: true, result });
          if (command.action === 'stop') break;
        } catch (error) {
          await atomicWrite(join(directory, `response-${command.id}.json`), { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      unsubscribeSignals(); agentSocial.close(); agentSpaces.close(); spaces.close(); visits.close(); aiHost?.close(); aiRuntime?.close(); deviceReplication.close(); content.close(); groups.close(); messages.close(); graphReplication.close(); replication.close(); privateCommunityReplication.close(); musicReplication.close(); videoReplication.close(); fileReplication.close(); liveReplication.close(); discoveryReplication.close(); await transport.close();
    }
    expect(true).toBe(true);
  }, 120_000);
});

async function execute(command: Command, context: { local: DeviceSessionKeys; peerKeys: Record<Role, DeviceSessionKeys>; messages: DirectMessageService; groups: GroupConversationService; graph: SocialGraphService; graphReplication: SocialGraphReplicationService; notifications: NotificationService; communities: CommunityService; replication: CommunityReplicationService; privateCommunities: PrivateCommunityService; privateCommunityReplication: PrivateCommunityReplicationService; transport: RecordingTransport; content: NetworkContentBridge; musicContent: LocalContentStore; music: MusicService; musicReplication: MusicReplicationService; videoContent: VideoContentStore; videos: VideoService; videoReplication: VideoReplicationService; fileContent: LocalContentStore; files: FileService; filePolicy: FileStorageManager; fileReplication: FileReplicationService; live: LiveBroadcastService; liveReplication: LiveReplicationService; discovery: UnifiedDiscoveryService; discoveryReplication: DiscoveryReplicationService; discoveryObjects: Map<string, KeystoneObject>; cryptoProvider: SodiumCryptoProvider; security: ContactEnvelopeSecurity; signals: Array<{ peer: string; signal: CallSignal }>; signaling: HyperswarmSignalingChannel; devices: DeviceService; deviceReplication: DeviceReplicationService; settings: SettingsService; backup: BackupService; visits: AgentVisitService; agentSocial: AgentMailbox; spaces: SharedSpaceService; agentSpaces: SharedSpaceService; contextResolver: UnifiedContextResolver; roomMessages: AgentRoomMessage[]; directory: string; masterSeed: string; aiHost?: PersonalAIHost; aiRuntime?: RemoteLocalAIRuntime; aiRevoked: Set<string> }): Promise<unknown> {
  const peer = command.peer ? context.peerKeys[command.peer] : undefined;
  if (command.action === 'aiDiscover') { if (!peer || !context.aiRuntime) throw new Error('aiDiscover requires a personal AI client and peer'); const advertisement = await context.aiRuntime.discover(); return { deviceId: advertisement.deviceId, capability: advertisement.capability, state: advertisement.state, busy: advertisement.busy, queueLength: advertisement.queueLength, maxConcurrent: advertisement.maxConcurrent, models: advertisement.models }; }
  if (command.action === 'aiInfer') { if (!peer || !context.aiRuntime || !command.text) throw new Error('aiInfer requires a personal AI client, peer and text'); let text = ''; for await (const token of context.aiRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'test-host', model: 'qwen' }, systemPrompt: 'Keystone test host', userText: command.text, context: [{ id: 'private-test-context', source: 'chat', dataClass: 'PRIVATE', value: 'private context stays inside trusted devices' }], requestedTools: [] })) text += token; return { text, privacyClass: 'PERSONAL_TRUSTED_COMPUTE' }; }
  if (command.action === 'aiStats') { if (!context.aiHost) throw new Error('AI host is not running'); return { active: context.aiHost.activeRequests, queueLength: context.aiHost.queueLength, maxConcurrent: (await context.aiHost.advertisement()).maxConcurrent, busy: context.aiHost.isBusy }; }
  if (command.action === 'aiRevoke') { if (!context.aiHost || !peer) throw new Error('aiRevoke requires host and target'); context.aiRevoked.add(peer.nodeId); await atomicWrite(join(context.directory, 'ai-revocations.json'), [...context.aiRevoked]); return { deviceId: peer.nodeId, revoked: true }; }
  if (command.action === 'spaceCreate') {
    const members = (command.members ?? []).map(name => ({ identityId: context.peerKeys[name].nodeId, role: 'editor' as const }));
    const space = await context.spaces.createSpace({ title: command.text ?? 'Production Shared Space', description: 'P2P collaborative workspace', visibility: command.visibility ?? 'public', members });
    const document = await context.spaces.createDocument(space.id, { title: 'Plan', body: `${context.local.nodeId} initial document` });
    return { spaceId: space.id, documentId: document.id, visibility: space.visibility, members: space.members.map(value => value.identityId) };
  }
  if (command.action === 'spacePublish') { if (!command.spaceId) throw new Error('spacePublish requires spaceId'); await context.spaces.publish(command.spaceId); return { spaceId: command.spaceId, published: true }; }
  if (command.action === 'spaceDocument') { if (!command.spaceId) throw new Error('spaceDocument requires spaceId'); const document = await context.spaces.createDocument(command.spaceId, { title: command.text ?? 'Plan', body: 'shared document' }); return { documentId: document.id }; }
  if (command.action === 'spaceEdit') { if (!command.spaceId || !command.messageId) throw new Error('spaceEdit requires spaceId and document id'); const document = await context.spaces.updateDocument(command.spaceId, command.messageId, { body: command.text ?? 'production edit' }); return { spaceId: command.spaceId, documentId: document.id, title: document.title, body: document.body }; }
  if (command.action === 'spaceGrantAgent') { if (!command.spaceId || !peer) throw new Error('spaceGrantAgent requires spaceId and peer'); const grant = await context.spaces.grantAgent(command.spaceId, { agentId: `${command.peer}-agent`, identityId: peer.nodeId, permissions: ['space.read', 'document.read', 'document.write'] }); await context.spaces.publish(command.spaceId); return { spaceId: command.spaceId, agentId: grant.agentId, grantId: grant.id }; }
  if (command.action === 'spaceAgentEdit') { if (!command.spaceId || !command.messageId) throw new Error('spaceAgentEdit requires spaceId and document id'); const document = await context.agentSpaces.updateDocument(command.spaceId, command.messageId, { body: command.text ?? 'agent production edit' }); return { spaceId: command.spaceId, documentId: document.id, body: document.body, agentId: `${role}-agent` }; }
  if (command.action === 'spaceRead') { if (!command.spaceId) throw new Error('spaceRead requires spaceId'); const space = context.spaces.getSpace(command.spaceId); if (!space) throw new Error('Shared Space is unavailable'); return { space, documents: context.spaces.listDocuments(command.spaceId), stats: context.spaces.stats() }; }
  if (command.action === 'spaceRemove') { if (!command.spaceId || !peer) throw new Error('spaceRemove requires spaceId and peer'); const space = await context.spaces.removeMember(command.spaceId, peer.nodeId); return { spaceId: space.id, members: space.members.map(value => ({ identityId: value.identityId, removed: !!value.removedAt })) }; }
  if (command.action === 'agentTaskSend') {
    if (!peer || !command.text) throw new Error('agentTaskSend requires peer and text');
    const task = await context.agentSocial.createTask({ recipient: { agentId: `${command.peer}-agent`, identityId: peer.nodeId }, taskType: 'availability', prompt: command.text, explicitContext: [{ id: 'explicit-request', label: 'User explicitly shared request', value: command.text, dataClass: 'USER_EXPLICIT' }] });
    return { taskId: task.taskId, requestId: task.id, status: task.status, outbox: (await context.agentSocial.snapshot()).outbox.length };
  }
  if (command.action === 'agentTaskAccept') { if (!command.agentTaskId) throw new Error('agentTaskAccept requires agentTaskId'); const response = await context.agentSocial.acceptTask(command.agentTaskId); return { taskId: response.taskId, status: response.status }; }
  if (command.action === 'agentSocialRead') { const snapshot = await context.agentSocial.snapshot(); return { inbox: snapshot.requests.filter(value => value.recipient.identityId === context.local.nodeId), sent: snapshot.requests.filter(value => value.sender.identityId === context.local.nodeId), responses: snapshot.responses, receipts: snapshot.receipts, rooms: snapshot.rooms, contributions: snapshot.contributions, outbox: snapshot.outbox.length, rejected: snapshot.audit.filter(value => value.outcome === 'denied').length }; }
  if (command.action === 'agentSocialFlush') { if (!peer) throw new Error('agentSocialFlush requires peer'); await context.agentSocial.flush(peer.nodeId); return { outbox: (await context.agentSocial.snapshot()).outbox.length }; }
  if (command.action === 'agentPolicy') { const target = command.target ? context.peerKeys[command.target] : undefined; const policy = command.text === 'ask' ? await context.agentSocial.setTrustPolicy({ mode: 'ask', askBeforeAccepting: true, autoAcceptTaskTypes: [] }) : target ? await context.agentSocial.setTrustPolicy({ blockedIdentityIds: [...new Set([...context.agentSocial.policySnapshot().blockedIdentityIds, target.nodeId])] }) : await context.agentSocial.setTrustPolicy({ mode: 'auto', askBeforeAccepting: false, autoAcceptTaskTypes: ['availability', 'coordination'] }); return { mode: policy.mode, blocked: policy.blockedIdentityIds }; }
  if (command.action === 'agentRoomCreate') { const members = (command.members ?? []).map(name => ({ agentId: `${name}-agent`, identityId: context.peerKeys[name].nodeId })); const room = await context.agentSocial.createAsyncRoom({ title: command.text ?? 'Production async room', members, sharedContext: [{ id: 'room-scope', label: 'Explicit shared room scope', value: 'bounded coordination', dataClass: 'USER_EXPLICIT' }] }); await context.agentSocial.flush(); return { roomId: room.id, members: room.members.map(value => value.identityId) }; }
  if (command.action === 'agentRoomPost') { if (!command.roomId || !command.text) throw new Error('agentRoomPost requires roomId and text'); const contribution = await context.agentSocial.addRoomContribution(command.roomId, { text: command.text, context: [{ id: 'contribution', label: 'Explicit contribution', value: command.text, dataClass: 'USER_EXPLICIT' }] }); await context.agentSocial.flush(); return { contributionId: contribution.id, roomId: contribution.roomId }; }
  if (command.action === 'visitInvite') {
    if (!peer) throw new Error('visitInvite requires peer');
    const invitation = await context.visits.createInvitation({ agentId: `${command.peer}-agent`, identityId: peer.nodeId }, [{ capability: 'talk_to_host_agent' }]);
    await context.visits.sendInvitation(invitation.id);
    return { invitationId: invitation.id, visitorAgent: invitation.visitor.agentId, hostAgent: invitation.host.agentId, expiresAt: invitation.expiresAt };
  }
  if (command.action === 'visitRead') {
    return { invitations: await context.visits.listInvitations(), visits: await context.visits.listVisits(), sessions: await context.visits.listSessions(), stats: context.visits.stats(), audit: context.visits.audit().map(entry => ({ event: entry.event, outcome: entry.outcome, visitId: entry.visitId, roomId: entry.roomId, errorCode: entry.errorCode, dataClasses: entry.dataClasses })) };
  }
  if (command.action === 'visitAccept') {
    if (!command.visitId && !command.text) throw new Error('visitAccept requires invitation id');
    const invitationId = command.visitId ?? command.text!;
    const invitation = (await context.visits.listInvitations()).find(value => value.id === invitationId);
    if (!invitation) throw new Error('Invitation not found');
    const accepted = await context.visits.acceptInvitation(invitation.id, { approvalMode: 'ALLOW_THIS_VISIT', capabilities: [{ grantId: `grant-${crypto.randomUUID()}`, capability: 'talk_to_host_agent', issuedAt: new Date().toISOString(), expiresAt: invitation.expiresAt, maxUses: 8 }] });
    return { visitId: accepted.visit.id, tokenId: accepted.token.id, status: accepted.visit.status };
  }
  if (command.action === 'visitRequest') {
    if (!command.visitId) throw new Error('visitRequest requires visitId');
    const operation = command.operation ?? 'talk_to_host_agent';
    const result = await context.visits.request(command.visitId, { operation, input: command.text ?? 'production visit request', dataClass: operation === 'read_private_memory' ? 'PRIVATE' : 'USER_EXPLICIT' });
    return { visitId: command.visitId, operation, value: result.value, dataClass: result.dataClass };
  }
  if (command.action === 'visitRevoke') {
    if (!command.visitId) throw new Error('visitRevoke requires visitId');
    await context.visits.revokeVisit(command.visitId, command.text ?? 'revoked by host');
    return { visitId: command.visitId, revoked: true };
  }
  if (command.action === 'visitReplay') {
    if (!peer || !context.transport.lastVisit) throw new Error('visitReplay requires peer and a visit envelope');
    await context.transport.send(peer.nodeId, context.transport.lastVisit);
    return { replayed: true };
  }
  if (command.action === 'visitSpoof') {
    if (!peer) throw new Error('visitSpoof requires peer');
    const forgedUnsigned = { version: 1 as const, id: `forged-${crypto.randomUUID()}`, visitor: { agentId: 'alice-agent', identityId: context.peerKeys.alice.nodeId }, host: { agentId: `${command.peer}-agent`, identityId: peer.nodeId }, requestedCapabilities: [{ capability: 'talk_to_host_agent' as const }], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'pending' as const };
    const forged = { ...forgedUnsigned, signature: await context.cryptoProvider.sign(canonicalJson(forgedUnsigned), context.local.privateKey) };
    const unsigned = { version: 1 as const, type: 'ai.agent_visit', id: crypto.randomUUID(), sender: context.local.nodeId, recipient: peer.nodeId, nonce: await context.cryptoProvider.randomNonce(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { kind: 'invitation' as const, invitation: forged } };
    await context.transport.connect(peer.nodeId); await context.transport.send(peer.nodeId, { ...unsigned, signature: await context.security.sign(unsigned) });
    return { sent: true, forged: true };
  }
  if (command.action === 'visitCapabilitySpoof') {
    if (!peer || !command.visitId) throw new Error('visitCapabilitySpoof requires peer and visitId');
    const now = new Date().toISOString();
    const fakeVisitUnsigned = { version: 1 as const, id: command.visitId, invitationId: 'forged-invitation', visitor: { agentId: 'mallory-agent', identityId: context.local.nodeId }, host: { agentId: `${command.peer}-agent`, identityId: peer.nodeId }, capabilities: [{ grantId: 'forged-grant', capability: 'use_specific_tool' as const, toolId: 'read_private_memory', issuedAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), maxUses: 99 }], approvalMode: 'ALLOW_THIS_VISIT' as const, tokenId: 'forged-token', createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), status: 'active' as const, revision: 99 };
    const fakeVisit = { ...fakeVisitUnsigned, signature: await context.cryptoProvider.sign(canonicalJson(fakeVisitUnsigned), context.local.privateKey) };
    const fakeTokenUnsigned = { version: 1 as const, id: 'forged-token', visitId: command.visitId, issuer: context.local.nodeId, subject: context.local.nodeId, hostAgentId: `${command.peer}-agent`, visitorAgentId: 'mallory-agent', capabilities: fakeVisitUnsigned.capabilities, issuedAt: now, expiresAt: fakeVisitUnsigned.expiresAt };
    const fakeToken = { ...fakeTokenUnsigned, signature: await context.cryptoProvider.sign(canonicalJson(fakeTokenUnsigned), context.local.privateKey) };
    const body = { kind: 'request' as const, visit: fakeVisit, token: fakeToken, request: { requestId: `forged-request-${crypto.randomUUID()}`, operation: 'use_specific_tool' as const, toolId: 'read_private_memory', input: 'private', dataClass: 'PUBLIC' as const } };
    const unsigned = { version: 1 as const, type: 'ai.agent_visit', id: crypto.randomUUID(), sender: context.local.nodeId, recipient: peer.nodeId, nonce: await context.cryptoProvider.randomNonce(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body };
    await context.transport.connect(peer.nodeId); await context.transport.send(peer.nodeId, { ...unsigned, signature: await context.security.sign(unsigned) });
    return { sent: true, forgedCapability: true };
  }
  if (command.action === 'roomCreate') {
    const members: AgentRef[] = (command.members ?? []).map(name => ({ agentId: `${name}-agent`, identityId: context.peerKeys[name].nodeId }));
    const room = await context.visits.createRoom({ title: command.text ?? 'Production agent room', members, sharedContext: [{ id: 'scope', label: 'Explicit shared scope', value: 'Coordinate a bounded task without private memory', dataClass: 'USER_EXPLICIT' }] });
    return { roomId: room.id, members: room.members.map(value => value.agent.identityId), sharedContext: room.sharedContext.map(value => value.id) };
  }
  if (command.action === 'roomPublish') { if (!command.roomId) throw new Error('roomPublish requires roomId'); await context.visits.publishRoom(command.roomId); return { roomId: command.roomId, published: true }; }
  if (command.action === 'roomMessage') { if (!command.roomId || !command.text) throw new Error('roomMessage requires roomId and text'); await context.visits.sendRoomMessage(command.roomId, command.text); return { roomId: command.roomId, sent: true }; }
  if (command.action === 'roomRead') { return { rooms: await context.visits.listRooms(), messages: context.roomMessages.map(message => ({ id: message.id, roomId: message.roomId, sender: message.sender.identityId, text: message.text, dataClass: message.dataClass })) }; }
  if (command.action === 'contextRead') { if (!command.text) throw new Error('contextRead requires text'); await context.contextResolver.refresh(); const result = await context.contextResolver.resolve({ text: command.text, execution: 'local', scope: 'all-private' }); return { status: result.status, answer: result.answer, citations: result.citations.map(value => ({ objectId: value.objectId, sourceType: value.sourceType, author: value.author, permissionScope: value.permissionScope })) }; }
  if (command.action === 'sendText') { if (!peer || !command.text) throw new Error('sendText requires peer and text'); const message = await context.messages.sendText(peer.nodeId, command.text); return { id: message.id }; }
  if (command.action === 'flush') { if (!peer) throw new Error('flush requires peer'); await context.messages.flush(peer.nodeId); return {}; }
  if (command.action === 'history') { if (!peer) throw new Error('history requires peer'); const conversation = await context.messages.createConversation(peer.nodeId); return { messages: (await context.messages.history(conversation.id)).map(message => ({ id: message.id, text: message.payload.kind === 'text' ? message.payload.text : undefined })) }; }
  if (command.action === 'groupCreate') { const members = (command.members ?? []).map(member => context.peerKeys[member].nodeId); const group = await context.groups.create({ title: command.text ?? 'Keystone group', members }); return { conversationId: group.id, members: group.members, admins: group.adminIds }; }
  if (command.action === 'groupRead') { if (!command.conversationId) throw new Error('groupRead requires conversationId'); const group = await context.groups.get(command.conversationId); if (!group) return undefined; const canRead = (group.members ?? []).includes(context.local.nodeId); const messages = canRead ? await context.groups.history(group.id) : []; return { conversationId: group.id, members: group.members, admins: group.adminIds, title: group.title, unread: group.unreadCount, messages: messages.map(message => ({ id: message.id, author: message.author, text: message.payload.kind === 'text' ? message.payload.text : undefined, kind: message.payload.kind, references: message.references, supersedes: message.supersedes, deleted: message.deleted })) }; }
  if (command.action === 'groupSend') { if (!command.conversationId || !command.text) throw new Error('groupSend requires conversationId and text'); const message = await context.groups.sendText(command.conversationId, command.text); return { id: message.id, conversationId: command.conversationId }; }
  if (command.action === 'groupReply') { if (!command.conversationId || !command.text || !command.messageId) throw new Error('groupReply requires conversationId, messageId and text'); const message = await context.groups.sendText(command.conversationId, command.text, { replyTo: command.messageId, quote: { messageId: command.messageId, text: command.text } }); return { id: message.id, replyTo: command.messageId }; }
  if (command.action === 'groupReact') { if (!command.conversationId || !command.messageId) throw new Error('groupReact requires conversationId and messageId'); const message = await context.groups.react(command.conversationId, command.messageId, command.text ?? '👍'); return { id: message.id, target: command.messageId }; }
  if (command.action === 'groupEdit') { if (!command.conversationId || !command.messageId || !command.text) throw new Error('groupEdit requires conversationId, messageId and text'); const message = await context.groups.editText(command.conversationId, command.messageId, command.text); return { id: message.id, supersedes: message.supersedes }; }
  if (command.action === 'groupDelete') { if (!command.conversationId || !command.messageId) throw new Error('groupDelete requires conversationId and messageId'); const message = await context.groups.deleteMessage(command.conversationId, command.messageId); return { id: message.id, supersedes: message.supersedes, deleted: message.deleted }; }
  if (command.action === 'groupAdd') { if (!command.conversationId || !peer) throw new Error('groupAdd requires conversationId and peer'); const group = await context.groups.addMember(command.conversationId, peer.nodeId); return { conversationId: group.id, members: group.members, admins: group.adminIds }; }
  if (command.action === 'groupRemove') { if (!command.conversationId || !peer) throw new Error('groupRemove requires conversationId and peer'); const group = await context.groups.removeMember(command.conversationId, peer.nodeId); return { conversationId: group.id, members: group.members, admins: group.adminIds }; }
  if (command.action === 'groupAttach') { if (!command.conversationId || !command.manifest) throw new Error('groupAttach requires conversationId and manifest'); const message = await context.groups.sendAttachments(command.conversationId, [{ contentUri: `keystone://content/${command.manifest.contentId}`, name: command.manifest.name ?? 'attachment', mimeType: command.manifest.mimeType, size: command.manifest.byteLength }]); return { id: message.id, contentId: command.manifest.contentId }; }
  if (command.action === 'groupStats') { if (!command.conversationId) throw new Error('groupStats requires conversationId'); return context.groups.stats(command.conversationId); }
  if (command.action === 'replayLast') { if (!peer || !context.transport.lastMessage) throw new Error('No message envelope available for replay'); await context.transport.send(peer.nodeId, context.transport.lastMessage); return {}; }
  if (command.action === 'profilePublish') {
    const profile = await context.graph.publishProfile({ displayName: `${role![0].toUpperCase()}${role!.slice(1)} Keystone`, handle: `${role}_keystone`, bio: 'Local-first profile', bannerUri: 'keystone://profile/banner', links: [] });
    if (peer) await context.graphReplication.publish(peer.nodeId, profile);
    return { id: profile.id, author: profile.author, handle: profile.payload.handle };
  }
  if (command.action === 'profileRead') {
    const identity = peer?.nodeId ?? context.local.nodeId; const profile = await context.graph.profile(identity); return profile ? { id: profile.id, author: profile.author, payload: profile.payload, followers: (await context.graph.followers(identity)).length, following: (await context.graph.following(identity)).length } : undefined;
  }
  if (command.action === 'follow' || command.action === 'unfollow') { if (!peer) throw new Error(`${command.action} requires peer`); const follow = command.action === 'follow' ? await context.graph.follow(peer.nodeId) : await context.graph.unfollow(peer.nodeId); await context.graphReplication.publish(peer.nodeId, follow); return { id: follow.id, target: follow.payload.target, action: follow.payload.action }; }
  if (command.action === 'socialRead') {
    const identity = peer?.nodeId ?? context.local.nodeId; const relationship = peer ? await context.graph.relationship(peer.nodeId) : undefined; return { identity, following: await context.graph.following(identity), followers: await context.graph.followers(identity), mutuals: await context.graph.mutuals(identity), relationship };
  }
  if (command.action === 'socialStats') return context.graphReplication.stats();
  if (command.action === 'block') { if (!peer) throw new Error('block requires peer'); await context.graph.setBlocked(peer.nodeId, true); await context.messages.block(peer.nodeId); context.graphReplication.block(peer.nodeId); return { blocked: peer.nodeId }; }
  if (command.action === 'mute') { if (!peer) throw new Error('mute requires peer'); await context.graph.setMuted(peer.nodeId, true); await context.notifications.setUserMuted(peer.nodeId, true); return { muted: peer.nodeId }; }
  if (command.action === 'notificationRead') return { notifications: await context.notifications.list({ limit: 100 }), unread: await context.notifications.unreadCount() };
  if (command.action === 'notificationStats') return { unread: await context.notifications.unreadCount(), total: (await context.notifications.list({ limit: 100 })).length, settings: context.notifications.settings() };
  if (command.action === 'settingsSet') { const language = command.text === 'ru' ? 'ru' : 'en'; await context.settings.update({ appearance: { language } }); return { language: context.settings.snapshot().appearance.language }; }
  if (command.action === 'settingsRead') return context.settings.snapshot();
  if (command.action === 'backupInspect') { const bytes = new Uint8Array(await readFile(join(context.directory, 'phase28-backup.keystone'))); return context.backup.inspect(bytes); }
  if (command.action === 'backupCreate') {
    const files = ['messages.json', 'communities.json', 'private-communities.json', 'music.json', 'video.json', 'files.json', 'file-storage.json', 'notifications.json', 'discovery.json', 'devices.json', 'security-events.json', 'settings.json'] as const;
    const stores: Record<string, unknown> = {}; for (const file of files) stores[file] = await readJson(join(context.directory, file));
    const created = await context.backup.create({
      identitySecurity: { identityId: context.local.nodeId, masterSeed: context.masterSeed, devices: stores['devices.json'], securityEvents: stores['security-events.json'] },
      applicationState: { durableStores: stores }, settings: stores['settings.json'], socialGraph: { store: 'messages.json' }, conversations: { store: 'messages.json' }, communities: { store: 'communities.json' }, privateCommunities: { store: 'private-communities.json' }, mediaMetadata: { music: stores['music.json'], video: stores['video.json'], files: stores['files.json'] }, libraryPlaylists: { music: stores['music.json'], video: stores['video.json'] }, notifications: stores['notifications.json'], storageReferences: { fileStorage: stores['file-storage.json'] }, userOwnedMedia: { files: stores['files.json'], fileStorage: stores['file-storage.json'] },
    }, { recoverySecret: command.text ?? 'phase28-network-recovery-secret' });
    const path = join(context.directory, 'phase28-backup.keystone'); await writeFile(path, created.bytes, { mode: 0o600 }); return { path, manifest: created.manifest };
  }
  if (command.action === 'deviceAuthorize') {
    if (!peer) throw new Error('deviceAuthorize requires peer');
    const device = await context.devices.authorizeDevice({ deviceId: peer.nodeId, name: command.text ?? `${command.peer} device`, platform: command.messageId ?? 'desktop', publicKey: peer.publicKey, encryptionPublicKey: peer.encryptionPublicKey });
    await context.deviceReplication.publishAuthorization(peer.nodeId, device); return { deviceId: device.deviceId, authorizationId: device.id };
  }
  if (command.action === 'deviceRead') { return { identityId: context.devices.identityId, devices: await context.devices.list(), pending: await context.devices.pendingPairings(), events: await context.devices.events.stats(), replication: context.deviceReplication.stats() }; }
  if (command.action === 'deviceRevoke') { if (!peer) throw new Error('deviceRevoke requires peer'); const value = await context.devices.revokeDevice(peer.nodeId, command.text ?? 'revoked by owner'); await context.deviceReplication.publishRevocation(peer.nodeId, value); return { deviceId: value.deviceId, revocationId: value.id }; }
  if (command.action === 'devicePrivileged') { if (!peer) throw new Error('devicePrivileged requires peer'); const event = await context.devices.makePrivilegedEvent(command.text ?? 'settings.update', { source: context.local.nodeId }); await context.deviceReplication.publishPrivileged(peer.nodeId, event); return { eventId: event.id }; }
  if (command.action === 'devicePrivilegedSpoof') { if (!peer) throw new Error('devicePrivilegedSpoof requires peer'); const unsigned = { version: 1 as const, kind: 'device_privileged' as const, id: crypto.randomUUID(), identityId: context.peerKeys.alice.nodeId, deviceId: context.local.nodeId, createdAt: new Date().toISOString(), action: 'settings.update', payload: { replayOf: command.text ?? '' } }; const event: DevicePrivilegedEvent = { ...unsigned, signature: await context.cryptoProvider.sign(canonicalJson(unsigned), context.local.privateKey) }; await context.deviceReplication.publishPrivileged(peer.nodeId, event); return { eventId: event.id }; }
  if (command.action === 'deviceSpoof') { if (!peer) throw new Error('deviceSpoof requires peer'); const target = context.peerKeys.alice_device ?? peer; const unsigned = { version: 1 as const, kind: 'device_authorization' as const, id: crypto.randomUUID(), identityId: context.peerKeys.alice.nodeId, deviceId: target.nodeId, name: 'Spoofed', platform: 'unknown', publicKey: target.publicKey, encryptionPublicKey: target.encryptionPublicKey, createdAt: new Date().toISOString(), joinedAt: new Date().toISOString(), issuedBy: context.peerKeys.alice.nodeId }; const spoof = { ...unsigned, signature: await context.cryptoProvider.sign(canonicalJson(unsigned), context.local.privateKey) }; await context.deviceReplication.publishAuthorization(peer.nodeId, spoof); return { sent: true, authorizationId: spoof.id }; }
  if (command.action === 'deviceStats') return context.deviceReplication.stats();
  if (command.action === 'socialSpoof') {
    if (!peer) throw new Error('socialSpoof requires peer'); const valid = await context.graph.follow(peer.nodeId); const object = { ...valid, payload: { ...valid.payload, target: context.local.nodeId } }; const unsigned = { version: 1 as const, type: 'social.graph_object', id: crypto.randomUUID(), sender: context.local.nodeId, recipient: peer.nodeId, nonce: await context.cryptoProvider.randomNonce(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { object } }; await context.transport.connect(peer.nodeId); await context.transport.send(peer.nodeId, { ...unsigned, signature: await context.security.sign(unsigned) }); return { sent: true, objectId: valid.id };
  }
  if (command.action === 'privateCreate') {
    const community = await context.privateCommunities.createCommunity({ name: 'Production encrypted community', visibility: 'private' });
    const channel = await context.communities.createChannel(community.id, { name: 'encrypted', kind: 'text' });
    return { communityId: community.id, channelId: channel.payload.channelId, epoch: (await context.privateCommunities.state(community.id))?.epoch };
  }
  if (command.action === 'privateInvite') {
    if (!peer || !command.communityId) throw new Error('privateInvite requires peer and communityId');
    const invite = await context.privateCommunityReplication.invite(peer.nodeId, command.communityId); return { communityId: command.communityId, inviteId: invite.invite.payload.inviteId, recipient: invite.recipient };
  }
  if (command.action === 'privateRead') {
    if (!command.communityId) throw new Error('privateRead requires communityId');
    const state = await context.privateCommunities.state(command.communityId); if (!state) return undefined;
    const channelId = command.channelId ?? (await context.communities.events(command.communityId)).find(event => event.type === 'channel')?.payload.channelId;
    const messages = channelId ? await context.communities.messages(command.communityId, channelId) : [];
    return { communityId: command.communityId, epoch: state.epoch, members: state.members.map(member => member.nodeId), revoked: state.revokedDevices, messages: messages.map(message => ({ id: message.id, text: message.payload.text })) };
  }
  if (command.action === 'privateSend') {
    if (!command.communityId || !command.channelId || !command.text) throw new Error('privateSend requires communityId, channelId and text');
    const event = await context.privateCommunities.postMessage(command.communityId, command.channelId, command.text); await context.privateCommunityReplication.broadcastEvent(event); return { eventId: event.id, epoch: (await context.privateCommunities.state(command.communityId))?.epoch };
  }
  if (command.action === 'privateLeave') {
    if (!command.communityId) throw new Error('privateLeave requires communityId'); await context.privateCommunityReplication.leave(command.communityId); return {};
  }
  if (command.action === 'privateRemove') {
    if (!command.communityId || !peer) throw new Error('privateRemove requires communityId and peer');
    const updates = await context.privateCommunityReplication.rotateAndBroadcast(command.communityId, peer.nodeId, (command.text as 'kick' | 'ban' | 'unban') ?? 'ban', command.messageId ?? 'Phase 25 removal'); return { epoch: (await context.privateCommunities.state(command.communityId))?.epoch, recipients: updates.map(update => update.recipient) };
  }
  if (command.action === 'privateReplay') {
    if (!peer || !context.transport.lastPrivate) throw new Error('No private envelope available for replay'); await context.transport.send(peer.nodeId, context.transport.lastPrivate); return {};
  }
  if (command.action === 'privateTamper') {
    if (!peer || !context.transport.lastPrivate) throw new Error('No private envelope available for tamper test'); const last = context.transport.lastPrivate; const body = last.body && typeof last.body === 'object' ? { ...(last.body as Record<string, unknown>), ciphertext: `${String((last.body as Record<string, unknown>).ciphertext ?? '')}tampered` } : last.body; await context.transport.send(peer.nodeId, { ...last, body, nonce: crypto.randomUUID(), signature: 'invalid' }); return {};
  }
  if (command.action === 'privateSpoof') {
    if (!peer) throw new Error('privateSpoof requires peer'); const unsigned = { version: 1 as const, type: 'social.private_community_key_update', id: crypto.randomUUID(), sender: context.local.nodeId, recipient: peer.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { algorithm: 'crypto_box', senderEncryptionPublicKey: context.local.encryptionPublicKey, nonce: 'invalid', ciphertext: 'invalid' } }; await context.transport.connect(peer.nodeId); await context.transport.send(peer.nodeId, { ...unsigned, signature: 'invalid' }); return {};
  }
  if (command.action === 'communityPublish') {
    if (!peer) throw new Error('communityPublish requires peer'); const community = await context.communities.createCommunity({ name: 'Production network community' }); const role = await context.communities.createRole(community.id, { name: 'Member', permissions: ['post_message'] }); const invite = await context.communities.invite(community.id, peer.nodeId, [role.payload.roleId]);
    for (const event of [community, role, invite]) await context.replication.publish(peer.nodeId, event);
    const channel = await context.communities.createChannel(community.id, { name: 'general', kind: 'text' }); const message = await context.communities.postMessage(community.id, channel.payload.channelId, 'community over Hyperswarm');
    for (const event of [channel, message]) await context.replication.publish(peer.nodeId, event);
    return { communityId: community.id, channelId: channel.payload.channelId };
  }
  if (command.action === 'communityRead') { if (!command.communityId || !command.channelId) throw new Error('communityRead requires ids'); return { messages: (await context.communities.messages(command.communityId, command.channelId)).map(message => message.payload.text) }; }
  if (command.action === 'communityPhase24Create') {
    const peers = (command.members ?? ['bob', 'charlie']).map(name => context.peerKeys[name]); if (!peers.length) throw new Error('communityPhase24Create requires members');
    const community = await context.communities.createCommunity({ name: 'Phase 24 production community', description: 'Signed roles and moderation', visibility: 'public' });
    const role = await context.communities.createRole(community.id, { name: 'Moderator', position: 20, permissions: ['post_message', 'moderate', 'pin_messages', 'moderate_messages'] });
    const category = await context.communities.createCategory(community.id, { name: 'Main', position: 0 });
    const channel = await context.communities.createChannel(community.id, { name: 'general', kind: 'text', categoryId: category.payload.categoryId });
    const base: CommunityEvent[] = [community, role, category, channel]; const membership: Record<string, string[]> = {};
    for (const target of peers) { const events = [...base]; if (target === context.peerKeys.bob) { const inviteObject = await context.communities.createInvite(community.id, { recipient: target.nodeId, roleIds: [role.payload.roleId] }); const member = await context.communities.invite(community.id, target.nodeId, [role.payload.roleId]); membership[target.nodeId] = [inviteObject.id, member.id]; events.push(inviteObject, member); } for (const event of events) await context.replication.publish(target.nodeId, event); }
    return { communityId: community.id, roleId: role.payload.roleId, categoryId: category.payload.categoryId, channelId: channel.payload.channelId, eventIds: [...base.map(event => event.id), ...Object.values(membership).flat()] };
  }
  if (command.action === 'communityPhase24Join') { if (!command.communityId || !peer) throw new Error('communityPhase24Join requires communityId and peer'); const member = await context.communities.join(command.communityId); await context.replication.publish(peer.nodeId, member); return { eventId: member.id, member: member.payload.member }; }
  if (command.action === 'communityPhase24Moderate') { if (!command.communityId || !command.target || !peer) throw new Error('communityPhase24Moderate requires communityId, target and peer'); const target = context.peerKeys[command.target]; const event = await context.communities.moderate(command.communityId, target.nodeId, (command.text as 'kick' | 'ban' | 'unban' | 'mute' | 'unmute' | 'timeout') || 'ban', { reason: command.messageId ?? 'Phase 24 moderation' }); await context.replication.publish(peer.nodeId, event); return { eventId: event.id, action: event.payload.action, target: event.payload.member }; }
  if (command.action === 'communityPhase24Relay') { if (!command.messageId || !peer) throw new Error('communityPhase24Relay requires event id and peer'); const event = await context.communities.event(command.messageId); if (!event) throw new Error('Community event not found'); await context.replication.publish(peer.nodeId, event); return { eventId: event.id }; }
  if (command.action === 'communityPhase24Read') { if (!command.communityId) throw new Error('communityPhase24Read requires communityId'); const projection = await context.communities.projection(command.communityId); if (!projection) return undefined; return { communityId: projection.community.payload.communityId, visibility: projection.community.visibility, members: [...projection.members.values()].map(member => ({ identity: member.identity, active: member.active, banned: member.banned, muted: member.muted, roleIds: member.roleIds })), channels: [...projection.channels.values()].map(channel => ({ id: channel.payload.channelId, name: channel.payload.name, kind: channel.payload.kind })), roles: [...projection.roles.values()].map(role => ({ id: role.payload.roleId, name: role.payload.name, permissions: role.payload.permissions })), audit: projection.auditLog.map(entry => ({ action: entry.action, target: entry.target, reason: entry.reason })) }; }
  if (command.action === 'communityPhase24SpoofRole') { if (!command.communityId || !peer) throw new Error('communityPhase24SpoofRole requires communityId and peer'); const unsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'role' as const, id: crypto.randomUUID(), author: context.local.nodeId, createdAt: new Date().toISOString(), visibility: 'community' as const, references: [{ id: command.communityId, type: 'community' as const }], payload: { communityId: command.communityId, roleId: crypto.randomUUID(), name: 'Mallory takeover', permissions: ['manage_community' as const, 'ban_members' as const], position: 99 } }; const object = roleObjectSchema.parse({ ...unsigned, signature: await context.cryptoProvider.sign(canonicalJson(unsigned), context.local.privateKey) }); await context.communities.ingest(object); await context.replication.publish(peer.nodeId, object); return { eventId: object.id }; }
  if (command.action === 'communityPhase24Replay') { if (!peer || !context.transport.lastCommunity) throw new Error('No community envelope available for replay'); await context.transport.send(peer.nodeId, context.transport.lastCommunity); return {}; }
  if (command.action === 'contentServe') return { manifest: await context.content.serve() };
  if (command.action === 'contentFetch') { if (!peer || !command.manifest) throw new Error('contentFetch requires peer and manifest'); return context.content.fetch(peer.nodeId, command.manifest, command.interruptAt); }
  if (command.action === 'filePublish') {
    if (!peer) throw new Error('filePublish requires peer');
    const bytes = Uint8Array.from({ length: 192 * 1024 }, (_, index) => (index * 17) % 251);
    const imported = await context.files.import({ bytes, filename: 'production-keystone.bin', mimeType: 'application/octet-stream', visibility: 'public', chunkSize: 16 * 1024 });
    await context.filePolicy.register(imported.file, { userOwned: true });
    const manifest = await context.content.serveBytes(bytes, 'application/octet-stream');
    if (manifest.contentId !== imported.manifest.contentId) throw new Error('File bridge manifest mismatch');
    await context.fileReplication.publish(peer.nodeId, imported.file);
    return { fileId: imported.file.id, objectId: imported.file.id, contentId: imported.file.payload.contentId, manifest };
  }
  if (command.action === 'fileRead') {
    if (!command.fileId) throw new Error('fileRead requires fileId'); const file = await context.files.get(command.fileId); if (!file) return undefined;
    const manifest = await context.fileContent.manifest(file.payload.contentId as `sha256-${string}`); return { fileId: file.id, filename: file.payload.filename, size: file.payload.size, visibility: file.visibility, contentId: file.payload.contentId, local: !!manifest && context.fileContent.cache.missing(manifest).length === 0 };
  }
  if (command.action === 'fileSeed') {
    if (!peer || !command.manifest) throw new Error('fileSeed requires peer and manifest');
    return context.content.fetchToServe(peer.nodeId, command.manifest);
  }
  if (command.action === 'fileFetch') {
    if (!command.fileId || !command.manifest) throw new Error('fileFetch requires fileId and manifest'); const file = await context.files.get(command.fileId); if (!file) throw new Error('FileObject has not arrived');
    const providerRoles = command.providers?.length ? command.providers : peer ? [command.peer!] : []; if (!providerRoles.length) throw new Error('fileFetch requires providers'); const providers = providerRoles.map((name, index) => context.content.provider(context.peerKeys[name].nodeId, index === 0 ? command.interruptAt : undefined, true)); const directory: FileProviderDirectory = { async manifest() { return command.manifest!; }, async providers() { return providers; } }; const transfer = new FileTransferManager(context.fileContent.cache, directory, context.filePolicy, 3);
    try { const bytes = await transfer.download(file, { manifest: command.manifest, maxParallel: 3 }); return { complete: true, bytes: bytes.length, missing: context.fileContent.cache.missing(command.manifest), status: transfer.state(file).status }; } catch (error) { return { complete: false, missing: context.fileContent.cache.missing(command.manifest), status: transfer.state(file).status, error: error instanceof Error ? error.message : String(error) }; }
  }
  if (command.action === 'musicPublish') {
    if (!peer) throw new Error('musicPublish requires peer'); const artist = await context.music.createArtist({ name: 'Network Alice', profileId: context.local.nodeId }); const bytes = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251); const track = await context.music.importTrack({ bytes, mimeType: 'audio/ogg', name: 'network.ogg', chunkSize: 16 * 1024, title: 'Noise track', artistIds: [artist.payload.artistId], durationMs: 60_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Network Alice' } } }, context.musicContent); const manifest = await context.content.serveBytes(bytes, 'audio/ogg'); await context.messages.sendTrack(peer.nodeId, track.track.id, track.track.payload.title); await context.musicReplication.publish(peer.nodeId, artist); await context.musicReplication.publish(peer.nodeId, track.track); return { trackId: track.track.id, manifest };
  }
  if (command.action === 'musicPlay') { if (!peer || !command.manifest) throw new Error('musicPlay requires peer and manifest'); const track = (await context.music.tracks())[0]; if (!track) throw new Error('Track not received'); const segment = await context.content.play(peer.nodeId, track, command.manifest); return { trackId: track.id, chunkIndex: segment.chunkIndex, bytes: segment.bytes.length }; }
  if (command.action === 'videoPublish') { if (!peer) throw new Error('videoPublish requires peer'); const bytes = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251); const video = await context.videos.import({ bytes, mimeType: 'video/webm', name: 'network.webm', chunkSize: 16 * 1024, title: `Noise ${role} video`, durationMs: 60_000, dimensions: { width: 1280, height: 720 }, videoStream: { codec: 'vp9', container: 'webm' }, audioStream: { codec: 'opus', channels: 2 }, shortForm: { caption: 'Network short', aspectRatio: '9:16' } }, context.videoContent); const manifest = await context.content.serveBytes(bytes, 'video/webm'); await context.messages.sendVideo(peer.nodeId, video.video.id, video.video.payload.title); await context.videoReplication.publish(peer.nodeId, video.video); await context.discovery.ingest(video.video, 'local'); await context.discoveryReplication.publish(peer.nodeId, video.video); return { videoId: video.video.id, manifest, short: !!video.video.payload.shortForm }; }
  if (command.action === 'videoPlay') { if (!peer || !command.manifest) throw new Error('videoPlay requires peer and manifest'); const video = (await context.videos.videos())[0]; if (!video) throw new Error('Video not received'); const feed = buildShortFeed([video]); const segment = await context.content.playVideo(peer.nodeId, video, command.manifest); return { videoId: video.id, chunkIndex: segment.chunkIndex, bytes: segment.bytes.length, short: !!video.payload.shortForm, feed: feed.some(item => item.id === video.id) }; }
  if (command.action === 'webrtcOffer') { if (!peer) throw new Error('webrtcOffer requires peer'); await context.signaling.send(peer.nodeId, { type: 'call_offer', callId: 'network-call', media: 'audio', sdp: { type: 'offer', sdp: 'v=0\r\ns=Keystone network validation' } }); return {}; }
  if (command.action === 'livePublish') {
    if (!peer) throw new Error('livePublish requires peer');
    const existing = command.broadcastId ? await context.live.getBroadcast(command.broadcastId) : undefined;
    const scheduled = existing ?? await context.live.create({ title: 'Production Live', description: 'Signed production signaling session', category: 'music', creatorProfileId: crypto.randomUUID(), startsAt: new Date().toISOString(), tracks: { audio: true, video: true, screen: false } });
    const broadcast = existing ?? await context.live.start(scheduled);
    await context.liveReplication.publish(peer.nodeId, broadcast);
    return { broadcastId: broadcast.payload.broadcastId, objectId: broadcast.id, signallingId: broadcast.payload.signallingId, state: broadcast.payload.state };
  }
  if (command.action === 'liveRead') { if (!command.broadcastId) throw new Error('liveRead requires broadcastId'); const broadcast = await context.live.getBroadcast(command.broadcastId); return broadcast ? { broadcastId: broadcast.payload.broadcastId, objectId: broadcast.id, state: broadcast.payload.state, title: broadcast.payload.title, chatCount: (await context.live.chats(command.broadcastId)).length } : undefined; }
  if (command.action === 'liveSignal') { if (!peer || !command.broadcastId) throw new Error('liveSignal requires peer and broadcastId'); await context.signaling.send(peer.nodeId, { type: 'call_offer', callId: `live-${command.broadcastId}`, media: 'video', sdp: { type: 'offer', sdp: 'v=0\r\ns=Keystone live signaling validation' } }); return { productionSignaling: true }; }
  if (command.action === 'liveAnswer') { if (!peer || !command.broadcastId) throw new Error('liveAnswer requires peer and broadcastId'); await context.signaling.send(peer.nodeId, { type: 'call_answer', callId: `live-${command.broadcastId}`, sdp: { type: 'answer', sdp: 'v=0\r\ns=Keystone live signaling answer validation' } }); return { productionSignaling: true }; }
  if (command.action === 'liveChat') { if (!peer || !command.broadcastId || !command.text) throw new Error('liveChat requires peer, broadcastId and text'); const broadcast = await context.live.getBroadcast(command.broadcastId); if (!broadcast) throw new Error('Live broadcast not found'); const chat = await context.live.sendChat(broadcast, { text: command.text }); await context.liveReplication.publish(peer.nodeId, chat); return { chatId: chat.payload.chatId }; }
  if (command.action === 'liveEnd') { if (!peer || !command.broadcastId) throw new Error('liveEnd requires peer and broadcastId'); const broadcast = await context.live.getBroadcast(command.broadcastId); if (!broadcast) throw new Error('Live broadcast not found'); const ended = broadcast.payload.state === 'live' ? await context.live.end(broadcast) : broadcast; await context.liveReplication.publish(peer.nodeId, ended); await context.signaling.send(peer.nodeId, { type: 'call_end', callId: `live-${command.broadcastId}`, reason: 'hangup' }); return { broadcastId: ended.payload.broadcastId, objectId: ended.id, state: ended.payload.state }; }
  if (command.action === 'discoveryPublish') {
    if (!peer) throw new Error('discoveryPublish requires peer');
    if (!context.discoveryObjects.size) {
      const profileUnsigned = { version: KEYSTONE_OBJECT_VERSION as 1, type: 'identity.profile' as const, id: crypto.randomUUID(), author: context.local.nodeId, createdAt: new Date().toISOString(), visibility: 'public' as const, references: [], payload: { displayName: 'Discovery Alice', handle: 'discovery_alice', bio: 'Public P2P creator', links: [] } };
      const profile = profileObjectSchema.parse({ ...profileUnsigned, signature: await context.cryptoProvider.sign(canonicalJson(profileUnsigned), context.local.privateKey) });
      const artist = await context.music.createArtist({ name: 'Network Discovery Artist', profileId: profile.id });
      const bytes = Uint8Array.from({ length: 48 * 1024 }, (_, index) => index % 251);
      const imported = await context.music.importTrack({ bytes, mimeType: 'audio/ogg', name: 'discovery.ogg', chunkSize: 16 * 1024, title: 'Discovery Track', artistIds: [artist.payload.artistId], durationMs: 60_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'Network Discovery Artist' } } }, context.musicContent);
      const video = await context.videos.import({ bytes, mimeType: 'video/webm', name: 'discovery.webm', chunkSize: 16 * 1024, title: 'Discovery Short', description: 'Public discovery video', durationMs: 60_000, creatorProfileId: profile.id, dimensions: { width: 720, height: 1280 }, videoStream: { codec: 'vp9', container: 'webm' }, audioStream: { codec: 'opus', channels: 2 }, trackId: imported.track.payload.trackId, shortForm: { caption: 'Discovery caption', aspectRatio: '9:16' } }, context.videoContent);
      const live = await context.live.start(await context.live.create({ title: 'Discovery Live', description: 'Public discovery broadcast', category: 'music', creatorProfileId: profile.id, trackId: imported.track.payload.trackId, startsAt: new Date().toISOString(), tracks: { audio: true, video: true, screen: false } }));
      const community = await context.communities.createCommunity({ name: 'Discovery Community', description: 'Public P2P community' });
      for (const object of [profile, artist, imported.track, video.video, live, community] as KeystoneObject[]) { context.discoveryObjects.set(object.id, object); await context.discovery.ingest(object, 'local'); }
    }
    for (const object of context.discoveryObjects.values()) await context.discoveryReplication.publish(peer.nodeId, object);
    return { ids: [...context.discoveryObjects.values()].map(object => object.id), types: [...context.discoveryObjects.values()].map(object => object.type) };
  }
  if (command.action === 'discoveryRead') { const query = command.text?.trim() || 'Discovery'; const search = await context.discovery.search({ query, scope: 'public', limit: 50 }); const feed = await context.discovery.feed({ surface: 'home', limit: 50 }); return { search: search.items.map(item => ({ id: item.object.id, type: item.object.type })), feed: feed.items.map(item => ({ id: item.object.id, type: item.object.type })), stats: context.discoveryReplication.stats() }; }
  if (command.action === 'discoveryFollow') { if (!peer) throw new Error('discoveryFollow requires peer'); await context.discovery.follow(peer.nodeId); return { following: context.discovery.followingIds() }; }
  if (command.action === 'discoverySpoof') { if (!peer) throw new Error('discoverySpoof requires peer'); const unsigned = { version: 1 as const, type: 'social.discovery_object', id: crypto.randomUUID(), sender: context.local.nodeId, recipient: peer.nodeId, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body: { object: { malformed: true } } }; await context.transport.connect(peer.nodeId); await context.transport.send(peer.nodeId, { ...unsigned, signature: await context.security.sign(unsigned) }); return {}; }
  if (command.action === 'discoveryStats') return context.discoveryReplication.stats();
  if (command.action === 'signals') return { signals: context.signals.map(value => ({ peer: value.peer, type: value.signal.type, callId: value.signal.callId })) };
  if (command.action === 'stop') return {};
  throw new Error('Unknown network command');
}

/** Test-only public-fixture bridge: real ContentFetcher and Hyperswarm carry each chunk, while product hosts retain control of ContentProvider selection. */
class NetworkContentBridge {
  private readonly values = new Map<string, Uint8Array>(); private readonly manifests = new Map<string, ContentManifest>(); private readonly waiting = new Map<string, { resolve: (value: Uint8Array) => void; reject: (error: Error) => void }>(); private readonly cache = new ContentCache(512 * 1024); private readonly unsubscribe: () => void;
  constructor(private readonly transport: Transport, private readonly security: ContactEnvelopeSecurity, private readonly local: DeviceSessionKeys) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  close(): void { this.unsubscribe(); for (const pending of this.waiting.values()) pending.reject(new Error('Content bridge closed')); this.waiting.clear(); }
  async serve(): Promise<ContentManifest> { return this.serveBytes(Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 251), 'application/octet-stream'); }
  async serveBytes(bytes: Uint8Array, mimeType: string): Promise<ContentManifest> { const manifest = await createContentManifest(bytes, { mimeType, chunkSize: 16 * 1024 }); this.values.set(manifest.contentId, bytes); this.manifests.set(manifest.contentId, manifest); return manifest; }
  async fetch(peer: string, manifest: ContentManifest, interruptAt?: number): Promise<{ complete: boolean; missing: readonly number[] }> {
    const provider = this.provider(peer, interruptAt);
    try { await new ContentFetcher(this.cache).download(manifest, [provider]); return { complete: true, missing: this.cache.missing(manifest) }; } catch { return { complete: false, missing: this.cache.missing(manifest) }; }
  }
  async fetchToServe(peer: string, manifest: ContentManifest): Promise<ContentManifest> { const bytes = await new ContentFetcher(this.cache).download(manifest, [this.provider(peer)]); if (!bytes) throw new Error('Content fetch incomplete'); return this.serveBytes(bytes, manifest.mimeType); }
  provider(peer: string, interruptAt?: number, failAlways = false): ContentProvider { let interrupted = false; return { id: `production-hyperswarm-${peer}`, getChunk: async (contentId, index, signal) => { if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError'); if (index === interruptAt && (failAlways || !interrupted)) { interrupted = true; throw new Error('simulated receiver interruption'); } return this.request(peer, contentId, index); } }; }
  async play(peer: string, track: Awaited<ReturnType<MusicService['tracks']>>[number], manifestInput: unknown) { const manifest = manifestInput as ContentManifest; if (track.payload.audioUri !== `keystone://content/${manifest.contentId}`) throw new Error('Track audio reference does not match manifest'); const request = this.request.bind(this); return new StreamingPlaybackSource(this.cache, { async manifest(id) { return id === manifest.contentId ? manifest : undefined; }, async providers() { return [{ id: 'production-hyperswarm-test-bridge', getChunk: (id, index) => request(peer, id, index) }]; } }).open(track); }
  async playVideo(peer: string, video: Awaited<ReturnType<VideoService['videos']>>[number], manifestInput: unknown) { const manifest = manifestInput as ContentManifest; if (video.payload.videoUri !== `keystone://content/${manifest.contentId}`) throw new Error('Video media reference does not match manifest'); const request = this.request.bind(this); return new VideoPlaybackSource(this.cache, { async manifest(id) { return id === manifest.contentId ? manifest : undefined; }, async providers() { return [{ id: 'production-hyperswarm-test-bridge', getChunk: (id, index) => request(peer, id, index) }]; } }).open(video); }
  private async request(peer: string, contentId: string, index: number): Promise<Uint8Array> {
    const requestId = crypto.randomUUID(); const envelope = await this.envelope(peer, 'test.content.request', { requestId, contentId, index });
    const answer = new Promise<Uint8Array>((resolve, reject) => this.waiting.set(requestId, { resolve, reject })); await this.transport.connect(peer); await this.transport.send(peer, envelope); return answer;
  }
  private async receive(envelope: Envelope): Promise<void> {
    if (!envelope.type.startsWith('test.content.') || envelope.recipient !== this.local.nodeId || Date.parse(envelope.expiresAt) <= Date.now() || !(await this.security.verify(envelope))) return;
    const body = envelope.body as Record<string, unknown>;
    if (envelope.type === 'test.content.response' && typeof body.requestId === 'string' && typeof body.bytes === 'string') { const pending = this.waiting.get(body.requestId); if (!pending) return; this.waiting.delete(body.requestId); pending.resolve(Uint8Array.from(Buffer.from(body.bytes, 'base64url'))); return; }
    if (envelope.type !== 'test.content.request' || typeof body.requestId !== 'string' || typeof body.contentId !== 'string' || !Number.isInteger(body.index)) return;
    const value = this.values.get(body.contentId); if (!value) return; const start = Number(body.index) * 16 * 1024, chunk = value.subarray(start, Math.min(value.length, start + 16 * 1024)); const response = await this.envelope(envelope.sender, 'test.content.response', { requestId: body.requestId, bytes: Buffer.from(chunk).toString('base64url') }); await this.transport.send(envelope.sender, response);
  }
  private async envelope(recipient: string, type: string, body: unknown): Promise<Envelope> { const unsigned = { version: 1 as const, type, id: crypto.randomUUID(), sender: this.local.nodeId, recipient, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000).toISOString(), body }; return { ...unsigned, signature: await this.security.sign(unsigned) }; }
}

function contact(keys: DeviceSessionKeys): SocialContact { return { nodeId: keys.nodeId, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey }; }
async function readJson<T>(path: string): Promise<T | undefined> { try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; } }
async function atomicWrite(path: string, value: unknown): Promise<void> { const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
async function restoreNetworkState(directory: string, state: KeystoneBackupState): Promise<void> {
  const application = state.applicationState;
  if (application && typeof application === 'object' && !Array.isArray(application)) {
    const stores = (application as { durableStores?: unknown }).durableStores;
    if (stores && typeof stores === 'object' && !Array.isArray(stores)) for (const [name, value] of Object.entries(stores as Record<string, unknown>)) {
      if (!/^[a-z0-9-]+\.json$/i.test(name)) continue;
      await atomicWrite(join(directory, name), value);
    }
  }
  const identity = state.identitySecurity;
  if (identity && typeof identity === 'object' && !Array.isArray(identity)) {
    const value = identity as { devices?: unknown; securityEvents?: unknown };
    if (value.devices !== undefined) await atomicWrite(join(directory, 'devices.json'), value.devices);
    if (value.securityEvents !== undefined) await atomicWrite(join(directory, 'security-events.json'), value.securityEvents);
  }
}
function pause(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
