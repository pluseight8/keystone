/** Typed mobile host projection for R0P85 Nearby Exchange.  Private keys,
 * transport handles, manifests and received bytes never enter React Native. */
import { getMobileSettingsRuntime, subscribeMobileSettingsRuntime } from './settingsRuntime';
export type MobileNearbyReceivePolicy = 'NOT_ACCEPTING' | 'CONTACTS_ONLY' | 'TEMPORARILY_VISIBLE' | 'ASK_EVERY_TIME';
export type MobileNearbySocialState = 'ANONYMOUS' | 'IDENTITY_DISCLOSED' | 'KNOWN_CONTACT' | 'OWN_DEVICE';
export type MobileNearbyObjectType = 'file' | 'text' | 'url' | 'place' | 'route' | 'publication' | 'contact' | 'collaboration' | 'document';
export type MobileNearbyTransferStatus = 'OFFERED' | 'ACCEPTED' | 'TRANSFERRING' | 'PAUSED_WAITING_ROUTE' | 'VERIFYING' | 'RECEIVED' | 'REJECTED' | 'CANCELED' | 'FAILED' | 'EXPIRED';

export interface MobileNearbyEndpoint { readonly endpointId: string; readonly alias: string; readonly capabilities: readonly MobileNearbyObjectType[]; readonly verificationCode: string; readonly expiresAt: string; readonly socialState: MobileNearbySocialState; readonly visible: boolean; }
export interface MobileNearbyOffer { readonly offerId: string; readonly endpointId: string; readonly direction: 'OUTGOING' | 'INCOMING'; readonly objectType: MobileNearbyObjectType; readonly title: string; readonly subtitle?: string; readonly textPreview?: string; readonly byteLength?: number; readonly status: MobileNearbyTransferStatus; readonly expiresAt: string; readonly verificationCode: string; readonly updatedAt: string; }
export interface MobileNearbyTransfer { readonly transferId: string; readonly offerId: string; readonly endpointId: string; readonly direction: 'OUTGOING' | 'INCOMING'; readonly objectType: MobileNearbyObjectType; readonly status: MobileNearbyTransferStatus; readonly completedBytes: number; readonly totalBytes?: number; readonly progress: number; readonly updatedAt: string; readonly lastError?: string; }

export interface MobileNearbyExchangeRuntime {
  listNearby(): Promise<readonly MobileNearbyEndpoint[]>;
  receiveMode(): Promise<{ readonly policy: MobileNearbyReceivePolicy; readonly active: boolean; readonly until?: string }>;
  startReceive(input?: { readonly policy?: MobileNearbyReceivePolicy; readonly alias?: string; readonly durationMs?: number }): Promise<void>;
  stopReceive(): Promise<void>;
  createReceiveQr(ttlMs?: number): Promise<string>;
  incomingOffers(): Promise<readonly MobileNearbyOffer[]>;
  outgoingOffers(): Promise<readonly MobileNearbyOffer[]>;
  transfers(): Promise<readonly MobileNearbyTransfer[]>;
  accept(offerId: string): Promise<MobileNearbyTransfer>;
  reject(offerId: string, reason?: string): Promise<MobileNearbyTransfer>;
  cancel(id: string, reason?: string): Promise<MobileNearbyTransfer>;
  resume(transferId: string): Promise<MobileNearbyTransfer>;
  discloseIdentity?(endpointId: string, selectedFields: readonly string[]): Promise<{ readonly disclosedFields: readonly string[]; readonly displayName?: string }>;
  addContact?(endpointId: string): Promise<{ readonly contactId?: string }>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileNearbyExchangeRuntime | undefined;
const listeners = new Set<() => void>();
export function installMobileNearbyExchangeRuntime(runtime: MobileNearbyExchangeRuntime | undefined): void { current = runtime; listeners.forEach(listener => listener()); }
export function getMobileNearbyExchangeRuntime(): MobileNearbyExchangeRuntime | undefined { return current ?? getMobileSettingsRuntime()?.nearbyExchange; }
export function subscribeMobileNearbyExchangeRuntime(listener: () => void): () => void { listeners.add(listener); const settingsUnsubscribe = subscribeMobileSettingsRuntime(listener); return () => { listeners.delete(listener); settingsUnsubscribe(); }; }
