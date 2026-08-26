/** Typed desktop projection for R0P86 Photos.
 *
 * The shell receives bounded metadata and explicit-action results only. A
 * platform bootstrapper creates the core service with
 * createProductionMediaLibrary({ nativeHost }) and adapts NativeHost file
 * handles, R0P74 content delivery, R0P84 Continuity, R0P85 Nearby and R0P80
 * publication into this projection. The browser/Tauri UI never imports a
 * decoder tool or receives a private path; controlled media adapters are not
 * installed by this runtime.
 */
export type DesktopPhotosImportKind = 'SELECTED_FILE' | 'SELECTED_FOLDER' | 'CAMERA_ROLL';
export type DesktopPhotosShareDestination = 'CONTACTS' | 'MESSAGES' | 'SPACES' | 'NEARBY' | 'OWN_DEVICE' | 'PERSONAL_WEB';
export type DesktopPhotosShareMode = 'COPY' | 'ALBUM_REFERENCE' | 'PUBLISH_RENDITION';

export interface DesktopPhotoAsset {
  readonly mediaId: string;
  readonly filename: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly mimeType: string;
  readonly byteLength: number;
  readonly capturedAt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly hasEmbeddedLocation: boolean;
  readonly state: 'ACTIVE' | 'TRASHED';
}
export interface DesktopPhotoAlbum { readonly id: string; readonly name: string; readonly count: number; readonly sharing: 'PRIVATE' | 'SHARED_REFERENCE_ONLY'; }
export interface DesktopPhotosTimeline { readonly items: readonly DesktopPhotoAsset[]; readonly nextCursor?: string; readonly total: number; readonly groups: readonly { readonly key: string; readonly count: number }[]; }
export interface DesktopPhotosViewer { readonly asset: DesktopPhotoAsset; readonly original: 'AVAILABLE' | 'UNAVAILABLE' | 'FETCH_REQUIRED'; readonly thumbnail: 'AVAILABLE' | 'UNAVAILABLE' | 'REGENERATE_REQUIRED'; readonly metadata: Readonly<Record<string, string | number | boolean | undefined>>; }
export interface DesktopPhotosState { readonly total: number; readonly albums: number; readonly favorites: number; readonly trashed: number; readonly localOnly: true; readonly cameraRoll: 'EXPLICIT_HOST_ACTION_ONLY'; }

export interface DesktopPhotosRuntime {
  open(): Promise<DesktopPhotosState>;
  timeline(input?: { readonly cursor?: string; readonly limit?: number; readonly favoritesOnly?: boolean; readonly includeTrash?: boolean; readonly kind?: 'IMAGE' | 'VIDEO' }): Promise<DesktopPhotosTimeline>;
  albums(): Promise<readonly DesktopPhotoAlbum[]>;
  album(mediaAlbumId: string): Promise<readonly DesktopPhotoAsset[]>;
  search(input: { readonly query: string; readonly limit?: number }): Promise<readonly DesktopPhotoAsset[]>;
  viewer(mediaId: string): Promise<DesktopPhotosViewer>;
  importSelected?(input: { readonly kind: DesktopPhotosImportKind }): Promise<{ readonly imported: number; readonly duplicates: number; readonly failed: number }>;
  share?(input: { readonly mediaId: string; readonly destination: DesktopPhotosShareDestination; readonly mode: DesktopPhotosShareMode; readonly ownerConfirmed: true; readonly locationConfirmed?: boolean }): Promise<{ readonly status: string; readonly publicCacheable: boolean }>;
  place?(input: { readonly mediaId: string; readonly deviceId: string; readonly mode: 'METADATA' | 'THUMBNAIL' | 'ORIGINAL'; readonly ownerConfirmed: true }): Promise<{ readonly metadata: string; readonly thumbnail: string; readonly original: string }>;
  trash?(mediaId: string): Promise<void>;
  restore?(mediaId: string): Promise<void>;
  map?(input: { readonly ownerConfirmed: true }): Promise<readonly { readonly mediaId: string; readonly latitude: number; readonly longitude: number }[]>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopPhotosRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopPhotosRuntime(runtime: DesktopPhotosRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopPhotosRuntime(): DesktopPhotosRuntime | undefined { return current; }
export function subscribeDesktopPhotosRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
