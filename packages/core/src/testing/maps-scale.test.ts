import { describe, expect, it } from 'vitest';
import {
  ControlledMapProvider,
  InMemoryMapsStateStore,
  MapCache,
  MapProviderRegistry,
  MapsService,
  NavigationService,
  registerControlledMapProvider,
  validateRoute,
  type MapData,
  type Place,
  type SavedPlace,
} from '../maps.js';
import { ControlledLocationProvider, LocationPolicy, LocationService, type LocationCaller } from '../location.js';

const owner: LocationCaller = { id: 'r0p82-scale-owner', kind: 'OWNER_UI' };
const fixedTimestamp = '2026-08-25T10:00:00.000Z';

function scalePlace(index: number): Place {
  const placeId = `scale-place-${index}`;
  return {
    version: 1,
    placeId,
    displayName: `R0P82 Place ${index}`,
    coordinates: { latitude: 55 + (index % 100) * 0.001, longitude: 37 + Math.floor(index / 100) * 0.001 },
    category: index % 2 === 0 ? 'cafe' : 'park',
    provenance: { kind: 'USER_CREATED', observedAt: fixedTimestamp },
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  };
}

function savedPlace(place: Place): SavedPlace {
  return {
    version: 1,
    id: `saved-${place.placeId}`,
    placeId: place.placeId,
    snapshot: {
      version: 1,
      placeId: place.placeId,
      displayName: place.displayName,
      coordinates: place.coordinates,
      category: place.category,
      provenance: place.provenance,
    },
    tags: ['scale'],
    collectionIds: [],
    createdAt: fixedTimestamp,
    updatedAt: fixedTimestamp,
  };
}

function mapData(index: number): MapData {
  return {
    version: 1,
    providerId: 'scale-cache',
    layer: 'VECTOR',
    viewport: { version: 1, center: { latitude: 55 + index * 0.001, longitude: 37 }, zoom: 12, origin: 'MANUAL', updatedAt: fixedTimestamp },
    features: [{ id: `feature-${index}`, kind: 'PLACE', label: `Feature ${index}` }],
    offline: true,
  };
}

describe('R0P82 Maps/Places/Navigation scale and resource bounds', () => {
  it('indexes 10k saved places, bounds map cache, and validates a large route geometry', async () => {
    const places = Array.from({ length: 10_000 }, (_, index) => scalePlace(index));
    const store = new InMemoryMapsStateStore();
    await store.write({ version: 1, places, savedPlaces: places.map(savedPlace), collections: [], offlinePackages: [], revision: 1 });
    const registry = new MapProviderRegistry();
    const provider = new ControlledMapProvider({ id: 'scale.local' });
    registerControlledMapProvider(registry, provider);
    const cache = new MapCache({ maxEntries: 32, maxBytes: 64 * 1024 });
    const service = new MapsService({ registry, store, cache, maxSavedPlaces: 10_000 });
    await service.ready();

    const searchStarted = performance.now();
    const matches = await service.searchPlaces({ query: 'R0P82 Place 9999', limit: 10 });
    const searchDurationMs = Math.round(performance.now() - searchStarted);
    expect(service.listSavedPlaces(10_000)).toHaveLength(10_000);
    expect(matches[0]?.place.placeId).toBe('scale-place-9999');
    expect(searchDurationMs).toBeLessThan(30_000);

    for (let index = 0; index < 256; index += 1) cache.put(`cache-${index}`, 'scale-cache', mapData(index));
    expect(cache.stats().entries).toBeLessThanOrEqual(32);
    expect(cache.stats().bytes).toBeLessThanOrEqual(cache.stats().maxBytes);

    const waypoints = Array.from({ length: 2_500 }, (_, index) => ({ latitude: 55 + index * 0.00001, longitude: 37 + index * 0.00001 }));
    const routeStarted = performance.now();
    const route = validateRoute({
      version: 1,
      id: 'scale-route',
      providerId: provider.descriptor.id,
      mode: 'WALKING',
      geometry: waypoints,
      distanceMeters: 100_000,
      durationSeconds: 10_000,
      legs: [{ id: 'scale-leg', origin: waypoints[0]!, destination: waypoints.at(-1)!, distanceMeters: 100_000, durationSeconds: 10_000, steps: [{ id: 'scale-step', instruction: 'Continue along the bounded geometry', distanceMeters: 100_000, durationSeconds: 10_000, geometry: waypoints }] }],
      estimated: true,
      calculatedAt: fixedTimestamp,
    }, provider.descriptor);
    const routeDurationMs = Math.round(performance.now() - routeStarted);
    expect(route.geometry).toHaveLength(2_500);
    expect(route.legs).toHaveLength(1);
    expect(routeDurationMs).toBeLessThan(30_000);
    console.log(`[R0P82-PERF] ${JSON.stringify({ savedPlaces: 10_000, searchDurationMs, cacheEntries: cache.stats().entries, routePoints: route.geometry.length, routeDurationMs })}`);
  }, 180_000);

  it('completes 100 foreground navigation lifecycles without watch or session leakage', async () => {
    const provider = new ControlledLocationProvider();
    const policy = new LocationPolicy();
    const grant = policy.issue({ principal: owner, capability: 'LOCAL_USE', scope: 'FOREGROUND', precision: 'PRECISE', durationMs: 30 * 60_000, explicitOwnerAction: true });
    const location = new LocationService(provider, policy);
    const mapsProvider = new ControlledMapProvider({ id: 'navigation.scale' });
    const registry = new MapProviderRegistry();
    registerControlledMapProvider(registry, mapsProvider);
    const maps = new MapsService({ registry });
    const route = await maps.planRoute({ origin: { type: 'COORDINATE', coordinates: { latitude: 55.751, longitude: 37.618 } }, destination: { type: 'COORDINATE', coordinates: { latitude: 55.752, longitude: 37.619 } }, mode: 'WALKING' });
    const navigation = new NavigationService(location, { routing: mapsProvider, updateIntervalMs: 0 });

    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const session = await navigation.start({ route, grantId: grant.id, caller: owner, ownerConfirmed: true });
      expect(session.state).toBe('ACTIVE');
      await navigation.end(session.id);
    }
    const durationMs = Math.round(performance.now() - started);
    expect(navigation.active()).toBeUndefined();
    expect(provider.activeWatches()).toBe(0);
    expect(durationMs).toBeLessThan(30_000);
    await navigation.shutdown();
    await location.shutdown();
    console.log(`[R0P82-PERF] ${JSON.stringify({ navigationCycles: 100, durationMs, activeWatches: provider.activeWatches() })}`);
  }, 180_000);
});
