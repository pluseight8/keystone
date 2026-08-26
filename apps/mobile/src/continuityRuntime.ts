/** Typed mobile host boundary for R0P84 Device Continuity.
 *
 * React Native receives bounded device/handoff projections only. Trust,
 * encryption, Fabric routing, file bytes and clipboard writes stay in the
 * native/core adapter.
 */
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from './settingsRuntime';

export type MobileContinuityObjectType =
  | 'file' | 'vault' | 'document' | 'browser' | 'place' | 'route' | 'mail'
  | 'publication' | 'collaboration' | 'messaging' | 'workspace' | 'clipboard';
export type MobileContinuityAction = 'OPEN' | 'CONTINUE';
export type MobileContinuityStatus = 'QUEUED' | 'SENDING' | 'DELIVERED_TO_DEVICE' | 'ACCEPTED' | 'OPENED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type MobileContinuityAvailability = 'AVAILABLE' | 'RECENTLY_AVAILABLE' | 'OFFLINE' | 'WAITING_FOR_ROUTE' | 'UNKNOWN';

export interface MobileContinuityDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly platform: string;
  readonly trustState: 'TRUSTED' | 'REVOKED' | 'PENDING' | 'EXPIRED';
  readonly capabilities: readonly string[];
  readonly availability: MobileContinuityAvailability;
  readonly lastSeenAt?: string;
  readonly isCurrent: boolean;
}

export interface MobileContinuityReference {
  readonly objectId: string;
  readonly kind?: MobileContinuityObjectType;
  readonly label?: string;
  readonly title?: string;
  readonly uri?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

export interface MobileContinuityItem {
  readonly requestId: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly sourceLabel?: string;
  readonly type: MobileContinuityObjectType;
  readonly action: MobileContinuityAction;
  readonly status: MobileContinuityStatus;
  readonly reference: MobileContinuityReference;
  readonly title: string;
  readonly createdAt?: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export interface MobileContinuitySendInput {
  readonly targetDeviceId: string;
  readonly type: Exclude<MobileContinuityObjectType, 'clipboard'>;
  readonly reference: MobileContinuityReference;
  readonly action?: MobileContinuityAction;
  readonly viewContext?: Record<string, unknown>;
  readonly continuationState?: Record<string, unknown>;
  readonly ttlMs?: number;
}

export interface MobileContinuityRuntime {
  devices(): Promise<readonly MobileContinuityDevice[]>;
  inbox(): Promise<readonly MobileContinuityItem[]>;
  outbox(): Promise<readonly MobileContinuityItem[]>;
  sendToDevice(input: MobileContinuitySendInput): Promise<MobileContinuityItem>;
  continueOnDevice(input: Omit<MobileContinuitySendInput, 'action'>): Promise<MobileContinuityItem>;
  openIncoming(requestId: string): Promise<MobileContinuityItem>;
  cancel(requestId: string): Promise<MobileContinuityItem>;
  flush(targetDeviceId?: string): Promise<{ readonly attempted: number; readonly delivered: number; readonly pending: number }>;
  automaticClipboardContinuityEnabled(): Promise<boolean>;
  setAutomaticClipboardContinuity(enabled: boolean, ownerConfirmed: boolean): Promise<boolean>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileContinuityRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileContinuityRuntime(runtime: MobileContinuityRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileContinuityRuntime(): MobileContinuityRuntime | undefined { return current ?? getMobileSettingsRuntime()?.continuity; }
export function subscribeMobileContinuityRuntime(listener: () => void): () => void {
  listeners.add(listener);
  const settingsUnsubscribe = subscribeMobileSettingsRuntime(listener);
  return () => { listeners.delete(listener); settingsUnsubscribe(); };
}
