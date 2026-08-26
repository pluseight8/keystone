import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import DHT from 'hyperdht';
import Hyperswarm from 'hyperswarm';
import { describe, expect, it } from 'vitest';
import {
  ControlledMapProvider,
  MapProviderRegistry,
  MapsService,
  PlaceSharingService,
  SodiumPlaceCipher,
  registerControlledMapProvider,
} from '../maps.js';
import { ConnectivityFabric, FabricTransport, HyperswarmTransportProvider, type KeystoneDeliveryInterface } from '../connectivity.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import { HyperswarmTransport, type Envelope } from '../transport.js';

type Role = 'alice' | 'bob';
type Config = { readonly root: string; readonly bootstrap: string; readonly seeds: Record<Role, string> };
type Command = { readonly id: string; readonly action: 'create' | 'share' | 'received' | 'wire' | 'stats' | 'stop'; readonly peer?: Role };
interface CommandResponse { readonly ok: boolean; readonly result?: unknown; readonly error?: string; }

class AtomicJsonStore {
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

class RecordingDelivery implements KeystoneDeliveryInterface {
  last?: { readonly type: string; readonly body: unknown };
  constructor(private readonly inner: KeystoneDeliveryInterface) {}
  connect(peer: string): Promise<void> { return this.inner.connect(peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peerId: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> {
    const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
    this.last = { type: envelope.type, body: structuredClone(envelope.body) };
    if (maybeEnvelope) return this.inner.send(peerOrEnvelope as string, maybeEnvelope);
    return this.inner.send(envelope);
  }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { return this.inner.onMessage(handler); }
  isPeerConnected(peer: string): boolean { return this.inner.isPeerConnected?.(peer) ?? false; }
  reconnect(peer: string): Promise<void> { return this.inner.reconnect?.(peer) ?? Promise.reject(new Error('Reconnect unavailable')); }
  close(): Promise<void> { return this.inner.close(); }
}

const configPath = process.env.KEYSTONE_MAPS_CONFIG;
const role = process.env.KEYSTONE_MAPS_ROLE as Role | undefined;
if (!configPath || !role) throw new Error('Maps network peer requires KEYSTONE_MAPS_CONFIG and KEYSTONE_MAPS_ROLE');

describe('R0P82 real Maps peer', () => {
  it('runs the command loop for the parent Hyperswarm place proof', async () => {
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
    const provider = new ControlledMapProvider({ id: 'controlled.real' });
    const registry = new MapProviderRegistry();
    registerControlledMapProvider(registry, provider);
    const maps = new MapsService({ registry, store: new AtomicJsonStore(join(directory, 'maps.json')) });
    const sharing = new PlaceSharingService({
      identityId: local.nodeId,
      delivery,
      security,
      cipher: new SodiumPlaceCipher(local, Object.values(keys)),
      onPlace: async reference => { await maps.importSharedPlace(reference); },
    });

    await fabricTransport.start();
    await maps.ready();
    await writeJson(join(directory, 'ready.json'), { nodeId: local.nodeId });
    let lastCommand = '';
    try {
      while (true) {
        const command = await readJson<Command>(join(directory, 'command.json'));
        if (!command || command.id === lastCommand) { await pause(25); continue; }
        lastCommand = command.id;
        try {
          const result = await execute(command, { keys, local, maps, sharing, delivery });
          await writeJson(join(directory, `response-${command.id}.json`), { ok: true, result });
          if (command.action === 'stop') break;
        } catch (error) {
          await writeJson(join(directory, `response-${command.id}.json`), { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      sharing.close();
      await maps.close();
      await delivery.close();
    }
    expect(true).toBe(true);
  }, 180_000);
});

async function execute(command: Command, context: { readonly keys: Record<Role, DeviceSessionKeys>; readonly local: DeviceSessionKeys; readonly maps: MapsService; readonly sharing: PlaceSharingService; readonly delivery: RecordingDelivery }): Promise<unknown> {
  if (command.action === 'create') return context.maps.createUserPlace({ placeId: 'r0p82-real-shared-place', displayName: 'R0P82 real shared cafe', coordinates: { latitude: 55.7512, longitude: 37.6184 }, address: 'Controlled street 1', category: 'cafe' });
  if (command.action === 'share') {
    if (!command.peer) throw new Error('share requires peer');
    const place = context.maps.getPlace('r0p82-real-shared-place');
    if (!place) throw new Error('shared place is missing');
    return context.sharing.sharePlace(context.keys[command.peer].nodeId, place, 'PRIVATE');
  }
  if (command.action === 'received') return context.maps.getPlace('r0p82-real-shared-place') ?? null;
  if (command.action === 'wire') return context.delivery.last ?? null;
  if (command.action === 'stats') return context.sharing.stats();
  if (command.action === 'stop') return { stopped: true, nodeId: context.local.nodeId };
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
