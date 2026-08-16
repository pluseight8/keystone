import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager, type DeviceSessionKeys } from '../identity.js';
import type { Envelope, EnvelopeSecurity, Transport } from '../transport.js';
import { ContactEnvelopeSecurity, type SocialContact } from '../social/messaging.js';
import {
  AIComputeRouter,
  AIInferenceCancelledError,
  PersonalAIContextPolicy,
  PersonalAIHost,
  RemoteLocalAIRuntime,
  type AIComputeModel,
} from './personal-mesh.js';
import type { AIProvider, AIProviderRequest, AIProviderResponse } from './privacy.js';

class MeshNetwork {
  readonly endpoints = new Map<string, MeshTransport>();
  connect(transport: MeshTransport): void { this.endpoints.set(transport.nodeId, transport); }
  deliver(to: string, envelope: Envelope): void { const endpoint = this.endpoints.get(to); if (!endpoint) throw new Error('peer is offline'); setTimeout(() => endpoint.deliver(envelope), 0); }
}

class MeshTransport implements Transport {
  private readonly handlers = new Set<(envelope: Envelope) => void>();
  constructor(readonly nodeId: string, private readonly network: MeshNetwork) { network.connect(this); }
  async connect(peer: string): Promise<void> { if (!this.network.endpoints.has(peer)) throw new Error('peer is offline'); }
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; const peer = maybeEnvelope ? peerOrEnvelope as string : envelope.recipient; this.network.deliver(peer, envelope); }
  onMessage(handler: (envelope: Envelope) => void): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  isPeerConnected(peer: string): boolean { return this.network.endpoints.has(peer); }
  async close(): Promise<void> { this.handlers.clear(); this.network.endpoints.delete(this.nodeId); }
  deliver(envelope: Envelope): void { for (const handler of this.handlers) handler(envelope); }
}

function contact(keys: DeviceSessionKeys): SocialContact { return { nodeId: keys.nodeId, signingPublicKey: keys.publicKey, encryptionPublicKey: keys.encryptionPublicKey }; }
function security(local: DeviceSessionKeys, peers: readonly DeviceSessionKeys[]): ContactEnvelopeSecurity { return new ContactEnvelopeSecurity(local, peers.filter(peer => peer.nodeId !== local.nodeId).map(contact)); }
function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

describe('Personal AI Mesh', () => {
  const transports: MeshTransport[] = [];
  const hosts: PersonalAIHost[] = [];
  const runtimes: RemoteLocalAIRuntime[] = [];
  afterEach(async () => { hosts.splice(0).forEach(host => host.close()); runtimes.splice(0).forEach(runtime => runtime.close()); await Promise.all(transports.splice(0).map(transport => transport.close())); });

  async function setup() {
    const alice = await IdentityManager.generate();
    const laptop = await alice.sessionKeys('laptop');
    const phone = await alice.sessionKeys('phone');
    const tablet = await alice.sessionKeys('tablet');
    const bob = await (await IdentityManager.generate()).sessionKeys('bob');
    const network = new MeshNetwork();
    const laptopTransport = new MeshTransport(laptop.nodeId, network); const phoneTransport = new MeshTransport(phone.nodeId, network); const tabletTransport = new MeshTransport(tablet.nodeId, network); const bobTransport = new MeshTransport(bob.nodeId, network);
    transports.push(laptopTransport, phoneTransport, tabletTransport, bobTransport);
    const keys = [laptop, phone, tablet, bob];
    const laptopSecurity = security(laptop, keys); const phoneSecurity = security(phone, keys); const tabletSecurity = security(tablet, keys); const bobSecurity = security(bob, keys);
    const trusted = new Set([phone.nodeId, tablet.nodeId]); let revoked = false; const captured: AIProviderRequest[] = [];
    const provider: AIProvider = {
      id: 'ollama', scope: 'local', models: [{ ref: { provider: 'ollama', model: 'qwen' }, scope: 'local', displayName: 'Qwen', contextLimit: 8_192 }],
      async complete(request) { captured.push(request); return { text: `complete:${request.userText}`, toolIntents: [] }; },
      async *stream(request) { captured.push(request); for (const token of ['one ', 'two ', 'three']) { if (request.signal?.aborted) throw new AIInferenceCancelledError(); await wait(5); yield token; } },
    };
    const signAdvertisement = (value: any) => new SodiumCryptoProvider().sign(canonicalJson(value), laptop.privateKey);
    const verifyAdvertisement = (value: any, signature: string) => new SodiumCryptoProvider().verify(canonicalJson(value), signature, laptop.publicKey);
    const host = new PersonalAIHost(laptopTransport, laptopSecurity, laptop, provider, { identityId: laptop.nodeId, isTrustedDevice: device => trusted.has(device), isRevoked: device => device === phone.nodeId && revoked, maxConcurrentRequests: 1, maxQueue: 8, signAdvertisement });
    hosts.push(host);
    const makeRuntime = (local: DeviceSessionKeys, transport: MeshTransport, localSecurity: EnvelopeSecurity) => { const runtime = new RemoteLocalAIRuntime(transport, localSecurity, local, laptop.nodeId, { isTrustedDevice: device => device === laptop.nodeId && !revoked, isRevoked: () => false, verifyAdvertisement: (value, signature) => verifyAdvertisement(value, signature) }); runtimes.push(runtime); return runtime; };
    const phoneRuntime = makeRuntime(phone, phoneTransport, phoneSecurity); const tabletRuntime = makeRuntime(tablet, tabletTransport, tabletSecurity);
    const bobRuntime = new RemoteLocalAIRuntime(bobTransport, bobSecurity, bob, laptop.nodeId, { isTrustedDevice: () => false }); runtimes.push(bobRuntime);
    return { laptop, phone, tablet, bob, phoneRuntime, tabletRuntime, bobRuntime, host, captured, trusted, setRevoked: (value: boolean) => { revoked = value; } };
  }

  it('discovers only directly authorised compute and streams private context', async () => {
    const { phoneRuntime, captured } = await setup();
    const ad = await phoneRuntime.discover();
    expect(ad.capability).toBe('AI_COMPUTE'); expect(ad.models[0].displayName).toBe('Qwen'); expect(ad.signature).toBeTruthy();
    const request = { privacyClass: 'PERSONAL_TRUSTED_COMPUTE' as const, model: ad.models[0].ref, systemPrompt: 'safe', userText: 'summarise', context: [{ id: 'chat-1', source: 'chat', dataClass: 'PRIVATE' as const, value: 'private message' }], requestedTools: [] };
    let text = ''; for await (const token of phoneRuntime.stream(request)) text += token;
    expect(text).toBe('one two three'); expect(captured[0].context[0].value).toBe('private message');
  });

  it('keeps two trusted clients bounded on one host and rejects an untrusted device', async () => {
    const { phoneRuntime, tabletRuntime, bobRuntime } = await setup();
    await expect(bobRuntime.discover()).rejects.toThrow(/access denied/i);
    const [phone, tablet] = await Promise.all([
      (async () => { let text = ''; for await (const token of phoneRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'ollama', model: 'qwen' }, systemPrompt: 'safe', userText: 'phone', context: [], requestedTools: [] })) text += token; return text; })(),
      (async () => { let text = ''; for await (const token of tabletRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'ollama', model: 'qwen' }, systemPrompt: 'safe', userText: 'tablet', context: [], requestedTools: [] })) text += token; return text; })(),
    ]);
    expect(phone).toBe('one two three'); expect(tablet).toBe('one two three');
  });

  it('cancels a stream and immediately loses access after device revocation', async () => {
    const { phoneRuntime, setRevoked } = await setup();
    const iterator = phoneRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'ollama', model: 'qwen' }, systemPrompt: 'safe', userText: 'cancel', context: [], requestedTools: [] })[Symbol.asyncIterator]();
    const first = await iterator.next(); expect(first.value).toBe('one '); await iterator.return?.();
    setRevoked(true);
    await expect(phoneRuntime.discover()).rejects.toThrow(/access denied/i);
  });

  it('cuts off an active stream when the host revokes the trusted device', async () => {
    const { phoneRuntime, setRevoked } = await setup();
    const iterator = phoneRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'ollama', model: 'qwen' }, systemPrompt: 'safe', userText: 'active revoke', context: [], requestedTools: [] })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toBe('one ');
    setRevoked(true);
    await expect(iterator.next()).rejects.toThrow(/revoked|failed|access/i);
  });

  it('routes private work to a trusted node and never falls back to external AI', async () => {
    const { phoneRuntime } = await setup();
    let externalCalls = 0;
    const external: AIProvider = { id: 'external', scope: 'remote', models: [{ ref: { provider: 'external', model: 'model' }, scope: 'remote', contextLimit: 8_192 }], async complete(_request) { externalCalls++; return { text: 'must not run', toolIntents: [] }; } };
    const externalRouter = (await import('./privacy.js')).AIRouter;
    const router = new AIComputeRouter({ personal: [phoneRuntime], external: new externalRouter({ providers: [external], defaultModel: 'external/model' }), contextPolicy: new PersonalAIContextPolicy() });
    const result = await router.complete({ taskPrivacy: 'private', target: 'automatic', model: 'ollama/qwen', userText: 'private task', context: [{ id: 'memory-1', source: 'memory', dataClass: 'PRIVATE', value: 'secret context' }] });
    expect(result.text).toBe('one two three'); expect(externalCalls).toBe(0);
  });

  it('fails closed for SECRET context and does not publish it', async () => {
    const { phoneRuntime } = await setup();
    const policy = new PersonalAIContextPolicy();
    expect(() => policy.build({ model: 'ollama/qwen', userText: 'no', context: [{ id: 'key', dataClass: 'SECRET', value: 'private key' }] })).toThrow(/SECRET/i);
    await expect((async () => { for await (const _token of phoneRuntime.stream({ privacyClass: 'PERSONAL_TRUSTED_COMPUTE', model: { provider: 'ollama', model: 'qwen' }, systemPrompt: 'safe', userText: 'no', context: [{ id: 'key', dataClass: 'SECRET', value: 'private key' }], requestedTools: [] })) { /* fail closed before yielding */ } })()).rejects.toThrow(/host|secret|access/i);
  });
});
