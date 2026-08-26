/**
 * Personal Daily Layer.
 *
 * This module is deliberately a projection, not another application store.
 * Sources expose bounded, permission-checked projections of their canonical
 * state; the layer keeps only references, cursors and presentation state.
 * Nothing in this module imports a transport, database, Vault store, or AI
 * provider.
 */

export const DAILY_LAYER_VERSION = 1 as const;
export const DAILY_LAYER_MAX_ITEMS = 500;
export const DAILY_LAYER_MAX_SOURCE_ITEMS = 256;
export const DAILY_LAYER_MAX_SOURCES = 32;
export const DAILY_LAYER_MAX_CURSORS = 64;
export const DAILY_LAYER_MAX_ITEM_STATE = 500;
export const DAILY_LAYER_MAX_NOTIFIED = 128;
export const DAILY_LAYER_SOURCE_TIMEOUT_MS = 500;
export const DAILY_LAYER_PHRASE_TIMEOUT_MS = 1_500;
export const DAILY_LAYER_AWAY_THRESHOLD_MS = 15 * 60_000;
export const DAILY_LAYER_MAX_AWAY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const DAILY_LAYER_MAX_SNOOZE_MS = 30 * 24 * 60 * 60_000;

export const DAILY_SOURCE_TYPES = [
  'calendar', 'tasks', 'workboards', 'messages', 'spaces', 'files',
  'devices', 'agents', 'approvals', 'memory', 'feed', 'video', 'network',
  'location',
] as const;
export type DailySourceType = (typeof DAILY_SOURCE_TYPES)[number] | (string & {});
export type DailySourceTrust = 'core' | 'owner' | 'plugin' | 'remote';
export type DailyBriefMode = 'morning' | 'day' | 'evening' | 'night';
export type DailyBriefStyle = 'concise' | 'normal' | 'detailed';
export type DailyBriefFrequency = 'important' | 'moderate' | 'selected-times';
export type DailyItemState = 'shown' | 'seen' | 'dismissed' | 'snoozed' | 'expired';
export type DailyDataClass = 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET';
export type DailyPriority = 'security' | 'approval' | 'time-sensitive' | 'communication' | 'completion' | 'informational';
export type StartupSurface = 'last-opened' | 'home' | 'feed' | 'video' | 'messages' | 'storage' | 'calendar' | 'vault' | 'workspace';
export type DailyActionKind = 'open-object' | 'review-approval' | 'resume' | 'open-surface' | 'review-location-share';

export interface DailyObjectReference {
  readonly id: string;
  readonly type: string;
  readonly visibility?: 'public' | 'contacts' | 'community' | 'private';
  readonly spaceId?: string;
  readonly version?: string;
}

export interface DailyActionReference {
  readonly kind: DailyActionKind;
  readonly object?: DailyObjectReference;
  readonly surface?: StartupSurface;
  /** Review actions are interpreted by the owning subsystem. */
  readonly actionId?: string;
}

export interface DailyContextItem {
  /** Stable source event/object identity, never generated from display text. */
  readonly id: string;
  readonly sourceType: DailySourceType;
  readonly sourceId?: string;
  readonly canonicalRef: DailyObjectReference;
  readonly title: string;
  readonly summary?: string;
  readonly reason?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly dueAt?: string;
  readonly startsAt?: string;
  readonly priority: DailyPriority;
  readonly dataClass?: DailyDataClass;
  readonly requiresAction?: boolean;
  readonly completed?: boolean;
  readonly continueTarget?: boolean;
  readonly dedupKey?: string;
  readonly spaceId?: string;
  readonly action?: DailyActionReference;
  /** Trusted sources may provide bounded factual tokens for phrasing checks. */
  readonly factTokens?: readonly string[];
}

export interface DailyContextWindow {
  readonly now: number;
  readonly mode: DailyBriefMode;
  readonly timezone: string;
  readonly from: number;
  readonly until: number;
  readonly awaySince?: number;
  readonly limit: number;
  readonly cursor?: string;
}

export interface DailyContextOwnerContext {
  readonly ownerId: string;
  readonly now: number;
  readonly timezone: string;
  readonly locked?: boolean;
  readonly sourceEnabled: (sourceType: DailySourceType) => boolean;
  /** The source remains the authority for object permissions. */
  readonly canRead?: (item: DailyContextItem) => boolean | Promise<boolean>;
}

export interface DailyContextCollection {
  readonly items: readonly DailyContextItem[];
  readonly cursor?: string;
}

export interface DailyContextSource {
  readonly sourceType: DailySourceType;
  readonly sourceId?: string;
  readonly trust?: DailySourceTrust;
  readonly collect: (window: DailyContextWindow, owner: DailyContextOwnerContext) => Promise<readonly DailyContextItem[] | DailyContextCollection> | readonly DailyContextItem[] | DailyContextCollection;
  /** Optional source-owned projection; it cannot expand permissions. */
  readonly project?: (item: DailyContextItem, owner: DailyContextOwnerContext) => DailyContextItem | undefined;
}

export interface DailyLayerSourceSettings {
  readonly [sourceType: string]: boolean;
}

export interface DailyLayerSettings {
  readonly version: 1;
  readonly enabled: boolean;
  readonly sources: DailyLayerSourceSettings;
  readonly briefTimes: Partial<Record<DailyBriefMode, string>>;
  readonly style: DailyBriefStyle;
  readonly frequency: DailyBriefFrequency;
  readonly startupOverlay: boolean;
  readonly locale?: 'en' | 'ru';
}

export interface StartupSurfacePreference {
  readonly version: 1;
  readonly surface: StartupSurface;
  readonly customTarget?: DailyObjectReference;
}

export interface DailyLayerItemState {
  readonly version: string;
  readonly state: DailyItemState;
  readonly changedAt: number;
  readonly snoozeUntil?: number;
}

export interface DailyLayerCursor {
  readonly sourceId: string;
  readonly cursor: string;
  readonly updatedAt: number;
}

export interface DailyLayerState {
  readonly version: 1;
  readonly settings: DailyLayerSettings;
  readonly startup: StartupSurfacePreference;
  readonly cursors: readonly DailyLayerCursor[];
  readonly itemStates: Readonly<Record<string, DailyLayerItemState>>;
  readonly lastActiveAt?: number;
  readonly continueContext?: DailyContextItem;
  readonly lastBriefFingerprint?: string;
  readonly lastBriefAt?: number;
  readonly notifiedFingerprints: readonly string[];
}

export interface DailyLayerStateStore {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryDailyLayerStateStore implements DailyLayerStateStore {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface DailyLayerNotification {
  readonly fingerprint: string;
  readonly mode: DailyBriefMode;
  readonly itemIds: readonly string[];
  readonly count: number;
}

/** The core asks an existing notification service to deliver; it never calls an OS API. */
export interface DailyLayerNotificationBoundary {
  readonly notify: (value: DailyLayerNotification) => Promise<void> | void;
}

export interface DailyLayerPhraseInput {
  readonly brief: DailyBrief;
  readonly items: readonly DailyContextItem[];
  readonly privacy: 'LOCAL' | 'PERSONAL_TRUSTED_COMPUTE';
}

export interface DailyLayerPhraseResult {
  readonly text: string;
  readonly itemIds: readonly string[];
}

/** Optional local/trusted presentation adapter. External adapters are refused. */
export interface DailyLayerPhrasingAdapter {
  readonly privacy: 'LOCAL' | 'PERSONAL_TRUSTED_COMPUTE' | 'EXTERNAL';
  readonly phrase: (input: DailyLayerPhraseInput) => Promise<DailyLayerPhraseResult> | DailyLayerPhraseResult;
}

export interface DailyBriefSection {
  readonly id: 'today' | 'attention' | 'away' | 'continue' | 'completed' | 'next' | 'information';
  readonly title: string;
  readonly items: readonly DailyContextItem[];
  readonly remaining: number;
}

export interface DailyLayerTimings {
  readonly aggregationMs: number;
  readonly sourceMs: Readonly<Record<string, number>>;
  readonly phrasingMs?: number;
}

export interface DailyBrief {
  readonly version: 1;
  readonly id: string;
  readonly fingerprint: string;
  readonly generatedAt: string;
  readonly mode: DailyBriefMode;
  readonly locale: 'en' | 'ru';
  readonly sections: readonly DailyBriefSection[];
  readonly items: readonly DailyContextItem[];
  readonly whileYouWereAway?: DailyBriefSection;
  readonly continueContext?: DailyContextItem;
  readonly deterministicText: string;
  readonly phrasedText?: string;
  readonly hasRelevantChanges: boolean;
  readonly shouldNotify: boolean;
  readonly metrics: {
    readonly sourceCount: number;
    readonly consideredCount: number;
    readonly deduplicatedCount: number;
    readonly emittedCount: number;
    readonly timedOutSources: readonly string[];
    readonly failedSources: readonly string[];
    readonly cursors: readonly DailyLayerCursor[];
    readonly timings: DailyLayerTimings;
  };
}

export interface DailyLayerOptions {
  readonly ownerId: string;
  readonly storage?: DailyLayerStateStore;
  readonly sources?: readonly DailyContextSource[];
  readonly notification?: DailyLayerNotificationBoundary;
  readonly phrasing?: DailyLayerPhrasingAdapter;
  readonly now?: () => number;
  readonly timezone?: string;
  readonly locale?: 'en' | 'ru';
  readonly sourceTimeoutMs?: number;
  readonly phrasingTimeoutMs?: number;
  readonly maxItems?: number;
  readonly maxSourceItems?: number;
  readonly allowPluginSources?: boolean;
  /** Host security state; locked projections are redacted before rendering. */
  readonly isLocked?: () => boolean;
  /** Optional host permission check for normalized source projections. */
  readonly canRead?: (item: DailyContextItem) => boolean | Promise<boolean>;
}

export interface DailyBriefOptions {
  readonly mode?: DailyBriefMode;
  readonly now?: number;
  readonly force?: boolean;
  readonly notify?: boolean;
  readonly timezone?: string;
}

export interface DailyLayerMetrics {
  readonly lastBrief?: DailyBrief;
  readonly lastAggregationMs?: number;
  readonly lastSourceCount?: number;
}

/** Named projection aliases used by hosts that expose these sections directly. */
export type WhileYouWereAway = DailyBriefSection;
export type ContinueContext = DailyContextItem;

/** Deterministic, non-engagement relevance policy shared by host projections. */
export class DailyRelevancePolicy {
  score(item: DailyContextItem): number { return priorityWeight(item.priority) + (item.requiresAction ? 50 : 0) + (item.completed ? 10 : 0); }
  compare(a: DailyContextItem, b: DailyContextItem): number { return compareItems(a, b); }
  select(items: readonly DailyContextItem[], frequency: DailyBriefFrequency = 'important', limit = DAILY_LAYER_MAX_ITEMS): readonly DailyContextItem[] {
    const eligible = frequency === 'important' ? items.filter(item => item.priority === 'security' || item.priority === 'approval' || item.priority === 'time-sensitive' || item.requiresAction === true || (item.priority === 'completion' && item.completed === true)) : [...items];
    return [...eligible].sort((a, b) => this.compare(a, b)).slice(0, boundedInt(limit, 1, DAILY_LAYER_MAX_ITEMS));
  }
}

/** Schedule helper; it never starts a polling loop. Hosts call it on resume or a Chronos trigger. */
export class DailyBriefSchedule {
  modeAt(timestamp: number, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): DailyBriefMode { return modeFor(timestamp, validTimezone(timezone) ?? 'UTC'); }
  isSelectedTime(timestamp: number, settings: DailyLayerSettings, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): boolean {
    const mode = this.modeAt(timestamp, timezone); const configured = settings.briefTimes[mode]; if (!configured) return false;
    return new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone) ?? 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)) === configured;
  }
}

const DEFAULT_SOURCE_SETTINGS: DailyLayerSourceSettings = Object.freeze({
  calendar: true, tasks: true, workboards: true, messages: true, spaces: true,
  files: true, devices: true, agents: true, approvals: true, memory: true,
  feed: false, video: false, network: true, location: false,
});

export const DEFAULT_DAILY_LAYER_SETTINGS: DailyLayerSettings = Object.freeze({
  version: 1,
  enabled: true,
  sources: DEFAULT_SOURCE_SETTINGS,
  briefTimes: { morning: '08:00', day: '13:00', evening: '18:00', night: '22:00' },
  style: 'normal',
  frequency: 'important',
  startupOverlay: true,
  locale: 'en',
});

export const DEFAULT_STARTUP_SURFACE: StartupSurfacePreference = Object.freeze({ version: 1, surface: 'last-opened' });

export class DailyLayerError extends Error {
  constructor(readonly code: 'INVALID_ARGUMENT' | 'INVALID_STATE' | 'SOURCE_REJECTED' | 'PHRASING_REJECTED', message: string) { super(message); this.name = 'DailyLayerError'; }
}

export class DailyLayerService {
  private readonly storage: DailyLayerStateStore;
  private readonly ownerId: string;
  private readonly now: () => number;
  private readonly defaultTimezone: string;
  private readonly sourceTimeoutMs: number;
  private readonly phrasingTimeoutMs: number;
  private readonly maxItems: number;
  private readonly maxSourceItems: number;
  private readonly allowPluginSources: boolean;
  private readonly lockState: () => boolean;
  private readonly permissionCheck?: (item: DailyContextItem) => boolean | Promise<boolean>;
  private readonly sources = new Map<string, DailyContextSource>();
  private notification?: DailyLayerNotificationBoundary;
  private phrasing?: DailyLayerPhrasingAdapter;
  private state: DailyLayerState = emptyState();
  private readonly readyPromise: Promise<void>;
  private lastBrief?: DailyBrief;
  private writes: Promise<void> = Promise.resolve();

  constructor(options: DailyLayerOptions) {
    if (!options.ownerId?.trim()) throw new DailyLayerError('INVALID_ARGUMENT', 'Daily Layer ownerId is required');
    this.ownerId = options.ownerId;
    this.storage = options.storage ?? new InMemoryDailyLayerStateStore();
    this.now = options.now ?? (() => Date.now());
    this.defaultTimezone = validTimezone(options.timezone) ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    this.sourceTimeoutMs = boundedInt(options.sourceTimeoutMs ?? DAILY_LAYER_SOURCE_TIMEOUT_MS, 50, 5_000);
    this.phrasingTimeoutMs = boundedInt(options.phrasingTimeoutMs ?? DAILY_LAYER_PHRASE_TIMEOUT_MS, 50, 5_000);
    this.maxItems = boundedInt(options.maxItems ?? 80, 1, DAILY_LAYER_MAX_ITEMS);
    this.maxSourceItems = boundedInt(options.maxSourceItems ?? DAILY_LAYER_MAX_SOURCE_ITEMS, 1, DAILY_LAYER_MAX_SOURCE_ITEMS);
    this.allowPluginSources = options.allowPluginSources === true;
    this.lockState = options.isLocked ?? (() => false);
    this.permissionCheck = options.canRead;
    this.notification = options.notification;
    this.phrasing = options.phrasing;
    if (this.phrasing?.privacy === 'EXTERNAL') this.phrasing = undefined;
    for (const source of options.sources ?? []) this.registerSource(source);
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  registerSource(source: DailyContextSource): void {
    if (!source || typeof source.collect !== 'function' || !source.sourceType) throw new DailyLayerError('SOURCE_REJECTED', 'Invalid Daily Layer source');
    const trust = source.trust ?? 'core';
    if (trust === 'plugin' && !this.allowPluginSources) throw new DailyLayerError('SOURCE_REJECTED', 'Plugin Daily Layer sources require explicit capability');
    const sourceId = normalizeId(source.sourceId ?? source.sourceType, 120);
    if (!sourceId) throw new DailyLayerError('SOURCE_REJECTED', 'Daily Layer source ID is invalid');
    const existing = this.sources.get(sourceId);
    if (existing && (existing.trust === 'core' || existing.trust === 'owner') && (trust === 'plugin' || trust === 'remote')) throw new DailyLayerError('SOURCE_REJECTED', 'Untrusted source cannot replace an owner source');
    this.sources.set(sourceId, { ...source, sourceId, trust });
  }

  unregisterSource(sourceId: string): boolean { return this.sources.delete(sourceId); }
  listSources(): readonly Pick<DailyContextSource, 'sourceType' | 'sourceId' | 'trust'>[] { return [...this.sources.values()].map(source => ({ sourceType: source.sourceType, sourceId: source.sourceId, trust: source.trust ?? 'core' })); }
  setNotificationBoundary(boundary: DailyLayerNotificationBoundary | undefined): void { this.notification = boundary; }
  setPhrasingAdapter(adapter: DailyLayerPhrasingAdapter | undefined): void { this.phrasing = adapter?.privacy === 'EXTERNAL' ? undefined : adapter; }

  settings(): DailyLayerSettings { return structuredClone(this.state.settings); }
  getSettings(): DailyLayerSettings { return this.settings(); }
  startup(): StartupSurfacePreference { return structuredClone(this.state.startup); }
  getStartupSurface(): StartupSurfacePreference { return this.startup(); }
  metrics(): DailyLayerMetrics { return { ...(this.lastBrief ? { lastBrief: structuredClone(this.lastBrief) } : {}), ...(this.lastBrief ? { lastAggregationMs: this.lastBrief.metrics.timings.aggregationMs, lastSourceCount: this.lastBrief.metrics.sourceCount } : {}) }; }

  async updateSettings(patch: Partial<DailyLayerSettings> & { sources?: DailyLayerSourceSettings; briefTimes?: Partial<Record<DailyBriefMode, string>> }): Promise<DailyLayerSettings> {
    await this.ready();
    const next = parseDailySettings({ ...this.state.settings, ...patch, sources: { ...this.state.settings.sources, ...(patch.sources ?? {}) }, briefTimes: { ...this.state.settings.briefTimes, ...(patch.briefTimes ?? {}) } });
    this.state = { ...this.state, settings: next };
    await this.persist();
    return this.settings();
  }
  async setSettings(value: DailyLayerSettings): Promise<DailyLayerSettings> { return this.updateSettings(value); }

  async setStartupSurface(surface: StartupSurface, customTarget?: DailyObjectReference): Promise<StartupSurfacePreference> {
    await this.ready();
    const next = parseStartupSurfacePreference({ version: 1, surface, ...(customTarget ? { customTarget } : {}) });
    this.state = { ...this.state, startup: next };
    await this.persist();
    return this.startup();
  }

  /** Resolve startup without forcing Home. A host supplies target existence/permission. */
  resolveStartup(input: { readonly lastOpened?: DailyObjectReference; readonly customTargetExists?: (target: DailyObjectReference) => boolean } = {}): { readonly surface: StartupSurface; readonly target?: DailyObjectReference; readonly fallback: boolean } {
    const preference = this.state.startup;
    if (preference.surface === 'last-opened' && input.lastOpened && (input.customTargetExists?.(input.lastOpened) ?? true)) return { surface: 'last-opened', target: structuredClone(input.lastOpened), fallback: false };
    if (preference.surface === 'workspace' && preference.customTarget && (input.customTargetExists?.(preference.customTarget) ?? true)) return { surface: 'workspace', target: structuredClone(preference.customTarget), fallback: false };
    if (preference.surface === 'last-opened' || (preference.surface === 'workspace' && (!preference.customTarget || (input.customTargetExists && !input.customTargetExists(preference.customTarget))))) return { surface: 'home', fallback: true };
    return { surface: preference.surface, ...(preference.customTarget ? { target: structuredClone(preference.customTarget) } : {}), fallback: false };
  }

  async recordActivity(input: { readonly at?: number; readonly continueContext?: DailyContextItem }): Promise<void> {
    await this.ready();
    const at = validTimestamp(input.at ?? this.now());
    if (input.continueContext) {
      const target = normalizeItem(input.continueContext, 'core', undefined);
      if (target) this.state = { ...this.state, continueContext: target };
    }
    this.state = { ...this.state, lastActiveAt: at };
    await this.persist();
  }

  async setContinueContext(item: DailyContextItem | undefined): Promise<void> {
    await this.ready();
    const target = item ? normalizeItem(item, 'core', undefined) : undefined;
    this.state = { ...this.state, ...(target ? { continueContext: target } : { continueContext: undefined }) };
    await this.persist();
  }

  continueContext(): DailyContextItem | undefined { return this.state.continueContext ? structuredClone(this.state.continueContext) : undefined; }
  getContinueContext(): DailyContextItem | undefined { return this.continueContext(); }

  async generateBrief(options: DailyBriefOptions = {}): Promise<DailyBrief> {
    await this.ready();
    const started = this.now();
    const now = validTimestamp(options.now ?? this.now());
    const timezone = validTimezone(options.timezone ?? this.defaultTimezone) ?? this.defaultTimezone;
    const mode = options.mode ?? modeFor(now, timezone);
    const awaySince = this.state.lastActiveAt !== undefined && now - this.state.lastActiveAt >= DAILY_LAYER_AWAY_THRESHOLD_MS
      ? Math.max(now - DAILY_LAYER_MAX_AWAY_WINDOW_MS, this.state.lastActiveAt) : undefined;
    const window: DailyContextWindow = { now, mode, timezone, from: awaySince ?? startOfLocalDay(now, timezone), until: now + 48 * 60 * 60_000, ...(awaySince !== undefined ? { awaySince } : {}), limit: this.maxSourceItems };
    const owner: DailyContextOwnerContext = { ownerId: this.ownerId, now, timezone, ...(this.isLocked() ? { locked: true } : {}), sourceEnabled: sourceType => this.isSourceEnabled(sourceType), ...(this.permissionCheck ? { canRead: this.permissionCheck } : {}) };
    const sourceResults = this.state.settings.enabled ? await this.collectSources(window, owner) : { items: [] as DailyContextItem[], sourceByItem: new Map<string, DailyContextSource>(), successful: 0, failed: [] as string[], timedOut: [] as string[], cursors: [] as DailyLayerCursor[], timings: [] as { sourceId: string; durationMs: number }[] };
    const raw = sourceResults.items;
    const normalizedValues = await Promise.all(raw.map(async value => {
      const source = sourceResults.sourceByItem.get(value.id);
      let projected: DailyContextItem | undefined = value;
      try { if (source?.project) projected = await source.project(value, owner); } catch { projected = undefined; }
      const item = projected ? normalizeItem(projected, source?.trust ?? 'core', owner) : undefined;
      if (!item) return undefined;
      if (owner.canRead) { try { if (!(await owner.canRead(item))) return undefined; } catch { return undefined; } }
      return item;
    }));
    const normalized = normalizedValues.flatMap(value => value ? [value] : []);
    const deduped = deduplicate(normalized);
    const visible = deduped.filter(item => this.isPresentationEligible(item, now, options.force === true));
    const filtered = this.applyFrequency(visible, options.force === true);
    const sorted = filtered.sort(compareItems).slice(0, this.maxItems);
    const locale = this.state.settings.locale ?? 'en';
    const continueItem = sorted.find(item => item.continueTarget) ?? (this.isLocked() && this.state.continueContext?.dataClass && this.state.continueContext.dataClass !== 'PUBLIC' ? undefined : this.state.continueContext);
    const sections = buildSections(sorted, mode, locale, awaySince, now);
    if (continueItem && !sections.some(section => section.id === 'continue' && section.items.some(item => item.id === continueItem.id))) {
      sections.push({ id: 'continue', title: labelsFor(locale).continue, items: [continueItem], remaining: 0 });
    }
    const fingerprint = fingerprintFor(sorted);
    const hasRelevantChanges = sorted.length > 0;
    const shouldNotify = this.shouldNotify(fingerprint, mode, hasRelevantChanges, options.notify !== false, now, timezone);
    const deterministicText = renderDeterministicText(sections, locale, this.state.settings.style);
    const sourceMs = Object.fromEntries(sourceResults.timings.map(value => [value.sourceId, value.durationMs]));
    const timings: DailyLayerTimings = { aggregationMs: Math.max(0, this.now() - started), sourceMs };
    let phrasedText: string | undefined;
    if (this.phrasing && hasRelevantChanges) {
      const phrasingStarted = this.now();
      const phrase = await this.tryPhrase({ version: 1, id: '', fingerprint, generatedAt: new Date(now).toISOString(), mode, locale, sections, items: sorted, ...(sections.find(section => section.id === 'away') ? { whileYouWereAway: sections.find(section => section.id === 'away') } : {}), ...(continueItem ? { continueContext: continueItem } : {}), deterministicText, hasRelevantChanges, shouldNotify, metrics: { sourceCount: sourceResults.successful, consideredCount: raw.length, deduplicatedCount: Math.max(0, normalized.length - deduped.length), emittedCount: sorted.length, timedOutSources: sourceResults.timedOut, failedSources: sourceResults.failed, cursors: sourceResults.cursors, timings } }, sorted);
      if (phrase) phrasedText = phrase;
      (timings as { phrasingMs?: number }).phrasingMs = Math.max(0, this.now() - phrasingStarted);
    }
    const brief: DailyBrief = {
      version: 1,
      id: `daily:${mode}:${new Date(now).toISOString().slice(0, 10)}:${fingerprint.slice(0, 32)}`,
      fingerprint,
      generatedAt: new Date(now).toISOString(),
      mode,
      locale,
      sections,
      items: sorted,
      ...(sections.find(section => section.id === 'away') ? { whileYouWereAway: sections.find(section => section.id === 'away') } : {}),
      ...(continueItem ? { continueContext: continueItem } : {}),
      deterministicText,
      ...(phrasedText ? { phrasedText } : {}),
      hasRelevantChanges,
      shouldNotify,
      metrics: {
        sourceCount: sourceResults.successful,
        consideredCount: raw.length,
        deduplicatedCount: Math.max(0, normalized.length - deduped.length),
        emittedCount: sorted.length,
        timedOutSources: sourceResults.timedOut,
        failedSources: sourceResults.failed,
        cursors: sourceResults.cursors,
        timings,
      },
    };
    this.lastBrief = brief;
    this.state = { ...this.state, lastBriefFingerprint: fingerprint, lastBriefAt: now, cursors: mergeCursors(this.state.cursors, sourceResults.cursors) };
    if (shouldNotify && this.notification) {
      // Notification delivery is an integration boundary. A denied or
      // temporarily unavailable OS adapter must never make the in-product
      // brief fail; only record the fingerprint after delivery succeeds.
      try {
        await this.notification.notify({ fingerprint, mode, itemIds: sorted.map(item => item.id), count: sorted.length });
        this.state = { ...this.state, notifiedFingerprints: boundedUnique([...this.state.notifiedFingerprints, fingerprint], DAILY_LAYER_MAX_NOTIFIED) };
      } catch {
        // Keep the fingerprint eligible for a later retry/resume.
      }
    }
    await this.persist();
    return structuredClone(brief);
  }

  async refresh(options: DailyBriefOptions = {}): Promise<DailyBrief> { return this.generateBrief(options); }
  async getWhileYouWereAway(options: DailyBriefOptions = {}): Promise<DailyBriefSection | undefined> { return (await this.generateBrief({ ...options, notify: options.notify ?? false, mode: options.mode ?? 'morning' })).whileYouWereAway; }

  async markItem(id: string, state: DailyItemState, version?: string): Promise<boolean> {
    await this.ready();
    if (!normalizeId(id, 256)) return false;
    const current = this.lastBrief?.items.find(item => item.id === id);
    const value: DailyLayerItemState = { version: version ?? current?.updatedAt ?? current?.createdAt ?? 'unknown', state, changedAt: this.now(), ...(state === 'snoozed' ? { snoozeUntil: this.now() + 60 * 60_000 } : {}) };
    this.state = { ...this.state, itemStates: trimItemStates({ ...this.state.itemStates, [id]: value }) };
    await this.persist();
    return true;
  }
  async dismiss(id: string, version?: string): Promise<boolean> { return this.markItem(id, 'dismissed', version); }
  async snooze(id: string, until?: number, version?: string): Promise<boolean> {
    await this.ready();
    const value = validTimestamp(until ?? this.now() + 60 * 60_000);
    const boundedUntil = Math.min(this.now() + DAILY_LAYER_MAX_SNOOZE_MS, value);
    const current = this.lastBrief?.items.find(item => item.id === id);
    if (!normalizeId(id, 256)) return false;
    this.state = { ...this.state, itemStates: trimItemStates({ ...this.state.itemStates, [id]: { version: version ?? current?.updatedAt ?? current?.createdAt ?? 'unknown', state: 'snoozed', changedAt: this.now(), snoozeUntil: boundedUntil } }) };
    await this.persist();
    return true;
  }
  async markSeen(id: string, version?: string): Promise<boolean> { return this.markItem(id, 'seen', version); }
  itemState(id: string): DailyLayerItemState | undefined { const value = this.state.itemStates[id]; return value ? structuredClone(value) : undefined; }
  stateSnapshot(): DailyLayerState { return structuredClone(this.state); }

  private isLocked(): boolean { return this.lockState(); }
  private isSourceEnabled(sourceType: DailySourceType): boolean { return this.state.settings.sources[sourceType] !== false; }

  private async collectSources(window: DailyContextWindow, owner: DailyContextOwnerContext): Promise<{ items: DailyContextItem[]; sourceByItem: Map<string, DailyContextSource>; successful: number; failed: string[]; timedOut: string[]; cursors: DailyLayerCursor[]; timings: { sourceId: string; durationMs: number }[] }> {
    const items: DailyContextItem[] = [];
    const sourceByItem = new Map<string, DailyContextSource>();
    const failed: string[] = [];
    const timedOut: string[] = [];
    const cursors: DailyLayerCursor[] = [];
    const timings: { sourceId: string; durationMs: number }[] = [];
    let successful = 0;
    const sources = [...this.sources.values()].filter(source => this.isSourceEnabled(source.sourceType)).slice(0, DAILY_LAYER_MAX_SOURCES);
    const results = await Promise.all(sources.map(async source => {
      const sourceId = source.sourceId ?? source.sourceType;
      const start = this.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timeout = false;
      try {
        const cursor = this.state.cursors.find(value => value.sourceId === sourceId)?.cursor;
        const sourceWindow: DailyContextWindow = { ...window, ...(cursor ? { cursor } : {}) };
        const pending = Promise.resolve().then(() => source.collect(sourceWindow, owner));
        const timeoutPromise = new Promise<never>((_, reject) => { timer = setTimeout(() => { timeout = true; reject(new Error('DAILY_SOURCE_TIMEOUT')); }, this.sourceTimeoutMs); });
        const result = await Promise.race([pending, timeoutPromise]);
        if (timer) clearTimeout(timer);
        const collection: DailyContextCollection = Array.isArray(result) ? { items: result as readonly DailyContextItem[] } : result as DailyContextCollection;
        if (!collection || !Array.isArray(collection.items)) throw new Error('DAILY_SOURCE_INVALID_RESULT');
        const bounded = collection.items.slice(0, this.maxSourceItems);
        if (collection.cursor && isValidCursor(collection.cursor)) cursors.push({ sourceId, cursor: normalizeCursor(collection.cursor), updatedAt: this.now() });
        timings.push({ sourceId, durationMs: Math.max(0, this.now() - start) });
        successful += 1;
        return { source, items: bounded };
      } catch (error) {
        if (timer) clearTimeout(timer);
        (timeout ? timedOut : failed).push(sourceId);
        timings.push({ sourceId, durationMs: Math.max(0, this.now() - start) });
        return { source, items: [] as readonly DailyContextItem[] };
      }
    }));
    for (const result of results) for (const item of result.items) { if (item && typeof item.id === 'string') { items.push(item); sourceByItem.set(item.id, result.source); } }
    return { items, sourceByItem, successful, failed: failed.sort(), timedOut: timedOut.sort(), cursors: cursors.slice(0, DAILY_LAYER_MAX_CURSORS), timings: timings.sort((a, b) => a.sourceId.localeCompare(b.sourceId)) };
  }

  private isPresentationEligible(item: DailyContextItem, now: number, force: boolean): boolean {
    const state = this.state.itemStates[item.id];
    if (!state || state.version !== (item.updatedAt ?? item.createdAt)) return true;
    if (state.state === 'dismissed' || state.state === 'expired') return false;
    if (state.state === 'snoozed' && (state.snoozeUntil ?? 0) > now && !force) return false;
    return true;
  }

  private applyFrequency(items: DailyContextItem[], force: boolean): DailyContextItem[] {
    if (force || this.state.settings.frequency !== 'important') return items;
    return items.filter(item => item.priority === 'security' || item.priority === 'approval' || item.priority === 'time-sensitive' || item.priority === 'completion' && item.completed === true || item.requiresAction === true);
  }

  private shouldNotify(fingerprint: string, mode: DailyBriefMode, hasItems: boolean, requested: boolean, now: number, timezone = this.defaultTimezone): boolean {
    if (!requested || !hasItems || !this.state.settings.enabled) return false;
    if (this.state.notifiedFingerprints.includes(fingerprint)) return false;
    if (this.state.settings.frequency === 'selected-times' && !this.isAtSelectedTime(mode, now, timezone)) return false;
    return this.state.lastBriefAt === undefined || now - this.state.lastBriefAt >= 5 * 60_000;
  }

  private isAtSelectedTime(mode: DailyBriefMode, timestamp: number, timezone = this.defaultTimezone): boolean {
    const configured = this.state.settings.briefTimes[mode];
    if (!configured) return false;
    const local = new Intl.DateTimeFormat('en', { timeZone: validTimezone(timezone) ?? this.defaultTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
    return local === configured;
  }

  private async tryPhrase(brief: DailyBrief, items: readonly DailyContextItem[]): Promise<string | undefined> {
    const phrasing = this.phrasing;
    if (!phrasing || (phrasing.privacy !== 'LOCAL' && phrasing.privacy !== 'PERSONAL_TRUSTED_COMPUTE')) return undefined;
    const privacy = phrasing.privacy;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = Promise.resolve().then(() => phrasing.phrase({ brief, items: structuredClone(items), privacy }));
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DAILY_PHRASING_TIMEOUT')), this.phrasingTimeoutMs); });
      const result = await Promise.race([pending, timeout]);
      if (!result || typeof result.text !== 'string' || !Array.isArray(result.itemIds) || result.text.length > 8_000) return undefined;
      const allowed = new Set(items.map(item => item.id));
      if (result.itemIds.some(id => typeof id !== 'string' || !allowed.has(id))) return undefined;
      // Numeric claims must be grounded in item facts or the deterministic
      // aggregate. This intentionally errs toward the factual fallback.
      const allowedNumbers = new Set<string>([String(items.length), ...items.flatMap(item => item.factTokens ?? []).filter(token => /^\d+$/.test(token))]);
      const numbers = result.text.match(/\b\d+\b/g) ?? [];
      if (numbers.some(number => !allowedNumbers.has(number))) return undefined;
      const numberWords: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
      const words = result.text.toLocaleLowerCase().match(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g) ?? [];
      if (words.some(word => !allowedNumbers.has(numberWords[word]!))) return undefined;
      return result.text.trim() || undefined;
    } catch { return undefined; }
    finally { if (timer) clearTimeout(timer); }
  }

  private async hydrate(): Promise<void> {
    const raw = await this.storage.read();
    this.state = parseState(raw);
  }

  private async persist(): Promise<void> {
    const snapshot = persistenceSnapshot(this.state);
    const operation = this.writes.then(() => this.storage.write(snapshot));
    this.writes = operation.catch(() => undefined);
    await operation;
  }
}

/**
 * Compatibility name for hosts that model aggregation as a separate
 * component. It intentionally shares the same service and state boundary;
 * there is no second aggregator or application store.
 */
export class DailyContextAggregator extends DailyLayerService {}

function emptyState(): DailyLayerState { return { version: 1, settings: structuredClone(DEFAULT_DAILY_LAYER_SETTINGS), startup: structuredClone(DEFAULT_STARTUP_SURFACE), cursors: [], itemStates: {}, notifiedFingerprints: [] }; }

/** Persist only a reference for Continue; private titles/summaries remain in
 * the canonical source and are never copied into the Daily Layer store. */
function persistenceSnapshot(state: DailyLayerState): DailyLayerState {
  const continueContext = state.continueContext ? {
    id: state.continueContext.id,
    sourceType: state.continueContext.sourceType,
    ...(state.continueContext.sourceId ? { sourceId: state.continueContext.sourceId } : {}),
    canonicalRef: state.continueContext.canonicalRef,
    title: 'Continue',
    createdAt: state.continueContext.createdAt,
    ...(state.continueContext.updatedAt ? { updatedAt: state.continueContext.updatedAt } : {}),
    priority: state.continueContext.priority,
    ...(state.continueContext.dataClass ? { dataClass: state.continueContext.dataClass } : {}),
    continueTarget: true,
    ...(state.continueContext.action ? { action: state.continueContext.action } : {}),
  } as DailyContextItem : undefined;
  return { ...structuredClone(state), ...(continueContext ? { continueContext } : { continueContext: undefined }) };
}

function parseState(value: unknown): DailyLayerState {
  if (!value) return emptyState();
  if (!isRecord(value) || value.version !== 1) return emptyState();
  const settings = parseDailySettings(value.settings);
  const startup = parseStartupSurfacePreference(value.startup);
  const cursors = Array.isArray(value.cursors) ? value.cursors.flatMap(entry => { if (!isRecord(entry) || typeof entry.sourceId !== 'string' || typeof entry.cursor !== 'string' || typeof entry.updatedAt !== 'number' || !isValidCursor(entry.cursor)) return []; const sourceId = normalizeId(entry.sourceId, 120); if (!sourceId) return []; return [{ sourceId, cursor: normalizeCursor(entry.cursor), updatedAt: validTimestamp(entry.updatedAt) }]; }).slice(0, DAILY_LAYER_MAX_CURSORS) : [];
  const itemStates: Record<string, DailyLayerItemState> = {};
  if (isRecord(value.itemStates)) for (const [id, entry] of Object.entries(value.itemStates).slice(-DAILY_LAYER_MAX_ITEM_STATE)) if (isRecord(entry) && typeof entry.version === 'string' && isItemState(entry.state) && typeof entry.changedAt === 'number') itemStates[normalizeId(id, 256)] = { version: entry.version.slice(0, 128), state: entry.state, changedAt: validTimestamp(entry.changedAt), ...(typeof entry.snoozeUntil === 'number' ? { snoozeUntil: validTimestamp(entry.snoozeUntil) } : {}) };
  const continueContext = isRecord(value.continueContext) ? normalizeItem(value.continueContext as unknown as DailyContextItem, 'core', undefined) : undefined;
  const notified = Array.isArray(value.notifiedFingerprints) ? value.notifiedFingerprints.filter((entry): entry is string => typeof entry === 'string' && /^[a-z0-9:-]{1,256}$/i.test(entry)).slice(-DAILY_LAYER_MAX_NOTIFIED) : [];
  return { version: 1, settings, startup, cursors, itemStates, ...(typeof value.lastActiveAt === 'number' ? { lastActiveAt: validTimestamp(value.lastActiveAt) } : {}), ...(continueContext ? { continueContext } : {}), ...(typeof value.lastBriefFingerprint === 'string' ? { lastBriefFingerprint: value.lastBriefFingerprint.slice(0, 256) } : {}), ...(typeof value.lastBriefAt === 'number' ? { lastBriefAt: validTimestamp(value.lastBriefAt) } : {}), notifiedFingerprints: notified };
}

export function parseDailySettings(value: unknown): DailyLayerSettings {
  const candidate = isRecord(value) ? value : {};
  const sourceRecord = isRecord(candidate.sources) ? candidate.sources : {};
  const sources: Record<string, boolean> = { ...DEFAULT_SOURCE_SETTINGS };
  for (const [key, enabled] of Object.entries(sourceRecord).slice(0, DAILY_LAYER_MAX_SOURCES)) if (typeof enabled === 'boolean' && /^[a-z][a-z0-9_-]{0,63}$/i.test(key)) sources[key] = enabled;
  const times: Partial<Record<DailyBriefMode, string>> = {};
  if (isRecord(candidate.briefTimes)) for (const mode of ['morning', 'day', 'evening', 'night'] as const) if (typeof candidate.briefTimes[mode] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.briefTimes[mode])) times[mode] = candidate.briefTimes[mode];
  return { version: 1, enabled: candidate.enabled !== false, sources, briefTimes: times, style: candidate.style === 'concise' || candidate.style === 'detailed' ? candidate.style : 'normal', frequency: candidate.frequency === 'moderate' || candidate.frequency === 'selected-times' ? candidate.frequency : 'important', startupOverlay: candidate.startupOverlay !== false, locale: candidate.locale === 'ru' ? 'ru' : 'en' };
}

export function parseStartupSurfacePreference(value: unknown): StartupSurfacePreference {
  if (!isRecord(value)) return structuredClone(DEFAULT_STARTUP_SURFACE);
  const allowed: readonly StartupSurface[] = ['last-opened', 'home', 'feed', 'video', 'messages', 'storage', 'calendar', 'vault', 'workspace'];
  const surface = allowed.includes(value.surface as StartupSurface) ? value.surface as StartupSurface : 'last-opened';
  const target = isRecord(value.customTarget) && typeof value.customTarget.id === 'string' && typeof value.customTarget.type === 'string' ? normalizeRef(value.customTarget as unknown as DailyObjectReference) : undefined;
  return { version: 1, surface, ...(target ? { customTarget: target } : {}) };
}

function normalizeItem(value: DailyContextItem, trust: DailySourceTrust, owner: DailyContextOwnerContext | undefined): DailyContextItem | undefined {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || typeof value.sourceType !== 'string' || typeof value.title !== 'string' || typeof value.createdAt !== 'string') return undefined;
  const id = normalizeId(value.id, 256); const canonicalRef = normalizeRef(value.canonicalRef); if (!id || !canonicalRef || !isIsoDate(value.createdAt)) return undefined;
  const priority = isPriority(value.priority) ? value.priority : 'informational';
  const safePriority: DailyPriority = trust === 'plugin' || trust === 'remote' ? (priority === 'security' || priority === 'approval' ? 'informational' : priority) : priority;
  const dataClass = isDataClass(value.dataClass) ? value.dataClass : 'PRIVATE';
  const canRead = owner?.canRead;
  // A remote adapter is never an authority for private projections. It may
  // contribute public/explicit references, but a host permission callback is
  // required before PRIVATE/SECRET data can enter the local brief.
  if (trust === 'remote' && (dataClass === 'PRIVATE' || dataClass === 'SECRET') && !canRead) return undefined;
  // Permission checks are performed before any sensitive projection leaves a source.
  // A locked owner context may still receive a redacted reference for an action.
  if (owner?.locked && (dataClass === 'PRIVATE' || dataClass === 'SECRET')) return { id, sourceType: value.sourceType, ...(value.sourceId ? { sourceId: normalizeId(value.sourceId, 120) } : {}), canonicalRef, title: 'Private item', reason: 'Unlock Keystone to view details.', createdAt: value.createdAt, updatedAt: value.updatedAt, priority: safePriority, dataClass, ...(value.requiresAction ? { requiresAction: true } : {}), ...(value.action?.kind === 'open-object' ? { action: { kind: 'open-object', object: canonicalRef } } : {}) };
  if (canRead) { /* The asynchronous check is handled by sources; never guess on a promise here. */ }
  let title = stripMarkup(value.title).slice(0, 240); if (!title) return undefined;
  const locationLeak = value.sourceType === 'location' && /(latitude|longitude|coordinates?|geo-?fix|\b-?\d{1,3}\.\d{2,}\b)/i.test(`${title} ${value.summary ?? ''}`);
  if (locationLeak) title = 'Location sharing is active';
  const item: DailyContextItem = { id, sourceType: value.sourceType, ...(value.sourceId ? { sourceId: normalizeId(value.sourceId, 120) } : {}), canonicalRef, title, ...(!locationLeak && value.summary ? { summary: stripMarkup(value.summary).slice(0, 600) } : {}), ...(value.reason ? { reason: stripMarkup(value.reason).slice(0, 240) } : {}), createdAt: value.createdAt, ...(value.updatedAt && isIsoDate(value.updatedAt) ? { updatedAt: value.updatedAt } : {}), ...(value.dueAt && isIsoDate(value.dueAt) ? { dueAt: value.dueAt } : {}), ...(value.startsAt && isIsoDate(value.startsAt) ? { startsAt: value.startsAt } : {}), priority: safePriority, ...(dataClass ? { dataClass } : {}), ...(value.requiresAction === true ? { requiresAction: true } : {}), ...(value.completed === true ? { completed: true } : {}), ...(value.continueTarget === true ? { continueTarget: true } : {}), ...(value.dedupKey ? { dedupKey: normalizeId(value.dedupKey, 256) } : {}), ...(value.spaceId ? { spaceId: normalizeId(value.spaceId, 256) } : {}), ...(value.action ? { action: normalizeAction(value.action) } : {}), ...(value.factTokens ? { factTokens: value.factTokens.filter(token => typeof token === 'string').slice(0, 32).map(token => token.slice(0, 64)) } : {}) };
  return item;
}

function normalizeAction(value: DailyActionReference): DailyActionReference | undefined {
  if (!value || typeof value !== 'object' || !isDailyActionKind(value.kind)) return undefined;
  const object = value.object ? normalizeRef(value.object) : undefined;
  const surface = isStartupSurface(value.surface) ? value.surface : undefined;
  const actionId = typeof value.actionId === 'string' ? normalizeId(value.actionId, 128) : undefined;
  return { kind: value.kind, ...(object ? { object } : {}), ...(surface ? { surface } : {}), ...(actionId ? { actionId } : {}) };
}

function normalizeRef(value: unknown): DailyObjectReference | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return undefined;
  const id = normalizeId(value.id, 256); const type = normalizeId(value.type, 80); if (!id || !type) return undefined;
  return { id, type, ...(isVisibility(value.visibility) ? { visibility: value.visibility } : {}), ...(typeof value.spaceId === 'string' && normalizeId(value.spaceId, 256) ? { spaceId: normalizeId(value.spaceId, 256) } : {}), ...(typeof value.version === 'string' && normalizeId(value.version, 128) ? { version: normalizeId(value.version, 128) } : {}) };
}

function normalizeId(value: string, max: number): string { return typeof value === 'string' ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''; }
function normalizeCursor(value: string): string { return normalizeId(value, 512); }
function isValidCursor(value: string): boolean { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,512}$/.test(value); }
function stripMarkup(value: string): string { return value.replace(/<[^>]*>/g, '').replace(/javascript\s*:/gi, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim(); }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function isIsoDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function validTimestamp(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : Date.now(); }
function boundedInt(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min; }
function validTimezone(value: string | undefined): string | undefined { if (!value || typeof value !== 'string' || value.length > 80) return undefined; try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { return undefined; } }
function isVisibility(value: unknown): value is DailyObjectReference['visibility'] { return value === 'public' || value === 'contacts' || value === 'community' || value === 'private'; }
function isDataClass(value: unknown): value is DailyDataClass { return value === 'PUBLIC' || value === 'USER_EXPLICIT' || value === 'PRIVATE' || value === 'SECRET'; }
function isPriority(value: unknown): value is DailyPriority { return value === 'security' || value === 'approval' || value === 'time-sensitive' || value === 'communication' || value === 'completion' || value === 'informational'; }
function isItemState(value: unknown): value is DailyItemState { return value === 'shown' || value === 'seen' || value === 'dismissed' || value === 'snoozed' || value === 'expired'; }
function isStartupSurface(value: unknown): value is StartupSurface { return value === 'last-opened' || value === 'home' || value === 'feed' || value === 'video' || value === 'messages' || value === 'storage' || value === 'calendar' || value === 'vault' || value === 'workspace'; }
function isDailyActionKind(value: unknown): value is DailyActionKind { return value === 'open-object' || value === 'review-approval' || value === 'resume' || value === 'open-surface' || value === 'review-location-share'; }

function modeFor(timestamp: number, timezone: string): DailyBriefMode {
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)));
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}
function startOfLocalDay(timestamp: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = Number(parts.find(part => part.type === 'year')?.value); const month = Number(parts.find(part => part.type === 'month')?.value); const day = Number(parts.find(part => part.type === 'day')?.value);
  const localAsUtc = Date.UTC(year, month - 1, day);
  const withClock = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(localAsUtc));
  const guessYear = Number(withClock.find(part => part.type === 'year')?.value); const guessMonth = Number(withClock.find(part => part.type === 'month')?.value); const guessDay = Number(withClock.find(part => part.type === 'day')?.value); const guessHour = Number(withClock.find(part => part.type === 'hour')?.value); const guessMinute = Number(withClock.find(part => part.type === 'minute')?.value);
  const offset = Date.UTC(guessYear, guessMonth - 1, guessDay, guessHour, guessMinute) - localAsUtc;
  return localAsUtc - offset;
}
function priorityWeight(priority: DailyPriority): number { return { security: 600, approval: 500, 'time-sensitive': 400, communication: 300, completion: 200, informational: 100 }[priority]; }
function compareItems(a: DailyContextItem, b: DailyContextItem): number { return priorityWeight(b.priority) - priorityWeight(a.priority) || Number(b.requiresAction) - Number(a.requiresAction) || (Date.parse(b.dueAt ?? b.startsAt ?? b.updatedAt ?? b.createdAt) || 0) - (Date.parse(a.dueAt ?? a.startsAt ?? a.updatedAt ?? a.createdAt) || 0) || a.id.localeCompare(b.id); }
function deduplicate(items: readonly DailyContextItem[]): DailyContextItem[] { const map = new Map<string, DailyContextItem>(); for (const item of items) { const key = item.dedupKey ?? `${item.canonicalRef.type}:${item.canonicalRef.id}`; const previous = map.get(key); if (!previous || compareItems(item, previous) < 0) map.set(key, item); } return [...map.values()]; }
function fingerprintFor(items: readonly DailyContextItem[]): string { const value = items.map(item => `${item.id}@${item.updatedAt ?? item.createdAt}`).sort().join('|'); if (!value) return 'empty'; let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return `f${(hash >>> 0).toString(16).padStart(8, '0')}`; }
function labelsFor(locale: 'en' | 'ru'): { today: string; attention: string; away: string; continue: string; completed: string; next: string; information: string } { return locale === 'ru' ? { today: 'Сегодня', attention: 'Требует внимания', away: 'Пока вас не было', continue: 'Продолжить', completed: 'Завершено', next: 'Следующее', information: 'Изменения' } : { today: 'Today', attention: 'Needs attention', away: 'While you were away', continue: 'Continue', completed: 'Completed', next: 'Next', information: 'Changes' }; }
function buildSections(items: readonly DailyContextItem[], _mode: DailyBriefMode, locale: 'en' | 'ru', awaySince: number | undefined, now: number): DailyBriefSection[] {
  const labels = labelsFor(locale); const buckets = new Map<DailyBriefSection['id'], DailyContextItem[]>(); const put = (id: DailyBriefSection['id'], item: DailyContextItem) => { const list = buckets.get(id) ?? []; list.push(item); buckets.set(id, list); };
  for (const item of items) { const changed = Date.parse(item.updatedAt ?? item.createdAt); if (awaySince !== undefined && changed >= awaySince) put('away', item); else if (item.continueTarget) put('continue', item); else if (item.priority === 'security' || item.priority === 'approval' || item.requiresAction) put('attention', item); else if (item.completed || item.priority === 'completion') put('completed', item); else if ((item.startsAt && Date.parse(item.startsAt) >= now) || (item.dueAt && Date.parse(item.dueAt) >= now)) put('next', item); else put('today', item); }
  const title: Record<DailyBriefSection['id'], string> = { today: labels.today, attention: labels.attention, away: labels.away, continue: labels.continue, completed: labels.completed, next: labels.next, information: labels.information };
  return (['attention', 'away', 'continue', 'next', 'today', 'completed'] as const).flatMap(id => { const list = buckets.get(id); return list?.length ? [{ id, title: title[id], items: list.slice(0, DAILY_LAYER_MAX_ITEMS), remaining: Math.max(0, list.length - DAILY_LAYER_MAX_ITEMS) }] : []; });
}
function renderDeterministicText(sections: readonly DailyBriefSection[], locale: 'en' | 'ru', style: DailyBriefStyle): string { const lines: string[] = []; for (const section of sections) { lines.push(section.title); const limit = style === 'concise' ? 2 : style === 'detailed' ? section.items.length : 5; for (const item of section.items.slice(0, limit)) lines.push(`- ${item.title}${item.reason ? ` — ${item.reason}` : ''}`); if (section.remaining) lines.push(locale === 'ru' ? `- ещё ${section.remaining}` : `- ${section.remaining} more`); } return lines.join('\n'); }
function boundedUnique(values: readonly string[], max: number): string[] { return [...new Set(values)].slice(-max); }
function trimItemStates(value: Record<string, DailyLayerItemState>): Record<string, DailyLayerItemState> { const entries = Object.entries(value).slice(-DAILY_LAYER_MAX_ITEM_STATE); return Object.fromEntries(entries); }
function mergeCursors(existing: readonly DailyLayerCursor[], updates: readonly DailyLayerCursor[]): DailyLayerCursor[] { const map = new Map(existing.map(value => [value.sourceId, value])); for (const value of updates) map.set(value.sourceId, value); return [...map.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)).slice(0, DAILY_LAYER_MAX_CURSORS); }

/** A small source useful for host tests and local-only fixtures; it has no persistence of its own. */
export class StaticDailyContextSource implements DailyContextSource {
  readonly trust: DailySourceTrust = 'owner';
  constructor(readonly sourceType: DailySourceType, private readonly values: readonly DailyContextItem[], readonly sourceId = sourceType) {}
  collect(window: DailyContextWindow): readonly DailyContextItem[] { return this.values.filter(item => Date.parse(item.updatedAt ?? item.createdAt) <= window.until).slice(0, window.limit); }
}
