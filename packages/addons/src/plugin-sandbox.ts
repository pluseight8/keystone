import type {
  PluginCapability,
  PluginCapabilityToken,
  PluginInstallRecord,
  PluginResourceBudget,
  PluginSandboxHost,
  PluginSandboxPolicy,
  PluginSandboxProfile,
  PluginSandboxSession,
  PluginSandboxTrustClass,
  PluginSandboxViolation,
  PluginSandboxViolationClass,
  PluginSandboxHealth,
  PluginSandboxExitReason,
} from './plugin-types.js';
import { sha256Hex } from './plugin-integrity.js';
import { LinuxNativeProcessSandboxHost, type NativePluginProcessRequest, type NativeProcessSandboxHandle, type NativeProcessSandboxHost } from '@keystone/native-host';

const DEFAULT_PROFILE: PluginSandboxProfile = {
  name: 'DEFAULT', runtime: 'ISOLATED_JS_PROCESS', filesystem: 'PRIVATE_NAMESPACE',
  process: 'DENY', native: 'DENY', network: 'DENY', maxMessageBytes: 256 * 1024,
};
const DEFAULT_POLICY: PluginSandboxPolicy = {
  profile: DEFAULT_PROFILE, environmentAllowlist: [], allowedOrigins: [],
  allowPrivateNetwork: false, allowLoopback: false, allowChildProcess: false, allowNativeModules: false,
};
const MAX_DEPTH = 8;

export class PluginSandboxError extends Error {
  constructor(readonly code: 'INVALID_IPC' | 'CAPABILITY_FORGERY' | 'UNAUTHORIZED_NETWORK' | 'UNAUTHORIZED_FS' | 'UNAUTHORIZED_PROCESS' | 'UNAUTHORIZED_SECRET' | 'RESOURCE_EXCEEDED' | 'RUNTIME_TAMPER' | 'NAMESPACE_ESCAPE' | 'SESSION_REVOKED' | 'NOT_FOUND', message: string) { super(message); this.name = 'PluginSandboxError'; }
}

/** Host-side session authority. It does not execute plugin code. */
export class PluginSandboxHostImpl implements PluginSandboxHost {
  private readonly sessions = new Map<string, PluginSandboxSession>();
  private readonly violationsLog: PluginSandboxViolation[] = [];
  private readonly tokens = new Map<string, PluginCapabilityToken>();
  private sequence = 0;
  private readonly requestCounts = new Map<string, { count: number; windowStarted: number }>();
  private readonly nativeProcesses = new Map<string, Set<NativeProcessSandboxHandle>>();
  private readonly nativeProcess: NativeProcessSandboxHost;
  constructor(private readonly now: () => number = () => Date.now(), private readonly maxMessageBytes = 256 * 1024, nativeProcess?: NativeProcessSandboxHost) { this.nativeProcess = nativeProcess ?? new LinuxNativeProcessSandboxHost(this.now); }

  async launchNativeProcess(request: NativePluginProcessRequest): Promise<NativeProcessSandboxHandle> {
    const session = [...this.sessions.values()].find(value => value.pluginId === request.pluginId && value.revisionHash === request.revisionHash && value.health === 'HEALTHY');
    if (!session) throw new PluginSandboxError('SESSION_REVOKED', 'Plugin sandbox session is not active');
    const handle = await this.nativeProcess.launchPlugin(request);
    const processes = this.nativeProcesses.get(session.sessionId) ?? new Set<NativeProcessSandboxHandle>(); processes.add(handle); this.nativeProcesses.set(session.sessionId, processes);
    return handle;
  }
  async terminateNativeProcess(handle: NativeProcessSandboxHandle): Promise<void> { await this.nativeProcess.terminate(handle, 'plugin lifecycle'); }

  async createSession(plugin: PluginInstallRecord, policy: PluginSandboxPolicy = DEFAULT_POLICY): Promise<PluginSandboxSession> {
    if (plugin.state === 'QUARANTINED' || plugin.state === 'REJECTED' || plugin.state === 'UNINSTALLED') throw new PluginSandboxError('NOT_FOUND', 'Quarantined Plugin cannot create a sandbox session');
    const sessionId = `pss:${plugin.pluginId}:${++this.sequence}:${this.now()}`;
    const session: PluginSandboxSession = {
      sessionId, pluginId: plugin.pluginId, revisionHash: plugin.currentRevision.packageHash,
      trust: plugin.manifest.pluginType === 'DEVELOPMENT' ? 'PLUGIN_DEVELOPMENT' : 'PLUGIN_SANDBOXED',
      policy: structuredClone(policy), startedAt: new Date(this.now()).toISOString(), health: 'HEALTHY',
    };
    this.sessions.set(sessionId, session);
    return structuredClone(session);
  }

  async terminate(sessionId: string, reason: PluginSandboxExitReason): Promise<void> {
    const current = this.sessions.get(sessionId); if (!current) return;
    const processes = this.nativeProcesses.get(sessionId); if (processes) { for (const handle of processes) await this.nativeProcess.terminate(handle, reason); this.nativeProcesses.delete(sessionId); }
    this.sessions.set(sessionId, { ...current, health: reason === 'QUARANTINED' ? 'QUARANTINED' : 'TERMINATED' });
    for (const [id, token] of this.tokens) if (token.sandboxSessionId === sessionId) this.tokens.set(id, { ...token, revokedAt: new Date(this.now()).toISOString() });
  }
  health(sessionId: string): PluginSandboxHealth { return this.sessions.get(sessionId)?.health ?? 'TERMINATED'; }
  violations(sessionId?: string): readonly PluginSandboxViolation[] { return this.violationsLog.filter(item => !sessionId || item.sessionId === sessionId).map(item => structuredClone(item)); }
  issueCapabilityToken(input: Omit<PluginCapabilityToken, 'tokenId' | 'issuedAt' | 'uses'>): PluginCapabilityToken {
    const session = this.sessions.get(input.sandboxSessionId);
    if (!session || session.pluginId !== input.pluginId || session.revisionHash !== input.revisionHash || session.health !== 'HEALTHY') throw new PluginSandboxError('CAPABILITY_FORGERY', 'Capability token is not bound to a live sandbox session');
    const token = { ...input, tokenId: `pct:${input.pluginId}:${++this.sequence}`, issuedAt: new Date(this.now()).toISOString(), uses: 0 };
    this.tokens.set(token.tokenId, token); return structuredClone(token);
  }
  revokeToken(tokenId: string, reason = 'revoked'): void { const token = this.tokens.get(tokenId); if (token) this.tokens.set(tokenId, { ...token, revokedAt: `${new Date(this.now()).toISOString()} ${reason.slice(0, 64)}` }); }
  consumeCapabilityToken(token: PluginCapabilityToken, expected: { pluginId: string; revisionHash: string; sessionId: string; capability: PluginCapability; scope?: string }): PluginCapabilityToken {
    const stored = this.tokens.get(token.tokenId);
    if (!stored || stored.pluginId !== expected.pluginId || stored.revisionHash !== expected.revisionHash || stored.sandboxSessionId !== expected.sessionId || stored.capability !== expected.capability || (expected.scope && stored.scope !== expected.scope) || stored.revokedAt || (stored.expiresAt && Date.parse(stored.expiresAt) <= this.now()) || (stored.maxUses !== undefined && stored.uses >= stored.maxUses)) { this.violate(expected.pluginId, expected.revisionHash, expected.sessionId, 'CAPABILITY_FORGERY', 'capability.consume', true); throw new PluginSandboxError('CAPABILITY_FORGERY', 'Capability token is invalid or expired'); }
    const next = { ...stored, uses: stored.uses + 1 }; this.tokens.set(token.tokenId, next); return structuredClone(next);
  }
  validateIpc(envelope: unknown, expected: { pluginId: string; revisionHash: string; sessionId: string; maxBytes?: number }): void {
    const bytes = byteLength(envelope); if (bytes > Math.min(expected.maxBytes ?? this.maxMessageBytes, this.maxMessageBytes)) { this.violate(expected.pluginId, expected.revisionHash, expected.sessionId, 'INVALID_IPC', 'ipc.size', true); throw new PluginSandboxError('INVALID_IPC', 'Sandbox IPC message exceeds the bounded size'); }
    if (!isRecord(envelope) || envelope.version !== 1 || envelope.pluginId !== expected.pluginId || envelope.revisionHash !== expected.revisionHash || envelope.sessionId !== expected.sessionId || typeof envelope.correlationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.correlationId) || typeof envelope.operation !== 'string' || envelope.operation.length > 128 || !isSafeValue(envelope.payload, 0)) { this.violate(expected.pluginId, expected.revisionHash, expected.sessionId, 'INVALID_IPC', 'ipc.validate', true); throw new PluginSandboxError('INVALID_IPC', 'Sandbox IPC envelope is malformed'); }
  }
  authorizeFilesystem(sessionId: string, path: string, mode: 'read' | 'write'): string {
    const session = this.requireSession(sessionId); if (session.policy.profile.filesystem === 'NONE') { this.violate(session.pluginId, session.revisionHash, sessionId, 'UNAUTHORIZED_FS', `fs.${mode}`, true); throw new PluginSandboxError('UNAUTHORIZED_FS', 'Plugin filesystem is denied'); }
    if (!isSafeRelativePath(path)) { const code = path.includes('..') || path.startsWith('/') ? 'NAMESPACE_ESCAPE' : 'UNAUTHORIZED_FS'; this.violate(session.pluginId, session.revisionHash, sessionId, code, `fs.${mode}`, true); throw new PluginSandboxError(code, 'Plugin path escapes its private namespace'); }
    return `${session.pluginId}/${session.revisionHash}/${path}`;
  }
  authorizeNetwork(sessionId: string, url: string, origins: readonly string[] = []): URL {
    const session = this.requireSession(sessionId); let parsed: URL;
    try { parsed = new URL(url); } catch { this.violate(session.pluginId, session.revisionHash, sessionId, 'UNAUTHORIZED_NETWORK', 'network.parse', true); throw new PluginSandboxError('UNAUTHORIZED_NETWORK', 'Network URL is invalid'); }
    if (session.policy.profile.network !== 'SCOPED' || !['https:', 'http:'].includes(parsed.protocol) || isLocalAddress(parsed.hostname) || !origins.some(origin => sameOrigin(origin, parsed))) { this.violate(session.pluginId, session.revisionHash, sessionId, 'UNAUTHORIZED_NETWORK', 'network.request', true); throw new PluginSandboxError('UNAUTHORIZED_NETWORK', 'Network request is outside the plugin policy'); }
    return parsed;
  }
  checkNetworkBudget(sessionId: string, budget: PluginResourceBudget): void { const now = this.now(); const current = this.requestCounts.get(sessionId); const value = !current || now - current.windowStarted >= 60_000 ? { count: 0, windowStarted: now } : current; if (value.count >= budget.networkRequestsPerMinute) { this.requestCounts.set(sessionId, value); this.recordResourceViolation(sessionId, 'network.rate'); } value.count += 1; this.requestCounts.set(sessionId, value); }
  authorizeProcess(sessionId: string, operation: string): never { const session = this.requireSession(sessionId); this.violate(session.pluginId, session.revisionHash, sessionId, 'UNAUTHORIZED_PROCESS', operation, true); throw new PluginSandboxError('UNAUTHORIZED_PROCESS', 'Process and shell access are denied to Plugins'); }
  authorizeSecret(sessionId: string): never { const session = this.requireSession(sessionId); this.violate(session.pluginId, session.revisionHash, sessionId, 'UNAUTHORIZED_SECRET', 'secret.raw', true); throw new PluginSandboxError('UNAUTHORIZED_SECRET', 'Raw secrets are never exposed to Plugins'); }
  recordResourceViolation(sessionId: string, operation: string): void { const session = this.requireSession(sessionId); this.violate(session.pluginId, session.revisionHash, sessionId, 'RESOURCE_EXCEEDED', operation, true); throw new PluginSandboxError('RESOURCE_EXCEEDED', 'Plugin resource budget exceeded'); }
  private requireSession(sessionId: string): PluginSandboxSession { const session = this.sessions.get(sessionId); if (!session || session.health !== 'HEALTHY') throw new PluginSandboxError('SESSION_REVOKED', 'Sandbox session is no longer active'); return session; }
  private violate(pluginId: string, revisionHash: string, sessionId: string, klass: PluginSandboxViolationClass, operation: string, terminated: boolean): void { this.violationsLog.push({ id: `psv:${++this.sequence}`, pluginId, revisionHash, sessionId, class: klass, operation: operation.slice(0, 128), at: new Date(this.now()).toISOString(), terminated }); if (this.violationsLog.length > 2048) this.violationsLog.splice(0, this.violationsLog.length - 2048); }
}

export function defaultPluginSandboxPolicy(profile: Partial<PluginSandboxProfile> = {}): PluginSandboxPolicy { return { ...DEFAULT_POLICY, profile: { ...DEFAULT_PROFILE, ...profile } }; }
export function isLocalAddress(hostname: string): boolean { const host = hostname.toLowerCase().replace(/\.$/, ''); if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.endsWith('.localhost') || host.endsWith('.local')) return true; if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^fc|^fd/i.test(host)) return true; return false; }
function sameOrigin(origin: string, url: URL): boolean { try { return new URL(origin).origin === url.origin; } catch { return false; } }
function isSafeRelativePath(value: string): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f]/.test(part)); }
function byteLength(value: unknown): number { try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isSafeValue(value: unknown, depth: number): boolean { if (depth > MAX_DEPTH) return false; if (value === null || typeof value === 'string' || typeof value === 'boolean') return true; if (typeof value === 'number') return Number.isFinite(value); if (Array.isArray(value)) return value.length <= 256 && value.every(item => isSafeValue(item, depth + 1)); if (isRecord(value)) return Object.keys(value).length <= 256 && Object.entries(value).every(([key, item]) => key.length <= 128 && isSafeValue(item, depth + 1)); return false; }
