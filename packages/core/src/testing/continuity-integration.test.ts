import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../crypto.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from '../connectivity.js';
import { ContinuityService, InMemoryContinuityStorage, createDefaultContinuityAdapters, type ContinuityHandoffPayload, type ContinuityTrustAuthority } from '../continuity.js';
import type { DeviceTrustRecord } from '../personal-device-mesh.js';
import type { TransportMessageHandler } from '../transport.js';

const capabilities = ['CAN_OPEN_MAPS', 'CAN_OPEN_MAIL', 'CAN_OPEN_BROWSER', 'CAN_RECEIVE_FILES', 'CAN_OPEN_VAULT', 'CAN_OPEN_DOCUMENT', 'CAN_OPEN_COLLABORATION', 'CAN_OPEN_PUBLICATION', 'CAN_OPEN_MESSAGING', 'CAN_OPEN_WORKSPACE', 'CAN_RECEIVE_CLIPBOARD'] as const;

class IntegrationBus {
  private readonly handlers = new Map<string, Set<TransportMessageHandler>>();
  private offline = new Set<string>();

  transport(peer: string): KeystoneDeliveryInterface {
    const handlers = new Set<TransportMessageHandler>(); this.handlers.set(peer, handlers);
    return {
      connect: async target => { if (this.offline.has(target) || !this.handlers.has(target)) throw new Error('route unavailable'); },
      send: async (peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope) => { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; const target = typeof peerOrEnvelope === 'string' ? peerOrEnvelope : envelope.recipient; if (this.offline.has(target) || !this.handlers.has(target)) throw new Error('route unavailable'); await Promise.all([...(this.handlers.get(target) ?? [])].map(handler => handler(envelope))); },
      onMessage: handler => { handlers.add(handler); return () => handlers.delete(handler); },
      isPeerConnected: target => this.handlers.has(target) && !this.offline.has(target),
      close: async () => { handlers.clear(); this.handlers.delete(peer); },
    };
  }

  setOffline(peer: string, value: boolean): void { if (value) this.offline.add(peer); else this.offline.delete(peer); }
}

class IntegrationSecurity implements EnvelopeSecurity {
  async sign(envelope: UnsignedEnvelope): Promise<string> { return `integration:${canonicalJson(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> { const { signature, ...unsigned } = envelope; return signature === `integration:${canonicalJson(unsigned)}`; }
}

class IntegrationTrust implements ContinuityTrustAuthority {
  readonly identityId = 'integration-owner'; readonly authorityDeviceId = 'integration-owner'; readonly trustEpoch = 1;
  constructor(readonly localDeviceId: string, private readonly peerDeviceId: string, private readonly revoked = new Set<string>()) {}
  private record(deviceId: string): DeviceTrustRecord { return { version: 1, deviceId, ownerIdentityId: this.identityId, publicKey: `signing:${deviceId}`, encryptionPublicKey: `encryption:${deviceId}`, label: deviceId, platform: 'integration', capabilities: { continuityCapabilities: [...capabilities] }, enrolledAt: new Date(0).toISOString(), lastSeenAt: new Date().toISOString(), trustEpoch: 1, state: this.revoked.has(deviceId) ? 'REVOKED' : 'TRUSTED' }; }
  async listDevices(): Promise<readonly DeviceTrustRecord[]> { return [this.record(this.localDeviceId), this.record(this.peerDeviceId)]; }
  async getDevice(deviceId: string): Promise<DeviceTrustRecord | undefined> { return deviceId === this.localDeviceId || deviceId === this.peerDeviceId ? this.record(deviceId) : undefined; }
  isTrustedDevice(deviceId: string): boolean { return (deviceId === this.localDeviceId || deviceId === this.peerDeviceId) && !this.revoked.has(deviceId); }
  isRevoked(deviceId: string): boolean { return this.revoked.has(deviceId); }
}

class IntegrationCipher {
  async seal(input: { readonly value: ContinuityHandoffPayload }): Promise<unknown> { return { algorithm: 'integration-e2e', ciphertext: structuredClone(input.value) }; }
  async open(input: { readonly value: unknown }): Promise<ContinuityHandoffPayload> { return (input.value as { ciphertext: ContinuityHandoffPayload }).ciphertext; }
}

async function eventually(check: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Continuity integration state did not converge');
}

describe('R0P84 Continuity integration boundary', () => {
  it('persists an offline handoff, resumes it after service restart and opens it once', async () => {
    const bus = new IntegrationBus(); const ownerTransport = bus.transport('owner'); const phoneTransport = bus.transport('phone'); const security = new IntegrationSecurity(); const ownerTrust = new IntegrationTrust('owner', 'phone'); const phoneTrust = new IntegrationTrust('phone', 'owner'); const ownerStorage = new InMemoryContinuityStorage(); const phoneStorage = new InMemoryContinuityStorage(); const ownerCipher = new IntegrationCipher(); const phoneCipher = new IntegrationCipher();
    const createOwner = () => new ContinuityService({ devices: ownerTrust, delivery: ownerTransport, security, cipher: ownerCipher, storage: ownerStorage, adapters: createDefaultContinuityAdapters() });
    const owner = createOwner(); const phone = new ContinuityService({ devices: phoneTrust, delivery: phoneTransport, security, cipher: phoneCipher, storage: phoneStorage, adapters: createDefaultContinuityAdapters() }); await Promise.all([owner.ready(), phone.ready()]);
    bus.setOffline('phone', true);
    const queued = await owner.sendToDevice({ targetDeviceId: 'phone', type: 'place', reference: { objectId: 'place:integration', placeId: 'place:integration', displayName: 'Integration place' } });
    expect(['QUEUED', 'SENDING']).toContain(queued.status); expect((await owner.outbox()).some(item => item.requestId === queued.requestId)).toBe(true); await eventually(async () => (await owner.get(queued.requestId))?.status === 'QUEUED');
    owner.close(); const restartedOwner = createOwner(); await restartedOwner.ready(); expect((await restartedOwner.get(queued.requestId))?.status).toBe('QUEUED');
    bus.setOffline('phone', false); await eventually(async () => { await restartedOwner.flush('phone'); return (await phone.inbox()).some(item => item.requestId === queued.requestId && item.status === 'DELIVERED_TO_DEVICE'); }, 4_000); const opened = await phone.openIncoming(queued.requestId); expect(opened.status).toBe('ACCEPTED'); await eventually(async () => (await restartedOwner.get(queued.requestId))?.status === 'ACCEPTED');
    await expect(phone.openIncoming(queued.requestId)).resolves.toMatchObject({ requestId: queued.requestId, status: 'ACCEPTED' });
    restartedOwner.close(); phone.close();
  });
});
