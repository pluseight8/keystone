/** Typed desktop host boundary for R0P84 Device Continuity.
 *
 * The shell receives bounded projections only. A native bootstrapper may
 * adapt ContinuityService here, but this module never exposes trust keys,
 * Fabric transports, browser sessions, file bytes or clipboard injection.
 */
export type DesktopContinuityObjectType =
  | 'file' | 'vault' | 'document' | 'browser' | 'place' | 'route' | 'mail'
  | 'publication' | 'collaboration' | 'messaging' | 'workspace' | 'clipboard';
export type DesktopContinuityAction = 'OPEN' | 'CONTINUE';
export type DesktopContinuityStatus = 'QUEUED' | 'SENDING' | 'DELIVERED_TO_DEVICE' | 'ACCEPTED' | 'OPENED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
export type DesktopContinuityAvailability = 'AVAILABLE' | 'RECENTLY_AVAILABLE' | 'OFFLINE' | 'WAITING_FOR_ROUTE' | 'UNKNOWN';

export interface DesktopContinuityDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly platform: string;
  readonly trustState: 'TRUSTED' | 'REVOKED' | 'PENDING' | 'EXPIRED';
  readonly capabilities: readonly string[];
  readonly availability: DesktopContinuityAvailability;
  readonly lastSeenAt?: string;
  readonly isCurrent: boolean;
}

export interface DesktopContinuityReference {
  readonly objectId: string;
  readonly label?: string;
  readonly title?: string;
  readonly uri?: string;
  readonly url?: string;
  readonly [key: string]: unknown;
}

export interface DesktopContinuityItem {
  readonly requestId: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly sourceDeviceId: string;
  readonly targetDeviceId: string;
  readonly sourceLabel?: string;
  readonly type: DesktopContinuityObjectType;
  readonly action: DesktopContinuityAction;
  readonly status: DesktopContinuityStatus;
  readonly reference: DesktopContinuityReference;
  readonly title: string;
  readonly createdAt?: string;
  readonly expiresAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export interface DesktopContinuitySendInput {
  readonly targetDeviceId: string;
  readonly type: Exclude<DesktopContinuityObjectType, 'clipboard'>;
  readonly reference: DesktopContinuityReference;
  readonly action?: DesktopContinuityAction;
  readonly viewContext?: Record<string, unknown>;
  readonly continuationState?: Record<string, unknown>;
  readonly ttlMs?: number;
}

export interface DesktopContinuityRuntime {
  devices(): Promise<readonly DesktopContinuityDevice[]>;
  capability?(targetDeviceId: string, type: DesktopContinuityObjectType): Promise<{ readonly allowed: boolean; readonly state: 'SUPPORTED' | 'UNSUPPORTED' | 'UNKNOWN'; readonly reason?: string }>;
  inbox(): Promise<readonly DesktopContinuityItem[]>;
  outbox(): Promise<readonly DesktopContinuityItem[]>;
  history?(): Promise<readonly DesktopContinuityItem[]>;
  sendToDevice(input: DesktopContinuitySendInput): Promise<DesktopContinuityItem>;
  continueOnDevice(input: Omit<DesktopContinuitySendInput, 'action'>): Promise<DesktopContinuityItem>;
  openIncoming(requestId: string): Promise<DesktopContinuityItem>;
  cancel(requestId: string): Promise<DesktopContinuityItem>;
  flush(targetDeviceId?: string): Promise<{ readonly attempted: number; readonly delivered: number; readonly pending: number }>;
  automaticClipboardContinuityEnabled(): Promise<boolean>;
  setAutomaticClipboardContinuity(enabled: boolean, ownerConfirmed: boolean): Promise<boolean>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopContinuityRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopContinuityRuntime(runtime: DesktopContinuityRuntime | undefined): void {
  current = runtime;
  for (const listener of listeners) listener();
}

export function getDesktopContinuityRuntime(): DesktopContinuityRuntime | undefined { return current; }
export function subscribeDesktopContinuityRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
