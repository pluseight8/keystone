/** Typed host boundary for the desktop Maps surface.
 *
 * The shell owns presentation only. A bootstrapper installs an adapter backed
 * by MapsService, R0P76 LocationService and KeystoneDeliveryInterface. The
 * adapter deliberately exposes no ambient current-position getter: location
 * is available only through the explicit showMyLocation action.
 */
export type DesktopMapRouteMode = 'WALKING' | 'DRIVING' | 'CYCLING';

export interface DesktopMapCoordinate { readonly latitude: number; readonly longitude: number; }
export interface DesktopMapViewport { readonly center: DesktopMapCoordinate; readonly zoom: number; readonly origin: string; readonly updatedAt: string; }
export interface DesktopMapProvider { readonly id: string; readonly name: string; readonly class: 'LOCAL' | 'OFFLINE' | 'EXTERNAL'; readonly operations: readonly string[]; readonly privacyNote?: string; }
export interface DesktopMapPlace { readonly placeId: string; readonly uri: string; readonly displayName: string; readonly address?: string; readonly category?: string; readonly approximateRegion?: string; readonly coordinates?: DesktopMapCoordinate; readonly provenance: string; }
export interface DesktopMapFeature { readonly id: string; readonly kind: string; readonly label?: string; readonly coordinates?: DesktopMapCoordinate; }
export interface DesktopMapRender { readonly providerId: string; readonly layer: 'VECTOR' | 'RASTER' | 'SCHEMATIC'; readonly offline: boolean; readonly features: readonly DesktopMapFeature[]; readonly attribution?: string; readonly viewport: DesktopMapViewport; }
export interface DesktopMapRouteStep { readonly instruction: string; readonly distanceMeters: number; readonly durationSeconds: number; }
export interface DesktopMapRoute { readonly id: string; readonly providerId: string; readonly mode: DesktopMapRouteMode; readonly distanceMeters: number; readonly durationSeconds: number; readonly steps: readonly DesktopMapRouteStep[]; readonly estimated: boolean; }
export interface DesktopOfflinePackage { readonly id: string; readonly providerId: string; readonly name: string; readonly sizeBytes: number; readonly contentHash: string; }
export interface DesktopMapsSurfaceState { readonly viewport: DesktopMapViewport; readonly providers: readonly DesktopMapProvider[]; readonly location: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'AVAILABLE_BY_EXPLICIT_ACTION'; readonly externalProviderDisclosure: string; }

export interface DesktopMapsRuntime {
  open(): Promise<DesktopMapsSurfaceState>;
  render?(input?: { readonly viewport?: DesktopMapViewport; readonly providerId?: string }): Promise<DesktopMapRender>;
  setViewport?(viewport: DesktopMapViewport): Promise<DesktopMapViewport>;
  search(input: { readonly query: string; readonly limit?: number }): Promise<readonly DesktopMapPlace[]>;
  saved?(limit?: number): Promise<readonly DesktopMapPlace[]>;
  offline?(): Promise<readonly DesktopOfflinePackage[]>;
  planRoute?(input: { readonly origin: string; readonly destination: string; readonly mode: DesktopMapRouteMode }): Promise<DesktopMapRoute>;
  /** Host must map this call to an explicit R0P76 one-shot grant. */
  showMyLocation?(): Promise<{ readonly viewport: DesktopMapViewport; readonly precision: 'APPROXIMATE' | 'PRECISE' }>;
  subscribe?(listener: () => void): () => void;
  openExternal?(url: string): Promise<void>;
}

let current: DesktopMapsRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopMapsRuntime(runtime: DesktopMapsRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopMapsRuntime(): DesktopMapsRuntime | undefined { return current; }
export function subscribeDesktopMapsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
