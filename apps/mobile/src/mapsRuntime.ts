/** Mobile host boundary for privacy-first Maps/Places/Navigation.
 * No location getter is exposed. `showMyLocation` is an explicit owner action
 * that the native/bootstrap layer must implement with the R0P76 grant path.
 */
export type MobileMapRouteMode = 'WALKING' | 'DRIVING' | 'CYCLING';
export interface MobileMapCoordinate { readonly latitude: number; readonly longitude: number; }
export interface MobileMapViewport { readonly center: MobileMapCoordinate; readonly zoom: number; readonly origin: string; readonly updatedAt: string; }
export interface MobileMapProvider { readonly id: string; readonly name: string; readonly class: 'LOCAL' | 'OFFLINE' | 'EXTERNAL'; readonly operations: readonly string[]; readonly privacyNote?: string; }
export interface MobileMapPlace { readonly placeId: string; readonly uri: string; readonly displayName: string; readonly address?: string; readonly category?: string; readonly approximateRegion?: string; readonly coordinates?: MobileMapCoordinate; readonly provenance: string; }
export interface MobileMapFeature { readonly id: string; readonly kind: string; readonly label?: string; readonly coordinates?: MobileMapCoordinate; }
export interface MobileMapRender { readonly providerId: string; readonly layer: 'VECTOR' | 'RASTER' | 'SCHEMATIC'; readonly offline: boolean; readonly features: readonly MobileMapFeature[]; readonly attribution?: string; readonly viewport: MobileMapViewport; }
export interface MobileMapRoute { readonly id: string; readonly providerId: string; readonly mode: MobileMapRouteMode; readonly distanceMeters: number; readonly durationSeconds: number; readonly steps: readonly { readonly instruction: string; readonly distanceMeters: number; readonly durationSeconds: number }[]; readonly estimated: boolean; }
export interface MobileOfflinePackage { readonly id: string; readonly providerId: string; readonly name: string; readonly sizeBytes: number; readonly contentHash: string; }
export interface MobileMapsState { readonly viewport: MobileMapViewport; readonly providers: readonly MobileMapProvider[]; readonly location: 'NOT_REQUESTED' | 'UNAVAILABLE' | 'AVAILABLE_BY_EXPLICIT_ACTION'; readonly externalProviderDisclosure: string; }

export interface MobileMapsRuntime {
  open(): Promise<MobileMapsState>;
  render?(input?: { readonly viewport?: MobileMapViewport; readonly providerId?: string }): Promise<MobileMapRender>;
  search(input: { readonly query: string; readonly limit?: number }): Promise<readonly MobileMapPlace[]>;
  saved?(limit?: number): Promise<readonly MobileMapPlace[]>;
  offline?(): Promise<readonly MobileOfflinePackage[]>;
  planRoute?(input: { readonly origin: string; readonly destination: string; readonly mode: MobileMapRouteMode }): Promise<MobileMapRoute>;
  showMyLocation?(): Promise<{ readonly viewport: MobileMapViewport; readonly precision: 'APPROXIMATE' | 'PRECISE' }>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileMapsRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileMapsRuntime(runtime: MobileMapsRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileMapsRuntime(): MobileMapsRuntime | undefined { return current; }
export function subscribeMobileMapsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
