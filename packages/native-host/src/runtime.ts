/**
 * R0P66 runtime and physical-evidence layer.
 *
 * This module deliberately keeps three things separate:
 *   (1) a capability contract exists in TypeScript;
 *   (2) the host can detect a matching runtime facility; and
 *   (3) a bounded real test actually exercised it.
 * A test adapter can produce deterministic evidence for protocol tests, but
 * it can never produce PHYSICALLY_VERIFIED evidence.
 */
import { createServer, connect as openSocket, type Server, type Socket } from 'node:net';
import { networkInterfaces, platform as osPlatform, arch, tmpdir } from 'node:os';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createLinuxProductionSecureStorage,
  NativeHostError,
  NativeSecureStorage,
} from './index.js';
import { LinuxNativeMediaHost } from './media.js';
import type {
  NativeHostFeature,
  NativeHostFeatureState,
  NativeHostRequest,
  NativeLanHost,
  NativeLanPeer,
  NativeNetworkSnapshot,
} from './index.js';

export type DeviceRuntimeId = `device-runtime:${string}`;
export type DeviceRuntimeSessionId = `device-session:${string}`;
export type DeviceRuntimeState = 'STARTING' | 'RUNNING' | 'BACKGROUND' | 'SUSPENDING' | 'SUSPENDED' | 'RESUMING' | 'RECOVERING' | 'TERMINATING' | 'TERMINATED' | 'FAILED';
export type DeviceRuntimeFeatureHealth = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';
export type DeviceRuntimePermissionState = 'UNKNOWN' | 'NOT_REQUESTED' | 'GRANTED' | 'DENIED' | 'RESTRICTED' | 'UNAVAILABLE';
export type DeviceRuntimePowerState = 'UNKNOWN' | 'BATTERY' | 'CHARGING' | 'AC' | 'LOW_POWER' | 'CRITICAL';
export type DeviceRuntimeThermalState = 'UNKNOWN' | 'NOMINAL' | 'FAIR' | 'SERIOUS' | 'CRITICAL';
export type DeviceRuntimeNetworkState = 'OFFLINE' | 'LOCAL_ONLY' | 'ONLINE' | 'METERED' | 'UNKNOWN';
export type DeviceRuntimeRecoveryState = 'CLEAN' | 'RECOVERING' | 'STALE_HANDLES_INVALIDATED' | 'FAILED_CLOSED';

export type CapabilityEvidenceStatus =
  | 'DECLARED' | 'IMPLEMENTED' | 'RUNTIME_DETECTED' | 'PHYSICALLY_VERIFIED'
  | 'UNAVAILABLE' | 'UNSUPPORTED' | 'BLOCKED_BY_ENVIRONMENT';
export type PhysicalTestClassification = 'REAL' | 'SIMULATED' | 'SAME_HOST' | 'HARDWARE' | 'BLOCKED' | 'UNSUPPORTED';

export interface PhysicalCapabilityEvidence {
  readonly feature: NativeHostFeature | string;
  readonly statuses: readonly CapabilityEvidenceStatus[];
  readonly classification?: PhysicalTestClassification;
  readonly observedAt: string;
  readonly environment: 'PRODUCTION' | 'TEST';
  readonly method: string;
  readonly limitations?: readonly string[];
}
export interface DeviceRuntimeFeature {
  readonly feature: NativeHostFeature | string;
  readonly health: DeviceRuntimeFeatureHealth;
  readonly state: NativeHostFeatureState | 'NOT_APPLICABLE';
  readonly evidence: PhysicalCapabilityEvidence;
  readonly permission?: DeviceRuntimePermissionState;
}
export interface DeviceRuntimeCapabilities {
  readonly platform: string;
  readonly architecture: string;
  readonly features: readonly DeviceRuntimeFeature[];
  readonly transportClasses: readonly ('InternetTransport' | 'LocalNetworkTransport' | 'WiFiDirectTransport' | 'BluetoothTransport' | 'USBTransport' | 'ExternalRadioTransport')[];
}
export interface DeviceRuntimeSession {
  readonly id: DeviceRuntimeSessionId;
  readonly runtimeId: DeviceRuntimeId;
  readonly startedAt: string;
  readonly state: DeviceRuntimeState;
  readonly recovered: boolean;
}
export interface DeviceRuntime {
  readonly id: DeviceRuntimeId;
  readonly platform: string;
  readonly state: DeviceRuntimeState;
  readonly capabilities: DeviceRuntimeCapabilities;
  readonly session: DeviceRuntimeSession;
  readonly power: { readonly state: DeviceRuntimePowerState; readonly charging: boolean | 'UNKNOWN' };
  readonly thermal: { readonly state: DeviceRuntimeThermalState };
  readonly network: { readonly state: DeviceRuntimeNetworkState; readonly localNetworkAvailable: boolean };
  readonly recovery: DeviceRuntimeRecoveryState;
}
export interface PlatformVerificationRecord {
  readonly platform: 'linux' | 'windows' | 'macos' | 'android' | 'ios' | 'unknown';
  readonly implementation: CapabilityEvidenceStatus;
  readonly buildVerified: boolean;
  readonly simulatorVerified: boolean;
  readonly physicalVerified: boolean;
  readonly notes: readonly string[];
  readonly checkedAt: string;
}

export interface PhysicalTestEvidence {
  readonly id: string;
  readonly feature: string;
  readonly classification: PhysicalTestClassification;
  readonly status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED';
  readonly method: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
  readonly limitations?: readonly string[];
}
export interface PhysicalTestResult extends PhysicalTestEvidence {
  readonly evidence: PhysicalCapabilityEvidence;
}

function nowIso(): string { return new Date().toISOString(); }
function id(prefix: string): string { return `${prefix}:${randomBytes(16).toString('hex')}`; }
function statusSet(...statuses: CapabilityEvidenceStatus[]): readonly CapabilityEvidenceStatus[] { return Object.freeze([...new Set(statuses)]); }
function featureEvidence(feature: string, statuses: readonly CapabilityEvidenceStatus[], method: string, environment: 'PRODUCTION' | 'TEST' = 'PRODUCTION', limitations?: readonly string[]): PhysicalCapabilityEvidence {
  return { feature, statuses, observedAt: nowIso(), environment, method, ...(limitations?.length ? { limitations } : {}) };
}

/** A bounded, opaque-byte local TCP transport. IP addresses never become IDs. */
export interface LocalNetworkConnection {
  readonly id: string;
  readonly transport: 'LocalNetworkTransport';
  readonly endpointClass: 'LOCAL_NETWORK';
  readonly state: 'CONNECTING' | 'OPEN' | 'CLOSED';
}
export interface LocalNetworkListener { readonly id: string; readonly port: number; readonly endpointClass: 'LOCAL_NETWORK'; readonly close: () => Promise<void>; }
export interface LocalNetworkTransportOptions { readonly maxFrameBytes?: number; readonly connectTimeoutMs?: number; readonly idleTimeoutMs?: number; }
export class LocalNetworkTransport {
  private readonly sockets = new Map<string, { socket: Socket; connection: LocalNetworkConnection }>();
  private readonly maxFrameBytes: number;
  private readonly connectTimeoutMs: number;
  constructor(options: LocalNetworkTransportOptions = {}) { this.maxFrameBytes = options.maxFrameBytes ?? 1024 * 1024; this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000; }
  async listen(onBytes: (connection: LocalNetworkConnection, bytes: Uint8Array) => void, options: { host?: string; port?: number } = {}): Promise<LocalNetworkListener> {
    const server = createServer(socket => this.attach(socket, onBytes));
    await new Promise<void>((resolvePromise, reject) => { const onError = (error: Error) => reject(error); server.once('error', onError); server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => { server.off('error', onError); resolvePromise(); }); });
    const address = server.address(); if (!address || typeof address === 'string') { await this.closeServer(server); throw new NativeHostError('PLATFORM_FAILURE', 'Local network listener did not expose a port'); }
    const listenerId = id('local-listener'); return { id: listenerId, port: address.port, endpointClass: 'LOCAL_NETWORK', close: async () => { await this.closeServer(server); } };
  }
  async connect(host: string, port: number, onBytes: (connection: LocalNetworkConnection, bytes: Uint8Array) => void, signal?: AbortSignal): Promise<LocalNetworkConnection> {
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) throw new NativeHostError('INVALID_REQUEST', 'Local network endpoint is invalid');
    if (signal?.aborted) throw new NativeHostError('CANCELLED', 'Local network connect cancelled');
    const socket = openSocket({ host, port }); const connection = this.attach(socket, onBytes);
    await new Promise<void>((resolvePromise, reject) => { let done = false; const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolvePromise(); }; const timer = setTimeout(() => { socket.destroy(); finish(new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Local network connect timed out')); }, this.connectTimeoutMs); const abort = () => { socket.destroy(); finish(new NativeHostError('CANCELLED', 'Local network connect cancelled')); }; signal?.addEventListener('abort', abort, { once: true }); socket.once('connect', () => finish()); socket.once('error', error => finish(new NativeHostError('PLATFORM_FAILURE', error.message))); });
    return connection;
  }
  send(connection: LocalNetworkConnection, bytes: Uint8Array): void { const record = this.sockets.get(connection.id); if (!record || record.connection.state !== 'OPEN') throw new NativeHostError('HANDLE_INVALID', 'Local network connection is closed'); if (bytes.byteLength > this.maxFrameBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Local network frame exceeds limit'); const frame = Buffer.allocUnsafe(4 + bytes.byteLength); frame.writeUInt32BE(bytes.byteLength, 0); Buffer.from(bytes).copy(frame, 4); record.socket.write(frame); }
  async close(connection: LocalNetworkConnection): Promise<void> { const record = this.sockets.get(connection.id); if (!record) return; record.socket.destroy(); this.sockets.delete(connection.id); }
  private attach(socket: Socket, onBytes: (connection: LocalNetworkConnection, bytes: Uint8Array) => void): LocalNetworkConnection { const connection = { id: id('local-connection'), transport: 'LocalNetworkTransport' as const, endpointClass: 'LOCAL_NETWORK' as const, state: 'CONNECTING' as const }; const mutable = { ...connection } as { id: string; transport: 'LocalNetworkTransport'; endpointClass: 'LOCAL_NETWORK'; state: 'CONNECTING' | 'OPEN' | 'CLOSED' }; this.sockets.set(mutable.id, { socket, connection: mutable }); let pending = Buffer.alloc(0); socket.on('connect', () => { mutable.state = 'OPEN'; }); socket.on('data', chunk => { pending = Buffer.concat([pending, Buffer.from(chunk)]); while (pending.byteLength >= 4) { const size = pending.readUInt32BE(0); if (size > this.maxFrameBytes) { socket.destroy(new Error('frame too large')); return; } if (pending.byteLength < size + 4) break; const payload = pending.subarray(4, size + 4); pending = pending.subarray(size + 4); onBytes(mutable, new Uint8Array(payload)); } }); socket.once('close', () => { mutable.state = 'CLOSED'; this.sockets.delete(mutable.id); }); socket.once('error', () => { mutable.state = 'CLOSED'; }); if (socket.readyState === 'open') mutable.state = 'OPEN'; return mutable; }
  private closeServer(server: Server): Promise<void> { return new Promise(resolvePromise => server.close(() => resolvePromise())); }
}

/** Native LAN implementation: ordinary infrastructure Wi-Fi and Ethernet
 * intentionally share this one transport class. */
export class NativeLocalNetworkHost implements NativeLanHost {
  async snapshot(_request?: NativeHostRequest): Promise<NativeNetworkSnapshot> { const interfaces = networkInterfaces(); const usable = Object.values(interfaces).flatMap(values => values ?? []).filter(item => !item.internal); return { online: usable.length > 0, lanAvailable: usable.length > 0, metered: 'UNKNOWN', interfaceCount: usable.length }; }
  async discover(options: { maxResults?: number; durationMs?: number }, request: NativeHostRequest): Promise<readonly NativeLanPeer[]> { if (request.capability !== 'lan.discovery') throw new NativeHostError('POLICY_DENIED', 'LAN discovery capability is required'); if ((options.maxResults ?? 32) > 64 || (options.durationMs ?? 0) > 30_000) throw new NativeHostError('RESOURCE_EXHAUSTED', 'LAN discovery bounds exceeded'); await new Promise(resolvePromise => setTimeout(resolvePromise, Math.min(options.durationMs ?? 0, 250))); return []; }
  transport(options?: LocalNetworkTransportOptions): LocalNetworkTransport { return new LocalNetworkTransport(options); }
}

export interface PhysicalFeatureProbeOptions { readonly now?: () => number; readonly commandTimeoutMs?: number; }
/** Best-effort Linux probes. Missing hardware/services are evidence, not an
 * error and are never upgraded to a PASS by this class. */
export class PhysicalFeatureProbe {
  private readonly now: () => number;
  private readonly timeoutMs: number;
  constructor(private readonly platform: string = osPlatform(), options: PhysicalFeatureProbeOptions = {}) { this.now = options.now ?? Date.now; this.timeoutMs = options.commandTimeoutMs ?? 2_000; }
  async probe(feature: NativeHostFeature | string): Promise<PhysicalTestResult> {
    const started = new Date(this.now()).toISOString(); const result = await this.probeInternal(feature); const ended = new Date(this.now()).toISOString();
    return { ...result, id: id('physical-test'), feature, startedAt: started, endedAt: ended, evidence: { ...featureEvidence(feature, result.evidence.statuses, result.method, 'PRODUCTION', result.limitations), classification: result.classification } };
  }
  async all(features: readonly (NativeHostFeature | string)[] = ['secureStorage', 'filesystem', 'processSandbox', 'mediaDecoder', 'clipboard', 'lanDiscovery', 'webRtc', 'bluetooth', 'wifiDirect', 'usb', 'camera', 'microphone', 'location', 'power', 'thermal']): Promise<readonly PhysicalTestResult[]> { const results: PhysicalTestResult[] = []; for (const feature of features) results.push(await this.probe(feature)); return results; }
  private async probeInternal(feature: string): Promise<any> {
    const unsupported = (method: string, limitations: readonly string[] = []) => ({ classification: 'UNSUPPORTED' as const, status: 'SKIPPED' as const, method, limitations, evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'UNSUPPORTED'), method) });
    if (this.platform !== 'linux') return unsupported('platform-probe', [`${this.platform} physical probe is not available in this host process`]);
    if (feature === 'filesystem') {
      const root = await mkdtemp(join(tmpdir(), 'keystone-r0p66-probe-')); const path = join(root, 'probe.bin');
      try { const payload = new Uint8Array([0, 255, 7, 44]); await writeFile(path, payload, { mode: 0o600 }); const read = new Uint8Array(await readFile(path)); if (read.length !== payload.length || read.some((value, index) => value !== payload[index])) throw new Error('filesystem round-trip mismatch'); return { classification: 'REAL' as const, status: 'PASS' as const, method: 'node-filesystem-runtime', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED', 'PHYSICALLY_VERIFIED'), 'node-filesystem-runtime') }; } finally { await rm(root, { recursive: true, force: true }); }
    }
    if (feature === 'processSandbox') {
      const outcome = await this.command(process.execPath, ['-e', 'process.stdout.write("r0p66-process-ok")']);
      return outcome.code === 0 ? { classification: 'REAL' as const, status: 'PASS' as const, method: 'linux-child-process-boundary', limitations: ['No claim of seccomp/namespace isolation without those mechanisms'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED', 'PHYSICALLY_VERIFIED'), 'linux-child-process-boundary', 'PRODUCTION', ['No claim of seccomp/namespace isolation without those mechanisms']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'linux-child-process-boundary', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'linux-child-process-boundary') };
    }
    if (feature === 'clipboard') {
      const available = ['/usr/bin/wl-paste', '/bin/wl-paste', '/usr/local/bin/wl-paste'].some(path => existsSync(path));
      return available ? { classification: 'SAME_HOST' as const, status: 'PASS' as const, method: 'wayland-clipboard-command-probe', limitations: ['Command availability is runtime evidence; the probe did not read the owner clipboard'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'wayland-clipboard-command-probe', 'PRODUCTION', ['No clipboard content was read or logged']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'wayland-clipboard-command-probe', limitations: ['wl-paste is unavailable; no clipboard read was attempted'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'wayland-clipboard-command-probe', 'PRODUCTION', ['No clipboard content was read or logged']) };
    }
    if (feature === 'mediaDecoder') {
      const capabilities = new LinuxNativeMediaHost().capabilities();
      return capabilities.length ? { classification: 'SAME_HOST' as const, status: 'PASS' as const, method: 'linux-media-tool-runtime-detection', limitations: ['Tool availability is runtime evidence; production image/video proof is collected separately through MediaLibraryService'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'linux-media-tool-runtime-detection', 'PRODUCTION', ['No mobile hardware or external decoder claim']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'linux-media-tool-runtime-detection', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'linux-media-tool-runtime-detection') };
    }
    if (feature === 'secureStorage') {
      const storage = createLinuxProductionSecureStorage();
      const available = storage.kind === 'OS_SECURE_STORAGE' && 'probe' in storage && await (storage as NativeSecureStorage & { probe: () => Promise<boolean> }).probe();
      return available ? { classification: 'REAL' as const, status: 'PASS' as const, method: 'linux-secret-service-probe', limitations: ['Hardware-backed enclave not established'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED', 'PHYSICALLY_VERIFIED'), 'linux-secret-service-probe', 'PRODUCTION', ['OS-backed Secret Service; hardware-backed enclave not established']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'linux-secret-service-probe', limitations: ['Secret Service unavailable or inaccessible'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'linux-secret-service-probe') };
    }
    if (feature === 'lanDiscovery') {
      const snap = await new NativeLocalNetworkHost().snapshot();
      return snap.lanAvailable ? { classification: 'SAME_HOST' as const, status: 'PASS' as const, method: 'host-network-interface-probe', limitations: ['Loopback/same-host only; no physical peer was exercised'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'host-network-interface-probe', 'PRODUCTION', ['Interface presence is not a two-device physical LAN test']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'host-network-interface-probe', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'host-network-interface-probe') };
    }
    if (feature === 'webRtc') return typeof (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function' ? { classification: 'SAME_HOST' as const, status: 'SKIPPED' as const, method: 'runtime-global-probe', limitations: ['Native media transport was not exercised'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'runtime-global-probe', 'PRODUCTION', ['No native RTCPeerConnection E2E harness is available']) } : unsupported('runtime-global-probe', ['RTCPeerConnection is not available']);
    if (feature === 'bluetooth') {
      const hardware = existsSync('/sys/class/bluetooth') && (await this.command('bluetoothctl', ['show'])).code === 0;
      return hardware ? { classification: 'HARDWARE' as const, status: 'SKIPPED' as const, method: 'bluetooth-controller-probe', limitations: ['Controller detected; bounded scan/advertise was not started (powered-off/permission-safe probe); no Social Identity was advertised'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'bluetooth-controller-probe', 'PRODUCTION', ['Controller presence is not a peer exchange']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'bluetooth-controller-probe', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'bluetooth-controller-probe') };
    }
    if (feature === 'wifiDirect') return unsupported('linux-wifi-direct-probe', ['Wi-Fi Direct adapter is not verified in this runtime']);
    if (feature === 'usb') return existsSync('/sys/bus/usb/devices') ? { classification: 'HARDWARE' as const, status: 'SKIPPED' as const, method: 'linux-usb-bus-probe', limitations: ['Bus presence detected; no endpoint was opened'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'linux-usb-bus-probe', 'PRODUCTION', ['No USB serial or device identity is exposed']) } : unsupported('linux-usb-bus-probe');
    if (feature === 'camera') return existsSync('/dev/video0') ? { classification: 'HARDWARE' as const, status: 'SKIPPED' as const, method: 'video-device-probe', limitations: ['Device node detected; no capture was started by the probe'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'video-device-probe', 'PRODUCTION', ['No capture was started']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'video-device-probe', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'video-device-probe') };
    if (feature === 'microphone') return existsSync('/dev/snd') ? { classification: 'HARDWARE' as const, status: 'SKIPPED' as const, method: 'sound-device-probe', limitations: ['Device node detected; no recording was started by the probe'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'sound-device-probe', 'PRODUCTION', ['No recording was started']) } : { classification: 'BLOCKED' as const, status: 'BLOCKED' as const, method: 'sound-device-probe', evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'BLOCKED_BY_ENVIRONMENT'), 'sound-device-probe') };
    if (feature === 'location') return unsupported('native-location-adapter', ['No verified OS location adapter is available in this host process; no IP/Wi-Fi/external geolocation fallback is used']);
    if (feature === 'power' || feature === 'thermal') return { classification: 'REAL' as const, status: 'SKIPPED' as const, method: 'linux-coarse-power-probe', limitations: ['Coarse host signal only'], evidence: featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED', 'RUNTIME_DETECTED'), 'linux-coarse-power-probe', 'PRODUCTION', ['Desktop thermal/power values are not battery claims']) };
    return unsupported('feature-probe');
  }
  private command(command: string, args: readonly string[]): Promise<{ code: number | null }> { return new Promise(resolvePromise => { const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'ignore'], shell: false }); const timer = setTimeout(() => child.kill('SIGKILL'), this.timeoutMs); child.once('close', code => { clearTimeout(timer); resolvePromise({ code }); }); child.once('error', () => { clearTimeout(timer); resolvePromise({ code: null }); }); }); }
}

export class PhysicalE2EHarness {
  constructor(readonly probe = new PhysicalFeatureProbe()) {}
  async run(features?: readonly (NativeHostFeature | string)[]): Promise<readonly PhysicalTestResult[]> { return this.probe.all(features); }
  /** TestHost is useful for protocol tests, never for physical evidence. */
  static simulated(feature: string, method = 'test-adapter'): PhysicalTestResult { const at = nowIso(); const evidence = { ...featureEvidence(feature, statusSet('DECLARED', 'IMPLEMENTED'), method, 'TEST', ['Test adapter cannot establish physical verification']), classification: 'SIMULATED' as const }; return { id: id('physical-test'), feature, classification: 'SIMULATED', status: 'PASS', method, startedAt: at, endedAt: at, limitations: ['Test adapter cannot establish physical verification'], evidence }; }
}

export interface DeviceRuntimeStore { load(): Promise<Partial<DeviceRuntime> | undefined>; save(snapshot: Partial<DeviceRuntime>): Promise<void>; }
export class AtomicDeviceRuntimeStore implements DeviceRuntimeStore {
  constructor(readonly path = join(tmpdir(), 'keystone-device-runtime.json')) {}
  async load(): Promise<Partial<DeviceRuntime> | undefined> { try { return JSON.parse(await readFile(this.path, 'utf8')) as Partial<DeviceRuntime>; } catch { return undefined; } }
  async save(snapshot: Partial<DeviceRuntime>): Promise<void> { await mkdir(resolve(this.path, '..'), { recursive: true }); const temp = `${this.path}.${id('tmp')}`; await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 }); await rename(temp, this.path); }
}

export class DeviceRuntimeService {
  constructor(private readonly options: { readonly store?: DeviceRuntimeStore; readonly probe?: PhysicalFeatureProbe; readonly platform?: string } = {}) {}
  async start(): Promise<DeviceRuntime> {
    const store = this.options.store ?? new AtomicDeviceRuntimeStore(); const previous = await store.load(); const platformName = this.options.platform ?? osPlatform(); const evidence = await (this.options.probe ?? new PhysicalFeatureProbe(platformName)).all();
    const features: DeviceRuntimeFeature[] = evidence.map(item => {
      const statuses = item.evidence.statuses;
      const physicallyVerified = statuses.includes('PHYSICALLY_VERIFIED');
      const blocked = statuses.includes('BLOCKED_BY_ENVIRONMENT');
      const unsupported = statuses.includes('UNSUPPORTED');
      return { feature: item.feature as NativeHostFeature, health: physicallyVerified ? 'HEALTHY' : blocked ? 'DEGRADED' : statuses.includes('RUNTIME_DETECTED') ? 'DEGRADED' : 'UNKNOWN', state: physicallyVerified ? 'AVAILABLE' : blocked ? 'UNAVAILABLE' : unsupported ? 'UNSUPPORTED' : statuses.includes('RUNTIME_DETECTED') ? 'DEGRADED' : 'UNAVAILABLE', evidence: item.evidence };
    });
    const runtimeId: DeviceRuntimeId = (previous?.id as DeviceRuntimeId | undefined) ?? `device-runtime:${id('local')}`; const session: DeviceRuntimeSession = { id: `device-session:${id('session')}`, runtimeId, startedAt: nowIso(), state: 'RUNNING', recovered: Boolean(previous) };
    const local = new NativeLocalNetworkHost(); const network = await local.snapshot(); const runtime: DeviceRuntime = { id: runtimeId, platform: platformName, state: 'RUNNING', capabilities: { platform: platformName, architecture: arch(), features, transportClasses: ['InternetTransport', 'LocalNetworkTransport', 'WiFiDirectTransport', 'BluetoothTransport', 'USBTransport', 'ExternalRadioTransport'] }, session, power: { state: 'UNKNOWN', charging: 'UNKNOWN' }, thermal: { state: 'UNKNOWN' }, network: { state: network.online ? 'LOCAL_ONLY' : 'OFFLINE', localNetworkAvailable: network.lanAvailable }, recovery: previous ? 'STALE_HANDLES_INVALIDATED' : 'CLEAN' }; await store.save(runtime); return runtime;
  }
}

export function platformVerificationRecord(platform: PlatformVerificationRecord['platform'], options: Partial<PlatformVerificationRecord> = {}): PlatformVerificationRecord { return { platform, implementation: options.implementation ?? 'IMPLEMENTED', buildVerified: options.buildVerified ?? false, simulatorVerified: options.simulatorVerified ?? false, physicalVerified: options.physicalVerified ?? false, notes: options.notes ?? ['Runtime evidence must be collected on the target platform'], checkedAt: nowIso() }; }
