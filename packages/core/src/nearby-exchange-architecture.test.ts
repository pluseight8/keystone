import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('R0P85 Nearby Exchange architecture', () => {
  it('uses R0P68 discovery, R0P74 content and the Fabric boundary without a second transport stack', () => {
    const source = readFileSync(new URL('./nearby-exchange.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/AnonymousNearbyTransportProvider/);
    expect(source).toMatch(/DistributedContentService/);
    expect(source).toMatch(/KeystoneDeliveryInterface/);
    expect(source).toMatch(/explicit/i);
    expect(source).not.toMatch(/NativeBluetooth|BluetoothTransportProvider|WiFiDirect|Hyperswarm|DHT|LocalNetworkTransport/);
    expect(source).not.toMatch(/LocationService|location\.current|gps|currentLocation/i);
    expect(source).not.toMatch(/createContact\(|autoContact|automaticContact/i);
  });

  it('does not persist anonymous endpoint/session material in the durable projection', () => {
    const source = readFileSync(new URL('./nearby-exchange.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/PersistedState/);
    expect(source).toMatch(/historyEntries/);
    expect(source).not.toMatch(/peerHandle.*Persisted|Persisted.*peerHandle/i);
  });
});
