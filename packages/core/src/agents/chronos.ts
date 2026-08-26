import type { NodeId } from '../types.js';
import type { Envelope, EnvelopeSecurity, UnsignedEnvelope } from '../connectivity.js';
import type { KeystoneDeliveryInterface } from '../connectivity.js';

export type ChronosSystemEvent =
  | { type: 'file.created'; path: string; occurredAt: string }
  | { type: 'wifi.connected'; ssid: string; occurredAt: string }
  /** Additive typed bridge for local-first agent automation events. */
  | { type: 'system'; eventType: string; eventId?: string; payload?: unknown; dataClass?: 'PUBLIC' | 'USER_EXPLICIT' | 'PRIVATE' | 'SECRET'; occurredAt: string; causedBy?: readonly string[] };

export type ChronosTrigger =
  | { type: 'schedule'; cron: string; timeZone?: string }
  | { type: 'file.created'; directory: string; glob?: string }
  | { type: 'wifi.connected'; ssid: string }
  | { type: 'system'; eventType: string };

export type ChronosAction =
  | { type: 'web.digest'; urls: string[]; topic?: string; notificationTitle?: string }
  | { type: 'life-map.review'; staleAfterDays: number; includeOverdue: boolean; notificationTitle?: string }
  | { type: 'ai.workflow'; instruction: string };

export interface ChronosRule {
  version: 1;
  id: string;
  name: string;
  enabled: boolean;
  trigger: ChronosTrigger;
  action: ChronosAction;
  /** Delegation never widens authority: only trusted active Self desktops qualify. */
  allowSelfDelegation: boolean;
  createdAt: string;
}

export type ChronosAuditStatus = 'started' | 'succeeded' | 'failed' | 'delegated' | 'skipped' | 'waiting_for_approval' | 'retry_scheduled' | 'cancelled';
export interface ChronosAuditEntry { id: string; ruleId: string; ruleName: string; nodeId: NodeId; status: ChronosAuditStatus; timestamp: string; message: string; durationMs?: number; automationId?: string; agentId?: string; trigger?: string; tools?: readonly string[]; resultStatus?: string; approvalState?: string; }
export interface ChronosRunContext { runId: string; ruleId: string; trigger: ChronosTrigger; event?: ChronosSystemEvent; delegatedFrom?: NodeId; signal: AbortSignal; }
export interface ChronosWorkflowRunner { run(action: ChronosAction, context: ChronosRunContext): Promise<{ summary?: string } | void>; }
export interface ChronosStore { listRules(): Promise<readonly ChronosRule[]>; putRule(rule: ChronosRule): Promise<void>; deleteRule(id: string): Promise<void>; appendAudit(entry: ChronosAuditEntry): Promise<void>; }
export interface ChronosPowerMonitor { isDeviceAwake(): boolean; canRunBackgroundWork(): boolean; }
export interface ChronosEventSource { subscribe(handler: (event: ChronosSystemEvent) => void | Promise<void>): () => void; }
export interface ChronosTaskDelegator { delegate(task: ChronosDelegatedTask): Promise<{ accepted: boolean; nodeId?: NodeId; message?: string }>; }
export interface ChronosDelegatedTask { version: 1; runId: string; rule: ChronosRule; event?: ChronosSystemEvent; requestedAt: string; }

export interface ChronosOptions {
  localNodeId: NodeId;
  store: ChronosStore;
  runner: ChronosWorkflowRunner;
  power: ChronosPowerMonitor;
  events?: ChronosEventSource;
  delegator?: ChronosTaskDelegator;
  now?: () => Date;
  setTimer?: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Energy-efficient autonomous scheduler. It owns one timer (the next due rule),
 * subscribes to native OS events instead of polling, and coalesces concurrent runs.
 */
export class Chronos {
  private readonly rules = new Map<string, ChronosRule>();
  private readonly running = new Set<string>();
  private readonly now: () => Date;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribeEvents?: () => void;
  private started = false;
  private intervalMultiplier = 1;

  constructor(private readonly options: ChronosOptions) { this.now = options.now ?? (() => new Date()); }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const rule of await this.options.store.listRules()) this.rules.set(rule.id, validateRule(rule));
    this.unsubscribeEvents = this.options.events?.subscribe(event => this.handleEvent(event));
    this.armNextTimer();
  }

  stop(): void {
    this.started = false;
    this.unsubscribeEvents?.(); this.unsubscribeEvents = undefined;
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = undefined;
  }

  listRules(): readonly ChronosRule[] { return [...this.rules.values()]; }

  /** Stretch scheduled work without mutating the user's persisted cron rules. */
  setIntervalMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error('Chronos interval multiplier must be >= 1');
    this.intervalMultiplier = multiplier;
    this.armNextTimer();
  }

  async upsertRule(input: ChronosRule): Promise<void> {
    const rule = validateRule(input);
    this.rules.set(rule.id, rule);
    await this.options.store.putRule(rule);
    this.armNextTimer();
  }

  async removeRule(id: string): Promise<void> { this.rules.delete(id); await this.options.store.deleteRule(id); this.armNextTimer(); }

  async runNow(ruleId: string): Promise<void> {
    const rule = this.rules.get(ruleId);
    if (!rule) throw new Error(`Unknown Chronos rule: ${ruleId}`);
    await this.dispatch(rule);
  }

  /** Entry point used by the trusted P2P receiver. */
  async runDelegated(task: ChronosDelegatedTask, sender: NodeId): Promise<void> {
    validateDelegatedTask(task);
    await this.execute(task.rule, task.runId, task.event, sender);
  }

  private async handleEvent(event: ChronosSystemEvent): Promise<void> {
    if (!this.started) return;
    const matches = [...this.rules.values()].filter(rule => rule.enabled && matchesEvent(rule.trigger, event));
    await Promise.all(matches.map(rule => this.dispatch(rule, event)));
  }

  private armNextTimer(): void {
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
    this.timer = undefined;
    if (!this.started) return;
    const now = this.now();
    const dates = [...this.rules.values()].filter((rule): rule is ChronosRule & { trigger: Extract<ChronosTrigger, { type: 'schedule' }> } => rule.enabled && rule.trigger.type === 'schedule').map(rule => nextCronDate(rule.trigger.cron, now, rule.trigger.timeZone));
    if (!dates.length) return;
    const next = dates.reduce((a, b) => a < b ? a : b);
    const delay = Math.min(2_147_000_000, Math.max(250, (next.getTime() - now.getTime()) * this.intervalMultiplier));
    this.timer = (this.options.setTimer ?? setTimeout)(() => { void this.onTimer(); }, delay);
  }

  private async onTimer(): Promise<void> {
    if (!this.started) return;
    const now = this.now();
    const due = [...this.rules.values()].filter(rule => rule.enabled && rule.trigger.type === 'schedule' && isCronDue(rule.trigger.cron, now, rule.trigger.timeZone));
    try { await Promise.all(due.map(rule => this.dispatch(rule))); } finally { this.armNextTimer(); }
  }

  private async dispatch(rule: ChronosRule, event?: ChronosSystemEvent): Promise<void> {
    if (this.running.has(rule.id)) { await this.audit(rule, 'skipped', 'A previous run is still active'); return; }
    const runId = crypto.randomUUID();
    if ((!this.options.power.isDeviceAwake() || !this.options.power.canRunBackgroundWork()) && rule.allowSelfDelegation && this.options.delegator) {
      const result = await this.options.delegator.delegate({ version: 1, runId, rule, event, requestedAt: this.now().toISOString() });
      if (result.accepted) { await this.audit(rule, 'delegated', `Delegated to active Self node ${result.nodeId ?? 'unknown'}`); return; }
    }
    if (!this.options.power.canRunBackgroundWork()) { await this.audit(rule, 'skipped', 'Background work is unavailable and no Self node accepted delegation'); return; }
    await this.execute(rule, runId, event);
  }

  private async execute(rule: ChronosRule, runId: string, event?: ChronosSystemEvent, delegatedFrom?: NodeId): Promise<void> {
    if (this.running.has(rule.id)) return;
    this.running.add(rule.id); const started = Date.now();
    await this.audit(rule, 'started', delegatedFrom ? `Accepted from Self node ${delegatedFrom}` : 'Local run started');
    try {
      const result = await this.options.runner.run(rule.action, { runId, ruleId: rule.id, trigger: rule.trigger, event, delegatedFrom, signal: new AbortController().signal });
      await this.audit(rule, 'succeeded', result?.summary ?? 'Workflow completed', Date.now() - started);
    } catch (error) {
      await this.audit(rule, 'failed', safeError(error), Date.now() - started);
    } finally { this.running.delete(rule.id); }
  }

  private audit(rule: ChronosRule, status: ChronosAuditStatus, message: string, durationMs?: number): Promise<void> {
    return this.options.store.appendAudit({ id: crypto.randomUUID(), ruleId: rule.id, ruleName: rule.name, nodeId: this.options.localNodeId, status, timestamp: this.now().toISOString(), message: message.slice(0, 2_000), ...(durationMs === undefined ? {} : { durationMs }) });
  }
}

export interface ChronosPeer { nodeId: NodeId; role: 'Self'; formFactor: 'desktop' | 'mobile'; isActive: boolean; }
export interface ChronosP2POptions {
  localNodeId: NodeId; selfPeers: () => readonly ChronosPeer[]; security?: EnvelopeSecurity; expiresInMs?: number;
  authorizeIncoming?: (task: ChronosDelegatedTask, sender: NodeId) => boolean | Promise<boolean>;
}

/** Signed, direct P2P delegation. Incoming packets are accepted only from the live Self allow-list. */
export class ChronosP2PDelegator implements ChronosTaskDelegator {
  private readonly pending = new Map<string, (result: { accepted: boolean; nodeId?: NodeId; message?: string }) => void>();
  private readonly handlers = new Set<(task: ChronosDelegatedTask, sender: NodeId) => Promise<void>>();
  private readonly seen = new Set<string>(); private readonly unsubscribe: () => void;
  constructor(private readonly transport: KeystoneDeliveryInterface, private readonly options: ChronosP2POptions) { this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope); }); }
  onTask(handler: (task: ChronosDelegatedTask, sender: NodeId) => Promise<void>): () => void { this.handlers.add(handler); return () => this.handlers.delete(handler); }
  async delegate(task: ChronosDelegatedTask): Promise<{ accepted: boolean; nodeId?: NodeId; message?: string }> {
    validateDelegatedTask(task);
    const peer = this.options.selfPeers().find(candidate => candidate.role === 'Self' && candidate.formFactor === 'desktop' && candidate.isActive);
    if (!peer) return { accepted: false, message: 'No active Self desktop is available' };
    await this.transport.connect(peer.nodeId);
    const response = new Promise<{ accepted: boolean; nodeId?: NodeId; message?: string }>(resolve => {
      const timeout = setTimeout(() => { this.pending.delete(task.runId); resolve({ accepted: false, message: 'Delegation timed out' }); }, 8_000);
      this.pending.set(task.runId, value => { clearTimeout(timeout); resolve(value); });
    });
    await this.send(peer.nodeId, 'chronos.delegate', task);
    return response;
  }
  close(): void { this.unsubscribe(); this.pending.clear(); }
  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.recipient !== this.options.localNodeId || !this.isSelf(envelope.sender) || Date.parse(envelope.expiresAt) <= Date.now() || this.seen.has(envelope.nonce)) return;
    if (this.options.security && !(await this.options.security.verify(envelope))) return;
    this.seen.add(envelope.nonce);
    if (envelope.type === 'chronos.result') {
      const result = envelope.body as Record<string, unknown>; if (typeof result.runId !== 'string' || typeof result.accepted !== 'boolean') return;
      const settle = this.pending.get(result.runId); this.pending.delete(result.runId); settle?.({ accepted: result.accepted, nodeId: envelope.sender, message: typeof result.message === 'string' ? result.message : undefined }); return;
    }
    if (envelope.type !== 'chronos.delegate') return;
    let task: ChronosDelegatedTask;
    try { task = validateDelegatedTask(envelope.body); } catch { return; }
    const allowed = await this.options.authorizeIncoming?.(task, envelope.sender) ?? true;
    if (!allowed || !this.options.selfPeers().some(peer => peer.nodeId === envelope.sender && peer.role === 'Self')) { await this.send(envelope.sender, 'chronos.result', { runId: task.runId, accepted: false, message: 'Rule is not authorized' }); return; }
    await this.send(envelope.sender, 'chronos.result', { runId: task.runId, accepted: true });
    await Promise.all([...this.handlers].map(handler => handler(task, envelope.sender)));
  }
  private isSelf(nodeId: NodeId): boolean { return this.options.selfPeers().some(peer => peer.nodeId === nodeId && peer.role === 'Self'); }
  private async send(peer: NodeId, type: string, body: unknown): Promise<void> {
    const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.options.localNodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + (this.options.expiresInMs ?? 60_000)).toISOString(), body };
    await this.transport.send(peer, { ...unsigned, signature: this.options.security ? await this.options.security.sign(unsigned) : '' });
  }
}

function matchesEvent(trigger: ChronosTrigger, event: ChronosSystemEvent): boolean {
  if (trigger.type === 'file.created' && event.type === 'file.created') return isInside(event.path, trigger.directory) && matchesGlob(fileName(event.path), trigger.glob ?? '*');
  if (trigger.type === 'wifi.connected' && event.type === 'wifi.connected') return trigger.ssid === event.ssid;
  return trigger.type === 'system' && event.type === 'system' && trigger.eventType === event.eventType;
}
function isInside(path: string, directory: string): boolean { const root = directory.replace(/[\\/]+$/, ''); return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`); }
function fileName(path: string): string { return path.split(/[\\/]/).pop() ?? ''; }
function matchesGlob(name: string, glob: string): boolean { const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'); return new RegExp(`^${escaped}$`, 'i').test(name); }

type CronParts = [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
function parseCron(cron: string): CronParts { const fields = cron.trim().split(/\s+/); if (fields.length !== 5) throw new Error('Chronos cron requires 5 fields: minute hour day month weekday'); const ranges: Array<[number, number]> = [[0,59],[0,23],[1,31],[1,12],[0,6]]; return fields.map((field, i) => parseCronField(field, ...ranges[i]!)) as CronParts; }
function parseCronField(field: string, min: number, max: number): Set<number> { const out = new Set<number>(); for (const part of field.split(',')) { const [range, rawStep] = part.split('/'); const step = rawStep === undefined ? 1 : Number(rawStep); if (!Number.isInteger(step) || step < 1) throw new Error('Invalid cron step'); const [a, b] = range === '*' ? [min,max] : range!.includes('-') ? range!.split('-').map(Number) : [Number(range),Number(range)]; if (!Number.isInteger(a) || !Number.isInteger(b) || a! < min || b! > max || a! > b!) throw new Error(`Invalid cron field: ${field}`); for (let value = a!; value <= b!; value += step) out.add(value); } return out; }
function dateParts(date: Date, timeZone?: string): [number,number,number,number,number] { if (!timeZone) return [date.getMinutes(),date.getHours(),date.getDate(),date.getMonth()+1,date.getDay()]; const parts = new Intl.DateTimeFormat('en-US',{ timeZone, minute:'numeric',hour:'numeric',hourCycle:'h23',day:'numeric',month:'numeric',weekday:'short' }).formatToParts(date); const get=(type:string)=>parts.find(p=>p.type===type)?.value ?? ''; const week=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday')); return [Number(get('minute')),Number(get('hour')),Number(get('day')),Number(get('month')),week]; }
function isCronDue(cron: string, date: Date, timeZone?: string): boolean { const fields=parseCron(cron), values=dateParts(date,timeZone); return fields.every((set,index)=>set.has(values[index]!)); }
export function nextCronDate(cron: string, after: Date, timeZone?: string): Date { parseCron(cron); const next=new Date(after); next.setSeconds(0,0); next.setMinutes(next.getMinutes()+1); for(let i=0;i<366*24*60;i++,next.setMinutes(next.getMinutes()+1)) if(isCronDue(cron,next,timeZone)) return new Date(next); throw new Error('Cron expression has no occurrence within one year'); }
function validateRule(value: ChronosRule): ChronosRule { if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || typeof value.enabled !== 'boolean' || typeof value.allowSelfDelegation !== 'boolean' || !value.trigger || !value.action || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid Chronos rule'); if(value.trigger.type==='schedule') parseCron(value.trigger.cron); else if(value.trigger.type==='file.created'){if(!value.trigger.directory)throw new Error('File trigger directory is required');} else if(value.trigger.type==='wifi.connected'){if(!value.trigger.ssid)throw new Error('Wi-Fi SSID is required');} else if(value.trigger.type==='system'){if(!safeEventType(value.trigger.eventType))throw new Error('System event type is invalid');} else throw new Error('Unsupported Chronos trigger'); if(value.action.type==='web.digest'){if(!value.action.urls.length||value.action.urls.some(url=>{try{return new URL(url).protocol!=='https:';}catch{return true;}}))throw new Error('Web digest requires HTTPS URLs');} else if(value.action.type==='life-map.review'){if(!Number.isFinite(value.action.staleAfterDays)||value.action.staleAfterDays<1)throw new Error('Invalid stale age');} else if(value.action.type==='ai.workflow'){if(!value.action.instruction.trim())throw new Error('Workflow instruction is empty');} else throw new Error('Unsupported Chronos action'); return value; }
function validateDelegatedTask(value: unknown): ChronosDelegatedTask { if(!value||typeof value!=='object')throw new Error('Invalid delegated task'); const v=value as ChronosDelegatedTask; if(v.version!==1||typeof v.runId!=='string'||!Number.isFinite(Date.parse(v.requestedAt)))throw new Error('Invalid delegated task'); validateRule(v.rule); return v; }
function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Unknown workflow error'; }
function safeEventType(value: unknown): value is string { return typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,95}$/.test(value); }
