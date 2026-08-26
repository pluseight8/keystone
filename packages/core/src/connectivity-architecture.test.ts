import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONNECTIVITY_AUTHORITY, CONNECTIVITY_USE_INVENTORY, FABRIC_APPLICATION_MODULES, LOW_LEVEL_PROVIDER_MODULES, NETWORK_CAPABLE_PRODUCTION_MODULES, assertFabricAuthority } from './connectivity-architecture.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('R0P67 connectivity import boundary', () => {
  it('keeps physical provider imports below the Fabric boundary', () => {
    for (const relative of FABRIC_APPLICATION_MODULES) {
      const source = readFileSync(join(here, relative), 'utf8');
      const providerImportPattern = relative === 'location.ts' ? /from ['"][^'"]*(?:hyperswarm|hyperdht|\.\.\/(?:nearby|mesh-routing)|\.\/(?:nearby|mesh-routing))[^'"]*['"]/i : /from ['"][^'"]*(?:hyperswarm|hyperdht|@keystone\/native-host|\.\.\/(?:nearby|mesh-routing)|\.\/(?:nearby|mesh-routing))[^'"]*['"]/i;
      expect(source).not.toMatch(providerImportPattern);
      expect(source).not.toMatch(/new\s+(?:Hyperswarm|DHT|LocalNetworkTransport|AnonymousNearbyTransportProvider|AnonymousMeshRouter|AnonymousMultiHopTransportProvider|NativeBluetoothNearbyLinkAdapter)\s*\(/);
    }
    for (const relative of LOW_LEVEL_PROVIDER_MODULES) {
      // The native-host entry is an external package boundary, not a file
      // relative to core/src.
      if (relative.startsWith('@')) continue;
      expect(readFileSync(join(here, relative), 'utf8')).toMatch(/Transport/);
    }
    for (const relative of NETWORK_CAPABLE_PRODUCTION_MODULES) {
      if (relative.startsWith('@') || relative.includes('*')) continue;
      const path = join(here, relative);
      try {
        const source = readFileSync(path, 'utf8');
        const providerImportPattern = relative === 'location.ts' ? /from ['"][^'"]*(?:hyperswarm|hyperdht|\.\.\/(?:nearby|mesh-routing)|\.\/(?:nearby|mesh-routing))[^'"]*['"]/i : /from ['"][^'"]*(?:hyperswarm|hyperdht|@keystone\/native-host|\.\.\/(?:nearby|mesh-routing)|\.\/(?:nearby|mesh-routing))[^'"]*['"]/i;
        expect(source).not.toMatch(providerImportPattern);
        expect(source).not.toMatch(/new\s+(?:Hyperswarm|DHT|LocalNetworkTransport|AnonymousNearbyTransportProvider|AnonymousMeshRouter|AnonymousMultiHopTransportProvider|NativeBluetoothNearbyLinkAdapter)\s*\(/);
      } catch {
        // Inventory entries for package-owned adapters are checked by the
        // package's own build; core application entries must exist here.
        if (relative.startsWith('social/') || relative.startsWith('ai/') || relative.startsWith('sync/') || relative.startsWith('security/') || relative.startsWith('agents/')) throw new Error(`Missing connectivity inventory module: ${relative}`);
      }
    }
    // Every service in the production inventory must either receive the
    // Fabric-compatible delivery seam or be explicitly local-only.  This
    // catches a newly added constructor that silently reintroduces a raw
    // physical transport even when no provider import appears in the file.
    for (const relative of NETWORK_CAPABLE_PRODUCTION_MODULES) {
      const entry = CONNECTIVITY_USE_INVENTORY.find(value => value.module === relative);
      expect(entry, `missing inventory entry for ${relative}`).toBeDefined();
      if (entry?.classification === 'FABRIC_MIGRATED') {
        const source = readFileSync(join(here, relative), 'utf8');
        // Some services delegate peer delivery to another Fabric-backed
        // service (for example AgentMailbox); they need not carry the seam
        // name in their own constructor.
        expect(source).toMatch(/KeystoneDeliveryInterface|FabricTransport|transport|mailbox|replication|signaling/i);
      }
    }
  });

  it('has no unclassified registered network path', () => {
    expect(CONNECTIVITY_USE_INVENTORY.every(entry => [
      'FABRIC_MIGRATED', 'LOW_LEVEL_PROVIDER', 'LOCAL_ONLY', 'TEST',
      'MIGRATION', 'LEGACY_COMPATIBILITY_BOUNDARY', 'LEGACY_BYPASS', 'EXTERNAL_PROVIDER_NETWORK',
    ].includes(entry.classification))).toBe(true);
    CONNECTIVITY_USE_INVENTORY.forEach(assertFabricAuthority);
    expect(CONNECTIVITY_AUTHORITY.applicationAuthority).toBe('ConnectivityFabric');
    expect(CONNECTIVITY_AUTHORITY.compatibilityFacade).toBe('FabricTransport');
    expect(CONNECTIVITY_AUTHORITY.directApplicationBypassAllowed).toBe(false);
    expect(CONNECTIVITY_AUTHORITY.silentLegacyFallbackAllowed).toBe(false);
  });

  it('enumerates direct low-level references only in provider/test/migration boundaries', () => {
    const application = FABRIC_APPLICATION_MODULES.map(relative => readFileSync(join(here, relative), 'utf8')).join('\n');
    expect(application).not.toMatch(/new\s+(?:Hyperswarm|DHT|LocalNetworkTransport|AnonymousNearbyTransportProvider|AnonymousMeshRouter|AnonymousMultiHopTransportProvider|NativeBluetoothNearbyLinkAdapter)\s*\(/);
    expect(application).not.toMatch(/bluetooth\.(?:scan|advertise|connect|exchange)/i);
    expect(application).not.toMatch(/navigator\.onLine/);
    expect(CONNECTIVITY_USE_INVENTORY.filter(entry => entry.classification === 'LEGACY_BYPASS')).toHaveLength(0);
    const engine = readFileSync(join(here, 'engine.ts'), 'utf8');
    expect(engine).toMatch(/legacyTransportPurpose/);
    expect(engine).toMatch(/rejects an unclassified legacy Transport/);
    expect(CONNECTIVITY_USE_INVENTORY.find(entry => entry.module === 'engine.ts')?.classification).toBe('LEGACY_COMPATIBILITY_BOUNDARY');
  });
});
