import type { PluginCapability, PluginRevision } from './plugin-types.js';
import { PLUGIN_EVENTS, type PluginEvent, type PluginEventSubscriptionHandle, type PluginEventType, type PluginExtensionContext } from './plugin-providers.js';
import { PluginPlatformError } from './plugin-platform.js';

export interface PluginEventBusOptions { readonly maxQueue?: number; readonly maxSubscriptions?: number; readonly now?: () => number; readonly canRead?: (event: PluginEventType, context: PluginExtensionContext, scope?: string) => boolean; }
interface Subscription { readonly handle: PluginEventSubscriptionHandle; readonly context: PluginExtensionContext; readonly queue: PluginEvent[]; readonly notify?: () => void; }

export class PluginEventBus {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly now: () => number;
  private readonly maxQueue: number;
  private readonly maxSubscriptions: number;
  private sequence = 0;
  private eventSequence = 0;
  constructor(private readonly options: PluginEventBusOptions = {}) { this.now = options.now ?? (() => Date.now()); this.maxQueue = Math.min(Math.max(options.maxQueue ?? 256, 1), 1024); this.maxSubscriptions = Math.min(Math.max(options.maxSubscriptions ?? 64, 1), 256); }
  subscribe(input: { readonly pluginId: string; readonly sessionId: string; readonly revision: PluginRevision; readonly event: PluginEventType; readonly scope?: string; readonly capabilities: readonly PluginCapability[] }): PluginEventSubscriptionHandle { if (!input || !PLUGIN_EVENTS.includes(input.event) || !input.capabilities.includes('events.subscribe')) throw new PluginPlatformError('CAPABILITY_DENIED', 'Unsupported or unauthorized Plugin event'); if (!input.pluginId || !input.sessionId || !/^[a-f0-9]{64}$/i.test(input.revision.packageHash)) throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin event principal is invalid'); if (this.subscriptions.size >= this.maxSubscriptions) throw new PluginPlatformError('QUOTA', 'Plugin event subscription quota exceeded'); const handle = { id: `pev:${input.pluginId}:${++this.sequence}`, pluginId: input.pluginId, sessionId: input.sessionId, event: input.event, ...(input.scope ? { scope: input.scope.slice(0, 512) } : {}), active: true }; this.subscriptions.set(handle.id, { handle, context: { pluginId: input.pluginId, revision: input.revision, sandboxSessionId: input.sessionId, ownerIdentity: '', grantedCapabilities: input.capabilities }, queue: [] }); return structuredClone(handle); }
  publish(event: PluginEvent): void {
    if (!PLUGIN_EVENTS.includes(event.type) || event.redacted !== true || event.payload === undefined || !event.provenance) return;
    const safeEvent: PluginEvent = { ...event, sequence: ++this.eventSequence, payload: redactEventValue(event.payload) as Readonly<Record<string, unknown>>, redacted: true };
    for (const [id, subscription] of this.subscriptions) {
      if (!subscription.handle.active || subscription.handle.event !== safeEvent.type || !this.options.canRead?.(safeEvent.type, subscription.context, subscription.handle.scope) && this.options.canRead) continue;
      const queue = subscription.queue;
      if (queue.length >= this.maxQueue) { if (safeEvent.type === 'selection.changed' || safeEvent.type === 'workspace.changed') queue.splice(0, queue.length - 1); else continue; }
      queue.push(structuredClone(safeEvent)); this.subscriptions.set(id, subscription); subscription.notify?.();
    }
  }
  drain(handleId: string, limit = 32): readonly PluginEvent[] { const value = this.subscriptions.get(handleId); if (!value || !value.handle.active) return []; return value.queue.splice(0, Math.min(Math.max(limit, 1), 100)); }
  unsubscribe(handleId: string): void { const value = this.subscriptions.get(handleId); if (value) this.subscriptions.set(handleId, { ...value, handle: { ...value.handle, active: false }, queue: [] }); }
  invalidateSession(pluginId: string, sessionId: string): void { for (const [id, value] of this.subscriptions) if (value.handle.pluginId === pluginId && value.handle.sessionId === sessionId) this.unsubscribe(id); }
  size(): number { return this.subscriptions.size; }
}

export function redactedPluginEvent(input: { readonly type: PluginEventType; readonly payload: Readonly<Record<string, unknown>>; readonly revision: string; readonly pluginId: string; readonly source?: string; readonly now?: number }): PluginEvent { if (!PLUGIN_EVENTS.includes(input.type) || !/^[a-f0-9]{64}$/i.test(input.revision) || !input.pluginId) throw new PluginPlatformError('INVALID_ARGUMENT', 'Plugin event is invalid'); const payload = structuredClone(input.payload); const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength; if (bytes > 128 * 1024) throw new PluginPlatformError('QUOTA', 'Plugin event payload exceeds quota'); return { type: input.type, sequence: 0, revision: input.revision, createdAt: new Date(input.now ?? Date.now()).toISOString(), payload, redacted: true, provenance: { pluginId: input.pluginId, pluginRevision: input.revision, ...(input.source ? { source: input.source.slice(0, 256) } : {}), createdAt: new Date(input.now ?? Date.now()).toISOString(), trust: 'PLUGIN_UNTRUSTED' } }; }

function redactEventValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 8_192) : value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactEventValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|private.?key|recovery|password|token|credential|relay|route|hop|gps|location|ip.?address/i.test(key)) continue;
    result[key.slice(0, 128)] = redactEventValue(item, depth + 1);
  }
  return result;
}
