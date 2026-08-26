/** Typed desktop projection for R0P85 Nearby Exchange.
 *
 * The shell receives endpoint/offer/transfer metadata only. Ephemeral
 * transport handles, identity keys, manifests, chunks, QR tokens and Fabric
 * routing remain inside the native/core adapter.
 */
export type DesktopNearbyReceivePolicy = 'NOT_ACCEPTING' | 'CONTACTS_ONLY' | 'TEMPORARILY_VISIBLE' | 'ASK_EVERY_TIME';
export type DesktopNearbySocialState = 'ANONYMOUS' | 'IDENTITY_DISCLOSED' | 'KNOWN_CONTACT' | 'OWN_DEVICE';
export type DesktopNearbyObjectType = 'file' | 'text' | 'url' | 'place' | 'route' | 'publication' | 'contact' | 'collaboration' | 'document';
export type DesktopNearbyTransferStatus = 'OFFERED' | 'ACCEPTED' | 'TRANSFERRING' | 'PAUSED_WAITING_ROUTE' | 'VERIFYING' | 'RECEIVED' | 'REJECTED' | 'CANCELED' | 'FAILED' | 'EXPIRED';

export interface DesktopNearbyEndpoint {
  readonly endpointId: string;
  readonly alias: string;
  readonly capabilities: readonly DesktopNearbyObjectType[];
  readonly verificationCode: string;
  readonly expiresAt: string;
  readonly socialState: DesktopNearbySocialState;
  readonly visible: boolean;
}

export interface DesktopNearbyOffer {
  readonly offerId: string;
  readonly endpointId: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly objectType: DesktopNearbyObjectType;
  readonly title: string;
  readonly subtitle?: string;
  readonly textPreview?: string;
  readonly byteLength?: number;
  readonly status: DesktopNearbyTransferStatus;
  readonly expiresAt: string;
  readonly verificationCode: string;
  readonly updatedAt: string;
}

export interface DesktopNearbyTransfer {
  readonly transferId: string;
  readonly offerId: string;
  readonly endpointId: string;
  readonly direction: 'OUTGOING' | 'INCOMING';
  readonly objectType: DesktopNearbyObjectType;
  readonly status: DesktopNearbyTransferStatus;
  readonly completedBytes: number;
  readonly totalBytes?: number;
  readonly progress: number;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export interface DesktopNearbyExchangeRuntime {
  listNearby(): Promise<readonly DesktopNearbyEndpoint[]>;
  receiveMode(): Promise<{ readonly policy: DesktopNearbyReceivePolicy; readonly active: boolean; readonly until?: string }>;
  startReceive(input?: { readonly policy?: DesktopNearbyReceivePolicy; readonly alias?: string; readonly durationMs?: number }): Promise<void>;
  stopReceive(): Promise<void>;
  createReceiveQr(ttlMs?: number): Promise<string>;
  incomingOffers(): Promise<readonly DesktopNearbyOffer[]>;
  outgoingOffers(): Promise<readonly DesktopNearbyOffer[]>;
  transfers(): Promise<readonly DesktopNearbyTransfer[]>;
  accept(offerId: string): Promise<DesktopNearbyTransfer>;
  reject(offerId: string, reason?: string): Promise<DesktopNearbyTransfer>;
  cancel(id: string, reason?: string): Promise<DesktopNearbyTransfer>;
  resume(transferId: string): Promise<DesktopNearbyTransfer>;
  discloseIdentity?(endpointId: string, selectedFields: readonly string[]): Promise<{ readonly disclosedFields: readonly string[]; readonly displayName?: string }>;
  addContact?(endpointId: string): Promise<{ readonly contactId?: string }>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopNearbyExchangeRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopNearbyExchangeRuntime(runtime: DesktopNearbyExchangeRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getDesktopNearbyExchangeRuntime(): DesktopNearbyExchangeRuntime | undefined { return current; }
export function subscribeDesktopNearbyExchangeRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
