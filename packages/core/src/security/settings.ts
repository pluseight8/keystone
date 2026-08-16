import type { Transport } from '../transport.js';
import { parseAIModelRef, type AIOrchestrationMode, type AISettingsModel } from '../ai/privacy.js';

export type SettingsLanguage = 'en' | 'ru';
export type SettingsTheme = 'system' | 'light' | 'dark';
export type ProfileVisibility = 'public' | 'contacts' | 'private';

/**
 * User-controlled, device-local settings.  This state is deliberately kept
 * separate from the shared Keystone config: it must never be replicated by a
 * CRDT or advertised to peers.
 */
export interface KeystoneSettings {
  version: 1;
  privacy: {
    profileVisibility: ProfileVisibility;
    discoveryParticipation: boolean;
    presence: boolean;
    typingIndicators: boolean;
    readReceipts: boolean;
    mediaAutoplay: boolean;
    mediaPrefetch: boolean;
    localHistory: boolean;
  };
  network: {
    offlineMode: boolean;
    bandwidthLimitBytesPerSecond: number;
    maxParallelTransfers: number;
  };
  notifications: {
    enabled: boolean;
    mutedCategories: readonly string[];
    mutedUsers: readonly string[];
    mutedCommunities: readonly string[];
  };
  ai: {
    localEnabled: boolean;
    allowLocalIndexing: boolean;
    remoteEnabled: boolean;
    models: readonly AISettingsModel[];
    defaultModel: string | null;
    fallbacks: readonly string[];
    contextLimits: Readonly<Record<string, number>>;
    personalTarget: string;
    orchestrationMode: AIOrchestrationMode;
  };
  appearance: { language: SettingsLanguage; theme: SettingsTheme };
  storage: { quotaBytes: number };
}

export interface SettingsStorage { read(): Promise<unknown | undefined>; write(value: unknown): Promise<void>; }
export class InMemorySettingsStorage implements SettingsStorage {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface SettingsRuntimeBindings {
  setOfflineMode?(enabled: boolean): void | Promise<void>;
  setDiscoveryParticipation?(enabled: boolean): void | Promise<void>;
  setLocalHistory?(enabled: boolean): void | Promise<void>;
  setTypingIndicators?(enabled: boolean): void | Promise<void>;
  setReadReceipts?(enabled: boolean): void | Promise<void>;
  setPresence?(enabled: boolean): void | Promise<void>;
  setMediaPrefetch?(enabled: boolean): void | Promise<void>;
  setMediaAutoplay?(enabled: boolean): void | Promise<void>;
  setMaxParallelTransfers?(value: number): void | Promise<void>;
  setBandwidthLimit?(value: number): void | Promise<void>;
  setNotificationsEnabled?(enabled: boolean): void | Promise<void>;
  setNotificationMutes?(value: KeystoneSettings['notifications']): void | Promise<void>;
  setStorageQuota?(value: number): void | Promise<void>;
  setAIOrchestrationMode?(mode: AIOrchestrationMode): void | Promise<void>;
}

export interface CoreSettingsTargets {
  discovery?: { setDiscoveryParticipation(enabled: boolean): void; setLocalHistoryEnabled(enabled: boolean): Promise<void> };
  messaging?: { setTypingIndicatorsEnabled(enabled: boolean): void; setReadReceiptsEnabled(enabled: boolean): void; setPresenceEnabled(enabled: boolean): void };
  notifications?: { setEnabled(enabled: boolean): void; applySettings?(value: KeystoneSettings['notifications']): Promise<void> };
  transfers?: { setMaxParallelTransfers(value: number): void; setBandwidthLimit(value: number): void };
  transport?: { setOfflineMode(enabled: boolean): void };
  cache?: { setQuotaBytes(value: number): void };
  media?: { setAutoplay(enabled: boolean): void; setPrefetch(enabled: boolean): void };
  ai?: { setOrchestrationMode(mode: AIOrchestrationMode): void };
}

/** Host-neutral media policy used by audio/video/short/live adapters. */
export class MediaSettingsPolicy {
  private autoplay = true; private prefetch = true;
  setAutoplay(enabled: boolean): void { this.autoplay = !!enabled; }
  setPrefetch(enabled: boolean): void { this.prefetch = !!enabled; }
  allowsAutoplay(): boolean { return this.autoplay; }
  allowsPrefetch(): boolean { return this.prefetch; }
}

/** Convenience binding used by desktop/mobile hosts during bootstrap. */
export function bindCoreSettings(settings: SettingsService, targets: CoreSettingsTargets): Promise<void> {
  return settings.bind({
    setOfflineMode: enabled => targets.transport?.setOfflineMode(enabled),
    setDiscoveryParticipation: enabled => targets.discovery?.setDiscoveryParticipation(enabled),
    setLocalHistory: enabled => targets.discovery?.setLocalHistoryEnabled(enabled),
    setTypingIndicators: enabled => targets.messaging?.setTypingIndicatorsEnabled(enabled),
    setReadReceipts: enabled => targets.messaging?.setReadReceiptsEnabled(enabled),
    setPresence: enabled => targets.messaging?.setPresenceEnabled(enabled),
    setMaxParallelTransfers: value => targets.transfers?.setMaxParallelTransfers(value),
    setBandwidthLimit: value => targets.transfers?.setBandwidthLimit(value),
    setNotificationsEnabled: enabled => targets.notifications?.setEnabled(enabled),
    setNotificationMutes: value => targets.notifications?.applySettings?.(value),
    setStorageQuota: value => targets.cache?.setQuotaBytes(value),
    setMediaAutoplay: enabled => targets.media?.setAutoplay(enabled),
    setMediaPrefetch: enabled => targets.media?.setPrefetch(enabled),
    setAIOrchestrationMode: mode => targets.ai?.setOrchestrationMode(mode),
  });
}

export type SettingsPatch = {
  [K in keyof Omit<KeystoneSettings, 'version'>]?: Partial<KeystoneSettings[K]>;
};

export const DEFAULT_KEYSTONE_SETTINGS: KeystoneSettings = {
  version: 1,
  privacy: { profileVisibility: 'public', discoveryParticipation: true, presence: true, typingIndicators: true, readReceipts: true, mediaAutoplay: true, mediaPrefetch: true, localHistory: true },
  network: { offlineMode: false, bandwidthLimitBytesPerSecond: 0, maxParallelTransfers: 3 },
  notifications: { enabled: true, mutedCategories: [], mutedUsers: [], mutedCommunities: [] },
  ai: { localEnabled: false, allowLocalIndexing: true, remoteEnabled: true, models: [], defaultModel: null, fallbacks: [], contextLimits: {}, personalTarget: 'automatic', orchestrationMode: 'balanced' },
  appearance: { language: 'en', theme: 'system' },
  storage: { quotaBytes: 512 * 1024 * 1024 },
};

/** Validated local settings with an explicit adapter boundary into core. */
export class SettingsService {
  private state: KeystoneSettings = structuredClone(DEFAULT_KEYSTONE_SETTINGS);
  private readonly listeners = new Set<(value: Readonly<KeystoneSettings>) => void>();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private binding?: SettingsRuntimeBindings;

  constructor(private readonly storage: SettingsStorage = new InMemorySettingsStorage()) { this.readyPromise = this.hydrate(); }
  async ready(): Promise<void> { await this.readyPromise; }
  snapshot(): Readonly<KeystoneSettings> { return structuredClone(this.state); }
  subscribe(listener: (value: Readonly<KeystoneSettings>) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Bind switches to live services; applying a setting is not a UI-only operation. */
  async bind(bindings: SettingsRuntimeBindings): Promise<void> { await this.ready(); this.binding = bindings; await this.apply(this.state); }
  async update(patch: SettingsPatch): Promise<Readonly<KeystoneSettings>> {
    await this.ready();
    const next = parseSettings({ ...this.state, ...patch, privacy: { ...this.state.privacy, ...(patch.privacy ?? {}) }, network: { ...this.state.network, ...(patch.network ?? {}) }, notifications: { ...this.state.notifications, ...(patch.notifications ?? {}) }, ai: { ...this.state.ai, ...(patch.ai ?? {}) }, appearance: { ...this.state.appearance, ...(patch.appearance ?? {}) }, storage: { ...this.state.storage, ...(patch.storage ?? {}) } });
    this.state = next; await this.persist(); await this.apply(next); this.listeners.forEach(listener => listener(this.snapshot())); return this.snapshot();
  }
  async set<K extends keyof Omit<KeystoneSettings, 'version'>>(section: K, value: KeystoneSettings[K]): Promise<Readonly<KeystoneSettings>> { return this.update({ [section]: value } as SettingsPatch); }
  private async hydrate(): Promise<void> { const value = await this.storage.read(); this.state = parseSettings(value ? { ...DEFAULT_KEYSTONE_SETTINGS, ...(value as object) } : DEFAULT_KEYSTONE_SETTINGS); }
  private async persist(): Promise<void> { const snapshot = structuredClone(this.state); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private async apply(value: KeystoneSettings): Promise<void> {
    const b = this.binding; if (!b) return;
    await b.setOfflineMode?.(value.network.offlineMode); await b.setDiscoveryParticipation?.(value.privacy.discoveryParticipation); await b.setLocalHistory?.(value.privacy.localHistory);
    await b.setTypingIndicators?.(value.privacy.typingIndicators); await b.setReadReceipts?.(value.privacy.readReceipts); await b.setPresence?.(value.privacy.presence); await b.setMediaPrefetch?.(value.privacy.mediaPrefetch); await b.setMediaAutoplay?.(value.privacy.mediaAutoplay);
    await b.setMaxParallelTransfers?.(value.network.maxParallelTransfers); await b.setBandwidthLimit?.(value.network.bandwidthLimitBytesPerSecond); await b.setNotificationsEnabled?.(value.notifications.enabled); await b.setNotificationMutes?.(value.notifications); await b.setStorageQuota?.(value.storage.quotaBytes);
    await b.setAIOrchestrationMode?.(value.ai.orchestrationMode);
  }
}

/** A non-sensitive network snapshot suitable for a Settings screen. */
export interface NetworkDiagnosticsSnapshot {
  state: 'online' | 'offline';
  connectedPeers: readonly string[];
  hyperswarm: boolean;
  activeTransfers: number;
  maxParallelTransfers: number;
  bandwidthLimitBytesPerSecond: number;
}
export class NetworkDiagnosticsService {
  constructor(private readonly transport: Pick<Transport, 'isPeerConnected'>, private readonly settings?: SettingsService, private readonly providers: () => readonly string[] = () => []) {}
  async snapshot(knownPeers: readonly string[] = []): Promise<NetworkDiagnosticsSnapshot> {
    const settings = this.settings?.snapshot(); const connectedPeers = knownPeers.filter(peer => this.transport.isPeerConnected?.(peer));
    return { state: settings?.network.offlineMode ? 'offline' : 'online', connectedPeers, hyperswarm: true, activeTransfers: this.providers().length, maxParallelTransfers: settings?.network.maxParallelTransfers ?? 3, bandwidthLimitBytesPerSecond: settings?.network.bandwidthLimitBytesPerSecond ?? 0 };
  }
}

export function parseSettings(value: unknown): KeystoneSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid Keystone settings');
  const candidate = value as Partial<KeystoneSettings>;
  const merged = {
    ...DEFAULT_KEYSTONE_SETTINGS,
    ...candidate,
    privacy: { ...DEFAULT_KEYSTONE_SETTINGS.privacy, ...(candidate.privacy ?? {}) },
    network: { ...DEFAULT_KEYSTONE_SETTINGS.network, ...(candidate.network ?? {}) },
    notifications: { ...DEFAULT_KEYSTONE_SETTINGS.notifications, ...(candidate.notifications ?? {}) },
    ai: { ...DEFAULT_KEYSTONE_SETTINGS.ai, ...(candidate.ai ?? {}) },
    appearance: { ...DEFAULT_KEYSTONE_SETTINGS.appearance, ...(candidate.appearance ?? {}) },
    storage: { ...DEFAULT_KEYSTONE_SETTINGS.storage, ...(candidate.storage ?? {}) },
  };
  if (merged.version !== 1) throw new Error('Unsupported Keystone settings version');
  if (!['public', 'contacts', 'private'].includes(merged.privacy.profileVisibility)) throw new Error('Invalid profile visibility');
  for (const key of ['discoveryParticipation', 'presence', 'typingIndicators', 'readReceipts', 'mediaAutoplay', 'mediaPrefetch', 'localHistory'] as const) if (typeof merged.privacy[key] !== 'boolean') throw new Error(`Invalid privacy setting: ${key}`);
  if (typeof merged.network.offlineMode !== 'boolean' || !Number.isInteger(merged.network.maxParallelTransfers) || merged.network.maxParallelTransfers < 1 || merged.network.maxParallelTransfers > 16 || !Number.isFinite(merged.network.bandwidthLimitBytesPerSecond) || merged.network.bandwidthLimitBytesPerSecond < 0) throw new Error('Invalid network settings');
  if (typeof merged.notifications.enabled !== 'boolean' || !Array.isArray(merged.notifications.mutedCategories) || !Array.isArray(merged.notifications.mutedUsers) || !Array.isArray(merged.notifications.mutedCommunities)) throw new Error('Invalid notification settings');
  if (typeof merged.ai.localEnabled !== 'boolean' || typeof merged.ai.allowLocalIndexing !== 'boolean' || typeof merged.ai.remoteEnabled !== 'boolean' || typeof merged.ai.personalTarget !== 'string' || !merged.ai.personalTarget.trim() || !['private-only', 'balanced', 'local-preferred'].includes(merged.ai.orchestrationMode) || !Array.isArray(merged.ai.models) || !merged.ai.models.every(model => isAISettingsModel(model)) || !(merged.ai.defaultModel === null || (typeof merged.ai.defaultModel === 'string' && validModelRef(merged.ai.defaultModel))) || !Array.isArray(merged.ai.fallbacks) || !merged.ai.fallbacks.every(ref => typeof ref === 'string' && validModelRef(ref)) || !merged.ai.contextLimits || typeof merged.ai.contextLimits !== 'object' || Array.isArray(merged.ai.contextLimits) || !Object.values(merged.ai.contextLimits as Record<string, unknown>).every(value => Number.isSafeInteger(value) && (value as number) > 0) || !['en', 'ru'].includes(merged.appearance.language) || !['system', 'light', 'dark'].includes(merged.appearance.theme) || !Number.isInteger(merged.storage.quotaBytes) || merged.storage.quotaBytes < 0) throw new Error('Invalid settings');
  return structuredClone(merged) as KeystoneSettings;
}

function isAISettingsModel(value: unknown): value is AISettingsModel {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AISettingsModel>;
  return typeof candidate.ref === 'string' && validModelRef(candidate.ref) && (candidate.scope === 'local' || candidate.scope === 'remote') && typeof candidate.enabled === 'boolean' && Number.isSafeInteger(candidate.contextLimit) && (candidate.contextLimit as number) > 0 && (candidate.endpoint === undefined || typeof candidate.endpoint === 'string') && (candidate.displayName === undefined || typeof candidate.displayName === 'string');
}
function validModelRef(value: string): boolean { try { parseAIModelRef(value); return true; } catch { return false; } }
