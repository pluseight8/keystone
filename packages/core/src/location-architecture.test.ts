import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FABRIC_APPLICATION_MODULES, CONNECTIVITY_USE_INVENTORY } from './connectivity-architecture.js';
import { PLUGIN_CAPABILITIES } from '@keystone/addons';

const here = dirname(fileURLToPath(import.meta.url));

describe('R0P76 location architecture guards', () => {
  it('keeps location out of route authority and forbids GPS scoring', () => {
    for (const file of ['adaptive-route.ts', 'nearby.ts', 'mesh-routing.ts', 'delay-tolerant.ts', 'gateway.ts']) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(source).not.toMatch(/latitude|longitude|\bGPS\b|geolocation|distanceToDestination|nearestPeer|homeLocation|locationFix/i);
    }
    expect(FABRIC_APPLICATION_MODULES).toContain('location.ts');
    expect(CONNECTIVITY_USE_INVENTORY.find(entry => entry.module === 'location.ts')?.classification).toBe('FABRIC_MIGRATED');
  });

  it('exposes no ambient/global location and only narrow plugin capabilities', () => {
    const source = readFileSync(join(here, 'location.ts'), 'utf8');
    expect(source).not.toMatch(/globalThis\.(?:currentGps|lastCoordinates|location)/i);
    expect(PLUGIN_CAPABILITIES).toEqual(expect.arrayContaining(['location.approximate.once', 'location.precise.once', 'location.foreground', 'location.background']));
    expect(PLUGIN_CAPABILITIES).not.toContain('location.readAll');
  });
});
