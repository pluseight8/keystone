/**
 * R0P82 privacy-first Maps, Places and Navigation.
 *
 * This module owns portable geographic objects and provider boundaries. It
 * deliberately does not own a device location provider, a network transport,
 * a tile vendor, or a location history. Current position enters only through
 * an explicit R0P76 LocationService grant supplied by the caller.
 */

import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import { canonicalJson } from './crypto.js';
import {
  coarsenLocationFix,
  locationFreshness,
  type LocationCaller,
  type LocationFix,
  type LocationPrecision,
  type LocationService,
} from './location.js';
import { SodiumDirectMessageCipher } from './social/messaging.js';
import { sha256 } from './social/content.js';
import type { DeviceSessionKeys } from './identity.js';
import type { NodeId } from './types.js';

export const MAPS_PROTOCOL = 'keystone.maps.r0p82' as const;
export const MAPS_VERSION = 1 as const;
export const MAPS_PLACE_ENVELOPE = 'maps.place.share' as const;
export const MAPS_MAX_SAVED_PLACES = 100_000;
export const MAPS_MAX_COLLECTIONS = 10_000;
export const MAPS_MAX_PLACE_RESULTS = 1_000;
export const MAPS_MAX_PLACE_TEXT = 4_096;
export const MAPS_MAX_METADATA = 32;
export const MAPS_MAX_ROUTE_POINTS = 50_000;
export const MAPS_MAX_ROUTE_LEGS = 256;
export const MAPS_MAX_ROUTE_STEPS = 4_096;
export const MAPS_MAX_ROUTE_TEXT = 512;
export const MAPS_MAX_OFFLINE_PACKAGES = 256;
export const MAPS_MAX_CACHE_ENTRIES = 2_048;
export const MAPS_MAX_AUDIT_ENTRIES = 512;
export const MAPS_MAX_NAVIGATION_REROUTES = 8;
export const MAPS_MAX_NAVIGATION_SESSIONS = 1;
export const MAPS_DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
export const MAPS_DEFAULT_NAVIGATION_UPDATE_INTERVAL_MS = 250;
export const MAPS_DEFAULT_REROUTE_INTERVAL_MS = 15_000;
export const MAPS_DEFAULT_REROUTE_DEVIATION_METERS = 120;

/** Machine-readable architecture assertions used by the R0P82 guard tests. */
export const MAPS_ARCHITECTURE_POLICY = Object.freeze({
  directNativeLocationImports: 0,
  ipGeolocationFallbacks: 0,
  rawTransportImports: 0,
  rawHyperswarmImports: 0,
  connectivityRouteSelectionBranches: 0,
  persistentMovementHistory: 0,
  automaticHomeWorkInference: 0,
  implicitPluginLocationGrant: 0,
  externalAiImplicitContext: 0,
  mandatoryPublicProvider: 0,
  restrictedProviderRedistribution: 0,
  geographicConnectivityRouteCoupling: 0,
  legacyBypass: 0,
  directApplicationBypassAllowed: false,
  silentLegacyFallbackAllowed: false,
} as const);

export type MapProviderClass = 'LOCAL' | 'OFFLINE' | 'EXTERNAL';
export type MapProviderSource = 'CORE' | 'PLUGIN' | 'HOST';
export type MapCapability =
  | 'VECTOR_TILES'
  | 'RASTER_TILES'
  | 'OFFLINE_REGION'
  | 'LOCAL_DATASET'
  | 'SEARCH'
  | 'GEOCODING'
  | 'REVERSE_GEOCODING'
  | 'ROUTING'
  | 'WALKING'
  | 'DRIVING'
  | 'CYCLING'
  | 'TRANSIT'
  | 'TURN_BY_TURN'
  | 'VOICE_GUIDANCE';
export type MapRouteMode = 'WALKING' | 'DRIVING' | 'CYCLING' | 'TRANSIT';
export type MapViewportOrigin = 'MANUAL' | 'RESTORED' | 'PLACE_SELECTED' | 'USER_GESTURE' | 'LOCATION_ONE_SHOT';
export type MapLayerKind = 'VECTOR' | 'RASTER' | 'SCHEMATIC';
export type MapAuditLocationClass = 'NONE' | 'APPROXIMATE' | 'PRECISE';
export type MapSearchResultSource = 'LOCAL' | 'OFFLINE' | 'EXTERNAL' | 'RECEIVED_KEYSTONE';

export interface GeoCoordinate {
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeoBounds {
  readonly north: number;
  readonly south: number;
  readonly east: number;
  readonly west: number;
}

export interface MapViewport {
  readonly version: 1;
  readonly center: GeoCoordinate;
  readonly zoom: number;
  readonly bearing?: number;
  readonly pitch?: number;
  readonly origin: MapViewportOrigin;
  readonly updatedAt: string;
}

export interface MapPrivacyPolicy {
  /** Offline-only is a hard no-external-request mode. */
  readonly offlineOnly?: boolean;
  readonly allowExternalMapData?: boolean;
  readonly allowExternalSearch?: boolean;
  readonly allowExternalGeocoding?: boolean;
  readonly allowExternalRouting?: boolean;
  /** Current position is never implied by this flag; the caller must also pass a grant. */
  readonly includeCurrentLocation?: boolean;
  readonly currentLocationPrecision?: LocationPrecision;
  /** Choosing a provider is an explicit caller/user decision. */
  readonly providerId?: string;
}

export interface NormalizedMapPrivacyPolicy {
  readonly offlineOnly: boolean;
  readonly allowExternalMapData: boolean;
  readonly allowExternalSearch: boolean;
  readonly allowExternalGeocoding: boolean;
  readonly allowExternalRouting: boolean;
  readonly includeCurrentLocation: boolean;
  readonly currentLocationPrecision: LocationPrecision;
  readonly providerId?: string;
}

export const DEFAULT_MAP_PRIVACY_POLICY: NormalizedMapPrivacyPolicy = Object.freeze({
  offlineOnly: false,
  allowExternalMapData: false,
  allowExternalSearch: false,
  allowExternalGeocoding: false,
  allowExternalRouting: false,
  includeCurrentLocation: false,
  currentLocationPrecision: 'APPROXIMATE',
});

export interface MapProviderDescriptor {
  readonly id: string;
  readonly name: string;
  readonly class: MapProviderClass;
  readonly capabilities: readonly MapCapability[];
  readonly attribution?: string;
  readonly license?: string;
  readonly privacyNote?: string;
  /** A reference resolved by the host secret boundary; never a credential value. */
  readonly credentialRef?: string;
}

export interface MapFeature {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly geometry?: readonly GeoCoordinate[];
}

export interface MapData {
  readonly version: 1;
  readonly providerId: string;
  readonly layer: MapLayerKind;
  readonly viewport: MapViewport;
  readonly features: readonly MapFeature[];
  readonly offline: boolean;
  readonly attribution?: string;
}

export interface MapDataRequest {
  readonly viewport: MapViewport;
  readonly bounds?: GeoBounds;
  readonly policy: NormalizedMapPrivacyPolicy;
}

export interface MapDataProvider {
  readonly descriptor: MapProviderDescriptor;
  map(request: MapDataRequest): Promise<MapData>;
}

export interface PlaceProviderProvenance {
  readonly kind: 'LOCAL_DATASET' | 'OFFLINE_DATASET' | 'EXTERNAL_PROVIDER' | 'USER_CREATED' | 'RECEIVED_KEYSTONE' | 'PUBLICATION';
  readonly providerId?: string;
  readonly providerPlaceId?: string;
  readonly sourceReference?: string;
  readonly license?: string;
  readonly observedAt: string;
}

export interface Place {
  readonly version: 1;
  readonly placeId: string;
  readonly displayName: string;
  readonly coordinates?: GeoCoordinate;
  readonly approximateRegion?: string;
  readonly address?: string;
  readonly category?: string;
  readonly provenance: PlaceProviderProvenance;
  readonly publicMetadata?: Readonly<Record<string, string>>;
  readonly website?: string;
  readonly phone?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PlaceSnapshot = Pick<Place, 'version' | 'placeId' | 'displayName' | 'coordinates' | 'approximateRegion' | 'address' | 'category' | 'provenance' | 'publicMetadata' | 'website' | 'phone'>;

export interface PlaceReference {
  readonly version: 1;
  readonly kind: 'PLACE';
  readonly placeId: string;
  readonly uri: string;
  readonly snapshot: PlaceSnapshot;
}

export interface SavedPlace {
  readonly version: 1;
  readonly id: string;
  readonly placeId: string;
  readonly snapshot: PlaceSnapshot;
  readonly label?: string;
  readonly note?: string;
  readonly tags: readonly string[];
  readonly collectionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlaceCollection {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly placeIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlaceSearchQuery {
  readonly query: string;
  readonly viewport?: MapViewport;
  /** Manually selected or explicitly authorized current position. */
  readonly near?: GeoCoordinate;
  readonly limit: number;
  readonly policy: NormalizedMapPrivacyPolicy;
}

export interface PlaceSearchResult {
  readonly place: Place;
  readonly score: number;
  readonly providerId: string;
  readonly source: MapSearchResultSource;
  readonly distanceMeters?: number;
}

export interface PlaceSearchProvider {
  readonly descriptor: MapProviderDescriptor;
  search(request: PlaceSearchQuery): Promise<readonly PlaceSearchResult[]>;
}

export interface ForwardGeocodeRequest {
  readonly address: string;
  readonly policy: NormalizedMapPrivacyPolicy;
}

export interface ReverseGeocodeRequest {
  readonly coordinates: GeoCoordinate;
  readonly policy: NormalizedMapPrivacyPolicy;
}

export interface GeocodingProvider {
  readonly descriptor: MapProviderDescriptor;
  forward(request: ForwardGeocodeRequest): Promise<Place | undefined>;
  reverse(request: ReverseGeocodeRequest): Promise<Place | undefined>;
}

export type RouteEndpoint =
  | { readonly type: 'PLACE'; readonly place: Place | PlaceReference }
  | { readonly type: 'COORDINATE'; readonly coordinates: GeoCoordinate; readonly label?: string }
  | { readonly type: 'CURRENT_LOCATION'; readonly grantId: string; readonly caller: LocationCaller };

export interface RouteRequest {
  readonly origin: GeoCoordinate;
  readonly destination: GeoCoordinate;
  readonly waypoints?: readonly GeoCoordinate[];
  readonly mode: MapRouteMode;
  readonly policy: NormalizedMapPrivacyPolicy;
}

export interface RouteStep {
  readonly id: string;
  readonly instruction: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly geometry: readonly GeoCoordinate[];
  readonly roadLabel?: string;
}

export interface RouteLeg {
  readonly id: string;
  readonly origin: GeoCoordinate;
  readonly destination: GeoCoordinate;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly steps: readonly RouteStep[];
}

export interface GeographicRoute {
  readonly version: 1;
  readonly id: string;
  readonly providerId: string;
  readonly mode: MapRouteMode;
  readonly geometry: readonly GeoCoordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly legs: readonly RouteLeg[];
  readonly estimated: true;
  readonly attribution?: string;
  readonly calculatedAt: string;
}

export type MapRoute = GeographicRoute;

export interface RoutingProvider {
  readonly descriptor: MapProviderDescriptor;
  route(request: RouteRequest): Promise<GeographicRoute>;
}

export interface OfflineMapRegion {
  readonly id: string;
  readonly name: string;
  readonly bounds: GeoBounds;
}

export interface OfflineMapPackageInput {
  readonly version: 1;
  readonly id: string;
  readonly providerId: string;
  readonly region: OfflineMapRegion;
  readonly packageVersion: string;
  readonly manifest: {
    readonly contentIds: readonly string[];
    readonly featureCount?: number;
  };
  readonly sizeBytes: number;
  readonly capabilities: readonly MapCapability[];
  readonly attribution?: string;
  readonly license?: string;
}

export interface OfflineMapPackage extends OfflineMapPackageInput {
  readonly contentHash: string;
  readonly installedAt: string;
}

export interface OfflineMapProvider {
  readonly descriptor: MapProviderDescriptor;
  listInstalled(): Promise<readonly OfflineMapPackage[]>;
  install(value: OfflineMapPackage): Promise<void>;
  remove(packageId: string): Promise<void>;
}

export interface MapProviderRegistration {
  readonly descriptor: MapProviderDescriptor;
  readonly mapData?: MapDataProvider;
  readonly search?: PlaceSearchProvider;
  readonly geocoding?: GeocodingProvider;
  readonly routing?: RoutingProvider;
  readonly offline?: OfflineMapProvider;
  /** Plugins may expose map capabilities, never an implicit location capability. */
  readonly requestedCapabilities?: readonly string[];
}

export interface MapProviderState {
  readonly descriptor: MapProviderDescriptor;
  readonly source: MapProviderSource;
  readonly operations: readonly ('MAP_DATA' | 'SEARCH' | 'GEOCODING' | 'ROUTING' | 'OFFLINE')[];
}

export class MapsError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'PRIVACY_POLICY' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'BOUNDS_EXCEEDED' | 'INTEGRITY' | 'NOT_AUTHORIZED' | 'REPLAY' | 'PROVIDER_FAILURE' | 'LOCATION_REQUIRED' | 'RESOURCE_EXHAUSTED' | 'STALE_FIX', message: string) {
    super(message);
    this.name = 'MapsError';
  }
}

export class MapProviderRegistry {
  private readonly providers = new Map<string, { readonly registration: MapProviderRegistration; readonly source: MapProviderSource }>();

  register(registration: MapProviderRegistration, source: MapProviderSource = 'CORE'): void {
    validateProviderDescriptor(registration.descriptor);
    if (source === 'PLUGIN' && (registration.requestedCapabilities ?? []).some(value => /location|current.?position|movement/i.test(value))) throw new MapsError('NOT_AUTHORIZED', 'A map provider plugin cannot request LocationService access');
    if (registration.mapData && registration.mapData.descriptor.id !== registration.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Map data provider id does not match its registration');
    if (registration.search && registration.search.descriptor.id !== registration.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Place search provider id does not match its registration');
    if (registration.geocoding && registration.geocoding.descriptor.id !== registration.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Geocoding provider id does not match its registration');
    if (registration.routing && registration.routing.descriptor.id !== registration.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Routing provider id does not match its registration');
    if (registration.offline && registration.offline.descriptor.id !== registration.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Offline provider id does not match its registration');
    this.providers.set(registration.descriptor.id, { registration, source });
  }

  unregister(providerId: string): boolean { return this.providers.delete(providerId); }
  get(providerId: string): MapProviderRegistration | undefined { return this.providers.get(providerId)?.registration; }
  source(providerId: string): MapProviderSource | undefined { return this.providers.get(providerId)?.source; }
  list(): readonly MapProviderState[] {
    return [...this.providers.values()].map(({ registration, source }) => ({
      descriptor: structuredClone(registration.descriptor),
      source,
      operations: [
        ...(registration.mapData ? ['MAP_DATA' as const] : []),
        ...(registration.search ? ['SEARCH' as const] : []),
        ...(registration.geocoding ? ['GEOCODING' as const] : []),
        ...(registration.routing ? ['ROUTING' as const] : []),
        ...(registration.offline ? ['OFFLINE' as const] : []),
      ],
    }));
  }

  pick(operation: 'MAP_DATA' | 'SEARCH' | 'GEOCODING' | 'ROUTING' | 'OFFLINE', policy: NormalizedMapPrivacyPolicy, preferredId?: string): MapProviderRegistration | undefined {
    const candidates = [...this.providers.values()].filter(({ registration }) => hasOperation(registration, operation));
    if (preferredId || policy.providerId) {
      const id = preferredId ?? policy.providerId!;
      const selected = candidates.find(value => value.registration.descriptor.id === id);
      if (!selected) throw new MapsError('NOT_FOUND', `Map provider ${id} is not available for ${operation}`);
      if (!providerAllowed(selected.registration.descriptor, operation, policy)) throw new MapsError('PRIVACY_POLICY', `Map provider ${id} is not allowed by the current privacy policy`);
      return selected.registration;
    }
    return candidates
      .filter(value => providerAllowed(value.registration.descriptor, operation, policy))
      .sort((left, right) => providerClassRank(left.registration.descriptor.class) - providerClassRank(right.registration.descriptor.class) || left.registration.descriptor.id.localeCompare(right.registration.descriptor.id))[0]?.registration;
  }
}

export interface MapCacheEntry {
  readonly key: string;
  readonly providerId: string;
  readonly bytes: number;
  readonly value: MapData;
  readonly lastAccessedAt: number;
}

export interface MapCacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export class MapCache {
  private readonly entries = new Map<string, MapCacheEntry>();
  private usedBytes = 0;
  private maxEntries: number;
  private maxBytes: number;

  constructor(options: { readonly maxEntries?: number; readonly maxBytes?: number } = {}, private readonly now: () => number = Date.now) {
    this.maxEntries = boundedInt(options.maxEntries ?? 256, 1, MAPS_MAX_CACHE_ENTRIES);
    this.maxBytes = boundedInt(options.maxBytes ?? MAPS_DEFAULT_CACHE_BYTES, 1, 512 * 1024 * 1024);
  }

  get(key: string): MapData | undefined {
    const current = this.entries.get(key);
    if (!current) return undefined;
    const next = { ...current, lastAccessedAt: this.now() };
    this.entries.set(key, next);
    return structuredClone(next.value);
  }

  put(key: string, providerId: string, value: MapData): void {
    const bytes = estimateBytes(value);
    if (bytes > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) this.usedBytes -= old.bytes;
    this.entries.set(key, { key, providerId, bytes, value: structuredClone(value), lastAccessedAt: this.now() });
    this.usedBytes += bytes;
    this.evict();
  }

  remove(key: string): boolean {
    const old = this.entries.get(key);
    if (!old) return false;
    this.usedBytes -= old.bytes;
    this.entries.delete(key);
    return true;
  }

  clear(): void { this.entries.clear(); this.usedBytes = 0; }
  stats(): MapCacheStats { return { entries: this.entries.size, bytes: this.usedBytes, maxEntries: this.maxEntries, maxBytes: this.maxBytes }; }
  list(): readonly MapCacheEntry[] { return [...this.entries.values()].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt).map(value => structuredClone(value)); }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.usedBytes > this.maxBytes) {
      const oldest = [...this.entries.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0];
      if (!oldest) break;
      this.remove(oldest.key);
    }
  }
}

export interface MapsStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryMapsStateStore implements MapsStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
  snapshot(): unknown { return this.value === undefined ? undefined : structuredClone(this.value); }
}

export interface MapPrivacyAuditEntry {
  readonly id: string;
  readonly providerId: string;
  readonly providerClass: MapProviderClass;
  readonly operation: 'MAP_DATA' | 'SEARCH' | 'FORWARD_GEOCODE' | 'REVERSE_GEOCODE' | 'ROUTING' | 'OFFLINE';
  readonly includedLocation: MapAuditLocationClass;
  readonly at: string;
}

export interface MapSurfaceState {
  readonly version: 1;
  readonly viewport: MapViewport;
  readonly providers: readonly MapProviderState[];
  readonly location: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'AVAILABLE_BY_EXPLICIT_ACTION';
  readonly externalProviderDisclosure: string;
}

export interface MapsEvent {
  readonly type: 'PLACE_CHANGED' | 'COLLECTION_CHANGED' | 'VIEWPORT_CHANGED' | 'OFFLINE_CHANGED' | 'PROVIDER_AUDIT';
  readonly id?: string;
}

export interface MapsServiceOptions {
  readonly registry?: MapProviderRegistry;
  readonly location?: LocationService;
  readonly store?: MapsStateStore;
  readonly cache?: MapCache;
  readonly now?: () => number;
  readonly maxSavedPlaces?: number;
  readonly maxCollections?: number;
  readonly maxOfflinePackages?: number;
  readonly auditLimit?: number;
}

interface PersistedMapsState {
  readonly version: 1;
  readonly places: readonly Place[];
  readonly savedPlaces: readonly SavedPlace[];
  readonly collections: readonly PlaceCollection[];
  readonly viewport?: MapViewport;
  readonly offlinePackages: readonly OfflineMapPackage[];
  readonly revision: number;
}

export interface SavePlaceInput {
  readonly place: Place | PlaceReference;
  readonly label?: string;
  readonly note?: string;
  readonly tags?: readonly string[];
  readonly collectionIds?: readonly string[];
}

export interface CreateUserPlaceInput {
  readonly placeId?: string;
  readonly displayName: string;
  readonly coordinates?: GeoCoordinate;
  readonly approximateRegion?: string;
  readonly address?: string;
  readonly category?: string;
  readonly website?: string;
  readonly phone?: string;
}

export interface CreateCollectionInput {
  readonly id?: string;
  readonly name: string;
  readonly description?: string;
}

export interface SearchPlacesInput {
  readonly query: string;
  readonly viewport?: MapViewport;
  readonly near?: GeoCoordinate;
  readonly currentLocation?: { readonly grantId: string; readonly caller: LocationCaller };
  readonly policy?: MapPrivacyPolicy;
  readonly providerId?: string;
  readonly limit?: number;
}

export interface ShowMyLocationInput {
  readonly grantId: string;
  readonly caller: LocationCaller;
  readonly explicitOwnerAction: boolean;
}

export interface PlanRouteInput {
  readonly origin: RouteEndpoint;
  readonly destination: RouteEndpoint;
  readonly waypoints?: readonly RouteEndpoint[];
  readonly mode: MapRouteMode;
  readonly policy?: MapPrivacyPolicy;
  readonly providerId?: string;
}

export class MapsService {
  readonly registry: MapProviderRegistry;
  readonly cache: MapCache;
  private readonly location?: LocationService;
  private readonly store: MapsStateStore;
  private readonly now: () => number;
  private readonly maxSavedPlaces: number;
  private readonly maxCollections: number;
  private readonly maxOfflinePackages: number;
  private readonly auditLimit: number;
  private readonly places = new Map<string, Place>();
  private readonly savedPlaces = new Map<string, SavedPlace>();
  private readonly collections = new Map<string, PlaceCollection>();
  private readonly offlinePackages = new Map<string, OfflineMapPackage>();
  private readonly auditEntries: MapPrivacyAuditEntry[] = [];
  private readonly listeners = new Set<(event: MapsEvent) => void | Promise<void>>();
  private viewport: MapViewport;
  private revision = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;

  constructor(options: MapsServiceOptions = {}) {
    this.registry = options.registry ?? new MapProviderRegistry();
    this.location = options.location;
    this.store = options.store ?? new InMemoryMapsStateStore();
    this.cache = options.cache ?? new MapCache({}, options.now ?? Date.now);
    this.now = options.now ?? Date.now;
    this.viewport = defaultViewport(new Date(this.now()).toISOString());
    this.maxSavedPlaces = boundedInt(options.maxSavedPlaces ?? MAPS_MAX_SAVED_PLACES, 1, MAPS_MAX_SAVED_PLACES);
    this.maxCollections = boundedInt(options.maxCollections ?? MAPS_MAX_COLLECTIONS, 1, MAPS_MAX_COLLECTIONS);
    this.maxOfflinePackages = boundedInt(options.maxOfflinePackages ?? MAPS_MAX_OFFLINE_PACKAGES, 1, MAPS_MAX_OFFLINE_PACKAGES);
    this.auditLimit = boundedInt(options.auditLimit ?? MAPS_MAX_AUDIT_ENTRIES, 1, MAPS_MAX_AUDIT_ENTRIES);
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }
  subscribe(listener: (event: MapsEvent) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  providerStates(): readonly MapProviderState[] { return this.registry.list(); }
  audits(limit = 100): readonly MapPrivacyAuditEntry[] { return this.auditEntries.slice(-boundedInt(limit, 1, this.auditLimit)).map(value => structuredClone(value)); }
  getViewport(): MapViewport { return structuredClone(this.viewport); }

  async open(): Promise<MapSurfaceState> {
    await this.ready();
    return {
      version: 1,
      viewport: this.getViewport(),
      providers: this.providerStates(),
      location: 'NOT_REQUESTED',
      externalProviderDisclosure: 'External map tiles, search, geocoding and routing may reveal the geographic query or viewed region to the selected provider. Keystone Identity is not attached automatically.',
    };
  }

  async setViewport(viewport: MapViewport): Promise<MapViewport> {
    await this.ready();
    const validated = validateViewport(viewport);
    this.viewport = validated.origin === 'LOCATION_ONE_SHOT' ? { ...validated, origin: 'PLACE_SELECTED' } : validated;
    await this.persist();
    this.emit({ type: 'VIEWPORT_CHANGED' });
    return this.getViewport();
  }

  async map(viewport = this.viewport, input: { readonly policy?: MapPrivacyPolicy; readonly providerId?: string } = {}): Promise<MapData> {
    await this.ready();
    const policy = normalizePolicy(input.policy);
    const selected = this.registry.pick('MAP_DATA', policy, input.providerId);
    if (!selected?.mapData) return schematicMap(validateViewport(viewport));
    const requestViewport = validateViewport(viewport);
    const cacheKey = `${selected.descriptor.id}:${canonicalJson(requestViewport)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    this.audit(selected.descriptor, 'MAP_DATA', 'NONE');
    try {
      const value = validateMapData(await selected.mapData.map({ viewport: requestViewport, policy }), selected.descriptor);
      this.cache.put(cacheKey, selected.descriptor.id, value);
      return value;
    } catch (error) {
      // Provider failure degrades to an honest schematic state. It does not
      // silently select another provider with different disclosure rules.
      return schematicMap(requestViewport, selected.descriptor.id, error instanceof Error ? error.message : 'Provider unavailable');
    }
  }

  async showMyLocation(input: ShowMyLocationInput): Promise<{ readonly fix: LocationFix; readonly viewport: MapViewport }> {
    await this.ready();
    if (!input.explicitOwnerAction || !this.location) throw new MapsError('LOCATION_REQUIRED', 'Showing current position requires an explicit R0P76 action and a LocationService');
    const fix = await this.location.current(input.grantId, input.caller);
    const viewport: MapViewport = { version: 1, center: { latitude: fix.latitude, longitude: fix.longitude }, zoom: 16, origin: 'LOCATION_ONE_SHOT', updatedAt: new Date(this.now()).toISOString() };
    return { fix: structuredClone(fix), viewport };
  }

  async searchPlaces(input: SearchPlacesInput): Promise<readonly PlaceSearchResult[]> {
    await this.ready();
    const policy = normalizePolicy(input.policy);
    const query = boundedText(input.query, 512, true).toLocaleLowerCase();
    const limit = boundedInt(input.limit ?? 50, 1, MAPS_MAX_PLACE_RESULTS);
    let near = input.near ? validateCoordinate(input.near) : undefined;
    let includedLocation: MapAuditLocationClass = 'NONE';
    if (input.currentLocation) {
      if (!policy.includeCurrentLocation || !this.location) throw new MapsError('PRIVACY_POLICY', 'Current position must be explicitly authorized for this search');
      const fix = await this.location.current(input.currentLocation.grantId, input.currentLocation.caller);
      const wanted = policy.currentLocationPrecision;
      if (wanted === 'PRECISE' && fix.precision !== 'PRECISE') throw new MapsError('LOCATION_REQUIRED', 'The search requested precise location but the grant is approximate');
      const disclosed = wanted === 'APPROXIMATE' ? coarsenLocationFix(fix) : fix;
      near = { latitude: disclosed.latitude, longitude: disclosed.longitude };
      includedLocation = disclosed.precision;
    }
    const local = this.localSearch(query, near, limit);
    const selected = this.registry.pick('SEARCH', policy, input.providerId);
    if (!selected?.search) return local;
    this.audit(selected.descriptor, 'SEARCH', includedLocation);
    try {
      const remote = (await selected.search.search({ query: input.query.trim(), ...(input.viewport ? { viewport: validateViewport(input.viewport) } : {}), ...(near ? { near } : {}), limit, policy })).slice(0, limit).map(value => validateSearchResult(value, selected.descriptor));
      return mergeSearchResults([...local, ...remote], limit);
    } catch {
      // Local results remain useful when an explicitly allowed provider fails.
      return local;
    }
  }

  async forwardGeocode(address: string, input: { readonly policy?: MapPrivacyPolicy; readonly providerId?: string } = {}): Promise<Place | undefined> {
    await this.ready();
    const policy = normalizePolicy(input.policy);
    const provider = this.registry.pick('GEOCODING', policy, input.providerId);
    if (!provider?.geocoding) return undefined;
    this.audit(provider.descriptor, 'FORWARD_GEOCODE', 'NONE');
    try { return cloneOptionalPlace(await provider.geocoding.forward({ address: boundedText(address, 512, true), policy }), provider.descriptor); } catch { return undefined; }
  }

  async reverseGeocode(coordinates: GeoCoordinate, input: { readonly policy?: MapPrivacyPolicy; readonly providerId?: string } = {}): Promise<Place | undefined> {
    await this.ready();
    const policy = normalizePolicy(input.policy);
    const point = validateCoordinate(coordinates);
    const provider = this.registry.pick('GEOCODING', policy, input.providerId);
    if (!provider?.geocoding) return undefined;
    this.audit(provider.descriptor, 'REVERSE_GEOCODE', 'PRECISE');
    try { return cloneOptionalPlace(await provider.geocoding.reverse({ coordinates: point, policy }), provider.descriptor); } catch { return undefined; }
  }

  async planRoute(input: PlanRouteInput): Promise<GeographicRoute> {
    await this.ready();
    const policy = normalizePolicy(input.policy);
    const origin = await this.resolveEndpoint(input.origin, policy);
    const destination = await this.resolveEndpoint(input.destination, policy);
    const waypoints: GeoCoordinate[] = [];
    let includedLocation: MapAuditLocationClass = 'NONE';
    if (origin.fromCurrent || destination.fromCurrent) includedLocation = policy.currentLocationPrecision;
    for (const endpoint of input.waypoints ?? []) {
      const resolved = await this.resolveEndpoint(endpoint, policy);
      waypoints.push(resolved.coordinates);
      if (resolved.fromCurrent) includedLocation = policy.currentLocationPrecision;
    }
    const provider = this.registry.pick('ROUTING', policy, input.providerId);
    if (!provider?.routing) throw new MapsError('UNAVAILABLE', 'No compatible routing provider is installed');
    this.audit(provider.descriptor, 'ROUTING', includedLocation);
    try {
      return validateRoute(await provider.routing.route({ origin: origin.coordinates, destination: destination.coordinates, ...(waypoints.length ? { waypoints } : {}), mode: input.mode, policy }), provider.descriptor);
    } catch (error) {
      if (error instanceof MapsError) throw error;
      throw new MapsError('PROVIDER_FAILURE', error instanceof Error ? error.message : 'Routing provider failed');
    }
  }

  async createUserPlace(input: CreateUserPlaceInput): Promise<Place> {
    await this.ready();
    const timestamp = new Date(this.now()).toISOString();
    const place = validatePlace({ version: 1, placeId: input.placeId ?? randomId('place'), displayName: input.displayName, ...(input.coordinates ? { coordinates: input.coordinates } : {}), ...(input.approximateRegion ? { approximateRegion: input.approximateRegion } : {}), ...(input.address ? { address: input.address } : {}), ...(input.category ? { category: input.category } : {}), provenance: { kind: 'USER_CREATED', observedAt: timestamp }, ...(input.website ? { website: input.website } : {}), ...(input.phone ? { phone: input.phone } : {}), createdAt: timestamp, updatedAt: timestamp });
    if (this.places.size >= this.maxSavedPlaces) throw new MapsError('RESOURCE_EXHAUSTED', 'Local place bound exceeded');
    this.places.set(place.placeId, place);
    await this.persist();
    this.emit({ type: 'PLACE_CHANGED', id: place.placeId });
    return structuredClone(place);
  }

  async savePlace(input: SavePlaceInput): Promise<SavedPlace> {
    await this.ready();
    if (this.savedPlaces.size >= this.maxSavedPlaces) throw new MapsError('RESOURCE_EXHAUSTED', 'Saved place bound exceeded');
    const source = 'snapshot' in input.place ? input.place.snapshot : input.place;
    const place = validatePlace(source);
    const collectionIds = [...new Set((input.collectionIds ?? []).map(value => safeId(value, 256) ? value : (() => { throw new MapsError('INVALID_ARGUMENT', 'Place collection id is invalid'); })()))];
    if (collectionIds.some(id => !this.collections.has(id))) throw new MapsError('NOT_FOUND', 'Place collection was not found');
    this.places.set(place.placeId, place);
    const now = new Date(this.now()).toISOString();
    const existing = [...this.savedPlaces.values()].find(value => value.placeId === place.placeId);
    const saved: SavedPlace = { version: 1, id: existing?.id ?? randomId('saved-place'), placeId: place.placeId, snapshot: placeSnapshot(place), ...(input.label?.trim() ? { label: boundedText(input.label, 256) } : {}), ...(input.note?.trim() ? { note: boundedText(input.note, 8_192) } : {}), tags: normalizeTags(input.tags), collectionIds, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.savedPlaces.set(saved.id, saved);
    await this.persist();
    this.emit({ type: 'PLACE_CHANGED', id: saved.id });
    return structuredClone(saved);
  }

  async createCollection(input: CreateCollectionInput): Promise<PlaceCollection> {
    await this.ready();
    if (this.collections.size >= this.maxCollections) throw new MapsError('RESOURCE_EXHAUSTED', 'Place collection bound exceeded');
    const id = input.id ?? randomId('place-collection');
    if (!safeId(id, 256)) throw new MapsError('INVALID_ARGUMENT', 'Place collection id is invalid');
    if (this.collections.has(id)) throw new MapsError('INVALID_ARGUMENT', 'Place collection already exists');
    const now = new Date(this.now()).toISOString();
    const collection: PlaceCollection = { version: 1, id, name: boundedText(input.name, 256, true), ...(input.description?.trim() ? { description: boundedText(input.description, 2_048) } : {}), placeIds: [], createdAt: now, updatedAt: now };
    this.collections.set(id, collection);
    await this.persist();
    this.emit({ type: 'COLLECTION_CHANGED', id });
    return structuredClone(collection);
  }

  async addToCollection(collectionId: string, placeId: string): Promise<PlaceCollection> {
    await this.ready();
    const current = this.collections.get(collectionId);
    if (!current) throw new MapsError('NOT_FOUND', 'Place collection was not found');
    if (!this.places.has(placeId) && ![...this.savedPlaces.values()].some(value => value.placeId === placeId)) throw new MapsError('NOT_FOUND', 'Place was not found');
    if (current.placeIds.includes(placeId)) return structuredClone(current);
    const next: PlaceCollection = { ...current, placeIds: [...current.placeIds, placeId].slice(0, MAPS_MAX_SAVED_PLACES), updatedAt: new Date(this.now()).toISOString() };
    this.collections.set(collectionId, next);
    await this.persist();
    this.emit({ type: 'COLLECTION_CHANGED', id: collectionId });
    return structuredClone(next);
  }

  getPlace(placeId: string): Place | undefined { const place = this.places.get(placeId); return place ? structuredClone(place) : undefined; }
  listPlaces(limit = MAPS_MAX_SAVED_PLACES): readonly Place[] { return [...this.places.values()].slice(0, boundedInt(limit, 1, MAPS_MAX_SAVED_PLACES)).map(value => structuredClone(value)); }
  listSavedPlaces(limit = MAPS_MAX_SAVED_PLACES): readonly SavedPlace[] { return [...this.savedPlaces.values()].slice(0, boundedInt(limit, 1, MAPS_MAX_SAVED_PLACES)).map(value => structuredClone(value)); }
  listCollections(limit = MAPS_MAX_COLLECTIONS): readonly PlaceCollection[] { return [...this.collections.values()].slice(0, boundedInt(limit, 1, MAPS_MAX_COLLECTIONS)).map(value => structuredClone(value)); }
  listOfflinePackages(): readonly OfflineMapPackage[] { return [...this.offlinePackages.values()].map(value => structuredClone(value)); }
  placeReference(placeId: string): PlaceReference { const place = this.places.get(placeId) ?? [...this.savedPlaces.values()].find(value => value.placeId === placeId)?.snapshot; if (!place) throw new MapsError('NOT_FOUND', 'Place was not found'); return createPlaceReference(place); }
  placeLink(placeId: string): string { return this.placeReference(placeId).uri; }
  cacheStats(): MapCacheStats { return this.cache.stats(); }

  async installOfflinePackage(value: OfflineMapPackage): Promise<OfflineMapPackage> {
    await this.ready();
    if (this.offlinePackages.size >= this.maxOfflinePackages && !this.offlinePackages.has(value.id)) throw new MapsError('RESOURCE_EXHAUSTED', 'Offline package bound exceeded');
    const packageValue = await validateOfflineMapPackage(value);
    const provider = this.registry.pick('OFFLINE', normalizePolicy({ offlineOnly: true }), packageValue.providerId);
    if (!provider?.offline) throw new MapsError('UNAVAILABLE', 'The selected provider has no offline package capability');
    await provider.offline.install(packageValue);
    this.offlinePackages.set(packageValue.id, packageValue);
    await this.persist();
    this.emit({ type: 'OFFLINE_CHANGED', id: packageValue.id });
    return structuredClone(packageValue);
  }

  async removeOfflinePackage(packageId: string): Promise<void> {
    await this.ready();
    const current = this.offlinePackages.get(packageId);
    if (!current) return;
    const provider = this.registry.get(current.providerId);
    await provider?.offline?.remove(packageId);
    this.offlinePackages.delete(packageId);
    await this.persist();
    this.emit({ type: 'OFFLINE_CHANGED', id: packageId });
  }

  /** Import only a typed Place reference received through an explicit share. */
  async importSharedPlace(reference: PlaceReference): Promise<Place> {
    await this.ready();
    const snapshot = validatePlace(reference.snapshot);
    const now = new Date(this.now()).toISOString();
    const place: Place = { ...snapshot, placeId: reference.placeId, provenance: { ...snapshot.provenance, kind: 'RECEIVED_KEYSTONE', observedAt: now }, createdAt: snapshot.createdAt, updatedAt: now };
    this.places.set(place.placeId, place);
    await this.persist();
    this.emit({ type: 'PLACE_CHANGED', id: place.placeId });
    return structuredClone(place);
  }

  async close(): Promise<void> { this.listeners.clear(); await this.persist(); }

  private localSearch(query: string, near: GeoCoordinate | undefined, limit: number): PlaceSearchResult[] {
    const values: PlaceSearchResult[] = [];
    const savedPlaceIds = new Set([...this.savedPlaces.values()].map(value => value.placeId));
    for (const place of this.places.values()) {
      const text = `${place.displayName} ${place.address ?? ''} ${place.category ?? ''} ${place.approximateRegion ?? ''}`.toLocaleLowerCase();
      if (!text.includes(query)) continue;
      const distanceMeters = near && place.coordinates ? distanceBetween(near, place.coordinates) : undefined;
      const saved = savedPlaceIds.has(place.placeId);
      values.push({ place: structuredClone(place), score: (saved ? 2 : 0) + (place.displayName.toLocaleLowerCase().startsWith(query) ? 1 : 0) + (distanceMeters === undefined ? 0 : 1 / Math.max(1, distanceMeters)), providerId: 'keystone.local', source: place.provenance.kind === 'RECEIVED_KEYSTONE' ? 'RECEIVED_KEYSTONE' : 'LOCAL', ...(distanceMeters === undefined ? {} : { distanceMeters }) });
    }
    return values.sort(compareSearchResults).slice(0, limit);
  }

  private async resolveEndpoint(endpoint: RouteEndpoint, policy: NormalizedMapPrivacyPolicy): Promise<{ readonly coordinates: GeoCoordinate; readonly fromCurrent: boolean }> {
    if (endpoint.type === 'COORDINATE') return { coordinates: validateCoordinate(endpoint.coordinates), fromCurrent: false };
    if (endpoint.type === 'PLACE') return { coordinates: validateCoordinate('snapshot' in endpoint.place ? endpoint.place.snapshot.coordinates : endpoint.place.coordinates), fromCurrent: false };
    if (!policy.includeCurrentLocation || !this.location) throw new MapsError('LOCATION_REQUIRED', 'Route-from-current-location requires an explicit R0P76 grant');
    const fix = await this.location.current(endpoint.grantId, endpoint.caller);
    const disclosed = policy.currentLocationPrecision === 'APPROXIMATE' ? coarsenLocationFix(fix) : fix;
    if (policy.currentLocationPrecision === 'PRECISE' && disclosed.precision !== 'PRECISE') throw new MapsError('LOCATION_REQUIRED', 'Precise route origin requires a precise grant');
    return { coordinates: { latitude: disclosed.latitude, longitude: disclosed.longitude }, fromCurrent: true };
  }

  private audit(descriptor: MapProviderDescriptor, operation: MapPrivacyAuditEntry['operation'], includedLocation: MapAuditLocationClass): void {
    this.auditEntries.push({ id: randomId('maps-audit'), providerId: descriptor.id, providerClass: descriptor.class, operation, includedLocation, at: new Date(this.now()).toISOString() });
    while (this.auditEntries.length > this.auditLimit) this.auditEntries.shift();
    this.emit({ type: 'PROVIDER_AUDIT', id: descriptor.id });
  }

  private emit(event: MapsEvent): void { for (const listener of this.listeners) void listener(event); }

  private async hydrate(): Promise<void> {
    const raw = await this.store.read();
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Partial<PersistedMapsState>;
    if (value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision ?? 0) < 0) return;
    this.revision = value.revision!;
    if (Array.isArray(value.places)) for (const candidate of value.places.slice(0, this.maxSavedPlaces)) { try { const place = validatePlace(candidate); this.places.set(place.placeId, place); } catch {} }
    if (Array.isArray(value.savedPlaces)) for (const candidate of value.savedPlaces.slice(0, this.maxSavedPlaces)) { try { const saved = validateSavedPlace(candidate); if (this.places.has(saved.placeId) || saved.snapshot) this.savedPlaces.set(saved.id, saved); } catch {} }
    if (Array.isArray(value.collections)) for (const candidate of value.collections.slice(0, this.maxCollections)) { try { const collection = validateCollection(candidate); this.collections.set(collection.id, collection); } catch {} }
    if (value.viewport) { try { this.viewport = validateViewport(value.viewport); } catch {} }
    if (Array.isArray(value.offlinePackages)) for (const candidate of value.offlinePackages.slice(0, this.maxOfflinePackages)) { try { const packageValue = await validateOfflineMapPackage(candidate); this.offlinePackages.set(packageValue.id, packageValue); } catch {} }
  }

  private async persist(): Promise<void> {
    const snapshot: PersistedMapsState = { version: 1, places: [...this.places.values()].slice(0, this.maxSavedPlaces), savedPlaces: [...this.savedPlaces.values()].slice(0, this.maxSavedPlaces), collections: [...this.collections.values()].slice(0, this.maxCollections), viewport: this.viewport.origin === 'LOCATION_ONE_SHOT' ? undefined : this.viewport, offlinePackages: [...this.offlinePackages.values()].slice(0, this.maxOfflinePackages), revision: ++this.revision };
    const operation = this.writes.then(() => this.store.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation;
  }
}

export interface NavigationSession {
  readonly version: 1;
  readonly id: string;
  readonly route: GeographicRoute;
  readonly state: 'ACTIVE' | 'ARRIVED' | 'ENDED' | 'INTERRUPTED';
  readonly mode: MapRouteMode;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly currentStepIndex: number;
  readonly progressRatio: number;
  readonly rerouteCount: number;
  readonly lastFix?: LocationFix;
  readonly ignoredStaleFixes: number;
}

export interface NavigationProgress {
  readonly session: NavigationSession;
  readonly nextStep?: RouteStep;
  readonly distanceToDestinationMeters?: number;
}

export interface NavigationServiceOptions {
  readonly now?: () => number;
  readonly routing?: RoutingProvider;
  readonly policy?: MapPrivacyPolicy;
  readonly updateIntervalMs?: number;
  readonly rerouteIntervalMs?: number;
  readonly deviationMeters?: number;
  readonly maxReroutes?: number;
}

export interface StartNavigationInput {
  readonly route: GeographicRoute;
  readonly grantId: string;
  readonly caller: LocationCaller;
  readonly ownerConfirmed: boolean;
}

/**
 * Navigation is intentionally an in-memory active session. It consumes a
 * foreground R0P76 watch and releases it on every terminal path. No state
 * store is accepted here, so a restart cannot silently resume a watch or
 * recreate a movement trail.
 */
export class NavigationService {
  private readonly now: () => number;
  private readonly location: LocationService;
  private readonly routing?: RoutingProvider;
  private readonly policy: NormalizedMapPrivacyPolicy;
  private readonly updateIntervalMs: number;
  private readonly rerouteIntervalMs: number;
  private readonly deviationMeters: number;
  private readonly maxReroutes: number;
  private readonly sessions = new Map<string, MutableNavigationSession>();
  private readonly watches = new Map<string, string>();
  private readonly listeners = new Set<(progress: NavigationProgress) => void | Promise<void>>();
  private closed = false;

  constructor(location: LocationService, options: NavigationServiceOptions = {}) {
    this.location = location;
    this.now = options.now ?? Date.now;
    this.routing = options.routing;
    this.policy = normalizePolicy(options.policy);
    this.updateIntervalMs = boundedInt(options.updateIntervalMs ?? MAPS_DEFAULT_NAVIGATION_UPDATE_INTERVAL_MS, 0, 60_000);
    this.rerouteIntervalMs = boundedInt(options.rerouteIntervalMs ?? MAPS_DEFAULT_REROUTE_INTERVAL_MS, 1_000, 10 * 60_000);
    this.deviationMeters = boundedInt(options.deviationMeters ?? MAPS_DEFAULT_REROUTE_DEVIATION_METERS, 10, 10_000);
    this.maxReroutes = boundedInt(options.maxReroutes ?? MAPS_MAX_NAVIGATION_REROUTES, 0, MAPS_MAX_NAVIGATION_REROUTES);
  }

  subscribe(listener: (progress: NavigationProgress) => void | Promise<void>): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  active(): NavigationProgress | undefined { const current = [...this.sessions.values()][0]; return current ? this.progress(current) : undefined; }

  async start(input: StartNavigationInput): Promise<NavigationSession> {
    if (this.closed) throw new MapsError('UNAVAILABLE', 'Navigation service is closed');
    if (this.sessions.size >= MAPS_MAX_NAVIGATION_SESSIONS) throw new MapsError('RESOURCE_EXHAUSTED', 'Only one navigation session can be active');
    if (!input.ownerConfirmed) throw new MapsError('NOT_AUTHORIZED', 'Starting navigation requires explicit owner confirmation');
    const route = validateRoute(input.route);
    const grant = this.location.grants.requireFor(input.grantId, input.caller, 'LOCAL_USE');
    if (grant.scope === 'ONE_SHOT') throw new MapsError('NOT_AUTHORIZED', 'Navigation requires a foreground location grant');
    if (grant.precision !== 'PRECISE') throw new MapsError('LOCATION_REQUIRED', 'Turn-by-turn navigation requires a precise location grant');
    const now = new Date(this.now()).toISOString();
    const session: MutableNavigationSession = { version: 1, id: randomId('navigation'), route, state: 'ACTIVE', mode: route.mode, startedAt: now, currentStepIndex: 0, progressRatio: 0, rerouteCount: 0, ignoredStaleFixes: 0, lastProcessedAt: 0, lastRerouteAt: 0 };
    this.sessions.set(session.id, session);
    try {
      const watch = await this.location.startWatch(input.grantId, input.caller, fix => this.onFix(session.id, fix));
      this.watches.set(session.id, watch.id);
      this.emit(session);
      return cloneNavigation(session);
    } catch (error) {
      this.sessions.delete(session.id);
      throw error;
    }
  }

  async end(sessionId?: string): Promise<NavigationSession | undefined> {
    const id = sessionId ?? [...this.sessions.keys()][0];
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const watchId = this.watches.get(id);
    this.watches.delete(id);
    if (watchId) await this.location.stopWatch(watchId);
    session.state = 'ENDED';
    session.endedAt = new Date(this.now()).toISOString();
    const result = cloneNavigation(session);
    this.sessions.delete(id);
    this.emit(session);
    return result;
  }

  async interrupt(sessionId?: string): Promise<NavigationSession | undefined> {
    const id = sessionId ?? [...this.sessions.keys()][0];
    if (!id) return undefined;
    const session = this.sessions.get(id);
    if (!session) return undefined;
    const watchId = this.watches.get(id);
    this.watches.delete(id);
    if (watchId) await this.location.stopWatch(watchId);
    session.state = 'INTERRUPTED';
    session.endedAt = new Date(this.now()).toISOString();
    const result = cloneNavigation(session);
    this.sessions.delete(id);
    this.emit(session);
    return result;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const id of [...this.sessions.keys()]) await this.interrupt(id);
    this.listeners.clear();
  }

  private onFix(sessionId: string, fix: LocationFix): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== 'ACTIVE') return;
    const freshness = locationFreshness(fix, this.now());
    if (freshness === 'STALE' || freshness === 'UNKNOWN' || fix.precision !== 'PRECISE') {
      session.ignoredStaleFixes += 1;
      return;
    }
    const currentTime = this.now();
    session.lastFix = structuredClone(fix);
    // Coalescing is deliberately state based: the next admissible fix does
    // the work, so there is no per-sensor timer to leak on shutdown.
    if (currentTime - session.lastProcessedAt < this.updateIntervalMs) return;
    session.lastProcessedAt = currentTime;
    const destination = session.route.geometry.at(-1);
    if (!destination) return;
    session.currentStepIndex = stepIndexForFix(session.route, fix, session.currentStepIndex);
    const distanceToDestinationMeters = distanceBetween(fix, destination);
    session.progressRatio = clamp01(session.route.distanceMeters <= 0 ? 1 : 1 - distanceToDestinationMeters / Math.max(session.route.distanceMeters, 1));
    if (distanceToDestinationMeters <= Math.max(25, fix.horizontalAccuracy * 2)) session.state = 'ARRIVED';
    const offRoute = distanceToRoute(fix, session.route.geometry) > this.deviationMeters;
    if (offRoute && session.state === 'ACTIVE' && session.rerouteCount < this.maxReroutes && currentTime - session.lastRerouteAt >= this.rerouteIntervalMs) {
      session.lastRerouteAt = currentTime;
      session.rerouteCount += 1;
      void this.tryReroute(session, fix);
    }
    this.emit(session);
  }

  private async tryReroute(session: MutableNavigationSession, fix: LocationFix): Promise<void> {
    if (!this.routing || session.state !== 'ACTIVE') return;
    const destination = session.route.geometry.at(-1);
    if (!destination) return;
    try {
      const next = validateRoute(await this.routing.route({ origin: { latitude: fix.latitude, longitude: fix.longitude }, destination, mode: session.mode, policy: this.policy }), this.routing.descriptor);
      if (this.sessions.get(session.id) !== session || session.state !== 'ACTIVE') return;
      session.route = next;
      session.currentStepIndex = 0;
      session.progressRatio = 0;
      this.emit(session);
    } catch {
      // A bounded failed reroute does not end navigation and never switches
      // to another provider without an explicit policy decision.
    }
  }

  private progress(session: MutableNavigationSession): NavigationProgress { return { session: cloneNavigation(session), nextStep: session.route.legs.flatMap(leg => leg.steps)[session.currentStepIndex], ...(session.lastFix && session.route.geometry.at(-1) ? { distanceToDestinationMeters: distanceBetween(session.lastFix, session.route.geometry.at(-1)!) } : {}) }; }
  private emit(session: MutableNavigationSession): void { const value = this.progress(session); for (const listener of this.listeners) void listener(value); }
}

interface MutableNavigationSession {
  version: 1;
  id: string;
  route: GeographicRoute;
  state: NavigationSession['state'];
  mode: MapRouteMode;
  startedAt: string;
  endedAt?: string;
  currentStepIndex: number;
  progressRatio: number;
  rerouteCount: number;
  lastFix?: LocationFix;
  ignoredStaleFixes: number;
  lastProcessedAt: number;
  lastRerouteAt: number;
}

export interface PlaceCiphertext {
  readonly version: 1;
  readonly algorithm: 'APPLICATION_E2E';
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface PlaceCipher {
  seal(recipient: NodeId, value: unknown): Promise<PlaceCiphertext>;
  open(sender: NodeId, value: unknown): Promise<unknown>;
}

/**
 * Host/test adapter over the existing recipient-keyed application cipher.
 * Production hosts can inject a Secret/NativeHost-backed PlaceCipher instead;
 * the Maps protocol never receives raw private keys.
 */
export class SodiumPlaceCipher implements PlaceCipher {
  private readonly cipher = new SodiumDirectMessageCipher();
  private readonly peers: ReadonlyMap<NodeId, DeviceSessionKeys>;

  constructor(private readonly local: DeviceSessionKeys, peers: ReadonlyMap<NodeId, DeviceSessionKeys> | readonly DeviceSessionKeys[]) {
    this.peers = Array.isArray(peers) ? new Map<string, DeviceSessionKeys>(peers.map(peer => [peer.nodeId, peer] as const)) : peers as ReadonlyMap<string, DeviceSessionKeys>;
  }

  async seal(recipient: NodeId, value: unknown): Promise<PlaceCiphertext> {
    if (recipient === this.local.nodeId) throw new MapsError('INVALID_ARGUMENT', 'A place share recipient must be another identity');
    const peer = this.peers.get(recipient);
    if (!peer) throw new MapsError('NOT_AUTHORIZED', 'Recipient encryption key is unavailable');
    const encrypted = await this.cipher.encrypt(canonicalJson(value), this.local.encryptionPrivateKey, peer.encryptionPublicKey);
    return { version: 1, algorithm: 'APPLICATION_E2E', nonce: encrypted.nonce, ciphertext: encrypted.ciphertext };
  }

  async open(sender: NodeId, value: unknown): Promise<unknown> {
    const peer = this.peers.get(sender);
    if (!peer || !isPlaceCiphertext(value)) throw new MapsError('INTEGRITY', 'Place ciphertext is malformed');
    try { return JSON.parse(await this.cipher.decrypt({ algorithm: 'xsalsa20poly1305', nonce: value.nonce, ciphertext: value.ciphertext }, this.local.encryptionPrivateKey, peer.encryptionPublicKey)) as unknown; } catch { throw new MapsError('INTEGRITY', 'Place ciphertext authentication failed'); }
  }
}

export interface PlaceSharePayload {
  readonly version: 1;
  readonly kind: 'PLACE';
  readonly reference: PlaceReference;
  readonly visibility: 'PUBLIC' | 'PRIVATE';
}

interface PlaceShareWire {
  readonly version: 1;
  readonly kind: 'PLACE_SHARE';
  readonly shareId: string;
  readonly sender: NodeId;
  readonly recipient: NodeId;
  readonly visibility: 'PUBLIC' | 'PRIVATE';
  readonly encrypted: boolean;
  readonly payload?: PlaceSharePayload;
  readonly ciphertext?: PlaceCiphertext;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface PlaceSharingServiceOptions {
  readonly identityId: NodeId;
  readonly delivery: KeystoneDeliveryInterface;
  readonly security: EnvelopeSecurity;
  readonly cipher?: PlaceCipher;
  readonly now?: () => number;
  readonly onPlace?: (reference: PlaceReference, sender: NodeId) => void | Promise<void>;
  readonly maxPending?: number;
}

export interface PlaceSharingStats {
  readonly pending: number;
  readonly received: number;
  readonly rejected: number;
}

/** Explicit Place sharing. It never carries a sender live position field. */
export class PlaceSharingService {
  private readonly identityId: NodeId;
  private readonly delivery: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly cipher?: PlaceCipher;
  private readonly now: () => number;
  private readonly onPlace?: (reference: PlaceReference, sender: NodeId) => void | Promise<void>;
  private readonly maxPending: number;
  private readonly pending: Array<{ readonly peer: NodeId; readonly envelope: Envelope }> = [];
  private readonly seen = new Set<string>();
  private readonly unsubscribe: () => void;
  private receivedCount = 0;
  private rejectedCount = 0;
  private closed = false;

  constructor(options: PlaceSharingServiceOptions) {
    if (!safeId(options.identityId, 512)) throw new MapsError('INVALID_ARGUMENT', 'Place sharing identity is invalid');
    this.identityId = options.identityId;
    this.delivery = options.delivery;
    this.security = options.security;
    this.cipher = options.cipher;
    this.now = options.now ?? Date.now;
    this.onPlace = options.onPlace;
    this.maxPending = boundedInt(options.maxPending ?? 64, 1, 256);
    this.unsubscribe = this.delivery.onMessage(envelope => this.receive(envelope));
  }

  async sharePlace(peer: NodeId, place: Place | PlaceReference, visibility: 'PUBLIC' | 'PRIVATE' = 'PRIVATE'): Promise<string> {
    if (this.closed) throw new MapsError('UNAVAILABLE', 'Place sharing service is closed');
    if (!safeId(peer, 512) || peer === this.identityId) throw new MapsError('INVALID_ARGUMENT', 'Place share recipient is invalid');
    const reference = 'snapshot' in place ? createPlaceReference(validatePlace(place.snapshot)) : createPlaceReference(validatePlace(place));
    const payload: PlaceSharePayload = { version: 1, kind: 'PLACE', reference, visibility };
    if (visibility === 'PRIVATE' && !this.cipher) throw new MapsError('NOT_AUTHORIZED', 'Private place sharing requires an application cipher');
    const issuedAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + 10 * 60_000).toISOString();
    const wire: PlaceShareWire = this.cipher && visibility === 'PRIVATE'
      ? { version: 1, kind: 'PLACE_SHARE', shareId: randomId('place-share'), sender: this.identityId, recipient: peer, visibility, encrypted: true, ciphertext: await this.cipher.seal(peer, payload), issuedAt, expiresAt }
      : { version: 1, kind: 'PLACE_SHARE', shareId: randomId('place-share'), sender: this.identityId, recipient: peer, visibility, encrypted: false, payload, issuedAt, expiresAt };
    const unsigned: UnsignedEnvelope = { version: 1, type: MAPS_PLACE_ENVELOPE, id: randomId('maps-envelope'), sender: this.identityId, recipient: peer, nonce: randomId('maps-nonce'), expiresAt, body: wire };
    const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) };
    try {
      await this.delivery.connect(peer);
      await this.delivery.send(peer, envelope);
    } catch (error) {
      this.pending.push({ peer, envelope });
      while (this.pending.length > this.maxPending) this.pending.shift();
      throw error;
    }
    return wire.shareId;
  }

  async flush(): Promise<number> {
    let delivered = 0;
    for (let index = 0; index < this.pending.length;) {
      const item = this.pending[index]!;
      try { await this.delivery.connect(item.peer); await this.delivery.send(item.peer, item.envelope); this.pending.splice(index, 1); delivered += 1; } catch { index += 1; }
    }
    return delivered;
  }

  stats(): PlaceSharingStats { return { pending: this.pending.length, received: this.receivedCount, rejected: this.rejectedCount }; }
  close(): void { this.closed = true; this.pending.length = 0; this.unsubscribe(); this.seen.clear(); }

  private async receive(envelope: Envelope): Promise<void> {
    if (this.closed || envelope.type !== MAPS_PLACE_ENVELOPE || envelope.recipient !== this.identityId || this.seen.has(envelope.id)) return;
    if (Date.parse(envelope.expiresAt) <= this.now() || !(await this.security.verify(envelope))) { this.rejectedCount += 1; return; }
    const wire = parsePlaceShareWire(envelope.body);
    if (!wire || wire.sender !== envelope.sender || wire.recipient !== this.identityId || Date.parse(wire.expiresAt) !== Date.parse(envelope.expiresAt) || Date.parse(wire.expiresAt) <= this.now()) { this.rejectedCount += 1; return; }
    this.seen.add(envelope.id);
    while (this.seen.size > 8_192) this.seen.delete(this.seen.values().next().value as string);
    try {
      const value = wire.encrypted ? await this.cipher?.open(wire.sender, wire.ciphertext) : wire.payload;
      if (!value || containsLocationDisclosure(value)) throw new MapsError('NOT_AUTHORIZED', 'Place share contains an unrequested location disclosure');
      const payload = parsePlaceSharePayload(value);
      if (payload.visibility !== wire.visibility) throw new MapsError('INTEGRITY', 'Place share visibility mismatch');
      this.receivedCount += 1;
      await this.onPlace?.(payload.reference, wire.sender);
    } catch { this.rejectedCount += 1; }
  }
}

export interface ExternalLinkGateway {
  open(url: string): Promise<void>;
}

export function sanitizeExternalLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048) throw new MapsError('INVALID_ARGUMENT', 'External place link is invalid');
  let url: URL;
  try { url = new URL(value); } catch { throw new MapsError('INVALID_ARGUMENT', 'External place link is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isPrivateHost(url.hostname)) throw new MapsError('NOT_AUTHORIZED', 'External place link is not allowed');
  return url.toString();
}

export async function openPlaceWebsite(place: Place, gateway: ExternalLinkGateway): Promise<void> {
  if (!place.website) throw new MapsError('NOT_FOUND', 'Place has no website');
  await gateway.open(sanitizeExternalLink(place.website));
}

export function createPlaceReference(value: Place | PlaceSnapshot): PlaceReference {
  const place = validatePlace(value);
  return { version: 1, kind: 'PLACE', placeId: place.placeId, uri: `keystone://place/${encodeURIComponent(place.placeId)}`, snapshot: placeSnapshot(place) };
}

export function parsePlaceLink(value: string): PlaceReference | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'keystone:' || url.hostname !== 'place') return undefined;
    const placeId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '');
    if (!safeId(placeId, 256)) return undefined;
    return { version: 1, kind: 'PLACE', placeId, uri: `keystone://place/${encodeURIComponent(placeId)}`, snapshot: { version: 1, placeId, displayName: placeId, provenance: { kind: 'RECEIVED_KEYSTONE', observedAt: new Date(0).toISOString() } } };
  } catch { return undefined; }
}

export type MapsCommand =
  | { readonly type: 'OPEN_MAP' }
  | { readonly type: 'SHOW_MY_LOCATION' }
  | { readonly type: 'SEARCH_PLACE'; readonly query: string }
  | { readonly type: 'PLAN_ROUTE'; readonly destination: string }
  | { readonly type: 'SAVE_PLACE'; readonly query: string }
  | { readonly type: 'DOWNLOAD_OFFLINE_REGION'; readonly region: string };

export function parseMapsCommand(value: string): MapsCommand | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^(open|open the|открыть)\s+(map|maps|карту|карты)$/i.test(text)) return { type: 'OPEN_MAP' };
  if (/^(show|показать)\s+(my\s+)?(location|position|геопозицию|мою геопозицию)$/i.test(text)) return { type: 'SHOW_MY_LOCATION' };
  const search = text.match(/^(?:find|search|найти|поиск(?:\s+мест)?|места)\s+(.+)$/i);
  if (search?.[1]) return { type: 'SEARCH_PLACE', query: search[1].trim() };
  const route = text.match(/^(?:route|directions|маршрут(?:\s+до)?|построить маршрут(?: до)?)\s+(.+)$/i);
  if (route?.[1]) return { type: 'PLAN_ROUTE', destination: route[1].trim() };
  const save = text.match(/^(?:save|сохранить)\s+(.+)$/i);
  if (save?.[1]) return { type: 'SAVE_PLACE', query: save[1].trim() };
  const offline = text.match(/^(?:download|скачать)\s+(?:map|maps|кар(?:ту|ты)|область)\s+(.+)$/i);
  if (offline?.[1]) return { type: 'DOWNLOAD_OFFLINE_REGION', region: offline[1].trim() };
  return undefined;
}

export interface ControlledMapProviderOptions {
  readonly id?: string;
  readonly name?: string;
  readonly class?: MapProviderClass;
  readonly places?: readonly Place[];
  readonly supportedModes?: readonly MapRouteMode[];
  readonly attribution?: string;
  readonly license?: string;
  readonly now?: () => number;
}

/** Deterministic local/offline provider used by tests and host integration. */
export class ControlledMapProvider implements MapDataProvider, PlaceSearchProvider, GeocodingProvider, RoutingProvider, OfflineMapProvider {
  readonly descriptor: MapProviderDescriptor;
  private readonly now: () => number;
  private readonly places = new Map<string, Place>();
  private readonly packages = new Map<string, OfflineMapPackage>();
  private readonly supportedModes: readonly MapRouteMode[];

  constructor(options: ControlledMapProviderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.supportedModes = [...new Set(options.supportedModes ?? (['WALKING', 'DRIVING', 'CYCLING'] as const))] as MapRouteMode[];
    const providerClass = options.class ?? 'LOCAL';
    this.descriptor = {
      id: options.id ?? 'controlled.local',
      name: options.name ?? 'Controlled Local Maps',
      class: providerClass,
      capabilities: [
        'VECTOR_TILES', 'LOCAL_DATASET', 'OFFLINE_REGION', 'SEARCH', 'GEOCODING', 'REVERSE_GEOCODING', 'ROUTING',
        ...this.supportedModes,
        'TURN_BY_TURN',
      ],
      ...(options.attribution ? { attribution: options.attribution } : {}),
      ...(options.license ? { license: options.license } : {}),
      privacyNote: providerClass === 'EXTERNAL' ? 'The selected provider receives explicit geographic queries only.' : 'Data remains in the local provider boundary.',
    };
    for (const place of options.places ?? []) this.addPlace(place);
  }

  registration(source: MapProviderSource = 'CORE'): { readonly registration: MapProviderRegistration; readonly source: MapProviderSource } {
    return { registration: { descriptor: this.descriptor, mapData: this, search: this, geocoding: this, routing: this, offline: this }, source };
  }

  addPlace(value: Place): void { const place = validatePlace(value); this.places.set(place.placeId, place); }
  clearPlaces(): void { this.places.clear(); }

  async map(request: MapDataRequest): Promise<MapData> {
    if (request.policy.offlineOnly && !this.packages.size) throw new MapsError('UNAVAILABLE', 'No installed offline region is available');
    const features: MapFeature[] = [];
    for (const place of this.places.values()) {
      if (!place.coordinates || !withinBounds(place.coordinates, request.bounds ?? viewportBounds(request.viewport))) continue;
      features.push({ id: place.placeId, kind: place.category ?? 'PLACE', label: place.displayName, geometry: [place.coordinates] });
      if (features.length >= 1_000) break;
    }
    return { version: 1, providerId: this.descriptor.id, layer: 'VECTOR', viewport: validateViewport(request.viewport), features, offline: request.policy.offlineOnly || this.packages.size > 0, ...(this.descriptor.attribution ? { attribution: this.descriptor.attribution } : {}) };
  }

  async search(request: PlaceSearchQuery): Promise<readonly PlaceSearchResult[]> {
    if (request.policy.offlineOnly && !this.packages.size) throw new MapsError('UNAVAILABLE', 'No installed offline region is available');
    const query = request.query.toLocaleLowerCase();
    return [...this.places.values()]
      .flatMap(place => {
        const haystack = `${place.displayName} ${place.address ?? ''} ${place.category ?? ''} ${place.approximateRegion ?? ''}`.toLocaleLowerCase();
        if (!haystack.includes(query)) return [];
        const distanceMeters = request.near && place.coordinates ? distanceBetween(request.near, place.coordinates) : undefined;
        return [{ place: structuredClone(place), score: (place.displayName.toLocaleLowerCase().startsWith(query) ? 2 : 1) + (distanceMeters === undefined ? 0 : 1 / Math.max(1, distanceMeters)), providerId: this.descriptor.id, source: this.descriptor.class === 'EXTERNAL' ? 'EXTERNAL' as const : this.packages.size ? 'OFFLINE' as const : 'LOCAL' as const, ...(distanceMeters === undefined ? {} : { distanceMeters }) }];
      })
      .sort(compareSearchResults)
      .slice(0, request.limit);
  }

  async forward(request: ForwardGeocodeRequest): Promise<Place | undefined> {
    const query = request.address.toLocaleLowerCase();
    const match = [...this.places.values()].find(place => `${place.displayName} ${place.address ?? ''}`.toLocaleLowerCase().includes(query));
    return match ? structuredClone(match) : undefined;
  }

  async reverse(request: ReverseGeocodeRequest): Promise<Place | undefined> {
    let nearest: { place: Place; distance: number } | undefined;
    for (const place of this.places.values()) {
      if (!place.coordinates) continue;
      const distance = distanceBetween(request.coordinates, place.coordinates);
      if (!nearest || distance < nearest.distance) nearest = { place, distance };
    }
    return nearest && nearest.distance <= 50_000 ? structuredClone(nearest.place) : undefined;
  }

  async route(request: RouteRequest): Promise<GeographicRoute> {
    if (request.policy.offlineOnly && !this.packages.size) throw new MapsError('UNAVAILABLE', 'No installed offline routing region is available');
    if (!this.supportedModes.includes(request.mode)) throw new MapsError('UNSUPPORTED', `Controlled provider does not support ${request.mode}`);
    const points = [request.origin, ...(request.waypoints ?? []), request.destination].map(validateCoordinate);
    const speedMetersPerSecond = request.mode === 'WALKING' ? 1.4 : request.mode === 'CYCLING' ? 5.5 : request.mode === 'TRANSIT' ? 8 : 13.9;
    const legs: RouteLeg[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const origin = points[index]!;
      const destination = points[index + 1]!;
      const distanceMeters = Math.max(1, distanceBetween(origin, destination));
      const durationSeconds = Math.max(1, Math.round(distanceMeters / speedMetersPerSecond));
      legs.push({ id: `leg-${index + 1}`, origin, destination, distanceMeters, durationSeconds, steps: [{ id: `step-${index + 1}`, instruction: `Continue to ${index === points.length - 2 ? 'destination' : 'waypoint'}`, distanceMeters, durationSeconds, geometry: [origin, destination], roadLabel: `Synthetic ${request.mode.toLocaleLowerCase()} segment` }] });
    }
    const geometry = points;
    return validateRoute({ version: 1, id: randomId('route'), providerId: this.descriptor.id, mode: request.mode, geometry, distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0), legs, estimated: true, ...(this.descriptor.attribution ? { attribution: this.descriptor.attribution } : {}), calculatedAt: new Date(this.now()).toISOString() }, this.descriptor);
  }

  async listInstalled(): Promise<readonly OfflineMapPackage[]> { return [...this.packages.values()].map(value => structuredClone(value)); }
  async install(value: OfflineMapPackage): Promise<void> { if (value.providerId !== this.descriptor.id) throw new MapsError('INVALID_ARGUMENT', 'Offline package provider mismatch'); this.packages.set(value.id, structuredClone(value)); }
  async remove(packageId: string): Promise<void> { this.packages.delete(packageId); }
}

export function registerControlledMapProvider(registry: MapProviderRegistry, provider: ControlledMapProvider, source: MapProviderSource = 'CORE'): void { registry.register(provider.registration(source).registration, source); }

function normalizePolicy(value: MapPrivacyPolicy | undefined): NormalizedMapPrivacyPolicy {
  return {
    offlineOnly: value?.offlineOnly === true,
    allowExternalMapData: value?.allowExternalMapData === true,
    allowExternalSearch: value?.allowExternalSearch === true,
    allowExternalGeocoding: value?.allowExternalGeocoding === true,
    allowExternalRouting: value?.allowExternalRouting === true,
    includeCurrentLocation: value?.includeCurrentLocation === true,
    currentLocationPrecision: value?.currentLocationPrecision === 'PRECISE' ? 'PRECISE' : 'APPROXIMATE',
    ...(value?.providerId ? { providerId: boundedText(value.providerId, 256, true) } : {}),
  };
}

function validateProviderDescriptor(value: MapProviderDescriptor): MapProviderDescriptor {
  if (!value || !safeId(value.id, 256) || !boundedText(value.name, 256, true) || !['LOCAL', 'OFFLINE', 'EXTERNAL'].includes(value.class)) throw new MapsError('INVALID_ARGUMENT', 'Map provider descriptor is invalid');
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 64 || value.capabilities.some(capability => !['VECTOR_TILES', 'RASTER_TILES', 'OFFLINE_REGION', 'LOCAL_DATASET', 'SEARCH', 'GEOCODING', 'REVERSE_GEOCODING', 'ROUTING', 'WALKING', 'DRIVING', 'CYCLING', 'TRANSIT', 'TURN_BY_TURN', 'VOICE_GUIDANCE'].includes(capability))) throw new MapsError('INVALID_ARGUMENT', 'Map provider capabilities are invalid');
  return value;
}

function providerAllowed(descriptor: MapProviderDescriptor, operation: 'MAP_DATA' | 'SEARCH' | 'GEOCODING' | 'ROUTING' | 'OFFLINE', policy: NormalizedMapPrivacyPolicy): boolean {
  if (policy.offlineOnly && descriptor.class === 'EXTERNAL') return false;
  if (descriptor.class !== 'EXTERNAL') return true;
  if (operation === 'MAP_DATA') return policy.allowExternalMapData;
  if (operation === 'SEARCH') return policy.allowExternalSearch;
  if (operation === 'GEOCODING') return policy.allowExternalGeocoding;
  if (operation === 'ROUTING') return policy.allowExternalRouting;
  return false;
}

function providerClassRank(value: MapProviderClass): number { return value === 'LOCAL' ? 0 : value === 'OFFLINE' ? 1 : 2; }
function hasOperation(value: MapProviderRegistration, operation: MapProviderState['operations'][number]): boolean { return operation === 'MAP_DATA' ? !!value.mapData : operation === 'SEARCH' ? !!value.search : operation === 'GEOCODING' ? !!value.geocoding : operation === 'ROUTING' ? !!value.routing : !!value.offline; }

export function validateCoordinate(value: unknown): GeoCoordinate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Coordinate is invalid');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number' || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude) || candidate.latitude < -90 || candidate.latitude > 90 || candidate.longitude < -180 || candidate.longitude > 180) throw new MapsError('INVALID_ARGUMENT', 'Coordinate is outside the valid range');
  return { latitude: candidate.latitude, longitude: candidate.longitude };
}

export function validateBounds(value: unknown): GeoBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Map bounds are invalid');
  const candidate = value as Record<string, unknown>;
  const bounds = { north: candidate.north, south: candidate.south, east: candidate.east, west: candidate.west };
  for (const coordinate of [bounds.north, bounds.south, bounds.east, bounds.west]) if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) throw new MapsError('INVALID_ARGUMENT', 'Map bounds contain an invalid coordinate');
  const north = bounds.north as number;
  const south = bounds.south as number;
  const east = bounds.east as number;
  const west = bounds.west as number;
  if (north < -90 || north > 90 || south < -90 || south > 90 || north < south || east < -180 || east > 180 || west < -180 || west > 180) throw new MapsError('INVALID_ARGUMENT', 'Map bounds are invalid');
  return { north, south, east, west };
}

export function validateViewport(value: unknown): MapViewport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Map viewport is invalid');
  const candidate = value as Record<string, unknown>;
  const center = validateCoordinate(candidate.center);
  if (candidate.version !== 1 || typeof candidate.zoom !== 'number' || !Number.isFinite(candidate.zoom) || candidate.zoom < 0 || candidate.zoom > 24 || !['MANUAL', 'RESTORED', 'PLACE_SELECTED', 'USER_GESTURE', 'LOCATION_ONE_SHOT'].includes(candidate.origin as string) || typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.updatedAt))) throw new MapsError('INVALID_ARGUMENT', 'Map viewport is invalid');
  const bearing = candidate.bearing === undefined ? undefined : boundedNumber(candidate.bearing, 0, 360, 'Map bearing is invalid');
  const pitch = candidate.pitch === undefined ? undefined : boundedNumber(candidate.pitch, 0, 90, 'Map pitch is invalid');
  return { version: 1, center, zoom: candidate.zoom, ...(bearing === undefined ? {} : { bearing }), ...(pitch === undefined ? {} : { pitch }), origin: candidate.origin as MapViewportOrigin, updatedAt: candidate.updatedAt };
}

export function validatePlace(value: unknown): Place {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Place is invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !safeId(candidate.placeId, 256)) throw new MapsError('INVALID_ARGUMENT', 'Place identity is invalid');
  const timestamp = new Date(0).toISOString();
  const provenance = validateProvenance(candidate.provenance);
  const result: Place = {
    version: 1,
    placeId: candidate.placeId,
    displayName: boundedText(candidate.displayName, MAPS_MAX_PLACE_TEXT, true),
    ...(candidate.coordinates === undefined ? {} : { coordinates: validateCoordinate(candidate.coordinates) }),
    ...(candidate.approximateRegion === undefined ? {} : { approximateRegion: boundedText(candidate.approximateRegion, 512) }),
    ...(candidate.address === undefined ? {} : { address: boundedText(candidate.address, 2_048) }),
    ...(candidate.category === undefined ? {} : { category: boundedText(candidate.category, 256) }),
    provenance,
    ...(candidate.publicMetadata === undefined ? {} : { publicMetadata: validateMetadata(candidate.publicMetadata) }),
    ...(candidate.website === undefined ? {} : { website: sanitizeExternalLink(candidate.website) }),
    ...(candidate.phone === undefined ? {} : { phone: boundedText(candidate.phone, 128) }),
    createdAt: typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt)) ? candidate.createdAt : timestamp,
    updatedAt: typeof candidate.updatedAt === 'string' && Number.isFinite(Date.parse(candidate.updatedAt)) ? candidate.updatedAt : timestamp,
  };
  if (!result.coordinates && !result.approximateRegion) throw new MapsError('INVALID_ARGUMENT', 'Place requires coordinates or an approximate region');
  return result;
}

export function validateMapData(value: unknown, descriptor?: MapProviderDescriptor): MapData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('PROVIDER_FAILURE', 'Map provider returned an invalid map object');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.providerId !== 'string' || (descriptor && candidate.providerId !== descriptor.id) || !['VECTOR', 'RASTER', 'SCHEMATIC'].includes(candidate.layer as string) || !Array.isArray(candidate.features) || candidate.features.length > 2_000) throw new MapsError('PROVIDER_FAILURE', 'Map provider returned an invalid map object');
  const features: MapFeature[] = [];
  for (const item of candidate.features) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new MapsError('PROVIDER_FAILURE', 'Map feature is invalid');
    const feature = item as Record<string, unknown>;
    if (!safeId(feature.id, 256) || !safeText(feature.kind, 128)) throw new MapsError('PROVIDER_FAILURE', 'Map feature identity is invalid');
    const geometry = feature.geometry === undefined ? undefined : validateGeometry(feature.geometry, 10_000);
    features.push({ id: feature.id, kind: feature.kind, ...(feature.label === undefined ? {} : { label: boundedText(feature.label, 512) }), ...(geometry ? { geometry } : {}) });
  }
  return { version: 1, providerId: candidate.providerId, layer: candidate.layer as MapLayerKind, viewport: validateViewport(candidate.viewport), features, offline: candidate.offline === true, ...(candidate.attribution === undefined ? {} : { attribution: boundedText(candidate.attribution, 1_024) }) };
}

export function validateRoute(value: unknown, descriptor?: MapProviderDescriptor): GeographicRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('PROVIDER_FAILURE', 'Routing provider returned an invalid route');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !safeId(candidate.id, 256) || typeof candidate.providerId !== 'string' || (descriptor && candidate.providerId !== descriptor.id) || !['WALKING', 'DRIVING', 'CYCLING', 'TRANSIT'].includes(candidate.mode as string) || candidate.estimated !== true || typeof candidate.calculatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.calculatedAt))) throw new MapsError('PROVIDER_FAILURE', 'Routing provider returned an invalid route');
  if (typeof candidate.distanceMeters !== 'number' || !Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters < 0 || candidate.distanceMeters > 100_000_000 || typeof candidate.durationSeconds !== 'number' || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds < 0 || candidate.durationSeconds > 10_000_000) throw new MapsError('PROVIDER_FAILURE', 'Route estimate is invalid');
  const geometry = validateGeometry(candidate.geometry, MAPS_MAX_ROUTE_POINTS);
  if (!Array.isArray(candidate.legs) || candidate.legs.length > MAPS_MAX_ROUTE_LEGS) throw new MapsError('PROVIDER_FAILURE', 'Route leg bound exceeded');
  let stepCount = 0;
  const legs: RouteLeg[] = [];
  for (const item of candidate.legs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new MapsError('PROVIDER_FAILURE', 'Route leg is invalid');
    const leg = item as Record<string, unknown>;
    if (!safeId(leg.id, 256) || typeof leg.distanceMeters !== 'number' || !Number.isFinite(leg.distanceMeters) || leg.distanceMeters < 0 || typeof leg.durationSeconds !== 'number' || !Number.isFinite(leg.durationSeconds) || leg.durationSeconds < 0 || !Array.isArray(leg.steps)) throw new MapsError('PROVIDER_FAILURE', 'Route leg is invalid');
    const steps: RouteStep[] = [];
    for (const stepValue of leg.steps) {
      stepCount += 1;
      if (stepCount > MAPS_MAX_ROUTE_STEPS || !stepValue || typeof stepValue !== 'object' || Array.isArray(stepValue)) throw new MapsError('PROVIDER_FAILURE', 'Route step bound exceeded');
      const step = stepValue as Record<string, unknown>;
      if (!safeId(step.id, 256) || typeof step.distanceMeters !== 'number' || !Number.isFinite(step.distanceMeters) || step.distanceMeters < 0 || typeof step.durationSeconds !== 'number' || !Number.isFinite(step.durationSeconds) || step.durationSeconds < 0) throw new MapsError('PROVIDER_FAILURE', 'Route step is invalid');
      steps.push({ id: step.id, instruction: boundedText(step.instruction, MAPS_MAX_ROUTE_TEXT, true), distanceMeters: step.distanceMeters, durationSeconds: step.durationSeconds, geometry: validateGeometry(step.geometry, MAPS_MAX_ROUTE_POINTS), ...(step.roadLabel === undefined ? {} : { roadLabel: boundedText(step.roadLabel, MAPS_MAX_ROUTE_TEXT) }) });
    }
    legs.push({ id: leg.id, origin: validateCoordinate(leg.origin), destination: validateCoordinate(leg.destination), distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, steps });
  }
  if (!legs.length || !geometry.length) throw new MapsError('PROVIDER_FAILURE', 'Route has no usable geometry');
  if (descriptor && !descriptor.capabilities.includes(candidate.mode as MapCapability)) throw new MapsError('UNSUPPORTED', `Provider does not support ${candidate.mode}`);
  return { version: 1, id: candidate.id, providerId: candidate.providerId, mode: candidate.mode as MapRouteMode, geometry, distanceMeters: candidate.distanceMeters, durationSeconds: candidate.durationSeconds, legs, estimated: true, ...(candidate.attribution === undefined ? {} : { attribution: boundedText(candidate.attribution, 1_024) }), calculatedAt: candidate.calculatedAt };
}

export async function createOfflineMapPackage(value: OfflineMapPackageInput): Promise<OfflineMapPackage> {
  const base = validateOfflineMapPackageInput(value);
  const contentHash = await offlinePackageHash(base);
  return { ...base, contentHash, installedAt: new Date().toISOString() };
}

export async function validateOfflineMapPackage(value: unknown): Promise<OfflineMapPackage> {
  const candidate = validateOfflineMapPackageInput(value);
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).contentHash !== 'string' || typeof (value as Record<string, unknown>).installedAt !== 'string' || !Number.isFinite(Date.parse((value as Record<string, unknown>).installedAt as string))) throw new MapsError('INTEGRITY', 'Offline package integrity metadata is missing');
  const metadata = value as Record<string, unknown>;
  const expected = await offlinePackageHash(candidate);
  if (metadata.contentHash !== expected) throw new MapsError('INTEGRITY', 'Offline package integrity check failed');
  return { ...candidate, contentHash: metadata.contentHash as string, installedAt: metadata.installedAt as string };
}

function validateOfflineMapPackageInput(value: unknown): OfflineMapPackageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Offline package is invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !safeId(candidate.id, 256) || !safeId(candidate.providerId, 256) || !safeText(candidate.packageVersion, 128) || typeof candidate.sizeBytes !== 'number' || !Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0 || candidate.sizeBytes > 100 * 1024 * 1024 * 1024 || !Array.isArray(candidate.capabilities) || candidate.capabilities.length > 64 || !candidate.region || typeof candidate.region !== 'object' || !candidate.manifest || typeof candidate.manifest !== 'object') throw new MapsError('INVALID_ARGUMENT', 'Offline package is invalid');
  const region = candidate.region as Record<string, unknown>;
  const manifest = candidate.manifest as Record<string, unknown>;
  if (!safeId(region.id, 256) || !safeText(region.name, 256) || !Array.isArray(manifest.contentIds) || manifest.contentIds.length > 100_000 || manifest.contentIds.some(value => !safeText(value, 256)) || (manifest.featureCount !== undefined && (!Number.isSafeInteger(manifest.featureCount) || (manifest.featureCount as number) < 0 || (manifest.featureCount as number) > 10_000_000))) throw new MapsError('INVALID_ARGUMENT', 'Offline package manifest is invalid');
  return { version: 1, id: candidate.id, providerId: candidate.providerId, region: { id: region.id, name: region.name, bounds: validateBounds(region.bounds) }, packageVersion: candidate.packageVersion, manifest: { contentIds: [...manifest.contentIds], ...(manifest.featureCount === undefined ? {} : { featureCount: manifest.featureCount as number }) }, sizeBytes: candidate.sizeBytes, capabilities: [...new Set(candidate.capabilities.filter((value): value is MapCapability => typeof value === 'string' && ['VECTOR_TILES', 'RASTER_TILES', 'OFFLINE_REGION', 'LOCAL_DATASET', 'SEARCH', 'GEOCODING', 'REVERSE_GEOCODING', 'ROUTING', 'WALKING', 'DRIVING', 'CYCLING', 'TRANSIT', 'TURN_BY_TURN', 'VOICE_GUIDANCE'].includes(value)))], ...(candidate.attribution === undefined ? {} : { attribution: boundedText(candidate.attribution, 1_024) }), ...(candidate.license === undefined ? {} : { license: boundedText(candidate.license, 1_024) }) };
}

async function offlinePackageHash(value: OfflineMapPackageInput): Promise<string> { return `sha256-${await sha256(new TextEncoder().encode(canonicalJson(value)))}`; }

function validateSearchResult(value: PlaceSearchResult, descriptor: MapProviderDescriptor): PlaceSearchResult {
  if (!value || typeof value !== 'object' || typeof value.providerId !== 'string' || value.providerId !== descriptor.id || typeof value.score !== 'number' || !Number.isFinite(value.score)) throw new MapsError('PROVIDER_FAILURE', 'Place search provider returned an invalid result');
  const place = validatePlace(value.place);
  const distanceMeters = value.distanceMeters === undefined ? undefined : boundedNumber(value.distanceMeters, 0, 100_000_000, 'Place search distance is invalid');
  return { place, score: value.score, providerId: descriptor.id, source: value.source === 'EXTERNAL' ? 'EXTERNAL' : value.source === 'OFFLINE' ? 'OFFLINE' : value.source === 'RECEIVED_KEYSTONE' ? 'RECEIVED_KEYSTONE' : 'LOCAL', ...(distanceMeters === undefined ? {} : { distanceMeters }) };
}

function cloneOptionalPlace(value: Place | undefined, descriptor: MapProviderDescriptor): Place | undefined { return value === undefined ? undefined : validatePlace({ ...value, provenance: { ...validatePlace(value).provenance, ...(value.provenance.kind === 'EXTERNAL_PROVIDER' ? { providerId: descriptor.id } : {}) } }); }
function placeSnapshot(value: Place): PlaceSnapshot { return { version: 1, placeId: value.placeId, displayName: value.displayName, ...(value.coordinates ? { coordinates: value.coordinates } : {}), ...(value.approximateRegion ? { approximateRegion: value.approximateRegion } : {}), ...(value.address ? { address: value.address } : {}), ...(value.category ? { category: value.category } : {}), provenance: structuredClone(value.provenance), ...(value.publicMetadata ? { publicMetadata: structuredClone(value.publicMetadata) } : {}), ...(value.website ? { website: value.website } : {}), ...(value.phone ? { phone: value.phone } : {}) }; }
function validateProvenance(value: unknown): PlaceProviderProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Place provenance is invalid');
  const candidate = value as Record<string, unknown>;
  const kinds: PlaceProviderProvenance['kind'][] = ['LOCAL_DATASET', 'OFFLINE_DATASET', 'EXTERNAL_PROVIDER', 'USER_CREATED', 'RECEIVED_KEYSTONE', 'PUBLICATION'];
  if (!kinds.includes(candidate.kind as PlaceProviderProvenance['kind']) || typeof candidate.observedAt !== 'string' || !Number.isFinite(Date.parse(candidate.observedAt))) throw new MapsError('INVALID_ARGUMENT', 'Place provenance is invalid');
  return { kind: candidate.kind as PlaceProviderProvenance['kind'], ...(candidate.providerId === undefined ? {} : { providerId: boundedText(candidate.providerId, 256, true) }), ...(candidate.providerPlaceId === undefined ? {} : { providerPlaceId: boundedText(candidate.providerPlaceId, 512, true) }), ...(candidate.sourceReference === undefined ? {} : { sourceReference: boundedText(candidate.sourceReference, 2_048, true) }), ...(candidate.license === undefined ? {} : { license: boundedText(candidate.license, 1_024) }), observedAt: candidate.observedAt };
}

function validateMetadata(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Place metadata is invalid');
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAPS_MAX_METADATA);
  if (Object.keys(value as Record<string, unknown>).length > MAPS_MAX_METADATA) throw new MapsError('BOUNDS_EXCEEDED', 'Place metadata bound exceeded');
  return Object.fromEntries(entries.map(([key, item]) => { if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key) || typeof item !== 'string' || item.length > 2_048) throw new MapsError('INVALID_ARGUMENT', 'Place metadata entry is invalid'); return [key, item]; }));
}

function validateSavedPlace(value: unknown): SavedPlace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Saved place is invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !safeId(candidate.id, 256) || !safeId(candidate.placeId, 256) || typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.updatedAt)) || !Array.isArray(candidate.tags) || !Array.isArray(candidate.collectionIds)) throw new MapsError('INVALID_ARGUMENT', 'Saved place is invalid');
  return { version: 1, id: candidate.id, placeId: candidate.placeId, snapshot: placeSnapshot(validatePlace(candidate.snapshot)), ...(candidate.label === undefined ? {} : { label: boundedText(candidate.label, 256) }), ...(candidate.note === undefined ? {} : { note: boundedText(candidate.note, 8_192) }), tags: normalizeTags(candidate.tags as unknown[]), collectionIds: candidate.collectionIds.map(value => { if (!safeId(value, 256)) throw new MapsError('INVALID_ARGUMENT', 'Saved place collection id is invalid'); return value; }), createdAt: candidate.createdAt, updatedAt: candidate.updatedAt };
}

function validateCollection(value: unknown): PlaceCollection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Place collection is invalid');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !safeId(candidate.id, 256) || !Array.isArray(candidate.placeIds) || candidate.placeIds.length > MAPS_MAX_SAVED_PLACES || candidate.placeIds.some(value => !safeId(value, 256)) || typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt)) || !Number.isFinite(Date.parse(candidate.updatedAt))) throw new MapsError('INVALID_ARGUMENT', 'Place collection is invalid');
  return { version: 1, id: candidate.id, name: boundedText(candidate.name, 256, true), ...(candidate.description === undefined ? {} : { description: boundedText(candidate.description, 2_048) }), placeIds: [...new Set(candidate.placeIds)], createdAt: candidate.createdAt, updatedAt: candidate.updatedAt };
}

function normalizeTags(value: readonly unknown[] | undefined): readonly string[] { return [...new Set((value ?? []).slice(0, 64).map(item => boundedText(item, 128, true)))]; }

function validateGeometry(value: unknown, limit: number): readonly GeoCoordinate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) throw new MapsError('PROVIDER_FAILURE', 'Geometry is invalid or too large');
  return value.map(validateCoordinate);
}

function defaultViewport(timestamp: string): MapViewport { return { version: 1, center: { latitude: 0, longitude: 0 }, zoom: 2, origin: 'MANUAL', updatedAt: timestamp }; }
function viewportBounds(viewport: MapViewport): GeoBounds { const span = Math.max(0.001, 90 / 2 ** Math.min(viewport.zoom, 8)); return { north: Math.min(90, viewport.center.latitude + span), south: Math.max(-90, viewport.center.latitude - span), east: Math.min(180, viewport.center.longitude + span * 2), west: Math.max(-180, viewport.center.longitude - span * 2) }; }
function schematicMap(viewport: MapViewport, providerId?: string, _reason?: string): MapData { return { version: 1, providerId: providerId ?? 'keystone.schematic', layer: 'SCHEMATIC', viewport, features: [], offline: true }; }
function withinBounds(point: GeoCoordinate, bounds: GeoBounds): boolean { return point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east; }
function estimateBytes(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function cloneNavigation(value: MutableNavigationSession): NavigationSession { return { version: 1, id: value.id, route: structuredClone(value.route), state: value.state, mode: value.mode, startedAt: value.startedAt, ...(value.endedAt ? { endedAt: value.endedAt } : {}), currentStepIndex: value.currentStepIndex, progressRatio: value.progressRatio, rerouteCount: value.rerouteCount, ...(value.lastFix ? { lastFix: structuredClone(value.lastFix) } : {}), ignoredStaleFixes: value.ignoredStaleFixes }; }
function safeId(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function safeText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function boundedText(value: unknown, max: number, required = false): string { if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new MapsError('INVALID_ARGUMENT', 'Text value is invalid'); return value.trim(); }
function boundedInt(value: unknown, minimum: number, maximum: number): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) return Math.max(minimum, Math.min(maximum, Math.floor(minimum))); return Math.max(minimum, Math.min(maximum, value)); }
function boundedNumber(value: unknown, minimum: number, maximum: number, message: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new MapsError('INVALID_ARGUMENT', message); return value; }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function randomId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function cloneOptional<T>(value: T | undefined): T | undefined { return value === undefined ? undefined : structuredClone(value); }

function compareSearchResults(left: PlaceSearchResult, right: PlaceSearchResult): number { return right.score - left.score || (left.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (right.distanceMeters ?? Number.MAX_SAFE_INTEGER) || left.place.placeId.localeCompare(right.place.placeId); }
function mergeSearchResults(values: readonly PlaceSearchResult[], limit: number): readonly PlaceSearchResult[] { const byId = new Map<string, PlaceSearchResult>(); for (const value of values) { const current = byId.get(value.place.placeId); if (!current || compareSearchResults(value, current) < 0) byId.set(value.place.placeId, value); } return [...byId.values()].sort(compareSearchResults).slice(0, limit).map(value => structuredClone(value)); }

function distanceBetween(a: GeoCoordinate | LocationFix, b: GeoCoordinate | LocationFix): number {
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function distanceToRoute(point: GeoCoordinate | LocationFix, geometry: readonly GeoCoordinate[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of geometry) best = Math.min(best, distanceBetween(point, candidate));
  for (let index = 0; index < geometry.length - 1; index += 1) {
    const left = geometry[index]!;
    const right = geometry[index + 1]!;
    const fraction = projectionFraction(point, left, right);
    best = Math.min(best, distanceBetween(point, { latitude: left.latitude + (right.latitude - left.latitude) * fraction, longitude: left.longitude + (right.longitude - left.longitude) * fraction }));
  }
  return best;
}

function projectionFraction(point: GeoCoordinate | LocationFix, left: GeoCoordinate, right: GeoCoordinate): number {
  const dx = right.longitude - left.longitude;
  const dy = right.latitude - left.latitude;
  if (dx === 0 && dy === 0) return 0;
  return clamp01(((point.longitude - left.longitude) * dx + (point.latitude - left.latitude) * dy) / (dx * dx + dy * dy));
}

function stepIndexForFix(route: GeographicRoute, fix: LocationFix, previous: number): number {
  const steps = route.legs.flatMap(leg => leg.steps);
  let next = Math.max(0, Math.min(previous, Math.max(0, steps.length - 1)));
  for (let index = next; index < steps.length; index += 1) {
    const end = steps[index]!.geometry.at(-1);
    if (end && distanceBetween(fix, end) < Math.max(30, fix.horizontalAccuracy * 2)) next = Math.min(steps.length - 1, index + 1);
  }
  return next;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '::1') return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every(Number.isInteger)) return parts[0]! === 10 || parts[0]! === 127 || (parts[0]! === 192 && parts[1] === 168) || (parts[0]! === 172 && parts[1]! >= 16 && parts[1]! <= 31);
  return false;
}

function isPlaceCiphertext(value: unknown): value is PlaceCiphertext { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const candidate = value as Record<string, unknown>; return candidate.version === 1 && candidate.algorithm === 'APPLICATION_E2E' && typeof candidate.nonce === 'string' && typeof candidate.ciphertext === 'string' && candidate.nonce.length <= 512 && candidate.ciphertext.length <= 8 * 1024 * 1024; }
function parsePlaceShareWire(value: unknown): PlaceShareWire | undefined { if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined; const candidate = value as Record<string, unknown>; if (candidate.version !== 1 || candidate.kind !== 'PLACE_SHARE' || !safeId(candidate.shareId, 256) || !safeId(candidate.sender, 512) || !safeId(candidate.recipient, 512) || !['PUBLIC', 'PRIVATE'].includes(candidate.visibility as string) || typeof candidate.encrypted !== 'boolean' || typeof candidate.issuedAt !== 'string' || typeof candidate.expiresAt !== 'string' || !Number.isFinite(Date.parse(candidate.issuedAt)) || !Number.isFinite(Date.parse(candidate.expiresAt))) return undefined; if (candidate.encrypted && !isPlaceCiphertext(candidate.ciphertext)) return undefined; if (!candidate.encrypted && !candidate.payload) return undefined; return candidate as unknown as PlaceShareWire; }
function parsePlaceSharePayload(value: unknown): PlaceSharePayload { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MapsError('INVALID_ARGUMENT', 'Place share payload is invalid'); const candidate = value as Record<string, unknown>; if (candidate.version !== 1 || candidate.kind !== 'PLACE' || !['PUBLIC', 'PRIVATE'].includes(candidate.visibility as string) || !candidate.reference) throw new MapsError('INVALID_ARGUMENT', 'Place share payload is invalid'); const reference = candidate.reference as Record<string, unknown>; if (reference.version !== 1 || reference.kind !== 'PLACE' || !safeId(reference.placeId, 256) || typeof reference.uri !== 'string' || !reference.uri.startsWith('keystone://place/')) throw new MapsError('INVALID_ARGUMENT', 'Place reference is invalid'); const snapshot = validatePlace(reference.snapshot); if (snapshot.placeId !== reference.placeId) throw new MapsError('INTEGRITY', 'Place reference identity mismatch'); return { version: 1, kind: 'PLACE', visibility: candidate.visibility as 'PUBLIC' | 'PRIVATE', reference: { version: 1, kind: 'PLACE', placeId: reference.placeId, uri: reference.uri, snapshot: placeSnapshot(snapshot) } }; }
function containsLocationDisclosure(value: unknown, depth = 0, insidePortableCoordinates = false): boolean {
  if (depth > 8 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(item => containsLocationDisclosure(item, depth + 1, insidePortableCoordinates));
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => {
    if (!insidePortableCoordinates && /^(currentLocation|locationFix|movementHistory|gps)$/i.test(key)) return true;
    if (!insidePortableCoordinates && /^(latitude|longitude|horizontalAccuracy|altitude|heading|speed)$/i.test(key)) return true;
    return containsLocationDisclosure(item, depth + 1, key === 'coordinates');
  });
}
