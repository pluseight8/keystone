import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PhysicalFeatureProbe,
  UnavailableBluetoothHost,
  type NativeHostCapability,
  type NativeHostRequest,
} from '@keystone/native-host';
import {
  AnonymousNearbyTransportProvider,
  NativeBluetoothNearbyLinkAdapter,
  NearbyPhysicalVerificationHarness,
  type NearbyPhysicalVerificationReport,
} from '../nearby.js';

const request = (capability: NativeHostCapability): NativeHostRequest => ({
  requestId: `nearby-evidence:${crypto.randomUUID()}`,
  capability,
  principal: { kind: 'CORE_TRUSTED_SUBSYSTEM', id: 'nearby-physical-harness' },
  scope: join(tmpdir(), 'keystone-nearby-evidence'),
});

describe('R0P68 physical nearby evidence', () => {
  it('reports controller evidence separately from a physical peer exchange', async () => {
    const controller = await new PhysicalFeatureProbe(process.platform).probe('bluetooth');
    const controllerPresent = controller.evidence.statuses.includes('RUNTIME_DETECTED');
    const adapter = new NativeBluetoothNearbyLinkAdapter({
      host: new UnavailableBluetoothHost(),
      request: capability => request(capability),
      evidence: controllerPresent ? 'RUNTIME_DETECTED' : 'BLOCKED_BY_ENVIRONMENT',
    });
    const provider = new AnonymousNearbyTransportProvider({ adapter, providerId: 'physical-nearby-evidence' });
    const protocol = await new NearbyPhysicalVerificationHarness(provider, adapter).run();
    const report: NearbyPhysicalVerificationReport = {
      ...protocol,
      controllerPresent,
      evidence: 'BLOCKED_BY_ENVIRONMENT',
      limitations: [
        ...(controller.limitations ?? []),
        ...protocol.limitations,
        'No production BlueZ bidirectional data adapter is installed',
        'No second physical Keystone peer is available',
      ],
    };
    console.log(`R0P68_NEARBY_PHYSICAL ${JSON.stringify(report)}`);
    expect(report.controllerPresent).toBe(controllerPresent);
    expect(report.encryptedSessionOpened).toBe(false);
    expect(report.opaqueEnvelopeExchanged).toBe(false);
    expect(report.evidence).toBe('BLOCKED_BY_ENVIRONMENT');
    await provider.stop();
  });
});
