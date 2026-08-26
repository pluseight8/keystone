/**
 * R0P84 Device Continuity.
 *
 * Continuity is an explicit, local-first intent channel.  It is deliberately
 * above PersonalDeviceMesh and ConnectivityFabric: the mesh remains the only
 * owned-device trust authority, while Fabric remains the only delivery seam.
 * A handoff carries a bounded, encrypted reference/context payload.  It never
 * carries a process, command, credential, browser session, or file bytes.
 */

import { canonicalJson } from './crypto.js';
import type { DeviceSessionKeys } from './identity.js';
import type { Envelope, EnvelopeSecurity, KeystoneDeliveryInterface, UnsignedEnvelope } from './connectivity.js';
import {
  PersonalDeviceMesh,
  type DeviceContinuityCapability,
  type DeviceTrustRecord,
} from './personal-device-mesh.js';
import type { NodeId } from './types.js';
import { SodiumDirectMessageCipher } from './social/messaging.js';

export const CONTINUITY_PROTOCOL = 'keystone.continuity.r0p84' as const;
export const CONTINUITY_VERSION = 1 as const;
export const CONTINUITY_ENVELOPE_TYPE = 'continuity.handoff' as const;
export const CONTINUITY_MAX_HANDOFF_BYTES = 256 * 1024;
export const CONTINUITY_MAX_VIEW_CONTEXT_BYTES = 32 * 1024;
export const CONTINUITY_MAX_WORKSPACE_TABS = 32;
export const CONTINUITY_MAX_WORKSPACE_PANES = 16;
export const CONTINUITY_MAX_CLIPBOARD_BYTES = 256 * 1024;
export const CONTINUITY_MAX_INBOX_ITEMS = 256;
export const CONTINUITY_MAX_HISTORY_ITEMS = 256;
export const CONTINUITY_MAX_DEDUP_ITEMS = 4_096;
export const CONTINUITY_MAX_PENDING_HANDOFFS = 256;
export const CONTINUITY_DEFAULT_TTL_MS = 24 * 60 * 60_000;
export const CONTINUITY_CLIPBOARD_TTL_MS = 5 * 60_000;
export const CONTINUITY_MAX_ATTEMPTS = 8;

export type HandoffObjectType =
  | 'file'
  | 'vault'
  | 'document'
  | 'browser'
  | 'place'
  | 'route'
  | 'mail'
  | 'publication'
  | 'collaboration'
  | 'messaging'
  | 'workspace'
  | 'clipboard';

export type HandoffAction = 'OPEN' | 'CONTINUE';
export type HandoffStatus =
  | 'QUEUED'
  | 'SENDING'
  | 'DELIVERED_TO_DEVICE'
  | 'ACCEPTED'
  | 'OPENED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export type ContinuityErrorCode =
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'UNKNOWN_DEVICE'
  | 'REVOKED'
  | 'UNSUPPORTED'
  | 'REPLAY'
  | 'EXPIRED'
  | 'RESOURCE_LIMIT'
  | 'UNAVAILABLE'
  | 'INTEGRITY'
  | 'NOT_FOUND'
  | 'CANCELLED';

export class ContinuityError extends Error {
  constructor(readonly code: ContinuityErrorCode, message: string) {
    super(message);
    this.name = 'ContinuityError';
  }
}

export interface HandoffPlaceSnapshot {
  readonly displayName: string;
  readonly address?: string;
  readonly category?: string;
  readonly approximateRegion?: string;
  readonly coordinates?: { readonly latitude: number; readonly longitude: number };
}

export interface HandoffRouteEndpoint {
  readonly type: 'PLACE' | 'COORDINATE';
  readonly placeId?: string;
  readonly label?: string;
  readonly coordinates?: { readonly latitude: number; readonly longitude: number };
}

export interface HandoffWorkspaceTab {
  readonly id: string;
  readonly type: Exclude<HandoffObjectType, 'workspace' | 'clipboard'>;
  readonly objectId: string;
  readonly uri?: string;
  readonly url?: string;
  readonly title?: string;
  readonly viewContext?: ContinuationViewContext;
}

export interface HandoffWorkspacePane {
  readonly id: string;
  readonly tabIds: readonly string[];
  readonly activeTabId?: string;
}

export type HandoffObjectReference =
  | { readonly version: 1; readonly kind: 'file'; readonly objectId: string; readonly uri?: string; readonly label?: string; readonly contentId?: string; readonly filename?: string; readonly mimeType?: string; readonly sizeBytes?: number }
  | { readonly version: 1; readonly kind: 'vault' | 'document'; readonly objectId: string; readonly uri?: string; readonly label?: string; readonly vaultId?: string }
  | { readonly version: 1; readonly kind: 'browser'; readonly objectId: string; readonly url: string; readonly title?: string; readonly scrollY?: number }
  | { readonly version: 1; readonly kind: 'place'; readonly objectId: string; readonly placeId: string; readonly uri?: string; readonly displayName: string; readonly snapshot?: HandoffPlaceSnapshot }
  | { readonly version: 1; readonly kind: 'route'; readonly objectId: string; readonly routeId?: string; readonly mode?: 'WALKING' | 'DRIVING' | 'CYCLING' | 'TRANSIT'; readonly origin?: HandoffRouteEndpoint; readonly destination?: HandoffRouteEndpoint; readonly snapshot?: Record<string, unknown> }
  | { readonly version: 1; readonly kind: 'mail'; readonly objectId: string; readonly accountId: string; readonly threadId?: string; readonly messageId?: string; readonly subject?: string }
  | { readonly version: 1; readonly kind: 'publication'; readonly objectId: string; readonly publicationId: string; readonly revisionAddress?: string; readonly title?: string }
  | { readonly version: 1; readonly kind: 'collaboration'; readonly objectId: string; readonly objectKind?: string; readonly spaceId?: string; readonly label?: string }
  | { readonly version: 1; readonly kind: 'messaging'; readonly objectId: string; readonly conversationId: string; readonly messageId?: string; readonly label?: string }
  | { readonly version: 1; readonly kind: 'workspace'; readonly objectId: string; readonly workspaceId?: string; readonly label?: string; readonly tabs: readonly HandoffWorkspaceTab[]; readonly panes?: readonly HandoffWorkspacePane[]; readonly activeTabId?: string }
  | { readonly version: 1; readonly kind: 'clipboard'; readonly objectId: string; readonly format: 'text' | 'url' | 'image-reference' | 'file-reference'; readonly text?: string; readonly reference?: string };

export interface ContinuationViewContext {
  readonly selectedTab?: string;
  readonly documentPosition?: number;
  readonly cursor?: { readonly anchor: number; readonly head: number };
  readonly canvasViewport?: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly workboard?: { readonly columnId?: string; readonly cardId?: string };
  readonly mapViewport?: { readonly latitude: number; readonly longitude: number; readonly zoom: number };
  readonly mailThreadId?: string;
  readonly mailMessageId?: string;
  readonly publicationRevision?: string;
  readonly browserUrl?: string;
  readonly browserScrollY?: number;
}

export type ContinuationState =
  | { readonly version: 1; readonly kind: 'DRAFT_REFERENCE'; readonly draftId: string; readonly revision?: string }
  | { readonly version: 1; readonly kind: 'WORKSPACE_LAYOUT'; readonly activeTabId?: string; readonly panes: readonly HandoffWorkspacePane[] };

export interface ContinuityHandoffPayload {
  readonly version: 1;
  readonly protocol: typeof CONTINUITY_PROTOCOL;
  readonly type: HandoffObjectType;
  readonly action: HandoffAction;
  readonly reference: HandoffObjectReference;
  readonly viewContext?: ContinuationViewContext;
  readonly continuationState?: ContinuationState;
  readonly requiredCapability: DeviceContinuityCapability;
  readonly expiresAt: string;
}

export interface HandoffRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly sourceDeviceId: NodeId;
  readonly targetDeviceId: NodeId;
  readonly payload: ContinuityHandoffPayload;
  readonly status: HandoffStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError?: string;
}

export interface DeviceInboxItem {
  readonly version: 1;
  readonly requestId: string;
  readonly sourceDeviceId: NodeId;
  readonly sourceLabel: string;
  readonly receivedAt: string;
  readonly payload: ContinuityHandoffPayload;
  readonly status: HandoffStatus;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export interface ContinuationHistoryEntry {
  readonly version: 1;
  readonly requestId: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly sourceDeviceId: NodeId;
  readonly targetDeviceId: NodeId;
  readonly type: HandoffObjectType;
  readonly action: HandoffAction;
  readonly status: HandoffStatus;
  readonly at: string;
}

export interface ContinuityDevice {
  readonly deviceId: NodeId;
  readonly label: string;
  readonly platform: string;
  readonly trustState: 'TRUSTED' | 'REVOKED' | 'PENDING' | 'EXPIRED';
  readonly capabilities: readonly DeviceContinuityCapability[];
  readonly availability: 'AVAILABLE' | 'RECENTLY_AVAILABLE' | 'OFFLINE' | 'WAITING_FOR_ROUTE' | 'UNKNOWN';
  readonly lastSeenAt?: string;
  readonly isCurrent: boolean;
}

export interface ContinuityCapabilityDecision {
  readonly allowed: boolean;
  readonly state: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN';
  readonly capability: DeviceContinuityCapability;
  readonly reason?: string;
}

export interface ContinuityCipher {
  seal(input: { readonly senderDeviceId: NodeId; readonly targetDeviceId: NodeId; readonly value: ContinuityHandoffPayload }): Promise<unknown>;
  open(input: { readonly senderDeviceId: NodeId; readonly targetDeviceId: NodeId; readonly value: unknown }): Promise<ContinuityHandoffPayload>;
}

/** Test/host adapter using the existing recipient-keyed application cipher.
 * The production-shaped ContinuityService still requires a cipher boundary;
 * this adapter is useful for native hosts that already own device sessions. */
export class SodiumContinuityCipher implements ContinuityCipher {
  private readonly cipher = new SodiumDirectMessageCipher();
  private readonly peers: ReadonlyMap<NodeId, DeviceSessionKeys>;

  constructor(private readonly local: DeviceSessionKeys, peers: ReadonlyMap<NodeId, DeviceSessionKeys> | readonly DeviceSessionKeys[]) {
    this.peers = Array.isArray(peers)
      ? new Map<NodeId, DeviceSessionKeys>((peers as readonly DeviceSessionKeys[]).map(peer => [peer.nodeId, peer] as const))
      : peers as ReadonlyMap<NodeId, DeviceSessionKeys>;
  }

  async seal(input: { readonly senderDeviceId: NodeId; readonly targetDeviceId: NodeId; readonly value: ContinuityHandoffPayload }): Promise<unknown> {
    if (input.senderDeviceId !== this.local.nodeId) throw new ContinuityError('UNAUTHORIZED', 'Continuity cipher sender mismatch');
    const peer = this.peers.get(input.targetDeviceId);
    if (!peer) throw new ContinuityError('UNAVAILABLE', 'Target encryption key is unavailable');
    const encrypted = await this.cipher.encrypt(canonicalJson(input.value), this.local.encryptionPrivateKey, peer.encryptionPublicKey);
    return { version: 1, algorithm: encrypted.algorithm, nonce: encrypted.nonce, ciphertext: encrypted.ciphertext };
  }

  async open(input: { readonly senderDeviceId: NodeId; readonly targetDeviceId: NodeId; readonly value: unknown }): Promise<ContinuityHandoffPayload> {
    if (input.targetDeviceId !== this.local.nodeId) throw new ContinuityError('UNAUTHORIZED', 'Continuity cipher target mismatch');
    const peer = this.peers.get(input.senderDeviceId);
    if (!peer) throw new ContinuityError('UNAUTHORIZED', 'Source encryption key is unavailable');
    try {
      const plaintext = await this.cipher.decrypt(input.value, this.local.encryptionPrivateKey, peer.encryptionPublicKey);
      const parsed = JSON.parse(plaintext) as unknown;
      return validateHandoffPayload(parsed);
    } catch (error) {
      if (error instanceof ContinuityError) throw error;
      throw new ContinuityError('INTEGRITY', 'Continuity payload authentication failed');
    }
  }
}

export interface ContinuityStorage {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

export class InMemoryContinuityStorage implements ContinuityStorage {
  private value?: unknown;
  async read(): Promise<unknown | undefined> { return this.value === undefined ? undefined : structuredClone(this.value); }
  async write(value: unknown): Promise<void> { this.value = structuredClone(value); }
}

export interface ContinuityOpenContext {
  readonly requestId: string;
  readonly sourceDeviceId: NodeId;
  readonly payload: ContinuityHandoffPayload;
}

export interface ContinuityOpenResult {
  readonly status: 'OPENED' | 'ACCEPTED' | 'UNSUPPORTED';
  readonly reason?: string;
}

export interface ContinuityAdapter {
  readonly type: HandoffObjectType;
  readonly capability: DeviceContinuityCapability;
  createReference(input: unknown): HandoffObjectReference;
  validateIncoming(reference: unknown): HandoffObjectReference;
  openOnTarget?(context: ContinuityOpenContext): Promise<ContinuityOpenResult> | ContinuityOpenResult;
}

export interface ContinuityAdapterOptions {
  readonly open?: Partial<Record<HandoffObjectType, (context: ContinuityOpenContext) => Promise<ContinuityOpenResult> | ContinuityOpenResult>>;
}

const TYPE_CAPABILITY: Readonly<Record<Exclude<HandoffObjectType, 'clipboard'>, DeviceContinuityCapability>> = {
  file: 'CAN_RECEIVE_FILES',
  vault: 'CAN_OPEN_VAULT',
  document: 'CAN_OPEN_DOCUMENT',
  browser: 'CAN_OPEN_BROWSER',
  place: 'CAN_OPEN_MAPS',
  route: 'CAN_OPEN_MAPS',
  mail: 'CAN_OPEN_MAIL',
  publication: 'CAN_OPEN_PUBLICATION',
  collaboration: 'CAN_OPEN_COLLABORATION',
  messaging: 'CAN_OPEN_MESSAGING',
  workspace: 'CAN_OPEN_WORKSPACE',
};

export function continuityCapabilityFor(type: HandoffObjectType): DeviceContinuityCapability {
  return type === 'clipboard' ? 'CAN_RECEIVE_CLIPBOARD' : TYPE_CAPABILITY[type];
}

/** A bounded reference registry.  Hosts can replace individual open handlers
 * without allowing the Continuity service to reach into application state. */
export function createDefaultContinuityAdapters(options: ContinuityAdapterOptions = {}): readonly ContinuityAdapter[] {
  const adapters: ContinuityAdapter[] = (Object.keys(TYPE_CAPABILITY) as Array<Exclude<HandoffObjectType, 'clipboard'>>).map(type => ({
    type,
    capability: TYPE_CAPABILITY[type],
    createReference: (input: unknown) => createReference(type, input),
    validateIncoming: (reference: unknown) => validateReference(reference, type),
    ...(options.open?.[type] ? { openOnTarget: options.open[type] } : {}),
  } satisfies ContinuityAdapter));
  adapters.push({
    type: 'clipboard',
    capability: 'CAN_RECEIVE_CLIPBOARD',
    createReference: (input: unknown) => validateReference(input, 'clipboard'),
    validateIncoming: (reference: unknown) => validateReference(reference, 'clipboard'),
    ...(options.open?.clipboard ? { openOnTarget: options.open.clipboard } : {}),
  });
  return adapters;
}

export interface ContinuityTrustAuthority {
  readonly localDeviceId: NodeId;
  readonly identityId: NodeId;
  readonly authorityDeviceId: NodeId;
  readonly trustEpoch: number;
  listDevices(): Promise<readonly DeviceTrustRecord[]>;
  getDevice(deviceId: NodeId): Promise<DeviceTrustRecord | undefined>;
  isTrustedDevice(deviceId: NodeId): boolean;
  isRevoked(deviceId: NodeId): boolean;
}

export interface ContinuityServiceOptions {
  readonly devices: ContinuityTrustAuthority | PersonalDeviceMesh;
  readonly delivery: KeystoneDeliveryInterface;
  readonly security: EnvelopeSecurity;
  readonly cipher: ContinuityCipher;
  readonly storage?: ContinuityStorage;
  readonly adapters?: readonly ContinuityAdapter[];
  readonly localCapabilities?: readonly DeviceContinuityCapability[];
  readonly now?: () => number;
  readonly maxInboxItems?: number;
  readonly maxHistoryItems?: number;
  readonly maxPendingHandoffs?: number;
  readonly maxDedupItems?: number;
  readonly onIncoming?: (item: DeviceInboxItem) => void | Promise<void>;
  /** Optional explicit host action. It updates a clipboard surface only; it
   * never injects text into a terminal, form, browser or message composer. */
  readonly onClipboardReceived?: (value: { readonly text?: string; readonly format: Extract<HandoffObjectReference, { readonly kind: 'clipboard' }>; readonly sourceDeviceId: NodeId }) => void | Promise<void>;
}

interface ContinuityState {
  readonly version: 1;
  readonly outbox: Record<string, HandoffRequest>;
  readonly inbox: Record<string, DeviceInboxItem>;
  readonly history: Record<string, ContinuationHistoryEntry>;
  readonly seen: Record<string, { readonly expiresAt: string; readonly status: HandoffStatus }>;
  readonly cancelled: Record<string, true>;
  readonly automaticClipboardEnabled: boolean;
}

interface ContinuityWireBase {
  readonly version: 1;
  readonly protocol: typeof CONTINUITY_PROTOCOL;
  readonly kind: 'DELIVER' | 'ACK' | 'OPENED' | 'CANCEL';
  readonly requestId: string;
  readonly sourceDeviceId: NodeId;
  readonly targetDeviceId: NodeId;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly trustEpoch: number;
}

interface ContinuityDeliverWire extends ContinuityWireBase {
  readonly kind: 'DELIVER';
  readonly ciphertext: unknown;
}

interface ContinuityAckWire extends ContinuityWireBase {
  readonly kind: 'ACK' | 'OPENED';
  readonly status: HandoffStatus;
  readonly reason?: string;
}

interface ContinuityCancelWire extends ContinuityWireBase { readonly kind: 'CANCEL'; }
type ContinuityWire = ContinuityDeliverWire | ContinuityAckWire | ContinuityCancelWire;

export class ContinuityService {
  private readonly devices: ContinuityTrustAuthority;
  private readonly delivery: KeystoneDeliveryInterface;
  private readonly security: EnvelopeSecurity;
  private readonly cipher: ContinuityCipher;
  private readonly storage: ContinuityStorage;
  private readonly adapters = new Map<HandoffObjectType, ContinuityAdapter>();
  private readonly localCapabilities?: ReadonlySet<DeviceContinuityCapability>;
  private readonly now: () => number;
  private readonly limits: { readonly inbox: number; readonly history: number; readonly pending: number; readonly dedup: number };
  private readonly onIncoming?: ContinuityServiceOptions['onIncoming'];
  private readonly onClipboardReceived?: ContinuityServiceOptions['onClipboardReceived'];
  private state: ContinuityState = emptyState();
  private writes: Promise<void> = Promise.resolve();
  private readonly readyPromise: Promise<void>;
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(options: ContinuityServiceOptions) {
    if (!options.devices || !options.delivery || !options.security || !options.cipher) throw new ContinuityError('INVALID_ARGUMENT', 'ContinuityService requires R0P73 trust, Fabric delivery, envelope security and an E2E cipher');
    this.devices = options.devices;
    this.delivery = options.delivery;
    this.security = options.security;
    this.cipher = options.cipher;
    this.storage = options.storage ?? new InMemoryContinuityStorage();
    this.localCapabilities = options.localCapabilities ? new Set(options.localCapabilities) : undefined;
    this.now = options.now ?? Date.now;
    this.limits = {
      inbox: clampInt(options.maxInboxItems ?? CONTINUITY_MAX_INBOX_ITEMS, 1, CONTINUITY_MAX_INBOX_ITEMS),
      history: clampInt(options.maxHistoryItems ?? CONTINUITY_MAX_HISTORY_ITEMS, 1, CONTINUITY_MAX_HISTORY_ITEMS),
      pending: clampInt(options.maxPendingHandoffs ?? CONTINUITY_MAX_PENDING_HANDOFFS, 1, CONTINUITY_MAX_PENDING_HANDOFFS),
      dedup: clampInt(options.maxDedupItems ?? CONTINUITY_MAX_DEDUP_ITEMS, 1, CONTINUITY_MAX_DEDUP_ITEMS),
    };
    this.onIncoming = options.onIncoming;
    this.onClipboardReceived = options.onClipboardReceived;
    for (const adapter of options.adapters ?? createDefaultContinuityAdapters()) this.registerAdapter(adapter);
    this.unsubscribe = this.delivery.onMessage(envelope => { void this.receive(envelope).catch(() => undefined); });
    this.readyPromise = this.hydrate();
  }

  async ready(): Promise<void> { await this.readyPromise; }

  registerAdapter(adapter: ContinuityAdapter): void {
    if (!adapter || !TYPE_CAPABILITY[adapter.type as Exclude<HandoffObjectType, 'clipboard'>] && adapter.type !== 'clipboard' || !adapter.capability || typeof adapter.createReference !== 'function' || typeof adapter.validateIncoming !== 'function') throw new ContinuityError('INVALID_ARGUMENT', 'Continuity adapter is incomplete');
    if (adapter.capability !== continuityCapabilityFor(adapter.type)) throw new ContinuityError('INVALID_ARGUMENT', 'Continuity adapter capability does not match its object type');
    this.adapters.set(adapter.type, adapter);
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async listDevices(): Promise<readonly ContinuityDevice[]> {
    await this.ready();
    const records = await this.devices.listDevices();
    const now = this.now();
    return records.map(record => ({
      deviceId: record.deviceId,
      label: record.label,
      platform: record.platform,
      trustState: record.state,
      capabilities: record.capabilities.continuityCapabilities ?? [],
      availability: this.availability(record, now),
      ...(record.lastSeenAt ? { lastSeenAt: record.lastSeenAt } : {}),
      isCurrent: record.deviceId === this.devices.localDeviceId,
    }));
  }

  async capability(targetDeviceId: NodeId, type: HandoffObjectType): Promise<ContinuityCapabilityDecision> {
    await this.ready();
    const required = continuityCapabilityFor(type);
    const record = targetDeviceId === this.devices.localDeviceId ? undefined : await this.devices.getDevice(targetDeviceId);
    if (targetDeviceId !== this.devices.localDeviceId && !record && targetDeviceId !== this.devices.authorityDeviceId) return { allowed: false, state: 'UNSUPPORTED', capability: required, reason: 'Target is not enrolled in the owner device mesh' };
    if (record?.state === 'REVOKED' || this.devices.isRevoked(targetDeviceId)) return { allowed: false, state: 'UNSUPPORTED', capability: required, reason: 'Target device is revoked' };
    const advertised = targetDeviceId === this.devices.localDeviceId ? this.localCapabilities : record?.capabilities.continuityCapabilities;
    if (!advertised) return { allowed: true, state: 'UNKNOWN', capability: required, reason: 'Target has not advertised a continuity capability set' };
    return hasCapability(advertised, required)
      ? { allowed: true, state: 'SUPPORTED', capability: required }
      : { allowed: false, state: 'UNSUPPORTED', capability: required, reason: `Target does not advertise ${required}` };
  }

  async sendToDevice(input: {
    readonly targetDeviceId: NodeId;
    readonly type: Exclude<HandoffObjectType, 'clipboard'>;
    readonly reference?: unknown;
    readonly value?: unknown;
    readonly action?: HandoffAction;
    readonly viewContext?: ContinuationViewContext;
    readonly continuationState?: ContinuationState;
    readonly ttlMs?: number;
  }): Promise<HandoffRequest> {
    return this.queueHandoff(input.targetDeviceId, input.type, input.reference ?? input.value, input.action ?? 'OPEN', input.viewContext, input.continuationState, input.ttlMs);
  }

  async continueOnDevice(input: Omit<Parameters<ContinuityService['sendToDevice']>[0], 'action'>): Promise<HandoffRequest> {
    return this.sendToDevice({ ...input, action: 'CONTINUE' });
  }

  async sendClipboard(input: { readonly targetDeviceId: NodeId; readonly text?: string; readonly format?: 'text' | 'url'; readonly reference?: string; readonly ownerConfirmed: true; readonly ttlMs?: number }): Promise<HandoffRequest> {
    await this.ready();
    if (input.ownerConfirmed !== true) throw new ContinuityError('UNAUTHORIZED', 'Clipboard handoff requires explicit owner confirmation');
    const format = input.format ?? (input.text && /^https?:\/\//i.test(input.text) ? 'url' : 'text');
    if (format === 'url' && input.text && !safeExternalUrl(input.text)) throw new ContinuityError('INVALID_ARGUMENT', 'Clipboard URL is not allowed');
    if (input.text !== undefined && byteLength(input.text) > CONTINUITY_MAX_CLIPBOARD_BYTES) throw new ContinuityError('RESOURCE_LIMIT', 'Clipboard handoff exceeds the bounded payload size');
    if (input.text === undefined && (!input.reference || input.reference.length > 2_048)) throw new ContinuityError('INVALID_ARGUMENT', 'Clipboard reference is invalid');
    const reference: HandoffObjectReference = { version: 1, kind: 'clipboard', objectId: `clipboard:${crypto.randomUUID()}`, format, ...(input.text === undefined ? { reference: input.reference } : { text: input.text }) };
    return this.queueHandoff(input.targetDeviceId, 'clipboard', reference, 'OPEN', undefined, undefined, input.ttlMs ?? CONTINUITY_CLIPBOARD_TTL_MS);
  }

  async setAutomaticClipboardContinuity(enabled: boolean, ownerConfirmed = false): Promise<boolean> {
    await this.ready();
    if (enabled && ownerConfirmed !== true) throw new ContinuityError('UNAUTHORIZED', 'Enabling automatic clipboard continuity requires explicit owner confirmation');
    this.state = { ...this.state, automaticClipboardEnabled: enabled };
    await this.persist();
    this.emit();
    return enabled;
  }

  async automaticClipboardContinuityEnabled(): Promise<boolean> { await this.ready(); return this.state.automaticClipboardEnabled; }

  async outbox(): Promise<readonly HandoffRequest[]> { await this.ready(); this.expireState(); return Object.values(this.state.outbox).sort(sortRecent).map(clone); }

  async inbox(): Promise<readonly DeviceInboxItem[]> { await this.ready(); this.expireState(); return Object.values(this.state.inbox).sort(sortRecent).map(clone); }

  async history(): Promise<readonly ContinuationHistoryEntry[]> { await this.ready(); return Object.values(this.state.history).sort(sortRecent).map(clone); }

  async get(requestId: string): Promise<HandoffRequest | DeviceInboxItem | undefined> { await this.ready(); return clone(this.state.outbox[requestId] ?? this.state.inbox[requestId]); }

  async flush(targetDeviceId?: NodeId): Promise<{ readonly attempted: number; readonly delivered: number; readonly pending: number }> {
    await this.ready();
    if (this.closed) return { attempted: 0, delivered: 0, pending: this.pendingCount() };
    let attempted = 0;
    let delivered = 0;
    const values = Object.values(this.state.outbox)
      .filter(value => (!targetDeviceId || value.targetDeviceId === targetDeviceId) && (value.status === 'QUEUED' || value.status === 'SENDING') && value.nextAttemptAt <= this.now())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 64);
    for (const value of values) {
      if (isExpiredAt(value.payload.expiresAt, this.now())) { this.updateOutbox(value.requestId, 'EXPIRED'); continue; }
      if (!this.isEligibleTarget(value.targetDeviceId)) { this.updateOutbox(value.requestId, 'FAILED', 'Target device is unavailable or revoked'); continue; }
      attempted += 1;
      const attempts = value.attempts + 1;
      this.state = { ...this.state, outbox: { ...this.state.outbox, [value.requestId]: { ...value, status: 'SENDING', attempts, updatedAt: nowIso(this.now), nextAttemptAt: this.now() + retryDelay(attempts) } } };
      await this.persist();
      try {
        await this.delivery.connect(value.targetDeviceId);
        await this.sendWire(value.targetDeviceId, {
          version: 1, protocol: CONTINUITY_PROTOCOL, kind: 'DELIVER', requestId: value.requestId,
          sourceDeviceId: value.sourceDeviceId, targetDeviceId: value.targetDeviceId, issuedAt: value.createdAt,
          expiresAt: value.payload.expiresAt, trustEpoch: this.devices.trustEpoch,
          ciphertext: await this.cipher.seal({ senderDeviceId: value.sourceDeviceId, targetDeviceId: value.targetDeviceId, value: value.payload }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 240) : 'Delivery route unavailable';
        const nextStatus: HandoffStatus = attempts >= CONTINUITY_MAX_ATTEMPTS ? 'FAILED' : 'QUEUED';
        this.updateOutbox(value.requestId, nextStatus, message, attempts);
        continue;
      }
      // A successful local send is only SENDING. The target ACK transitions it
      // to DELIVERED_TO_DEVICE, so reachability is never presented as delivery.
      if (this.state.outbox[value.requestId]?.status === 'DELIVERED_TO_DEVICE' || this.state.outbox[value.requestId]?.status === 'OPENED' || this.state.outbox[value.requestId]?.status === 'ACCEPTED') delivered += 1;
    }
    this.expireState();
    await this.persist();
    this.emit();
    return { attempted, delivered, pending: this.pendingCount() };
  }

  async openIncoming(requestId: string): Promise<DeviceInboxItem> {
    await this.ready();
    const current = this.state.inbox[requestId];
    if (!current) throw new ContinuityError('NOT_FOUND', 'Incoming handoff was not found');
    if (isExpiredAt(current.payload.expiresAt, this.now())) { this.updateInbox(requestId, 'EXPIRED'); await this.persist(); throw new ContinuityError('EXPIRED', 'Incoming handoff has expired'); }
    if (current.status === 'CANCELLED') throw new ContinuityError('CANCELLED', 'Incoming handoff was cancelled');
    if (current.status === 'OPENED' || current.status === 'ACCEPTED') return clone(current);
    const adapter = this.adapters.get(current.payload.type);
    let result: ContinuityOpenResult = { status: 'ACCEPTED' };
    try {
      if (current.payload.type === 'clipboard') {
        const reference = current.payload.reference;
        if (this.onClipboardReceived && reference.kind === 'clipboard' && reference.text !== undefined) await this.onClipboardReceived({ text: reference.text, format: reference, sourceDeviceId: current.sourceDeviceId });
        result = { status: 'OPENED' };
      } else if (adapter?.openOnTarget) result = await adapter.openOnTarget({ requestId, sourceDeviceId: current.sourceDeviceId, payload: current.payload });
    } catch (error) {
      result = { status: 'UNSUPPORTED', reason: error instanceof Error ? error.message.slice(0, 240) : 'Target surface rejected the handoff' };
    }
    const status: HandoffStatus = result.status === 'OPENED' ? 'OPENED' : result.status === 'ACCEPTED' ? 'ACCEPTED' : 'FAILED';
    this.updateInbox(requestId, status, result.reason);
    this.addHistory({ ...current, status });
    await this.persist();
    await this.sendReceipt(current, status, result.reason).catch(() => undefined);
    this.emit();
    return clone(this.state.inbox[requestId]!);
  }

  async cancel(requestId: string): Promise<HandoffRequest | DeviceInboxItem> {
    await this.ready();
    const outgoing = this.state.outbox[requestId];
    if (outgoing) {
      if (['OPENED', 'ACCEPTED', 'DELIVERED_TO_DEVICE', 'FAILED', 'EXPIRED'].includes(outgoing.status)) return clone(outgoing);
      this.state = { ...this.state, cancelled: { ...this.state.cancelled, [requestId]: true } };
      this.updateOutbox(requestId, 'CANCELLED');
      await this.persist();
      await this.sendWire(outgoing.targetDeviceId, { version: 1, protocol: CONTINUITY_PROTOCOL, kind: 'CANCEL', requestId, sourceDeviceId: outgoing.sourceDeviceId, targetDeviceId: outgoing.targetDeviceId, issuedAt: outgoing.createdAt, expiresAt: outgoing.payload.expiresAt, trustEpoch: this.devices.trustEpoch }).catch(() => undefined);
      this.emit();
      return clone(this.state.outbox[requestId]!);
    }
    const incoming = this.state.inbox[requestId];
    if (!incoming) throw new ContinuityError('NOT_FOUND', 'Handoff was not found');
    if (['OPENED', 'ACCEPTED'].includes(incoming.status)) return clone(incoming);
    this.updateInbox(requestId, 'CANCELLED');
    await this.persist();
    await this.sendReceipt(incoming, 'CANCELLED').catch(() => undefined);
    this.emit();
    return clone(this.state.inbox[requestId]!);
  }

  close(): void { this.closed = true; this.unsubscribe(); this.listeners.clear(); }

  private async queueHandoff(targetDeviceId: NodeId, type: HandoffObjectType, input: unknown, action: HandoffAction, viewContext?: ContinuationViewContext, continuationState?: ContinuationState, ttlMs = CONTINUITY_DEFAULT_TTL_MS): Promise<HandoffRequest> {
    await this.ready();
    if (this.closed) throw new ContinuityError('UNAVAILABLE', 'Continuity service is closed');
    if (!this.isEligibleTarget(targetDeviceId)) throw new ContinuityError(this.devices.isRevoked(targetDeviceId) ? 'REVOKED' : 'UNKNOWN_DEVICE', 'Target device is not currently eligible');
    const adapter = this.adapters.get(type);
    if (!adapter) throw new ContinuityError('UNSUPPORTED', `No continuity adapter is registered for ${type}`);
    const decision = await this.capability(targetDeviceId, type);
    if (!decision.allowed) throw new ContinuityError('UNSUPPORTED', decision.reason ?? 'Target does not support this continuity action');
    const now = this.now();
    const safeTtl = type === 'clipboard' ? clampInt(ttlMs, 30_000, CONTINUITY_CLIPBOARD_TTL_MS) : clampInt(ttlMs, 60_000, 7 * 24 * 60 * 60_000);
    const expiresAt = new Date(now + safeTtl).toISOString();
    const reference = type === 'clipboard' ? validateReference(input, 'clipboard') : adapter.createReference(input);
    const payload = validateHandoffPayload({ version: 1, protocol: CONTINUITY_PROTOCOL, type, action, reference, ...(viewContext ? { viewContext } : {}), ...(continuationState ? { continuationState } : {}), requiredCapability: adapter.capability, expiresAt });
    if (byteLength(JSON.stringify(payload)) > CONTINUITY_MAX_HANDOFF_BYTES) throw new ContinuityError('RESOURCE_LIMIT', 'Handoff payload exceeds the bounded size');
    const pendingCount = Object.values(this.state.outbox).filter(value => ['QUEUED', 'SENDING'].includes(value.status)).length;
    if (pendingCount >= this.limits.pending) throw new ContinuityError('RESOURCE_LIMIT', 'Pending handoff queue is full');
    const requestId = crypto.randomUUID();
    const request: HandoffRequest = { version: 1, requestId, sourceDeviceId: this.devices.localDeviceId, targetDeviceId, payload, status: 'QUEUED', createdAt: nowIso(this.now), updatedAt: nowIso(this.now), attempts: 0, nextAttemptAt: now };
    this.state = { ...this.state, outbox: { ...this.state.outbox, [requestId]: request } };
    this.trimState();
    await this.persist();
    this.emit();
    // Sending is deliberately non-blocking. An explicit flush is available
    // when a caller wants to observe a delivery attempt.
    void this.flush(targetDeviceId).catch(() => undefined);
    return clone(request);
  }

  private async receive(envelope: Envelope): Promise<void> {
    if (this.closed || envelope.type !== CONTINUITY_ENVELOPE_TYPE || envelope.recipient !== this.devices.localDeviceId) return;
    if (Date.parse(envelope.expiresAt) <= this.now()) return;
    if (!(await this.security.verify(envelope))) return;
    const wire = parseWire(envelope.body);
    if (!wire || wire.sourceDeviceId !== envelope.sender || wire.targetDeviceId !== this.devices.localDeviceId || wire.requestId.length > 128) return;
    if (this.devices.isRevoked(wire.sourceDeviceId) || !this.isTrustedSource(wire.sourceDeviceId)) return;
    if (wire.trustEpoch < this.devices.trustEpoch || isExpiredAt(wire.expiresAt, this.now())) return;
    if (wire.kind === 'DELIVER') {
      const active = this.inFlight.get(wire.requestId);
      if (active) { await active.catch(() => undefined); return; }
      const operation = this.receiveDelivery(envelope.sender, wire);
      this.inFlight.set(wire.requestId, operation);
      try { await operation; } finally { this.inFlight.delete(wire.requestId); }
      return;
    }
    if (wire.kind === 'ACK' || wire.kind === 'OPENED') { await this.receiveReceipt(envelope.sender, wire); return; }
    if (wire.kind === 'CANCEL') await this.receiveCancel(envelope.sender, wire);
  }

  private async receiveDelivery(sender: NodeId, wire: ContinuityDeliverWire): Promise<void> {
    const known = this.state.inbox[wire.requestId];
    if (this.state.cancelled[wire.requestId]) { await this.sendReceiptForWire(sender, wire, 'CANCELLED'); return; }
    if (known) { await this.sendReceipt(known, known.status, known.lastError); return; }
    let payload: ContinuityHandoffPayload;
    try { payload = await this.cipher.open({ senderDeviceId: sender, targetDeviceId: this.devices.localDeviceId, value: wire.ciphertext }); }
    catch (error) { await this.sendReceiptForWire(sender, wire, 'FAILED', error instanceof Error ? error.message.slice(0, 240) : 'Payload integrity check failed'); return; }
    if (payload.expiresAt !== wire.expiresAt || payload.protocol !== CONTINUITY_PROTOCOL || payload.version !== CONTINUITY_VERSION || payload.type !== payload.reference.kind) { await this.sendReceiptForWire(sender, wire, 'FAILED', 'Handoff envelope and payload do not match'); return; }
    const adapter = this.adapters.get(payload.type);
    if (!adapter) { await this.sendReceiptForWire(sender, wire, 'FAILED', 'Target surface is unsupported'); return; }
    try { payload = { ...payload, reference: adapter.validateIncoming(payload.reference) }; validateHandoffPayload(payload); }
    catch (error) { await this.sendReceiptForWire(sender, wire, 'FAILED', error instanceof Error ? error.message.slice(0, 240) : 'Handoff schema rejected'); return; }
    const localDecision = await this.localCapability(payload.type);
    if (!localDecision.allowed) { await this.sendReceiptForWire(sender, wire, 'FAILED', localDecision.reason ?? 'Target capability is unavailable'); return; }
    const source = await this.devices.getDevice(sender);
    const item: DeviceInboxItem = { version: 1, requestId: wire.requestId, sourceDeviceId: sender, sourceLabel: source?.label ?? 'Keystone device', receivedAt: nowIso(this.now), payload, status: 'DELIVERED_TO_DEVICE', updatedAt: nowIso(this.now) };
    this.state = { ...this.state, inbox: { ...this.state.inbox, [wire.requestId]: item }, seen: { ...this.state.seen, [wire.requestId]: { expiresAt: payload.expiresAt, status: item.status } } };
    this.trimState();
    this.addHistory(item);
    await this.persist();
    await this.onIncoming?.(clone(item));
    await this.sendReceipt(item, 'DELIVERED_TO_DEVICE');
    this.emit();
  }

  private async receiveReceipt(sender: NodeId, wire: ContinuityAckWire): Promise<void> {
    const current = this.state.outbox[wire.requestId];
    if (!current || current.targetDeviceId !== sender) return;
    if (isExpiredAt(current.payload.expiresAt, this.now()) && wire.status !== 'OPENED') { this.updateOutbox(current.requestId, 'EXPIRED'); await this.persist(); return; }
    const status = wire.status === 'OPENED' ? 'OPENED' : wire.status === 'ACCEPTED' ? 'ACCEPTED' : wire.status === 'DELIVERED_TO_DEVICE' ? 'DELIVERED_TO_DEVICE' : wire.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    this.updateOutbox(current.requestId, status, wire.reason);
    this.addHistory({ ...current, status });
    await this.persist();
    this.emit();
  }

  private async receiveCancel(sender: NodeId, wire: ContinuityCancelWire): Promise<void> {
    const current = this.state.inbox[wire.requestId];
    if (current && !['OPENED', 'ACCEPTED'].includes(current.status)) this.updateInbox(wire.requestId, 'CANCELLED');
    else if (!current) this.state = { ...this.state, cancelled: { ...this.state.cancelled, [wire.requestId]: true } };
    await this.persist();
    if (current) await this.sendReceipt(current, 'CANCELLED').catch(() => undefined);
    this.emit();
  }

  private async sendReceipt(item: DeviceInboxItem, status: HandoffStatus, reason?: string): Promise<void> {
    await this.sendReceiptForWire(item.sourceDeviceId, { version: 1, protocol: CONTINUITY_PROTOCOL, kind: 'ACK', requestId: item.requestId, sourceDeviceId: item.sourceDeviceId, targetDeviceId: this.devices.localDeviceId, issuedAt: item.receivedAt, expiresAt: item.payload.expiresAt, trustEpoch: this.devices.trustEpoch }, status, reason);
  }

  private async sendReceiptForWire(peer: NodeId, wire: ContinuityWireBase, status: HandoffStatus, reason?: string): Promise<void> {
    await this.sendWire(peer, { ...wire, kind: 'ACK', sourceDeviceId: this.devices.localDeviceId, targetDeviceId: peer, status, ...(reason ? { reason } : {}) } as ContinuityAckWire);
  }

  private async sendWire(peer: NodeId, wire: ContinuityWire): Promise<void> {
    if (this.closed) throw new ContinuityError('UNAVAILABLE', 'Continuity service is closed');
    const unsigned: UnsignedEnvelope = { version: 1, type: CONTINUITY_ENVELOPE_TYPE, id: crypto.randomUUID(), sender: this.devices.localDeviceId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: wire.expiresAt, body: wire };
    const envelope: Envelope = { ...unsigned, signature: await this.security.sign(unsigned) };
    await this.delivery.send(peer, envelope);
  }

  private async localCapability(type: HandoffObjectType): Promise<ContinuityCapabilityDecision> {
    const required = continuityCapabilityFor(type);
    const advertised = this.localCapabilities ?? (await this.devices.getDevice(this.devices.localDeviceId))?.capabilities.continuityCapabilities;
    if (!advertised) return { allowed: true, state: 'UNKNOWN', capability: required };
    return hasCapability(advertised, required) ? { allowed: true, state: 'SUPPORTED', capability: required } : { allowed: false, state: 'UNSUPPORTED', capability: required, reason: `This device does not advertise ${required}` };
  }

  private isEligibleTarget(deviceId: NodeId): boolean { return deviceId !== this.devices.localDeviceId && !this.devices.isRevoked(deviceId) && (this.devices.isTrustedDevice(deviceId) || deviceId === this.devices.authorityDeviceId); }
  private isTrustedSource(deviceId: NodeId): boolean { return deviceId !== this.devices.localDeviceId && (this.devices.isTrustedDevice(deviceId) || deviceId === this.devices.authorityDeviceId); }

  private availability(record: DeviceTrustRecord, now: number): ContinuityDevice['availability'] {
    if (record.state !== 'TRUSTED') return record.state === 'REVOKED' ? 'OFFLINE' : 'UNKNOWN';
    if (record.deviceId === this.devices.localDeviceId) return 'AVAILABLE';
    if (!record.lastSeenAt) return 'UNKNOWN';
    const age = now - Date.parse(record.lastSeenAt);
    if (age <= 2 * 60_000) return 'AVAILABLE';
    if (age <= 24 * 60 * 60_000) return 'RECENTLY_AVAILABLE';
    return 'OFFLINE';
  }

  private pendingCount(): number { return Object.values(this.state.outbox).filter(value => ['QUEUED', 'SENDING'].includes(value.status)).length; }
  private updateOutbox(requestId: string, status: HandoffStatus, lastError?: string, attempts?: number): void {
    const current = this.state.outbox[requestId];
    if (!current) return;
    this.state = { ...this.state, outbox: { ...this.state.outbox, [requestId]: { ...current, status, updatedAt: nowIso(this.now), ...(lastError ? { lastError } : {}), ...(attempts === undefined ? {} : { attempts }) } } };
  }
  private updateInbox(requestId: string, status: HandoffStatus, lastError?: string): void {
    const current = this.state.inbox[requestId];
    if (!current) return;
    this.state = { ...this.state, inbox: { ...this.state.inbox, [requestId]: { ...current, status, updatedAt: nowIso(this.now), ...(lastError ? { lastError } : {}) } }, seen: { ...this.state.seen, [requestId]: { expiresAt: current.payload.expiresAt, status } } };
  }
  private addHistory(value: HandoffRequest | DeviceInboxItem): void {
    if (value.payload.type === 'clipboard') return;
    const entry: ContinuationHistoryEntry = { version: 1, requestId: value.requestId, direction: 'sourceDeviceId' in value && value.sourceDeviceId === this.devices.localDeviceId ? 'OUTGOING' : 'INCOMING', sourceDeviceId: value.sourceDeviceId, targetDeviceId: 'targetDeviceId' in value ? value.targetDeviceId : this.devices.localDeviceId, type: value.payload.type, action: value.payload.action, status: value.status, at: value.updatedAt };
    this.state = { ...this.state, history: { ...this.state.history, [entry.requestId]: entry } };
  }
  private expireState(): void {
    const now = this.now();
    for (const [id, item] of Object.entries(this.state.outbox)) if (item.status !== 'OPENED' && isExpiredAt(item.payload.expiresAt, now)) this.updateOutbox(id, 'EXPIRED');
    for (const [id, item] of Object.entries(this.state.inbox)) if (!['OPENED', 'ACCEPTED', 'CANCELLED'].includes(item.status) && isExpiredAt(item.payload.expiresAt, now)) this.updateInbox(id, 'EXPIRED');
  }
  private trimState(): void {
    const outbox = Object.values(this.state.outbox).sort(sortRecent);
    const inbox = Object.values(this.state.inbox).sort(sortRecent);
    const history = Object.values(this.state.history).sort(sortRecent);
    const seen = Object.entries(this.state.seen).sort(([, a], [, b]) => a.expiresAt.localeCompare(b.expiresAt));
    const trimRecord = <T extends { readonly requestId: string }>(values: readonly T[], max: number): Record<string, T> => Object.fromEntries(values.slice(0, max).map(value => [value.requestId, value]));
    this.state = { ...this.state, outbox: trimRecord(outbox, this.limits.pending), inbox: trimRecord(inbox, this.limits.inbox), history: trimRecord(history, this.limits.history), seen: Object.fromEntries(seen.slice(Math.max(0, seen.length - this.limits.dedup))) };
  }
  private async hydrate(): Promise<void> {
    const value = await this.storage.read();
    if (value === undefined) { this.state = emptyState(); await this.persist(); return; }
    if (!isContinuityState(value)) throw new ContinuityError('INTEGRITY', 'Continuity state is malformed');
    const outbox: Record<string, HandoffRequest> = {};
    for (const item of Object.values(value.outbox)) { try { if (isHandoffRequest(item)) outbox[item.requestId] = item; } catch { /* tampered entry is ignored */ } }
    const inbox: Record<string, DeviceInboxItem> = {};
    for (const item of Object.values(value.inbox)) { try { if (isInboxItem(item)) inbox[item.requestId] = item; } catch { /* tampered entry is ignored */ } }
    this.state = { version: 1, outbox, inbox, history: isRecord(value.history) ? value.history as Record<string, ContinuationHistoryEntry> : {}, seen: isRecord(value.seen) ? value.seen as ContinuityState['seen'] : {}, cancelled: isRecord(value.cancelled) ? value.cancelled as Record<string, true> : {}, automaticClipboardEnabled: value.automaticClipboardEnabled === true };
    this.expireState();
    this.trimState();
    await this.persist();
  }
  private async persist(): Promise<void> { const snapshot = clone(this.state); const operation = this.writes.then(() => this.storage.write(snapshot)); this.writes = operation.catch(() => undefined); await operation; }
  private emit(): void { for (const listener of this.listeners) listener(); }
}

/** Named boundary retained for callers that want to depend on the handoff
 * layer separately from its product-facing ContinuityService facade. */
export class HandoffService extends ContinuityService {}

function emptyState(): ContinuityState { return { version: 1, outbox: {}, inbox: {}, history: {}, seen: {}, cancelled: {}, automaticClipboardEnabled: false }; }
function clone<T>(value: T): T { return structuredClone(value); }
function nowIso(now: () => number): string { return new Date(now()).toISOString(); }
function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
function clampInt(value: number, min: number, max: number): number { return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value)) : min; }
function retryDelay(attempt: number): number { return Math.min(15 * 60_000, 500 * (2 ** Math.max(0, Math.min(10, attempt - 1)))); }
function sortRecent(a: { readonly updatedAt?: string; readonly receivedAt?: string; readonly at?: string }, b: { readonly updatedAt?: string; readonly receivedAt?: string; readonly at?: string }): number { return (b.updatedAt ?? b.receivedAt ?? b.at ?? '').localeCompare(a.updatedAt ?? a.receivedAt ?? a.at ?? ''); }
function isExpiredAt(value: string, now: number): boolean { const at = Date.parse(value); return !Number.isFinite(at) || at <= now; }
function hasCapability(values: readonly DeviceContinuityCapability[] | ReadonlySet<DeviceContinuityCapability>, required: DeviceContinuityCapability): boolean { if (values instanceof Set) return values.has(required); return (values as readonly DeviceContinuityCapability[]).includes(required); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function safeText(value: unknown, max: number, required = false): value is string { return typeof value === 'string' && (!required || value.trim().length > 0) && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function safeId(value: unknown, max = 512): value is string { return safeText(value, max, true); }
function safeExternalUrl(value: unknown): value is string { if (!safeText(value, 2_048, true)) return false; try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password; } catch { return false; } }
function safeKeystoneUri(value: unknown): value is string { if (!safeText(value, 2_048, true)) return false; try { const url = new URL(value); return url.protocol === 'keystone:' && ['vault', 'document', 'place', 'route', 'mail', 'publication', 'collaboration', 'conversation', 'file', 'workspace'].includes(url.hostname); } catch { return false; } }
function forbiddenKey(key: string): boolean { return /^(?:privateKey|encryptionPrivateKey|masterSeed|mnemonic|recoverySecret|recoveryPhrase|apiKey|accessToken|refreshToken|authToken|password|credential|secretKey|sessionToken|cookie|localStorage|shell|command|executable|script|pluginInstall|remoteInput|screenCapture|deviceLocation|currentLocation|liveLocation)$/i.test(key); }
function assertSafeContent(value: unknown, depth = 0): void {
  if (depth > 16) throw new ContinuityError('INVALID_ARGUMENT', 'Continuity payload nesting is too deep');
  if (Array.isArray(value)) { if (value.length > 256) throw new ContinuityError('RESOURCE_LIMIT', 'Continuity collection bound exceeded'); value.forEach(item => assertSafeContent(item, depth + 1)); return; }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) { if (forbiddenKey(key)) throw new ContinuityError('UNAUTHORIZED', `Continuity field ${key} is not permitted`); assertSafeContent(child, depth + 1); }
}

function validateViewContext(value: unknown): ContinuationViewContext | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || byteLength(JSON.stringify(value)) > CONTINUITY_MAX_VIEW_CONTEXT_BYTES) throw new ContinuityError('RESOURCE_LIMIT', 'View context is too large');
  assertSafeContent(value);
  const result: ContinuationViewContext = {
    ...(safeId(value.selectedTab, 256) ? { selectedTab: value.selectedTab } : {}),
    ...(typeof value.documentPosition === 'number' && Number.isSafeInteger(value.documentPosition) && value.documentPosition >= 0 ? { documentPosition: value.documentPosition } : {}),
    ...(isRecord(value.cursor) && typeof value.cursor.anchor === 'number' && typeof value.cursor.head === 'number' && Number.isSafeInteger(value.cursor.anchor) && Number.isSafeInteger(value.cursor.head) ? { cursor: { anchor: value.cursor.anchor, head: value.cursor.head } } : {}),
    ...(isRecord(value.canvasViewport) && finiteNumber(value.canvasViewport.x) && finiteNumber(value.canvasViewport.y) && finiteNumber(value.canvasViewport.zoom) ? { canvasViewport: { x: value.canvasViewport.x, y: value.canvasViewport.y, zoom: Math.max(0.1, Math.min(8, value.canvasViewport.zoom)) } } : {}),
    ...(isRecord(value.workboard) ? { workboard: { ...(safeId(value.workboard.columnId, 256) ? { columnId: value.workboard.columnId } : {}), ...(safeId(value.workboard.cardId, 256) ? { cardId: value.workboard.cardId } : {}) } } : {}),
    ...(isRecord(value.mapViewport) && finiteNumber(value.mapViewport.latitude) && finiteNumber(value.mapViewport.longitude) && finiteNumber(value.mapViewport.zoom) ? { mapViewport: { latitude: value.mapViewport.latitude, longitude: value.mapViewport.longitude, zoom: Math.max(0.1, Math.min(24, value.mapViewport.zoom)) } } : {}),
    ...(safeId(value.mailThreadId, 512) ? { mailThreadId: value.mailThreadId } : {}),
    ...(safeId(value.mailMessageId, 512) ? { mailMessageId: value.mailMessageId } : {}),
    ...(safeText(value.publicationRevision, 512) ? { publicationRevision: value.publicationRevision } : {}),
    ...(safeExternalUrl(value.browserUrl) || safeKeystoneUri(value.browserUrl) ? { browserUrl: value.browserUrl } : {}),
    ...(typeof value.browserScrollY === 'number' && Number.isSafeInteger(value.browserScrollY) && value.browserScrollY >= 0 ? { browserScrollY: value.browserScrollY } : {}),
  };
  return result;
}

function validateWorkspaceTab(value: unknown): HandoffWorkspaceTab {
  if (!isRecord(value) || !safeId(value.id, 128) || typeof value.type !== 'string' || !['file', 'vault', 'document', 'browser', 'place', 'route', 'mail', 'publication', 'collaboration', 'messaging'].includes(value.type) || !safeId(value.objectId, 512)) throw new ContinuityError('INVALID_ARGUMENT', 'Workspace tab reference is invalid');
  const tab: HandoffWorkspaceTab = { id: value.id, type: value.type as HandoffWorkspaceTab['type'], objectId: value.objectId, ...(safeKeystoneUri(value.uri) ? { uri: value.uri } : {}), ...(safeExternalUrl(value.url) || safeKeystoneUri(value.url) ? { url: value.url } : {}), ...(safeText(value.title, 256) ? { title: value.title } : {}), ...(value.viewContext ? { viewContext: validateViewContext(value.viewContext) } : {}) };
  assertSafeContent(tab);
  return tab;
}

function validateReference(value: unknown, expected?: HandoffObjectType): HandoffObjectReference {
  if (!isRecord(value) || value.version !== 1 || typeof value.kind !== 'string' || !safeId(value.objectId, 512) || (expected && value.kind !== expected)) throw new ContinuityError('INVALID_ARGUMENT', 'Canonical handoff reference is invalid');
  const kind = value.kind as HandoffObjectType;
  if (!['file', 'vault', 'document', 'browser', 'place', 'route', 'mail', 'publication', 'collaboration', 'messaging', 'workspace', 'clipboard'].includes(kind)) throw new ContinuityError('UNSUPPORTED', 'Canonical handoff reference type is unsupported');
  if (kind === 'browser') {
    if (!safeExternalUrl(value.url) && !safeKeystoneUri(value.url)) throw new ContinuityError('INVALID_ARGUMENT', 'Browser handoff URL is unsafe');
    return { version: 1, kind: 'browser', objectId: value.objectId, url: value.url as string, ...(safeText(value.title, 256) ? { title: value.title } : {}), ...(typeof value.scrollY === 'number' && Number.isSafeInteger(value.scrollY) && value.scrollY >= 0 ? { scrollY: value.scrollY } : {}) };
  }
  if (kind === 'clipboard') {
    if (!['text', 'url', 'image-reference', 'file-reference'].includes(String(value.format))) throw new ContinuityError('INVALID_ARGUMENT', 'Clipboard format is invalid');
    if (value.text !== undefined && (!safeText(value.text, CONTINUITY_MAX_CLIPBOARD_BYTES, false) || byteLength(value.text) > CONTINUITY_MAX_CLIPBOARD_BYTES)) throw new ContinuityError('RESOURCE_LIMIT', 'Clipboard text is too large');
    if (value.format === 'url' && value.text !== undefined && !safeExternalUrl(value.text)) throw new ContinuityError('INVALID_ARGUMENT', 'Clipboard URL is unsafe');
    if (value.text === undefined && !safeText(value.reference, 2_048, true)) throw new ContinuityError('INVALID_ARGUMENT', 'Clipboard reference is invalid');
    return { version: 1, kind: 'clipboard', objectId: value.objectId, format: value.format as Extract<HandoffObjectReference, { kind: 'clipboard' }>['format'], ...(value.text === undefined ? { reference: value.reference as string } : { text: value.text as string }) };
  }
  if (kind === 'place') {
    if (!safeId(value.placeId, 512) || !safeText(value.displayName, 512, true)) throw new ContinuityError('INVALID_ARGUMENT', 'Place handoff reference is invalid');
    const snapshot = isRecord(value.snapshot) && safeText(value.snapshot.displayName, 512, true) ? { displayName: value.snapshot.displayName, ...(safeText(value.snapshot.address, 1_024) ? { address: value.snapshot.address } : {}), ...(safeText(value.snapshot.category, 256) ? { category: value.snapshot.category } : {}), ...(safeText(value.snapshot.approximateRegion, 256) ? { approximateRegion: value.snapshot.approximateRegion } : {}), ...(isRecord(value.snapshot.coordinates) && finiteNumber(value.snapshot.coordinates.latitude) && finiteNumber(value.snapshot.coordinates.longitude) ? { coordinates: { latitude: value.snapshot.coordinates.latitude, longitude: value.snapshot.coordinates.longitude } } : {}) } : undefined;
    return { version: 1, kind, objectId: value.objectId, placeId: value.placeId, displayName: value.displayName, ...(safeKeystoneUri(value.uri) ? { uri: value.uri } : {}), ...(snapshot ? { snapshot } : {}) };
  }
  if (kind === 'route') {
    if (value.mode !== undefined && !['WALKING', 'DRIVING', 'CYCLING', 'TRANSIT'].includes(String(value.mode))) throw new ContinuityError('INVALID_ARGUMENT', 'Route mode is invalid');
    if (isRecord(value.snapshot)) { assertSafeContent(value.snapshot); if (byteLength(JSON.stringify(value.snapshot)) > 32 * 1024) throw new ContinuityError('RESOURCE_LIMIT', 'Route snapshot is too large'); }
    return { version: 1, kind: 'route', objectId: value.objectId, ...(safeId(value.routeId, 512) ? { routeId: value.routeId } : {}), ...(value.mode ? { mode: value.mode as Extract<HandoffObjectReference, { kind: 'route' }>['mode'] } : {}), ...(value.origin ? { origin: validateRouteEndpoint(value.origin) } : {}), ...(value.destination ? { destination: validateRouteEndpoint(value.destination) } : {}), ...(isRecord(value.snapshot) ? { snapshot: structuredClone(value.snapshot) } : {}) };
  }
  const common = { version: 1 as const, objectId: value.objectId } as const;
  if (kind === 'file') return { ...common, kind: 'file', ...(safeKeystoneUri(value.uri) ? { uri: value.uri } : {}), ...(safeText(value.label, 256) ? { label: value.label } : {}), ...(safeText(value.contentId, 256) ? { contentId: value.contentId } : {}), ...(safeText(value.filename, 256) ? { filename: value.filename } : {}), ...(safeText(value.mimeType, 256) ? { mimeType: value.mimeType } : {}), ...(typeof value.sizeBytes === 'number' && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0 ? { sizeBytes: value.sizeBytes } : {}) };
  if (kind === 'vault' || kind === 'document') return { ...common, kind, ...(safeKeystoneUri(value.uri) ? { uri: value.uri } : {}), ...(safeText(value.label, 256) ? { label: value.label } : {}), ...(safeId(value.vaultId, 512) ? { vaultId: value.vaultId } : {}) };
  if (kind === 'mail') { if (!safeId(value.accountId, 512) || (value.threadId !== undefined && !safeId(value.threadId, 512)) || (value.messageId !== undefined && !safeId(value.messageId, 512))) throw new ContinuityError('INVALID_ARGUMENT', 'Mail handoff reference is invalid'); return { ...common, kind: 'mail', accountId: value.accountId, ...(value.threadId ? { threadId: value.threadId } : {}), ...(value.messageId ? { messageId: value.messageId } : {}), ...(safeText(value.subject, 998) ? { subject: value.subject } : {}) }; }
  if (kind === 'publication') { if (!safeId(value.publicationId, 512)) throw new ContinuityError('INVALID_ARGUMENT', 'Publication handoff reference is invalid'); return { ...common, kind: 'publication', publicationId: value.publicationId, ...(safeText(value.revisionAddress, 512) ? { revisionAddress: value.revisionAddress } : {}), ...(safeText(value.title, 512) ? { title: value.title } : {}) }; }
  if (kind === 'messaging') { if (!safeId(value.conversationId, 512)) throw new ContinuityError('INVALID_ARGUMENT', 'Messaging handoff reference is invalid'); return { ...common, kind: 'messaging', conversationId: value.conversationId, ...(safeId(value.messageId, 512) ? { messageId: value.messageId } : {}), ...(safeText(value.label, 256) ? { label: value.label } : {}) }; }
  if (kind === 'collaboration') return { ...common, kind: 'collaboration', ...(safeText(value.objectKind, 128) ? { objectKind: value.objectKind } : {}), ...(safeId(value.spaceId, 512) ? { spaceId: value.spaceId } : {}), ...(safeText(value.label, 256) ? { label: value.label } : {}) };
  if (kind === 'workspace') {
    if (!Array.isArray(value.tabs) || value.tabs.length > CONTINUITY_MAX_WORKSPACE_TABS) throw new ContinuityError('RESOURCE_LIMIT', 'Workspace tab bound exceeded');
    const tabs = value.tabs.map(validateWorkspaceTab); const ids = new Set(tabs.map(tab => tab.id));
    if (value.activeTabId !== undefined && (!safeId(value.activeTabId, 128) || !ids.has(value.activeTabId))) throw new ContinuityError('INVALID_ARGUMENT', 'Workspace active tab is invalid');
    const panes = value.panes === undefined ? undefined : validatePanes(value.panes, ids);
    return { ...common, kind: 'workspace', ...(safeId(value.workspaceId, 512) ? { workspaceId: value.workspaceId } : {}), ...(safeText(value.label, 256) ? { label: value.label } : {}), tabs, ...(panes ? { panes } : {}), ...(value.activeTabId ? { activeTabId: value.activeTabId } : {}) };
  }
  throw new ContinuityError('UNSUPPORTED', 'Unsupported handoff reference');
}

function validateRouteEndpoint(value: unknown): HandoffRouteEndpoint {
  if (!isRecord(value) || (value.type !== 'PLACE' && value.type !== 'COORDINATE')) throw new ContinuityError('INVALID_ARGUMENT', 'Route endpoint is invalid');
  if (value.type === 'PLACE') { if (!safeId(value.placeId, 512)) throw new ContinuityError('INVALID_ARGUMENT', 'Route place endpoint is invalid'); return { type: 'PLACE', placeId: value.placeId, ...(safeText(value.label, 256) ? { label: value.label } : {}) }; }
  if (!isRecord(value.coordinates) || !finiteNumber(value.coordinates.latitude) || !finiteNumber(value.coordinates.longitude)) throw new ContinuityError('INVALID_ARGUMENT', 'Route coordinate endpoint is invalid');
  return { type: 'COORDINATE', coordinates: { latitude: value.coordinates.latitude, longitude: value.coordinates.longitude }, ...(safeText(value.label, 256) ? { label: value.label } : {}) };
}

function validatePanes(value: unknown, ids: Set<string>): readonly HandoffWorkspacePane[] {
  if (!Array.isArray(value) || value.length > CONTINUITY_MAX_WORKSPACE_PANES) throw new ContinuityError('RESOURCE_LIMIT', 'Workspace pane bound exceeded');
  return value.map(item => { if (!isRecord(item) || !safeId(item.id, 128) || !Array.isArray(item.tabIds) || item.tabIds.length > CONTINUITY_MAX_WORKSPACE_TABS || !item.tabIds.every(tabId => safeId(tabId, 128) && ids.has(tabId))) throw new ContinuityError('INVALID_ARGUMENT', 'Workspace pane is invalid'); return { id: item.id, tabIds: item.tabIds as string[], ...(safeId(item.activeTabId, 128) && ids.has(item.activeTabId) ? { activeTabId: item.activeTabId } : {}) }; });
}

export function validateHandoffPayload(value: unknown): ContinuityHandoffPayload {
  if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTINUITY_PROTOCOL || typeof value.type !== 'string' || typeof value.action !== 'string' || !isRecord(value.reference) || value.reference.kind !== value.type || !safeText(value.requiredCapability, 80, true) || !safeText(value.expiresAt, 64, true) || !Number.isFinite(Date.parse(value.expiresAt))) throw new ContinuityError('INVALID_ARGUMENT', 'Handoff payload schema is invalid');
  const type = value.type as HandoffObjectType;
  if (!Object.prototype.hasOwnProperty.call(TYPE_CAPABILITY, type) && type !== 'clipboard') throw new ContinuityError('UNSUPPORTED', 'Handoff type is unsupported');
  if (value.action !== 'OPEN' && value.action !== 'CONTINUE') throw new ContinuityError('INVALID_ARGUMENT', 'Handoff action is invalid');
  const reference = validateReference(value.reference, type);
  const required = continuityCapabilityFor(type);
  if (value.requiredCapability !== required) throw new ContinuityError('UNAUTHORIZED', 'Handoff capability does not match its type');
  const viewContext = validateViewContext(value.viewContext);
  let continuationState: ContinuationState | undefined;
  if (value.continuationState !== undefined) {
    if (!isRecord(value.continuationState) || value.continuationState.version !== 1 || !safeText(value.continuationState.kind, 64, true)) throw new ContinuityError('INVALID_ARGUMENT', 'Continuation state is invalid');
    if (value.continuationState.kind === 'DRAFT_REFERENCE' && safeId(value.continuationState.draftId, 512)) continuationState = { version: 1, kind: 'DRAFT_REFERENCE', draftId: value.continuationState.draftId, ...(safeText(value.continuationState.revision, 512) ? { revision: value.continuationState.revision } : {}) };
    else if (value.continuationState.kind === 'WORKSPACE_LAYOUT') continuationState = { version: 1, kind: 'WORKSPACE_LAYOUT', panes: validatePanes(value.continuationState.panes, new Set(reference.kind === 'workspace' ? reference.tabs.map(tab => tab.id) : [])), ...(safeId(value.continuationState.activeTabId, 128) ? { activeTabId: value.continuationState.activeTabId } : {}) };
    else throw new ContinuityError('UNSUPPORTED', 'Continuation state kind is unsupported');
  }
  const result = { version: 1 as const, protocol: CONTINUITY_PROTOCOL, type, action: value.action as HandoffAction, reference, ...(viewContext ? { viewContext } : {}), ...(continuationState ? { continuationState } : {}), requiredCapability: required, expiresAt: value.expiresAt };
  assertSafeContent(result);
  if (byteLength(JSON.stringify(result)) > CONTINUITY_MAX_HANDOFF_BYTES) throw new ContinuityError('RESOURCE_LIMIT', 'Handoff payload exceeds the bounded size');
  return result;
}

function createReference(type: Exclude<HandoffObjectType, 'clipboard'>, input: unknown): HandoffObjectReference {
  if (isRecord(input) && input.version === 1 && input.kind === type) return validateReference(input, type);
  if (!isRecord(input)) throw new ContinuityError('INVALID_ARGUMENT', `${type} handoff input is invalid`);
  const objectId = typeof input.objectId === 'string' ? input.objectId : typeof input.id === 'string' ? input.id : type === 'browser' && typeof input.url === 'string' ? input.url : typeof input[`${type}Id`] === 'string' ? input[`${type}Id`] : undefined;
  if (type === 'browser' && typeof input.url === 'string' && objectId) return validateReference({ version: 1, kind: type, objectId, url: input.url, ...(typeof input.title === 'string' ? { title: input.title } : {}), ...(Number.isSafeInteger(input.scrollY) ? { scrollY: input.scrollY } : {}) }, type);
  if (!objectId) throw new ContinuityError('INVALID_ARGUMENT', `${type} handoff object ID is missing`);
  if (type === 'file') return validateReference({ version: 1, kind: type, objectId, uri: typeof input.uri === 'string' ? input.uri : undefined, label: typeof input.label === 'string' ? input.label : typeof input.filename === 'string' ? input.filename : undefined, contentId: typeof input.contentId === 'string' ? input.contentId : typeof input.payload === 'object' && input.payload && typeof (input.payload as Record<string, unknown>).contentId === 'string' ? (input.payload as Record<string, unknown>).contentId : undefined, filename: typeof input.filename === 'string' ? input.filename : undefined, mimeType: typeof input.mimeType === 'string' ? input.mimeType : undefined, sizeBytes: input.sizeBytes }, type);
  if (type === 'place') return validateReference({ version: 1, kind: type, objectId, placeId: typeof input.placeId === 'string' ? input.placeId : objectId, uri: input.uri, displayName: typeof input.displayName === 'string' ? input.displayName : typeof input.label === 'string' ? input.label : objectId, snapshot: input.snapshot }, type);
  if (type === 'route') return validateReference({ version: 1, kind: type, objectId, routeId: typeof input.routeId === 'string' ? input.routeId : objectId, mode: input.mode, origin: input.origin, destination: input.destination, snapshot: input.snapshot ?? input }, type);
  if (type === 'mail') return validateReference({ version: 1, kind: type, objectId, accountId: typeof input.accountId === 'string' ? input.accountId : 'unknown-account', threadId: input.threadId, messageId: input.messageId, subject: input.subject }, type);
  if (type === 'publication') return validateReference({ version: 1, kind: type, objectId, publicationId: typeof input.publicationId === 'string' ? input.publicationId : objectId, revisionAddress: input.revisionAddress, title: input.title }, type);
  if (type === 'collaboration') return validateReference({ version: 1, kind: type, objectId, objectKind: input.objectKind, spaceId: input.spaceId, label: input.label }, type);
  if (type === 'messaging') return validateReference({ version: 1, kind: type, objectId, conversationId: typeof input.conversationId === 'string' ? input.conversationId : objectId, messageId: input.messageId, label: input.label }, type);
  if (type === 'workspace') return validateReference({ version: 1, kind: type, objectId, workspaceId: input.workspaceId, label: input.label, tabs: input.tabs, panes: input.panes, activeTabId: input.activeTabId }, type);
  return validateReference({ version: 1, kind: type, objectId, uri: input.uri, label: input.label, vaultId: input.vaultId }, type);
}

function finiteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isHandoffRequest(value: unknown): value is HandoffRequest { return isRecord(value) && value.version === 1 && safeId(value.requestId, 128) && safeId(value.sourceDeviceId, 512) && safeId(value.targetDeviceId, 512) && validateHandoffPayload(value.payload) !== undefined && typeof value.status === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string' && Number.isSafeInteger(value.attempts) && Number.isFinite(value.nextAttemptAt); }
function isInboxItem(value: unknown): value is DeviceInboxItem { return isRecord(value) && value.version === 1 && safeId(value.requestId, 128) && safeId(value.sourceDeviceId, 512) && safeText(value.sourceLabel, 256, true) && typeof value.receivedAt === 'string' && validateHandoffPayload(value.payload) !== undefined && typeof value.status === 'string' && typeof value.updatedAt === 'string'; }
function isContinuityState(value: unknown): value is ContinuityState { return isRecord(value) && value.version === 1 && isRecord(value.outbox) && isRecord(value.inbox) && isRecord(value.history) && isRecord(value.seen) && isRecord(value.cancelled); }
function parseWire(value: unknown): ContinuityWire | undefined {
  if (!isRecord(value) || value.version !== 1 || value.protocol !== CONTINUITY_PROTOCOL || !['DELIVER', 'ACK', 'OPENED', 'CANCEL'].includes(String(value.kind)) || !safeId(value.requestId, 128) || !safeId(value.sourceDeviceId, 512) || !safeId(value.targetDeviceId, 512) || !safeText(value.issuedAt, 64, true) || !safeText(value.expiresAt, 64, true) || !Number.isSafeInteger(value.trustEpoch)) return undefined;
  if (value.kind === 'DELIVER' && !Object.prototype.hasOwnProperty.call(value, 'ciphertext')) return undefined;
  if ((value.kind === 'ACK' || value.kind === 'OPENED') && typeof value.status !== 'string') return undefined;
  return value as unknown as ContinuityWire;
}
