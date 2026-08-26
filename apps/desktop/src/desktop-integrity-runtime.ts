export interface DesktopIntegritySnapshot {
  readonly stage: string;
  readonly officialStatus: string;
  readonly locked: boolean;
  readonly failure?: { readonly category: string; readonly componentId?: string; readonly path?: string };
}

export interface DesktopIntegrityCore {
  readonly snapshot: () => DesktopIntegritySnapshot;
}

/** Native desktop host boundary for release verification and recovery. */
export interface DesktopIntegrityRuntime {
  readonly core?: DesktopIntegrityCore;
  readonly snapshot?: () => DesktopIntegritySnapshot | undefined;
  readonly verifyAgain?: () => Promise<void>;
  readonly repairHost?: () => Promise<void>;
  readonly verifyRecoveryArtifact?: () => Promise<void>;
  readonly subscribe?: (listener: () => void) => () => void;
}

let current: DesktopIntegrityRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopIntegrityRuntime(runtime: DesktopIntegrityRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopIntegrityRuntime(): DesktopIntegrityRuntime | undefined { return current; }
export function subscribeDesktopIntegrityRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
