/** Typed mobile projection for R0P94 Universal Capture and Share-In. */
import {
  CaptureService,
  type CaptureDestinationKind,
  type CaptureDestinationPreview,
  type CaptureFileInput,
  type CaptureItem,
  type CaptureListQuery,
  type CapturePage,
  type CapturePayload,
  type CaptureSuggestion,
} from '@keystone/core';

export type MobileSharePlatform = 'ANDROID' | 'IOS';
export interface MobileShareInBoundary {
  readonly platform: MobileSharePlatform;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED';
  /** Android ACTION_SEND/ACTION_SEND_MULTIPLE and iOS Share Extension feed this typed payload. */
  readonly receive: (payload: CapturePayload, accepted: true) => Promise<CaptureItem>;
}

export interface MobileCaptureRuntime {
  readonly capture: CaptureService;
  readonly shareIn?: MobileShareInBoundary;
  list(query?: CaptureListQuery): Promise<CapturePage>;
  search(query: string, options?: Omit<CaptureListQuery, 'query'>): Promise<CapturePage>;
  text(value: string): Promise<CaptureItem>;
  url(value: string): Promise<CaptureItem>;
  file(input: CaptureFileInput): Promise<CaptureItem>;
  shareInPayload(payload: CapturePayload): Promise<CaptureItem>;
  suggestions(id: string): Promise<readonly CaptureSuggestion[]>;
  preview(id: string, destination: CaptureDestinationKind): Promise<CaptureDestinationPreview>;
  route(id: string, destination: CaptureDestinationKind): Promise<unknown>;
  dismiss(id: string): Promise<CaptureItem>;
  restore(id: string): Promise<CaptureItem>;
  subscribe?(listener: () => void): () => void;
}

let current: MobileCaptureRuntime | undefined;
const listeners = new Set<() => void>();

export function installMobileCaptureRuntime(runtime: MobileCaptureRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getMobileCaptureRuntime(): MobileCaptureRuntime | undefined { return current; }
export function subscribeMobileCaptureRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createMobileCaptureRuntime(service: CaptureService, shareIn?: MobileShareInBoundary): MobileCaptureRuntime {
  return {
    capture: service, ...(shareIn ? { shareIn } : {}),
    list: query => service.list(query), search: (query, options) => service.search(query, options), text: value => service.captureText(value), url: value => service.captureUrl(value), file: input => service.captureFile(input),
    shareInPayload: async payload => { if (!shareIn) return service.captureShareIn({ accepted: true, payload, source: { kind: 'OS_SHARE' } }); return shareIn.receive(payload, true); },
    suggestions: id => service.suggest(id), preview: (id, destination) => service.previewRoute(id, destination), route: (id, destination) => service.route(id, destination, { ownerConfirmed: true }), dismiss: id => service.dismiss(id), restore: id => service.restore(id), subscribe: listener => service.subscribe(() => listener()),
  };
}

/** In-app text/tray fallback. Native Share Sheet is optional and status is explicit. */
const fallback = new CaptureService();
current = createMobileCaptureRuntime(fallback);
