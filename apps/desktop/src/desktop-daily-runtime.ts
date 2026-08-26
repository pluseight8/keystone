/** Host boundary for the deterministic Daily Layer projection. The shell
 * receives references and bounded copy only; Core remains the source
 * authority and no network/AI work is performed by the renderer. */
export interface DesktopDailyItem {
  readonly id: string;
  readonly title: string;
  readonly reason?: string;
  readonly canonicalRef: { readonly id: string; readonly type: string };
  readonly priority?: string;
}
export interface DesktopDailySection { readonly id: string; readonly title: string; readonly items: readonly DesktopDailyItem[]; readonly remaining: number; }
export interface DesktopDailyBrief {
  readonly sections: readonly DesktopDailySection[];
  readonly deterministicText: string;
  readonly hasRelevantChanges: boolean;
  readonly whileYouWereAway?: DesktopDailySection;
  readonly continueContext?: DesktopDailyItem;
}
export interface DesktopDailyRuntime {
  brief(): Promise<DesktopDailyBrief>;
  refresh?(): Promise<DesktopDailyBrief>;
  markSeen?(itemId: string): Promise<void>;
}
let current: DesktopDailyRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopDailyRuntime(runtime: DesktopDailyRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopDailyRuntime(): DesktopDailyRuntime | undefined { return current; }
export function subscribeDesktopDailyRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
