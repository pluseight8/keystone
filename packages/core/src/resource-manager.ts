export interface BatteryState {
  /** Normalized from 0 to 1. */
  level: number;
  charging: boolean;
}

export interface BatteryProvider {
  getState(): Promise<BatteryState | undefined>;
  subscribe?(listener: (state: BatteryState) => void): () => void;
}
export interface PausableIndexer { pause(): void; resume(): void; }
export interface AdjustableScheduler { setIntervalMultiplier(multiplier: number): void; }
export interface ResourceManagerState extends BatteryState { ecoMode: boolean; }
export interface ResourceManagerOptions {
  battery: BatteryProvider;
  indexer: PausableIndexer;
  chronos: AdjustableScheduler;
  lowBatteryThreshold?: number;
  ecoChronosMultiplier?: number;
}

/** Coordinates expensive local work from one observable power policy. */
export class ResourceManager {
  private state: ResourceManagerState = { level: 1, charging: true, ecoMode: false };
  private readonly listeners = new Set<(state: ResourceManagerState) => void>();
  private unsubscribeBattery?: () => void;
  private started = false;

  constructor(private readonly options: ResourceManagerOptions) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const initial = await this.options.battery.getState();
    if (initial) this.apply(initial);
    this.unsubscribeBattery = this.options.battery.subscribe?.(battery => this.apply(battery));
  }

  stop(): void { this.started = false; this.unsubscribeBattery?.(); this.unsubscribeBattery = undefined; }
  getState(): Readonly<ResourceManagerState> { return this.state; }
  subscribe(listener: (state: ResourceManagerState) => void): () => void {
    this.listeners.add(listener); listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private apply(battery: BatteryState): void {
    const level = Math.max(0, Math.min(1, battery.level));
    const ecoMode = !battery.charging || level < (this.options.lowBatteryThreshold ?? .2);
    const next = { level, charging: battery.charging, ecoMode };
    if (sameState(this.state, next)) return;
    this.state = next;
    if (ecoMode) this.options.indexer.pause(); else this.options.indexer.resume();
    this.options.chronos.setIntervalMultiplier(ecoMode ? (this.options.ecoChronosMultiplier ?? 3) : 1);
    for (const listener of this.listeners) listener(next);
  }
}

/** Desktop provider using the standard Battery Status API (also works in a Tauri WebView when exposed). */
export class NavigatorBatteryProvider implements BatteryProvider {
  private battery?: WebBatteryManager;
  async getState(): Promise<BatteryState | undefined> {
    const getBattery = (globalThis.navigator as Navigator & { getBattery?: () => Promise<WebBatteryManager> } | undefined)?.getBattery;
    if (!getBattery) return undefined;
    this.battery = await getBattery.call(globalThis.navigator);
    return snapshot(this.battery);
  }
  subscribe(listener: (state: BatteryState) => void): () => void {
    if (!this.battery) return () => undefined;
    const update = () => listener(snapshot(this.battery!));
    this.battery.addEventListener('levelchange', update); this.battery.addEventListener('chargingchange', update);
    return () => { this.battery?.removeEventListener('levelchange', update); this.battery?.removeEventListener('chargingchange', update); };
  }
}

/** Adapter surface for `react-native-battery-info`, kept injectable so core remains platform-neutral. */
export interface ReactNativeBatteryInfoModule {
  getBatteryLevel(): Promise<number>;
  isCharging(): Promise<boolean>;
  addListener?(listener: () => void): { remove(): void };
}
export class ReactNativeBatteryProvider implements BatteryProvider {
  constructor(private readonly module: ReactNativeBatteryInfoModule) {}
  async getState(): Promise<BatteryState> { const [level, charging] = await Promise.all([this.module.getBatteryLevel(), this.module.isCharging()]); return { level, charging }; }
  subscribe(listener: (state: BatteryState) => void): () => void {
    const subscription = this.module.addListener?.(() => { void this.getState().then(listener); });
    return () => subscription?.remove();
  }
}

interface WebBatteryManager extends EventTarget { level: number; charging: boolean; }
function snapshot(battery: WebBatteryManager): BatteryState { return { level: battery.level, charging: battery.charging }; }
function sameState(a: ResourceManagerState, b: ResourceManagerState): boolean { return a.level === b.level && a.charging === b.charging && a.ecoMode === b.ecoMode; }
