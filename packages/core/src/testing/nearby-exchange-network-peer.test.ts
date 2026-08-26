import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnonymousNearbyTransportProvider } from '../nearby.js';
import { NearbyExchangeService } from '../nearby-exchange.js';
import { LoopbackNearbyLinkAdapter, type LoopbackNearbyPeerAddress } from './nearby-exchange-loopback.js';

type Role = 'alice' | 'bob';
interface Config { readonly root: string; readonly peers: Record<Role, LoopbackNearbyPeerAddress>; }
type Command = { readonly id: string; readonly action: 'offer' | 'incoming' | 'accept' | 'status' | 'wire' | 'stop' };

const configPath = process.env.KEYSTONE_NEARBY_CONFIG;
const role = process.env.KEYSTONE_NEARBY_ROLE as Role | undefined;
if (!configPath || !role) throw new Error('Nearby exchange network peer requires KEYSTONE_NEARBY_CONFIG and KEYSTONE_NEARBY_ROLE');

describe('R0P85 independent nearby exchange peer', () => {
  it('runs the command loop for the multi-process hybrid proof', async () => {
    const config = JSON.parse(await readFile(configPath!, 'utf8')) as Config;
    const other: Role = role === 'alice' ? 'bob' : 'alice';
    const directory = join(config.root, role!);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const adapter = new LoopbackNearbyLinkAdapter(config.peers[role!], config.peers[other]);
    const provider = new AnonymousNearbyTransportProvider({ adapter, providerId: `nearby-loopback-${role}`, peerTtlMs: 30_000, sessionLifetimeMs: 120_000, maxBytesPerSession: 32 * 1024 * 1024 });
    const service = new NearbyExchangeService({ nearby: provider, localAlias: `${role} loopback` });
    if (role === 'bob') await service.startReceive({ policy: 'ASK_EVERY_TIME', alias: 'Bob loopback' });
    else await service.start();
    await writeJson(join(directory, 'ready.json'), { role, evidence: service.diagnostics().nearbyEvidence });
    let lastCommand = '';
    try {
      while (true) {
        const command = await readJson<Command>(join(directory, 'command.json'));
        if (!command || command.id === lastCommand) { await pause(20); continue; }
        lastCommand = command.id;
        try {
          const result = await execute(command, service, adapter);
          await writeJson(join(directory, `response-${command.id}.json`), { ok: true, result });
          if (command.action === 'stop') break;
        } catch (error) {
          await writeJson(join(directory, `response-${command.id}.json`), { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      await service.close();
    }
    expect(true).toBe(true);
  }, 180_000);
});

async function execute(command: Command, service: NearbyExchangeService, adapter: LoopbackNearbyLinkAdapter): Promise<unknown> {
  if (command.action === 'offer') {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const endpoint = (await service.listNearby())[0];
      if (endpoint) return service.createOffer({ endpointId: endpoint.endpointId, object: { version: 1, type: 'text', text: 'R0P85 independent-process nearby payload' } });
      await pause(40);
    }
    throw new Error('No anonymous nearby endpoint discovered');
  }
  if (command.action === 'incoming') return service.incomingOffers();
  if (command.action === 'accept') {
    const offer = (await service.incomingOffers())[0];
    if (!offer) throw new Error('No incoming nearby offer is awaiting consent');
    return service.acceptOffer(offer.offerId);
  }
  if (command.action === 'status') return { transfers: await service.transfersList(), diagnostics: service.diagnostics() };
  if (command.action === 'wire') return { frames: adapter.transcript().map(value => Buffer.from(value).toString('base64url')), diagnostics: service.diagnostics() };
  return { stopped: true };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error: any) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined; throw error; }
}
async function writeJson(path: string, value: unknown): Promise<void> { const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await rename(temporary, path); }
async function pause(ms: number): Promise<void> { await new Promise(resolve => setTimeout(resolve, ms)); }
