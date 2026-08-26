import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import {
  CollaborationService,
  SodiumCollaborationCipher,
  type CollaborationStateStore,
  type TextDocumentSnapshot,
} from '../collaboration.js';
import { ConnectivityFabric, FabricTransport, HyperswarmTransportProvider, type KeystoneDeliveryInterface } from '../connectivity.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import { HyperswarmTransport, type Envelope } from '../transport.js';

type Role = 'alice' | 'bob';
type Config = { readonly root: string; readonly bootstrap: string; readonly seeds: Record<Role, string> };
type Command = {
  readonly id: string;
  readonly action: 'create' | 'share' | 'accept' | 'info' | 'edit' | 'snapshot' | 'comment' | 'presence' | 'offline' | 'wire' | 'stats' | 'stop';
  readonly objectId?: string;
  readonly peer?: Role;
  readonly invitationId?: string;
  readonly text?: string;
  readonly enabled?: boolean;
};

interface CommandResponse { readonly ok: boolean; readonly result?: unknown; readonly error?: string; }

class AtomicJsonStore implements CollaborationStateStore {
  constructor(private readonly path: string) {}
  async read(): Promise<unknown | undefined> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as unknown; }
    catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error; }
  }
  async write(value: unknown): Promise<void> {
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** The harness records only the application envelope before Fabric wraps it.
 * For a private object this must already be the protected marker; the raw
 * Hyperswarm provider never receives the application plaintext. */
class RecordingDelivery implements KeystoneDeliveryInterface {
  last?: { readonly type: string; readonly body: unknown };
  lastUpdate?: { readonly type: string; readonly body: unknown };
  constructor(private readonly inner: KeystoneDeliveryInterface) {}
  connect(peer: string): Promise<void> { return this.inner.connect(peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peerId: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
    this.last = { type: envelope.type, body: structuredClone(envelope.body) };
    if (envelope.type === 'keystone.collaboration.update') this.lastUpdate = this.last;
    if (maybeEnvelope) return this.inner.send(peerOrEnvelope as string, maybeEnvelope);
    return this.inner.send(envelope);
  }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void {
    return this.inner.onMessage(handler);
  }
  isPeerConnected(peer: string): boolean { return this.inner.isPeerConnected?.(peer) ?? false; }
  reconnect(peer: string): Promise<void> { return this.inner.reconnect?.(peer) ?? Promise.reject(new Error('Reconnect unavailable')); }
  close(): Promise<void> { return this.inner.close(); }
}

const configPath = process.env.KEYSTONE_COLLAB_CONFIG;
const role = process.env.KEYSTONE_COLLAB_ROLE as Role | undefined;
if (!configPath || !role) throw new Error('Collaboration network peer requires KEYSTONE_COLLAB_CONFIG and KEYSTONE_COLLAB_ROLE');

describe('R0P81 real collaboration peer', () => {
  it('runs the command loop for the parent Hyperswarm proof', async () => {
    const config = JSON.parse(await readFile(configPath!, 'utf8')) as Config;
    const identities = await Promise.all((Object.keys(config.seeds) as Role[]).map(async name => [name, await IdentityManager.fromMasterSeed(config.seeds[name]).sessionKeys(name)] as const));
    const keys = Object.fromEntries(identities) as Record<Role, DeviceSessionKeys>;
    const local = keys[role!];
    const contacts: SocialContact[] = (Object.keys(keys) as Role[]).filter(name => name !== role).map(name => ({ nodeId: keys[name].nodeId, signingPublicKey: keys[name].publicKey, encryptionPublicKey: keys[name].encryptionPublicKey }));
    const directory = join(config.root, role!);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const raw = new HyperswarmTransport(Buffer.from(local.publicKey, 'base64url'), () => new Hyperswarm({ dht: new DHT({ bootstrap: [config.bootstrap] }) }));
    const security = new ContactEnvelopeSecurity(local, contacts);
    const fabric = new ConnectivityFabric();
    fabric.registerProvider(new HyperswarmTransportProvider(raw, { sender: local.nodeId, security, ownsTransport: true }));
    const fabricTransport = new FabricTransport({ fabric, localNodeId: local.nodeId, applicationSecurity: security });
    const delivery = new RecordingDelivery(fabricTransport);
    const cipher = new SodiumCollaborationCipher(local, Object.values(keys));
    const store = new AtomicJsonStore(join(directory, 'collaboration.json'));
    const service = new CollaborationService({ identityId: local.nodeId, delivery, security, store, cipher });
    await fabricTransport.start();
    await service.ready();
    await writeJson(join(directory, 'ready.json'), { nodeId: local.nodeId });
    let lastCommand = '';
    try {
      while (true) {
        const command = await readJson<Command>(join(directory, 'command.json'));
        if (!command || command.id === lastCommand) { await pause(25); continue; }
        lastCommand = command.id;
        try {
          const result = await execute(command, { config, keys, local, raw, service, delivery });
          await writeJson(join(directory, `response-${command.id}.json`), { ok: true, result });
          if (command.action === 'stop') break;
        } catch (error) {
          await writeJson(join(directory, `response-${command.id}.json`), { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      await service.close();
      await delivery.close();
    }
    expect(true).toBe(true);
  }, 180_000);
});

async function execute(command: Command, context: { readonly config: Config; readonly keys: Record<Role, DeviceSessionKeys>; readonly local: DeviceSessionKeys; readonly raw: HyperswarmTransport; readonly service: CollaborationService; readonly delivery: RecordingDelivery }): Promise<unknown> {
  const objectId = command.objectId ?? 'r0p81-real-private-note';
  if (command.action === 'create') {
    const result = await context.service.createObject<TextDocumentSnapshot>({ id: objectId, kind: 'note', private: true, initial: { version: 1, title: 'R0P81 real note', content: '', metadata: { source: 'real-network' } } });
    return result;
  }
  if (command.action === 'share') {
    if (!command.peer) throw new Error('share requires peer');
    const invitation = await context.service.createInvitation(objectId, { invitee: context.keys[command.peer].nodeId, role: 'editor' });
    return invitation;
  }
  if (command.action === 'accept') {
    if (!command.invitationId) throw new Error('accept requires invitationId');
    await context.service.acceptInvitation(command.invitationId);
    return context.service.info(objectId);
  }
  if (command.action === 'info') return context.service.info(objectId);
  if (command.action === 'edit') {
    const snapshot = await context.service.edit(objectId, { type: 'replace', text: command.text ?? '' });
    return { snapshot, info: context.service.info(objectId) };
  }
  if (command.action === 'snapshot') {
    const info = context.service.info(objectId);
    return { info, snapshot: await context.service.snapshot<TextDocumentSnapshot>(objectId), comments: context.service.comments(objectId), presence: context.service.presence(objectId) };
  }
  if (command.action === 'comment') return context.service.addComment(objectId, command.text ?? '');
  if (command.action === 'presence') return context.service.publishPresence(objectId, { status: 'editing', cursor: { anchor: 1, head: 4 }, selection: ['r0p81-real-selection'] });
  if (command.action === 'offline') { context.raw.setOfflineMode(command.enabled === true); return { offline: context.raw.isOfflineMode() }; }
  if (command.action === 'wire') return context.delivery.lastUpdate ?? context.delivery.last ?? null;
  if (command.action === 'stats') return context.service.stats();
  if (command.action === 'stop') return { stopped: true };
  return undefined;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
}
async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
async function pause(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }
