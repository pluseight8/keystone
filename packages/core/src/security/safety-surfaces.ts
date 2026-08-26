import {
  SafetySurfaceGate,
  type SafetyEvaluationRequest,
  type SurfaceEligibleObject,
  isSurfaceEligible,
} from './content-safety.js';

/**
 * The complete set of product surfaces that can display, index, recommend or
 * exchange shared/public Keystone content. Keep this list deliberately boring:
 * adding a surface is an architectural change and must come with a gate.
 */
export const PROTECTED_SURFACES = [
  'DIRECT_CHAT',
  'GROUP_CHAT',
  'COMMUNITIES',
  'SHARED_SPACES',
  'SHARED_VAULTS',
  'PROFILES',
  'HOME',
  'DISCOVERY',
  'SEARCH',
  'RECOMMENDATIONS',
  'FILES',
  'MUSIC',
  'VIDEO',
  'SHORTS',
  'LIVE',
  'WORKBOARDS',
  'CALENDAR',
  'AGENT_MAILBOX',
  'AGENT_ROOMS',
  'AGENT_VISITS',
  'AGENT_NEGOTIATION',
  'BROWSER_SHARE',
  'SKILL_PACKAGES',
  'AI_CONTEXT',
  'PUBLICATIONS',
] as const;

export type ProtectedSurfaceId = (typeof PROTECTED_SURFACES)[number];

export interface ProtectedSurfaceDescriptor {
  readonly id: ProtectedSurfaceId;
  readonly requiresSafety: true;
  readonly accepts: 'SurfaceEligibleObject';
  readonly missingGate: 'FAIL_CLOSED';
}

export const PROTECTED_SURFACE_MANIFEST: readonly ProtectedSurfaceDescriptor[] = PROTECTED_SURFACES.map(id => ({
  id,
  requiresSafety: true,
  accepts: 'SurfaceEligibleObject',
  missingGate: 'FAIL_CLOSED',
}));

export function isProtectedSurface(value: unknown): value is ProtectedSurfaceId {
  return typeof value === 'string' && (PROTECTED_SURFACES as readonly string[]).includes(value);
}

export function protectedSurfaceManifest(): readonly ProtectedSurfaceDescriptor[] {
  return PROTECTED_SURFACE_MANIFEST.map(value => ({ ...value }));
}

export class SafetySurfaceUnavailableError extends Error {
  constructor(readonly surface: ProtectedSurfaceId) {
    super(`SafetySurfaceGate unavailable for protected surface ${surface}`);
    this.name = 'SafetySurfaceUnavailableError';
  }
}

/**
 * A typed renderer/index boundary. It intentionally has no method accepting a
 * RawIncomingObject, VerifiedObject or AuthorizedObject. Runtime callers still
 * get a second kind/token check, so an `as any` cast cannot create a bypass.
 */
export class ProtectedSurfaceAdapter<T = unknown> {
  constructor(private readonly registry: MandatorySafetySurfaceRegistry, readonly surface: ProtectedSurfaceId) {}

  async evaluate(request: SafetyEvaluationRequest<T>): Promise<SurfaceEligibleObject<T> | undefined> {
    return this.registry.evaluate(this.surface, request);
  }

  async display(value: SurfaceEligibleObject<T>): Promise<SurfaceEligibleObject<T> | undefined> {
    return this.registry.accept(this.surface, value);
  }

  async index(value: SurfaceEligibleObject<T>): Promise<boolean> {
    const accepted = await this.registry.accept(this.surface, value);
    if (!accepted) return false;
    return this.registry.store(this.surface, accepted);
  }

  async share(request: Omit<SafetyEvaluationRequest<T>, 'sharing'>): Promise<SurfaceEligibleObject<T> | undefined> {
    return this.registry.share(this.surface, request);
  }

  values(): readonly SurfaceEligibleObject<T>[] {
    return this.registry.values<T>(this.surface);
  }
}

/**
 * Mandatory recipient-local registry for all shared/public surface adapters.
 * `undefined` is an explicit unavailable host boundary: every protected
 * operation then returns false/undefined (never raw content).
 */
export class MandatorySafetySurfaceRegistry {
  private readonly entries = new Map<ProtectedSurfaceId, Map<string, SurfaceEligibleObject<unknown>>>();
  constructor(private readonly gate: SafetySurfaceGate | undefined) {
    for (const surface of PROTECTED_SURFACES) this.entries.set(surface, new Map());
  }

  hasMandatoryGate(surface: ProtectedSurfaceId): boolean {
    return isProtectedSurface(surface) && this.gate !== undefined;
  }

  allSurfacesHaveMandatoryGate(): boolean {
    return PROTECTED_SURFACES.every(surface => this.hasMandatoryGate(surface));
  }

  adapter<T = unknown>(surface: ProtectedSurfaceId): ProtectedSurfaceAdapter<T> {
    return new ProtectedSurfaceAdapter<T>(this, surface);
  }

  async evaluate<T>(surface: ProtectedSurfaceId, request: SafetyEvaluationRequest<T>): Promise<SurfaceEligibleObject<T> | undefined> {
    if (!this.hasMandatoryGate(surface) || !isSharedDomainForSurface(request.domain)) return undefined;
    try { return await this.gate!.beforeSurface(surface, request); } catch { return undefined; }
  }

  async share<T>(surface: ProtectedSurfaceId, request: Omit<SafetyEvaluationRequest<T>, 'sharing'>): Promise<SurfaceEligibleObject<T> | undefined> {
    if (!this.hasMandatoryGate(surface) || !isSharedDomainForSurface(request.domain)) return undefined;
    try {
      const evaluated = await this.gate!.beforeShare(request);
      return evaluated ? await this.gate!.acceptEvaluated<T>(evaluated) : undefined;
    } catch { return undefined; }
  }

  /** Accept only a token-bearing SafetyEvaluatedObject from this gate. */
  async accept<T>(surface: ProtectedSurfaceId, value: unknown): Promise<SurfaceEligibleObject<T> | undefined> {
    if (!this.hasMandatoryGate(surface) || !isSurfaceEligible<T>(value)) return undefined;
    try { return await this.gate!.acceptEvaluated<T>(value); } catch { return undefined; }
  }

  /** Internal typed storage used by protected indexes only. */
  async store<T>(surface: ProtectedSurfaceId, value: SurfaceEligibleObject<T>): Promise<boolean> {
    const accepted = await this.accept(surface, value);
    if (!accepted) return false;
    const entries = this.entries.get(surface);
    if (!entries || entries.has(accepted.objectId)) return false;
    entries.set(accepted.objectId, structuredClone(accepted) as SurfaceEligibleObject<unknown>);
    return true;
  }

  values<T>(surface: ProtectedSurfaceId): readonly SurfaceEligibleObject<T>[] {
    return [...(this.entries.get(surface)?.values() ?? [])].map(value => structuredClone(value) as SurfaceEligibleObject<T>);
  }

  remove(surface: ProtectedSurfaceId, objectId: string): void { this.entries.get(surface)?.delete(objectId); }
  clear(surface?: ProtectedSurfaceId): void { if (surface) this.entries.get(surface)?.clear(); else for (const values of this.entries.values()) values.clear(); }
}

function isSharedDomainForSurface(domain: SafetyEvaluationRequest['domain']): boolean {
  return domain === 'DIRECT_SHARED' || domain === 'GROUP_SHARED' || domain === 'SHARED_SPACE' || domain === 'COMMUNITY' || domain === 'PUBLIC' || domain === 'DISCOVERY';
}
