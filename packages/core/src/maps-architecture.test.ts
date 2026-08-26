import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAPS_ARCHITECTURE_POLICY, MapProviderRegistry, MapsError, ControlledMapProvider } from './maps.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('R0P82 architecture guards', () => {
  it('keeps Maps above the R0P76 and Connectivity provider boundaries', () => {
    const source = readFileSync(join(here, 'maps.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/transport\.js['"]/);
    expect(source).not.toMatch(/from ['"]@keystone\/native-host['"]/);
    expect(source).not.toMatch(/(?:^|\n)\s*import\s+[^;]*(?:hyperswarm|transport\.js|native-host)/i);
    expect(source).not.toMatch(/navigator\.geolocation|globalThis\.location/i);
    expect(source).not.toMatch(/ip[- ]geolocation/i);
    expect(source).not.toMatch(/\brouteOptimizer\b|\bConnectivityRoute\b|\bnetworkRoute\b/i);
    expect(MAPS_ARCHITECTURE_POLICY.directNativeLocationImports).toBe(0);
    expect(MAPS_ARCHITECTURE_POLICY.ipGeolocationFallbacks).toBe(0);
    expect(MAPS_ARCHITECTURE_POLICY.rawTransportImports).toBe(0);
    expect(MAPS_ARCHITECTURE_POLICY.directApplicationBypassAllowed).toBe(false);
  });

  it('does not turn geographic objects into authorization or identity state', () => {
    const source = readFileSync(join(here, 'maps.ts'), 'utf8');
    expect(source).not.toMatch(/unlock|trusted peer|authorization factor|home inference|work inference/i);
    expect(source).not.toMatch(/\bvisitedAt\b|\brouteHistory\b|\bcommute\b/i);
  });

  it('keeps plugin providers narrow and denies location-like capability claims', () => {
    const registry = new MapProviderRegistry();
    const provider = new ControlledMapProvider({ id: 'plugin-controlled' });
    expect(() => registry.register({ ...provider.registration().registration, requestedCapabilities: ['map.search'] }, 'PLUGIN')).not.toThrow();
    expect(() => registry.register({ ...provider.registration().registration, requestedCapabilities: ['location.foreground'] }, 'PLUGIN')).toThrowError(MapsError);
  });
});
