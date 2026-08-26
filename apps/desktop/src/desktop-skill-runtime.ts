/** Typed host boundary for the Skills surface.  The desktop shell never
 * parses packages or executes instructions; SkillPackageRegistry remains the
 * authority for review, integrity and ToolPolicy projection. */
export interface DesktopSkillSummary {
  readonly skillId: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly enabled: boolean;
  readonly source: string;
  readonly integrity: 'verified' | 'unsigned' | 'unverified' | 'invalid';
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly dependencies: readonly string[];
}
export interface DesktopSkillCandidateSummary { readonly candidateId: string; readonly title: string; readonly summary: string; readonly status: string; readonly evidenceCount: number; }
export interface DesktopSkillRuntime {
  readonly list: () => Promise<readonly DesktopSkillSummary[]>;
  readonly candidates?: () => Promise<readonly DesktopSkillCandidateSummary[]>;
  readonly enable?: (skillId: string) => Promise<void>;
  readonly disable?: (skillId: string) => Promise<void>;
  readonly install?: (packageJson: string, review: { readonly approved: boolean; readonly enabled?: boolean; readonly capabilities?: readonly string[] }) => Promise<void>;
  readonly reviewUpdate?: (skillId: string) => Promise<{ readonly changed: readonly string[]; readonly requiresPermissionReview: boolean }>;
  readonly subscribe?: (listener: () => void) => () => void;
}
let current: DesktopSkillRuntime | undefined;
const listeners = new Set<() => void>();
export function installDesktopSkillRuntime(runtime: DesktopSkillRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopSkillRuntime(): DesktopSkillRuntime | undefined { return current; }
export function subscribeDesktopSkillRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
