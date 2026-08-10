import * as Y from 'yjs';
import { KeystoneConfigSchema, mergeConfig, splitConfig, type KeystoneConfig, type LocalKeystoneConfig, type SharedKeystoneConfig } from './schema.js';

export interface LocalConfigStorage {
  load(): Promise<LocalKeystoneConfig | undefined>;
  save(config: LocalKeystoneConfig): Promise<void>;
}

export type ConfigListener = (config: Readonly<KeystoneConfig>) => void;

/** Owns validated configuration and mirrors only device-independent sections to Yjs. */
export class GlobalConfigManager {
  private readonly shared: Y.Map<unknown>;
  private local!: LocalKeystoneConfig;
  private current!: KeystoneConfig;
  private readonly listeners = new Set<ConfigListener>();

  constructor(private readonly document: Y.Doc, private readonly storage: LocalConfigStorage) {
    this.shared = document.getMap('globalConfig.v1');
    this.shared.observeDeep(this.onSharedChange);
  }

  /** initialConfig is mandatory on first boot: no implicit defaults are invented. */
  async initialize(initialConfig?: KeystoneConfig): Promise<Readonly<KeystoneConfig>> {
    const persisted = await this.storage.load();
    const remote = this.readShared();
    if (!persisted && !initialConfig) throw new Error('Explicit KeystoneConfig is required on first boot');
    if (!remote && !initialConfig) throw new Error('Shared config is absent; provide a complete KeystoneConfig');
    const split = initialConfig ? splitConfig(initialConfig) : undefined;
    this.local = persisted ?? split!.local;
    if (!remote) this.writeShared(split!.shared);
    this.current = mergeConfig(this.local, remote ?? split!.shared);
    await this.storage.save(this.local);
    return this.current;
  }

  get value(): Readonly<KeystoneConfig> { this.assertInitialized(); return this.current; }
  subscribe(listener: ConfigListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async replace(next: KeystoneConfig): Promise<void> {
    this.assertInitialized();
    const parsed = KeystoneConfigSchema.parse(next);
    const { local, shared } = splitConfig(parsed);
    await this.storage.save(local);
    this.local = local;
    this.writeShared(shared);
    this.current = parsed;
    this.emit();
  }

  destroy(): void { this.shared.unobserveDeep(this.onSharedChange); this.listeners.clear(); }

  private readonly onSharedChange = (): void => {
    if (!this.local) return;
    const shared = this.readShared();
    if (!shared) return;
    this.current = mergeConfig(this.local, shared);
    this.emit();
  };
  private readShared(): SharedKeystoneConfig | undefined {
    const raw = this.shared.get('value');
    if (!raw) return undefined;
    const local = this.local ?? { version: 1, webRtc: { devices: { cameraId: null, microphoneId: null, speakerId: null } }, omnipresence: { shortcuts: { commandPalette: '_', pushToTalk: '_', toggleOmnipresence: '_' }, autoLaunch: false, hideInSystemTray: false } } satisfies LocalKeystoneConfig;
    return splitConfig(mergeConfig(local, raw as SharedKeystoneConfig)).shared;
  }
  private writeShared(shared: SharedKeystoneConfig): void { this.document.transact(() => this.shared.set('value', structuredClone(shared)), this); }
  private emit(): void { this.listeners.forEach(listener => listener(this.current)); }
  private assertInitialized(): void { if (!this.current) throw new Error('GlobalConfigManager is not initialized'); }
}
