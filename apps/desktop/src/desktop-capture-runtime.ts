/** Typed desktop projection for R0P94 Universal Capture. */
import {
  CaptureService,
  type CaptureBrowserBoundary,
  type CaptureBrowserPage,
  type CaptureBrowserSelection,
  type CaptureDestinationKind,
  type CaptureDestinationPreview,
  type CaptureDestinationResult,
  type CaptureFileInput,
  type CaptureItem,
  type CaptureListQuery,
  type CapturePage,
  type CaptureSuggestion,
  type CaptureTextInput,
} from '@keystone/core';

export interface DesktopCaptureRuntime {
  readonly capture: CaptureService;
  readonly hostConnected?: boolean;
  list(query?: CaptureListQuery): Promise<CapturePage>;
  search(query: string, options?: Omit<CaptureListQuery, 'query'>): Promise<CapturePage>;
  captureText(input: CaptureTextInput | string): Promise<CaptureItem>;
  captureUrl(url: string, options?: Omit<CaptureTextInput, 'text'> & { readonly title?: string }): Promise<CaptureItem>;
  captureClipboard(input?: { readonly ownerConfirmed: true; readonly signal?: AbortSignal }): Promise<CaptureItem>;
  captureFile(input: CaptureFileInput): Promise<CaptureItem>;
  captureBrowserPage(input: { readonly ownerConfirmed: true; readonly page?: CaptureBrowserPage; readonly signal?: AbortSignal }): Promise<CaptureItem>;
  captureBrowserSelection(input: { readonly ownerConfirmed: true; readonly selection?: CaptureBrowserSelection; readonly signal?: AbortSignal }): Promise<CaptureItem>;
  captureDeepLink(link: string): Promise<CaptureItem>;
  suggestions(id: string): Promise<readonly CaptureSuggestion[]>;
  preview(id: string, destination: CaptureDestinationKind): Promise<CaptureDestinationPreview>;
  route(id: string, destination: CaptureDestinationKind): Promise<CaptureDestinationResult>;
  dismiss(id: string): Promise<CaptureItem>;
  restore(id: string): Promise<CaptureItem>;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopCaptureRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopCaptureRuntime(runtime: DesktopCaptureRuntime | undefined): void { current = runtime; for (const listener of listeners) listener(); }
export function getDesktopCaptureRuntime(): DesktopCaptureRuntime | undefined { return current; }
export function subscribeDesktopCaptureRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopCaptureRuntime(service: CaptureService, options: { readonly hostConnected?: boolean; readonly browser?: CaptureBrowserBoundary } = {}): DesktopCaptureRuntime {
  return {
    capture: service,
    hostConnected: options.hostConnected ?? false,
    list: query => service.list(query),
    search: (query, queryOptions) => service.search(query, queryOptions),
    captureText: input => service.captureText(input),
    captureUrl: (url, input) => service.captureUrl(url, input),
    captureClipboard: input => service.captureClipboard({ ownerConfirmed: true, ...(input?.signal ? { signal: input.signal } : {}) }),
    captureFile: input => service.captureFile(input),
    captureBrowserPage: input => service.captureBrowserPage({ ownerConfirmed: true, ...(input.page ? { page: input.page } : {}), ...(options.browser ? { boundary: options.browser } : {}), ...(input.signal ? { signal: input.signal } : {}) }),
    captureBrowserSelection: input => service.captureBrowserSelection({ ownerConfirmed: true, ...(input.selection ? { selection: input.selection } : {}), ...(options.browser ? { boundary: options.browser } : {}), ...(input.signal ? { signal: input.signal } : {}) }),
    captureDeepLink: link => service.captureDeepLink(link),
    suggestions: id => service.suggest(id),
    preview: (id, destination) => service.previewRoute(id, destination),
    route: (id, destination) => service.route(id, destination, { ownerConfirmed: true }),
    dismiss: id => service.dismiss(id),
    restore: id => service.restore(id),
    subscribe: listener => service.subscribe(() => listener()),
  };
}

/** Text/tray fallback keeps Quick Capture useful before native bootstrap. */
const fallback = new CaptureService();
current = createDesktopCaptureRuntime(fallback, { hostConnected: false });
