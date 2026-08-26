import { describe, expect, it } from 'vitest';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from '../connectivity.js';
import type { NodeId } from '../types.js';
import {
  CONTINUITY_MAX_HANDOFF_BYTES,
  ContinuityService,
  createDefaultContinuityAdapters,
  validateHandoffPayload,
  type ContinuityTrustAuthority,
} from '../continuity.js';
import type { DeviceContinuityCapability, DeviceTrustRecord } from '../personal-device-mesh.js';

const owner = 'r0p84-scale-owner' as NodeId;
const target = 'r0p84-scale-phone' as NodeId;
const capabilities: readonly DeviceContinuityCapability[] = ['CAN_OPEN_DOCUMENT', 'CAN_OPEN_BROWSER', 'CAN_RECEIVE_FILES', 'CAN_OPEN_WORKSPACE', 'CAN_RECEIVE_CLIPBOARD'];
const timestamp = '2026-08-25T10:00:00.000Z';

class ScaleDelivery implements KeystoneDeliveryInterface {
  sent = 0;
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  async connect(): Promise<void> {}
  async send(_peer: string | Envelope, _envelope?: Envelope): Promise<void> { this.sent += 1; }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async close(): Promise<void> { this.handlers.clear(); }
}

class ScaleSecurity implements EnvelopeSecurity {
  async sign(_envelope: UnsignedEnvelope): Promise<string> { return 'scale-signature'; }
  async verify(_envelope: Envelope): Promise<boolean> { return true; }
}

class ScaleCipher {
  async seal(input: { readonly value: unknown }): Promise<unknown> { return input.value; }
  async open(input: { readonly value: unknown }): Promise<any> { return input.value; }
}

function scaleDevice(): DeviceTrustRecord {
  return { version: 1, deviceId: target, ownerIdentityId: owner, publicKey: 'scale-public', encryptionPublicKey: 'scale-encryption', label: 'Scale phone', platform: 'test', capabilities: { continuityCapabilities: capabilities }, enrolledAt: timestamp, lastSeenAt: timestamp, trustEpoch: 0, state: 'TRUSTED' };
}

function scaleTrust(): ContinuityTrustAuthority {
  const record = scaleDevice();
  return {
    localDeviceId: owner,
    identityId: owner,
    authorityDeviceId: owner,
    trustEpoch: 0,
    async listDevices() { return [record]; },
    async getDevice(deviceId) { return deviceId === target ? record : undefined; },
    isTrustedDevice(deviceId) { return deviceId === target; },
    isRevoked() { return false; },
  };
}

describe('R0P84 Continuity scale and resource bounds', () => {
  it('validates 10k bounded metadata references and completes 1k queue/cancel endurance cycles', async () => {
    const metadataStarted = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      const value = validateHandoffPayload({
        version: 1,
        protocol: 'keystone.continuity.r0p84',
        type: 'document',
        action: index % 2 === 0 ? 'OPEN' : 'CONTINUE',
        requiredCapability: 'CAN_OPEN_DOCUMENT',
        expiresAt: timestamp,
        reference: { version: 1, kind: 'document', objectId: `document:${index}`, label: `Document ${index}` },
        viewContext: { selectedTab: `tab-${index % 32}`, documentPosition: index },
      });
      expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(CONTINUITY_MAX_HANDOFF_BYTES);
    }
    const metadataDurationMs = Math.round(performance.now() - metadataStarted);
    const delivery = new ScaleDelivery();
    const service = new ContinuityService({
      devices: scaleTrust(),
      delivery,
      security: new ScaleSecurity(),
      cipher: new ScaleCipher(),
      adapters: createDefaultContinuityAdapters(),
      localCapabilities: capabilities,
      maxPendingHandoffs: 1_000,
    });
    await service.ready();
    const enduranceStarted = performance.now();
    for (let index = 0; index < 1_000; index += 1) {
      const request = await service.sendToDevice({ targetDeviceId: target, type: 'document', value: { objectId: `document:endurance:${index}`, label: `Endurance ${index}` } });
      await service.flush(target);
      await service.cancel(request.requestId);
    }
    const enduranceDurationMs = Math.round(performance.now() - enduranceStarted);
    expect(delivery.sent).toBeGreaterThanOrEqual(2_000);
    expect((await service.outbox()).every(value => value.payload.reference.kind === 'document')).toBe(true);
    expect((await service.outbox()).length).toBeLessThanOrEqual(1_000);
    console.log(`[R0P84-PERF] ${JSON.stringify({ metadata: 10_000, enduranceCycles: 1_000, metadataDurationMs, enduranceDurationMs, sent: delivery.sent })}`);
    service.close();
  }, 180_000);
});
