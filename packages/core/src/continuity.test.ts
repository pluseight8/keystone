import { describe, expect, it } from 'vitest';
import { canonicalJson, SodiumCryptoProvider } from './crypto.js';
import { IdentityManager } from './identity.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import type { TransportMessageHandler } from './transport.js';
import {
  CONTINUITY_MAX_WORKSPACE_TABS,
  ContinuityError,
  ContinuityService,
  InMemoryContinuityStorage,
  SodiumContinuityCipher,
  createDefaultContinuityAdapters,
  validateHandoffPayload,
  type ContinuityOpenContext,
} from './continuity.js';
import { InMemoryDeviceMeshStorage, PersonalDeviceMesh, type DeviceContinuityCapability } from './personal-device-mesh.js';

const continuityCapabilities: readonly DeviceContinuityCapability[] = [
  'CAN_OPEN_MAPS', 'CAN_OPEN_MAIL', 'CAN_OPEN_BROWSER', 'CAN_RECEIVE_FILES',
  'CAN_OPEN_VAULT', 'CAN_OPEN_DOCUMENT', 'CAN_OPEN_COLLABORATION',
  'CAN_OPEN_PUBLICATION', 'CAN_OPEN_MESSAGING', 'CAN_OPEN_WORKSPACE',
  'CAN_RECEIVE_CLIPBOARD',
];

class ContinuityBus {
  private readonly handlers = new Map<string, Set<TransportMessageHandler>>();
  private readonly offlinePeers = new Set<string>();
  lastEnvelope?: Envelope;
  lastDeliveryEnvelope?: Envelope;

  register(peer: string): KeystoneDeliveryInterface {
    const handlers = new Set<TransportMessageHandler>();
    this.handlers.set(peer, handlers);
    return {
      connect: async target => { if (this.offlinePeers.has(target) || !this.handlers.has(target)) throw new Error('peer unavailable'); },
      send: async (peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope) => {
        const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope;
        const target = typeof peerOrEnvelope === 'string' ? peerOrEnvelope : envelope.recipient;
        if (this.offlinePeers.has(target) || !this.handlers.has(target)) throw new Error('peer unavailable');
        this.lastEnvelope = structuredClone(envelope);
        if (envelope.body && typeof envelope.body === 'object' && (envelope.body as { kind?: unknown }).kind === 'DELIVER') this.lastDeliveryEnvelope = structuredClone(envelope);
        await this.dispatch(target, envelope);
      },
      onMessage: handler => { handlers.add(handler); return () => handlers.delete(handler); },
      isPeerConnected: target => this.handlers.has(target) && !this.offlinePeers.has(target),
      close: async () => { this.handlers.delete(peer); handlers.clear(); },
    };
  }

  setOffline(peer: string, offline: boolean): void { if (offline) this.offlinePeers.add(peer); else this.offlinePeers.delete(peer); }
  async dispatch(peer: string, envelope: Envelope): Promise<void> { await Promise.all([...(this.handlers.get(peer) ?? [])].map(handler => handler(envelope))); }
}

class TestEnvelopeSecurity implements EnvelopeSecurity {
  async sign(envelope: UnsignedEnvelope): Promise<string> { return `test:${canonicalJson(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> {
    const { signature, ...unsigned } = envelope;
    return signature === `test:${canonicalJson(unsigned)}`;
  }
}

async function makeFixture() {
  const crypto = new SodiumCryptoProvider();
  const identity = await IdentityManager.generate();
  const owner = await identity.sessionKeys('continuity-owner');
  const phone = await identity.sessionKeys('continuity-phone');
  const bus = new ContinuityBus();
  const ownerTransport = bus.register(owner.nodeId);
  const phoneTransport = bus.register(phone.nodeId);
  const ownerMesh = new PersonalDeviceMesh({
    local: owner,
    crypto,
    storage: new InMemoryDeviceMeshStorage(),
    transport: ownerTransport,
  });
  const phoneMesh = new PersonalDeviceMesh({
    local: phone,
    ownerIdentityId: owner.nodeId,
    authorityDeviceId: owner.nodeId,
    authorityPublicKey: owner.publicKey,
    crypto,
    storage: new InMemoryDeviceMeshStorage(),
    transport: phoneTransport,
  });
  await Promise.all([ownerMesh.ready(), phoneMesh.ready()]);
  const enrollment = await phoneMesh.createEnrollmentRequest({
    label: 'Continuity phone',
    platform: 'android',
    capabilities: { roles: ['PORTABLE', 'USER_INTERFACE'], continuityCapabilities },
  });
  const authorization = await ownerMesh.authorizeEnrollment(enrollment, { confirmed: true, doubleConfirmed: true });
  expect(await phoneMesh.acceptEnrollmentAuthorization(authorization)).toBe(true);
  const security = new TestEnvelopeSecurity();
  const opened: Array<{ type: string; objectId: string }> = [];
  const open = (context: ContinuityOpenContext) => { opened.push({ type: context.payload.type, objectId: context.payload.reference.objectId }); return { status: 'OPENED' as const }; };
  const ownerContinuity = new ContinuityService({
    devices: ownerMesh,
    delivery: ownerTransport,
    security,
    cipher: new SodiumContinuityCipher(owner, [phone]),
    adapters: createDefaultContinuityAdapters({ open: { place: open, mail: open, browser: open, file: open, workspace: open } }),
    localCapabilities: continuityCapabilities,
  });
  const phoneContinuity = new ContinuityService({
    devices: phoneMesh,
    delivery: phoneTransport,
    security,
    cipher: new SodiumContinuityCipher(phone, [owner]),
    adapters: createDefaultContinuityAdapters({ open: { place: open, mail: open, browser: open, file: open, workspace: open } }),
    localCapabilities: continuityCapabilities,
  });
  await Promise.all([ownerContinuity.ready(), phoneContinuity.ready()]);
  return { owner, phone, bus, ownerMesh, phoneMesh, ownerTransport, phoneTransport, ownerContinuity, phoneContinuity, opened, security };
}

async function eventually(check: () => Promise<boolean> | boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for Continuity state');
}

function closeFixture(fixture: Awaited<ReturnType<typeof makeFixture>>): void {
  fixture.ownerContinuity.close();
  fixture.phoneContinuity.close();
  fixture.ownerMesh.close();
  fixture.phoneMesh.close();
}

describe('R0P84 Device Continuity and Handoff', () => {
  it('uses enrolled mesh trust, encrypted references, typed adapters and explicit open ACKs', async () => {
    const fixture = await makeFixture();
    try {
      const devices = await fixture.ownerContinuity.listDevices();
      expect(devices.find(device => device.deviceId === fixture.phone.nodeId)?.capabilities).toContain('CAN_OPEN_MAPS');
      const request = await fixture.ownerContinuity.sendToDevice({
        targetDeviceId: fixture.phone.nodeId,
        type: 'place',
        value: { objectId: 'place:coffee', placeId: 'place:coffee', displayName: 'Coffee place', snapshot: { displayName: 'Coffee place', approximateRegion: 'Moscow' } },
        action: 'CONTINUE',
        viewContext: { mapViewport: { latitude: 55.75, longitude: 37.61, zoom: 12 } },
      });
      expect(request.payload.action).toBe('CONTINUE');
      await eventually(() => fixture.bus.lastDeliveryEnvelope !== undefined);
      expect(JSON.stringify(fixture.bus.lastDeliveryEnvelope?.body)).not.toContain('Coffee place');
      await eventually(async () => (await fixture.phoneContinuity.inbox()).some(item => item.requestId === request.requestId && item.status === 'DELIVERED_TO_DEVICE'));
      await eventually(async () => (await fixture.ownerContinuity.get(request.requestId))?.status === 'DELIVERED_TO_DEVICE');
      const opened = await fixture.phoneContinuity.openIncoming(request.requestId);
      expect(opened.status).toBe('OPENED');
      await eventually(async () => (await fixture.ownerContinuity.get(request.requestId))?.status === 'OPENED');
      expect(fixture.opened).toContainEqual({ type: 'place', objectId: 'place:coffee' });

      const mail = await fixture.ownerContinuity.sendToDevice({ targetDeviceId: fixture.phone.nodeId, type: 'mail', value: { objectId: 'mail:thread-1', accountId: 'account-1', threadId: 'thread-1', subject: 'Project' } });
      expect(JSON.stringify(mail.payload)).not.toMatch(/password|accessToken|refreshToken/i);
      await eventually(async () => (await fixture.phoneContinuity.inbox()).some(item => item.requestId === mail.requestId));
      await fixture.phoneContinuity.openIncoming(mail.requestId);
      expect(fixture.opened).toContainEqual({ type: 'mail', objectId: 'mail:thread-1' });
    } finally {
      closeFixture(fixture);
    }
  });

  it('queues offline without blocking, survives restart, deduplicates replay and honors revocation', async () => {
    const fixture = await makeFixture();
    const storage = new InMemoryContinuityStorage();
    let restarted: ContinuityService | undefined;
    fixture.ownerContinuity.close();
    const offlineService = new ContinuityService({
      devices: fixture.ownerMesh,
      delivery: fixture.ownerTransport,
      security: fixture.security,
      cipher: new SodiumContinuityCipher(fixture.owner, [fixture.phone]),
      storage,
      localCapabilities: continuityCapabilities,
    });
    await offlineService.ready();
    try {
      fixture.bus.setOffline(fixture.phone.nodeId, true);
      const started = Date.now();
      const queued = await offlineService.sendToDevice({ targetDeviceId: fixture.phone.nodeId, type: 'browser', value: { url: 'https://example.test/docs', title: 'Docs' } });
      expect(Date.now() - started).toBeLessThan(500);
      expect(queued.status).toBe('QUEUED');
      await eventually(async () => (await offlineService.outbox()).find(item => item.requestId === queued.requestId)?.status === 'QUEUED');

      offlineService.close();
      restarted = new ContinuityService({
        devices: fixture.ownerMesh,
        delivery: fixture.ownerTransport,
        security: fixture.security,
        cipher: new SodiumContinuityCipher(fixture.owner, [fixture.phone]),
        storage,
        localCapabilities: continuityCapabilities,
      });
      await restarted.ready();
      fixture.bus.setOffline(fixture.phone.nodeId, false);
      await new Promise(resolve => setTimeout(resolve, 600));
      await restarted.flush(fixture.phone.nodeId);
      await eventually(async () => (await fixture.phoneContinuity.inbox()).some(item => item.requestId === queued.requestId));
      const captured = fixture.bus.lastDeliveryEnvelope;
      expect(captured).toBeDefined();
      await fixture.bus.dispatch(fixture.phone.nodeId, captured!);
      expect((await fixture.phoneContinuity.inbox()).filter(item => item.requestId === queued.requestId)).toHaveLength(1);
      await restarted.cancel(queued.requestId);
      expect((await restarted.get(queued.requestId))?.status).toBe('DELIVERED_TO_DEVICE');
      await restarted.flush();
      const revoked = await fixture.ownerMesh.revokeDevice(fixture.phone.nodeId, 'lost phone', { confirmed: true, doubleConfirmed: true });
      expect(revoked.trustEpoch).toBeGreaterThan(0);
      await expect(restarted.sendToDevice({ targetDeviceId: fixture.phone.nodeId, type: 'browser', value: { url: 'https://example.test/after-revoke' } })).rejects.toMatchObject({ code: 'REVOKED' });
      restarted.close();
      restarted = undefined;
    } finally {
      restarted?.close();
      fixture.phoneContinuity.close();
      fixture.phoneMesh.close();
      fixture.ownerMesh.close();
    }
  });

  it('keeps clipboard explicit, defaults automatic mode off, and rejects unsafe/oversized state', async () => {
    const received: string[] = [];
    const fixture = await makeFixture();
    fixture.phoneContinuity.close();
    const phoneWithClipboard = new ContinuityService({
      devices: fixture.phoneMesh,
      delivery: fixture.phoneTransport,
      security: fixture.security,
      cipher: new SodiumContinuityCipher(fixture.phone, [fixture.owner]),
      localCapabilities: continuityCapabilities,
      onClipboardReceived: value => { if (value.text) received.push(value.text); },
    });
    await phoneWithClipboard.ready();
    try {
      expect(await phoneWithClipboard.automaticClipboardContinuityEnabled()).toBe(false);
      await expect(phoneWithClipboard.setAutomaticClipboardContinuity(true)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const clipboard = await fixture.ownerContinuity.sendClipboard({ targetDeviceId: fixture.phone.nodeId, text: 'explicit clipboard', ownerConfirmed: true });
      await eventually(async () => (await phoneWithClipboard.inbox()).some(item => item.requestId === clipboard.requestId));
      expect(received).toEqual([]);
      await phoneWithClipboard.openIncoming(clipboard.requestId);
      expect(received).toEqual(['explicit clipboard']);
      const safeMail = validateHandoffPayload({ version: 1, protocol: 'keystone.continuity.r0p84', type: 'mail', action: 'OPEN', requiredCapability: 'CAN_OPEN_MAIL', expiresAt: new Date(Date.now() + 60_000).toISOString(), reference: { version: 1, kind: 'mail', objectId: 'mail:secret', accountId: 'account', password: 'never' } });
      expect(JSON.stringify(safeMail)).not.toContain('never');
      expect(() => validateHandoffPayload({ version: 1, protocol: 'keystone.continuity.r0p84', type: 'route', action: 'OPEN', requiredCapability: 'CAN_OPEN_MAPS', expiresAt: new Date(Date.now() + 60_000).toISOString(), reference: { version: 1, kind: 'route', objectId: 'route:secret', snapshot: { password: 'never' } } })).toThrowError(ContinuityError);
      expect(() => validateHandoffPayload({ version: 1, protocol: 'keystone.continuity.r0p84', type: 'browser', action: 'OPEN', requiredCapability: 'CAN_OPEN_BROWSER', expiresAt: new Date(Date.now() + 60_000).toISOString(), reference: { version: 1, kind: 'browser', objectId: 'browser', url: 'javascript:alert(1)' } })).toThrowError(ContinuityError);
      expect(() => validateHandoffPayload({ version: 1, protocol: 'keystone.continuity.r0p84', type: 'workspace', action: 'CONTINUE', requiredCapability: 'CAN_OPEN_WORKSPACE', expiresAt: new Date(Date.now() + 60_000).toISOString(), reference: { version: 1, kind: 'workspace', objectId: 'workspace', tabs: Array.from({ length: CONTINUITY_MAX_WORKSPACE_TABS + 1 }, (_, index) => ({ id: `tab-${index}`, type: 'document', objectId: `document-${index}` })) } })).toThrowError(ContinuityError);
    } finally {
      phoneWithClipboard.close();
      fixture.ownerContinuity.close();
      fixture.ownerMesh.close();
      fixture.phoneMesh.close();
    }
  });
});
