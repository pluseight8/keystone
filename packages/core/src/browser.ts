/**
 * Browser/renderer-safe Core entry.
 *
 * The full Core barrel also exposes native transport and migration surfaces
 * for Node/Tauri-side consumers. Renderer builds should import only the
 * small set of UI services that are safe to evaluate in a browser context.
 * Host capabilities remain typed projections installed by the application.
 */

export { i18n, createI18nManager, dictionariesByLocale } from './i18n/index.js';
export { CaptureService } from './capture.js';
export type {
  CaptureStateStore,
  CaptureTextInput,
  CaptureItem,
  CaptureListQuery,
  CapturePage,
} from './capture.js';
export { ContactService } from './contacts.js';
export { TaskService } from './tasks.js';
export type {
  TaskStateStore,
  TaskServiceOptions,
  Task,
  TaskList,
} from './tasks.js';

// These projections are safe for the renderer: they operate on bounded local
// bytes and metadata. Native transport, raw key material and provider secrets
// remain outside this entry point.
export { IdentityManager } from './identity.js';
export type { DevicePublicIdentity, IdentityManagerOptions } from './identity.js';
export type { NodeId } from './types.js';
export { canonicalJson, signCanonical, verifyCanonical, SodiumCryptoProvider } from './crypto.js';
export type { CryptoProvider, SodiumKeyPair } from './crypto.js';
export { SecretHandle, SecretAccessError } from './security/secrets.js';
export type {
  SecretCapability,
  SecretCreateInput,
  SecretReference,
  SecretStatus,
  SecureSecretHost,
  SecureSecretStore,
  SecureSigningHost,
  SecureCryptoHost,
  SigningDomain,
  SecretOperation,
} from './security/secrets.js';
export { DocumentService } from './documents.js';
export type {
  DocumentFileSource,
  DocumentFileRef,
  DocumentStateStore,
  DocumentDescriptor,
  DocumentReaderHandle,
} from './documents.js';
export {
  ContentCache,
  PersistentContentCache,
  sha256,
  contentUri,
  parseContentUri,
  createContentManifest,
} from './social/content.js';
export type { ContentCacheStateStore, ContentId, ContentManifest, ContentProvider } from './social/content.js';

// These are host-installed product services.  The renderer may receive their
// typed projections, but it still does not receive raw identity keys or a
// generic filesystem/transport capability.
export { AIRouter, AISettingsService, OllamaAIProvider, OpenAICompatibleAIProvider } from './ai/privacy.js';
export type {
  AIHealthSnapshot,
  AIModelDescriptor,
  AIModelRef,
  AIProvider,
  AIProviderScope,
  AISettingsModel,
  AISettingsState,
  AISettingsStorage,
  AIRequest,
  AIRouterResult,
} from './ai/privacy.js';
// Connectivity implementation imports native-host transports. Keep the
// renderer boundary type-only; a trusted host may install a real Fabric
// projection without pulling Node/Rust transport code into the WebView.
export type { ConnectivityFabric, UniversalReachabilityService, ConnectivityStateSnapshot, ConnectivityFabricSnapshot, ReachabilityResult, DeliveryRequirement } from './connectivity.js';
export { PersistentDiscoveryStorage, UnifiedDiscoveryService } from './social/discovery.js';
export type {
  DiscoveryEntry,
  DiscoveryScope,
  DiscoverySource,
  FeedPage,
  FeedSurface,
  SearchPage,
  DiscoveryStateBackend,
  PersistentDiscoveryStorage as PersistentDiscoveryStorageType,
} from './social/discovery.js';

// Media services are exposed as types here because their signing/content
// construction belongs to a native or otherwise trusted host adapter.
export { LocalContentStore, MusicService, PersistentMusicStorage, InMemoryMusicStorage, PlaybackController } from './social/music.js';
export type {
  AudioPlaybackAdapter,
  EncryptedMusicStateStore,
  LocalObjectIdentity,
  LocalObjectSigner,
  MusicObject,
  MusicService as MusicServiceType,
  PlaybackController as PlaybackControllerType,
} from './social/music.js';
export type { VideoObject, VideoPlaybackAdapter, VideoService as VideoServiceType } from './social/video.js';
export { VideoService, PersistentVideoStorage, InMemoryVideoStorage, VideoPlaybackController, VideoContentStore } from './social/video.js';
export type { EncryptedVideoStateStore, WatchState, WatchStateStore, VideoContentStore as VideoContentStoreType, VideoPlaybackController as VideoPlaybackControllerType } from './social/video.js';
export type { ShortVideoObject } from './social/shorts.js';
export { ShortFeedController, ShortVideoService } from './social/shorts.js';
export type {
  LiveBroadcastObject,
  LiveBroadcastService,
  LiveSessionController,
} from './social/streams.js';
export { SharedFolderService, ContentCacheFolderContentStore } from './shared-folders.js';
export type {
  FolderContentStore,
  FolderFileId,
  FolderFileProjection,
  FolderId,
  FolderSigner,
  FolderStateStore,
  SharedFolderServiceOptions,
} from './shared-folders.js';
