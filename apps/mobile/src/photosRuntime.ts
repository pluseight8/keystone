/** Mobile host boundary for R0P86 Photos.
 *
 * Camera roll, file pickers and large-original fetches are explicit native
 * actions. The mobile UI receives metadata projections only.
 */
export type MobilePhotosImportKind = 'SELECTED_FILE' | 'SELECTED_FOLDER' | 'CAMERA_ROLL';
export type MobilePhotosShareDestination = 'CONTACTS' | 'MESSAGES' | 'SPACES' | 'NEARBY' | 'OWN_DEVICE' | 'PERSONAL_WEB';
export type MobilePhotosShareMode = 'COPY' | 'ALBUM_REFERENCE' | 'PUBLISH_RENDITION';

export interface MobilePhotoAsset {
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
export interface MobilePhotoAlbum { readonly id: string; readonly name: string; readonly count: number; readonly sharing: 'PRIVATE' | 'SHARED_REFERENCE_ONLY'; }
export interface MobilePhotosState { readonly total: number; readonly albums: number; readonly favorites: number; readonly trashed: number; readonly cameraRoll: 'EXPLICIT_HOST_ACTION_ONLY'; }
export interface MobilePhotosViewer { readonly asset: MobilePhotoAsset; readonly original: 'AVAILABLE' | 'UNAVAILABLE' | 'FETCH_REQUIRED'; readonly thumbnail: 'AVAILABLE' | 'UNAVAILABLE' | 'REGENERATE_REQUIRED'; readonly metadata: Readonly<Record<string, string | number | boolean | undefined>>; }

export interface MobilePhotosRuntime {
  open(): Promise<MobilePhotosState>;
  timeline(input?: { readonly cursor?: string; readonly limit?: number; readonly favoritesOnly?: boolean; readonly includeTrash?: boolean; readonly kind?: 'IMAGE' | 'VIDEO' }): Promise<{ readonly items: readonly MobilePhotoAsset[]; readonly nextCursor?: string; readonly total: number; readonly groups: readonly { readonly key: string; readonly count: number }[] }>;
  albums(): Promise<readonly MobilePhotoAlbum[]>;
  album(id: string): Promise<readonly MobilePhotoAsset[]>;
  search(input: { readonly query: string; readonly limit?: number; readonly includeTrash?: boolean }): Promise<readonly MobilePhotoAsset[]>;
  viewer(mediaId: string): Promise<MobilePhotosViewer>;
  importSelected?(input: { readonly kind: MobilePhotosImportKind }): Promise<{ readonly imported: number; readonly duplicates: number; readonly failed: number }>;
  share?(input: { readonly mediaId: string; readonly destination: MobilePhotosShareDestination; readonly mode: MobilePhotosShareMode; readonly ownerConfirmed: true; readonly locationConfirmed?: boolean }): Promise<{ readonly status: string; readonly publicCacheable: boolean }>;
  place?(input: { readonly mediaId: string; readonly deviceId: string; readonly mode: 'METADATA' | 'THUMBNAIL' | 'ORIGINAL'; readonly ownerConfirmed: true }): Promise<{ readonly metadata: string; readonly thumbnail: string; readonly original: string }>;
  trash?(mediaId: string): Promise<void>;
  restore?(mediaId: string): Promise<void>;
  map?(input: { readonly ownerConfirmed: true }): Promise<readonly { readonly mediaId: string; readonly latitude: number; readonly longitude: number }[]>;
  subscribe?(listener: () => void): () => void;
}

let current: MobilePhotosRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobilePhotosRuntime(runtime: MobilePhotosRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobilePhotosRuntime(): MobilePhotosRuntime | undefined { return current; }
export function subscribeMobilePhotosRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
