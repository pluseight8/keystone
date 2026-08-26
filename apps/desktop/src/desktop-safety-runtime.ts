export interface DesktopSafetyCore {
  readonly status: () => string;
  readonly metrics: () => { readonly evaluated: number; readonly quarantined: number };
}
export type DesktopSafetyPreferences = Readonly<Record<string, unknown>>;

/** Typed host boundary for the desktop Safety surface. The shell never runs
 * classifiers or receives unsafe media previews; the core SafetyRuntime does. */
export interface DesktopSafetyRuntime {
  readonly runtime: DesktopSafetyCore;
  readonly updatePreferences?: (value: DesktopSafetyPreferences) => Promise<void>;
  readonly subscribe?: (listener: () => void) => () => void;
}

let current: DesktopSafetyRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopSafetyRuntime(runtime: DesktopSafetyRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopSafetyRuntime(): DesktopSafetyRuntime | undefined { return current; }
export function subscribeDesktopSafetyRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
