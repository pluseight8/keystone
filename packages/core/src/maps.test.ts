import { describe, expect, it } from 'vitest';
import {
  ControlledMapProvider,
  InMemoryMapsStateStore,
  MapProviderRegistry,
  MapsError,
  MapsService,
  NavigationService,
  PlaceSharingService,
  createOfflineMapPackage,
  createPlaceReference,
  registerControlledMapProvider,
  validateCoordinate,
  validateRoute,
  type Place,
  type PlaceCipher,
} from './maps.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import { ControlledLocationProvider, LocationPolicy, LocationService, type LocationCaller, type LocationFix } from './location.js';

const owner: LocationCaller = { id: 'owner', kind: 'OWNER_UI' };
const place = (id = 'place-cafe', coordinates = { latitude: 55.7512, longitude: 37.6184 }): Place => ({ version: 1, placeId: id, displayName: id === 'place-cafe' ? 'Synthetic Cafe' : id, coordinates, address: 'Synthetic Street 1', category: 'cafe', provenance: { kind: 'LOCAL_DATASET', providerId: 'controlled.local', observedAt: new Date(0).toISOString() }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
const viewport = { version: 1 as const, center: { latitude: 55.75, longitude: 37.61 }, zoom: 12, origin: 'MANUAL' as const, updatedAt: new Date(0).toISOString() };
const fix = (timestamp = new Date().toISOString(), precision: 'APPROXIMATE' | 'PRECISE' = 'PRECISE'): LocationFix => ({ latitude: 55.7512, longitude: 37.6184, horizontalAccuracy: precision === 'PRECISE' ? 5 : 1_500, timestamp, provenance: 'CONTROLLED_TEST', precision });

function maps(provider = new ControlledMapProvider({ places: [place()] }), location?: LocationService, store = new InMemoryMapsStateStore()): MapsService {
  const registry = new MapProviderRegistry();
  registerControlledMapProvider(registry, provider);
  return new MapsService({ registry, location, store });
}

describe('R0P82 Maps/Places privacy architecture', () => {
  it('opens and renders a map without requesting current location', async () => {
    const locationProvider = new ControlledLocationProvider(Date.now, 'DENIED');
    const location = new LocationService(locationProvider);
    const service = maps(undefined, location);
    const opened = await service.open();
    expect(opened.location).toBe('NOT_REQUESTED');
    expect(await location.permission()).toMatchObject({ status: 'DENIED' });
    const rendered = await service.map(viewport);
    expect(rendered.layer).toBe('VECTOR');
    expect(rendered.viewport.center).toEqual(viewport.center);
  });

  it('creates portable user places, saves them, organizes them and searches locally', async () => {
    const service = maps();
    const created = await service.createUserPlace({ displayName: 'Meeting point', coordinates: { latitude: 55.7, longitude: 37.6 }, category: 'meeting' });
    const collection = await service.createCollection({ name: 'Trip' });
    const saved = await service.savePlace({ place: created, label: 'Meet here', note: 'User note', tags: ['trip'], collectionIds: [collection.id] });
    await service.addToCollection(collection.id, created.placeId);
    expect(saved.snapshot.provenance.kind).toBe('USER_CREATED');
    expect((await service.searchPlaces({ query: 'Meeting' })).map(value => value.place.placeId)).toContain(created.placeId);
    const link = service.placeLink(created.placeId);
    expect(link).toBe(`keystone://place/${encodeURIComponent(created.placeId)}`);
    expect(createPlaceReference(created).snapshot).not.toHaveProperty('visitedAt');
  });

  it('keeps external provider disclosure opt-in and records only a narrow audit class', async () => {
    const provider = new ControlledMapProvider({ id: 'external.synthetic', class: 'EXTERNAL', places: [place('external-cafe')] });
    const registry = new MapProviderRegistry();
    registerControlledMapProvider(registry, provider);
    const service = new MapsService({ registry });
    expect(await service.searchPlaces({ query: 'external' })).toEqual([]);
    const result = await service.searchPlaces({ query: 'external', providerId: 'external.synthetic', policy: { allowExternalSearch: true } });
    expect(result).toHaveLength(1);
    expect(service.audits(1)[0]).toMatchObject({ providerId: 'external.synthetic', operation: 'SEARCH', includedLocation: 'NONE' });
    expect(JSON.stringify(service.audits())).not.toMatch(/owner|latitude|longitude/);
  });

  it('requires explicit current-location grants and never stores a one-shot fix as viewport history', async () => {
    const provider = new ControlledLocationProvider();
    provider.emit(fix());
    const policy = new LocationPolicy();
    const grant = policy.issue({ principal: owner, capability: 'LOCAL_USE', scope: 'ONE_SHOT', precision: 'APPROXIMATE', durationMs: 60_000, explicitOwnerAction: true });
    const store = new InMemoryMapsStateStore();
    const location = new LocationService(provider, policy, { storage: new InMemoryLocationStateStorageForTest() });
    const service = maps(undefined, location, store);
    const shown = await service.showMyLocation({ grantId: grant.id, caller: owner, explicitOwnerAction: true });
    expect(shown.fix.precision).toBe('APPROXIMATE');
    expect(shown.viewport.origin).toBe('LOCATION_ONE_SHOT');
    await service.setViewport(shown.viewport);
    const persisted = store.snapshot() as { viewport?: { origin: string } };
    expect(persisted.viewport?.origin).not.toBe('LOCATION_ONE_SHOT');
    expect(await service.open()).toMatchObject({ location: 'NOT_REQUESTED' });
  });

  it('plans manual routes without location and validates mode/geometry boundaries', async () => {
    const service = maps();
    const route = await service.planRoute({ origin: { type: 'COORDINATE', coordinates: { latitude: 55.7, longitude: 37.6 } }, destination: { type: 'PLACE', place: place() }, mode: 'WALKING' });
    expect(route.mode).toBe('WALKING');
    expect(route.legs[0]?.steps[0]?.instruction).toBeTruthy();
    await expect(service.planRoute({ origin: { type: 'COORDINATE', coordinates: { latitude: 55.7, longitude: 37.6 } }, destination: { type: 'PLACE', place: place() }, mode: 'TRANSIT' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    expect(() => validateCoordinate({ latitude: Number.NaN, longitude: 0 })).toThrowError(MapsError);
    expect(() => validateRoute({ version: 1, id: 'route', providerId: 'x', mode: 'WALKING', geometry: [], distanceMeters: 1, durationSeconds: 1, legs: [], estimated: true, calculatedAt: new Date().toISOString() })).toThrowError(MapsError);
  });

  it('installs and verifies a bounded offline package, then works in offline-only mode', async () => {
    const provider = new ControlledMapProvider({ places: [place()] });
    const service = maps(provider);
    const offline = await createOfflineMapPackage({ version: 1, id: 'region-test', providerId: provider.descriptor.id, region: { id: 'synthetic-region', name: 'Synthetic Region', bounds: { north: 56, south: 55, east: 38, west: 37 } }, packageVersion: '1', manifest: { contentIds: ['sha256-synthetic'] }, sizeBytes: 2_048, capabilities: ['VECTOR_TILES', 'SEARCH', 'ROUTING', 'WALKING'] });
    await service.installOfflinePackage(offline);
    const map = await service.map(viewport, { policy: { offlineOnly: true } });
    expect(map.offline).toBe(true);
    expect((await service.searchPlaces({ query: 'Synthetic', policy: { offlineOnly: true } })).length).toBe(1);
    const route = await service.planRoute({ origin: { type: 'COORDINATE', coordinates: { latitude: 55.7, longitude: 37.6 } }, destination: { type: 'PLACE', place: place() }, mode: 'WALKING', policy: { offlineOnly: true } });
    expect(route.providerId).toBe(provider.descriptor.id);
    await expect(service.installOfflinePackage({ ...offline, contentHash: 'sha256-forged' })).rejects.toMatchObject({ code: 'INTEGRITY' });
  });

  it('runs an active navigation session through the R0P76 foreground watch and releases it', async () => {
    const locationProvider = new ControlledLocationProvider();
    locationProvider.emit(fix());
    const locationPolicy = new LocationPolicy();
    const grant = locationPolicy.issue({ principal: owner, capability: 'LOCAL_USE', scope: 'FOREGROUND', precision: 'PRECISE', durationMs: 60_000, explicitOwnerAction: true });
    const location = new LocationService(locationProvider, locationPolicy);
    const provider = new ControlledMapProvider({ places: [place()] });
    const service = maps(provider, location);
    const route = await service.planRoute({ origin: { type: 'COORDINATE', coordinates: { latitude: 55.7512, longitude: 37.6184 } }, destination: { type: 'COORDINATE', coordinates: { latitude: 55.752, longitude: 37.62 } }, mode: 'WALKING' });
    const navigation = new NavigationService(location, { routing: provider });
    const session = await navigation.start({ route, grantId: grant.id, caller: owner, ownerConfirmed: true });
    expect(session.state).toBe('ACTIVE');
    locationProvider.emit({ ...fix(), latitude: 55.752, longitude: 37.62, timestamp: new Date().toISOString() });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(navigation.active()?.session.lastFix?.precision).toBe('PRECISE');
    await navigation.end(session.id);
    expect(locationProvider.activeWatches()).toBe(0);
  });

  it('rejects a plugin provider that requests an implicit location capability', () => {
    const registry = new MapProviderRegistry();
    const provider = new ControlledMapProvider({ id: 'plugin.map' });
    expect(() => registerControlledMapProvider(registry, provider, 'PLUGIN')).not.toThrow();
    expect(() => registry.register({ ...provider.registration().registration, requestedCapabilities: ['map.search', 'location.readAll'] }, 'PLUGIN')).toThrowError(MapsError);
  });

  it('shares only an intended Place reference through the delivery boundary', async () => {
    const delivery = new PairDelivery();
    const cipherA = new TestPlaceCipher('alice', 'bob');
    const cipherB = new TestPlaceCipher('bob', 'alice');
    const security = new TestEnvelopeSecurity();
    let received: unknown;
    const bob = new PlaceSharingService({ identityId: 'bob', delivery: delivery.bob, security, cipher: cipherB, onPlace: reference => { received = reference; } });
    const alice = new PlaceSharingService({ identityId: 'alice', delivery: delivery.alice, security, cipher: cipherA });
    const shared = place('private-meeting');
    await alice.sharePlace('bob', shared, 'PRIVATE');
    expect(received).toMatchObject({ placeId: 'private-meeting', kind: 'PLACE' });
    expect(JSON.stringify(delivery.lastBody)).not.toContain('private-meeting');
    expect(JSON.stringify(delivery.lastBody)).not.toContain('55.7512');
    bob.close();
    alice.close();
  });
});

class InMemoryLocationStateStorageForTest {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value; }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

class TestPlaceCipher implements PlaceCipher {
  constructor(private readonly local: string, private readonly peer: string) {}
  async seal(recipient: string, value: unknown) { if (recipient !== this.peer || this.local === recipient) throw new Error('recipient'); return { version: 1 as const, algorithm: 'APPLICATION_E2E' as const, nonce: `${this.local}-nonce`, ciphertext: Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') }; }
  async open(sender: string, value: unknown) { if (sender !== this.peer || !value || typeof value !== 'object') throw new Error('sender'); const ciphertext = (value as { ciphertext?: unknown }).ciphertext; if (typeof ciphertext !== 'string') throw new Error('ciphertext'); return JSON.parse(Buffer.from(ciphertext, 'base64url').toString('utf8')) as unknown; }
}

class TestEnvelopeSecurity implements EnvelopeSecurity {
  async sign(envelope: UnsignedEnvelope): Promise<string> { return `sig:${canonicalEnvelope(envelope)}`; }
  async verify(envelope: Envelope): Promise<boolean> { const { signature: _signature, ...unsigned } = envelope; return envelope.signature === `sig:${canonicalEnvelope(unsigned)}`; }
}

class PairDelivery {
  readonly alice: Endpoint;
  readonly bob: Endpoint;
  lastBody?: unknown;
  constructor() {
    const connect = async (peer: string) => { if (!['alice', 'bob'].includes(peer)) throw new Error('peer'); };
    this.alice = new Endpoint(connect, envelope => this.bob.dispatch(envelope), body => { this.lastBody = body; });
    this.bob = new Endpoint(connect, envelope => this.alice.dispatch(envelope), body => { this.lastBody = body; });
  }
}

class Endpoint implements KeystoneDeliveryInterface {
  private readonly handlers = new Set<(envelope: Envelope) => void | Promise<void>>();
  constructor(private readonly connectPeer: (peer: string) => Promise<void>, private readonly forward: (envelope: Envelope) => Promise<void>, private readonly record: (body: unknown) => void) {}
  connect(peer: string): Promise<void> { return this.connectPeer(peer); }
  async send(envelope: Envelope): Promise<void>;
  async send(peer: string, envelope: Envelope): Promise<void>;
  async send(peerOrEnvelope: string | Envelope, maybeEnvelope?: Envelope): Promise<void> { const envelope = maybeEnvelope ?? peerOrEnvelope as Envelope; this.record(envelope.body); await this.forward(envelope); }
  onMessage(handler: (envelope: Envelope) => void | Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async close(): Promise<void> { this.handlers.clear(); }
  async dispatch(envelope: Envelope): Promise<void> { await Promise.all([...this.handlers].map(handler => handler(envelope))); }
}

function canonicalEnvelope(value: unknown): string { return JSON.stringify(value, Object.keys(value as object).sort()); }
