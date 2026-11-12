/** Local-only AI host boundary for the desktop shell. */
import {
  AIRouter,
  AISettingsService,
  OllamaAIProvider,
  OpenAICompatibleAIProvider,
  type AIHealthSnapshot,
  type AIModelRef,
  type AIRequest,
  type AISettingsState,
} from '@keystone/core';
import { invoke } from '@tauri-apps/api/core';
import { isTauriAvailable } from './desktop-window-runtime';

/**
 * Local model servers send no CORS headers by default, so the WebView cannot read their
 * answers. Inside the app the request goes through the loopback-only native command.
 */
const localModelFetch: typeof fetch = async (input, init) => {
  if (!isTauriAvailable()) return fetch(input, init);
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const request = invoke<{ status: number; body: string }>('desktop_local_model_http', { request: { method: init?.method ?? 'GET', url: String(input), ...(typeof init?.body === 'string' ? { body: init.body } : {}) } });
  const result = signal ? await new Promise<Awaited<typeof request>>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  }) : await request;
  return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json' } });
};

export type DesktopLocalAIProviderKind = 'ollama' | 'openai-compatible' | 'lm-studio' | 'built-in' | 'llama.cpp';

export interface DesktopLocalAIProviderInput {
  readonly kind: DesktopLocalAIProviderKind;
  readonly endpoint?: string;
  readonly model: string;
  readonly displayName?: string;
  readonly contextLimit?: number;
}

export interface DesktopLocalAIModel {
  readonly model: string;
  readonly displayName: string;
  readonly ownedBy?: string;
}

export interface DesktopAIRuntime {
  readonly settings: AISettingsService;
  router: AIRouter;
  ready(): Promise<void>;
  configureLocalProvider(input: DesktopLocalAIProviderInput): Promise<Readonly<AISettingsState>>;
  clearLocalProvider(): Promise<Readonly<AISettingsState>>;
  /** Lists models of the configured source, or of `draft` so a model can be picked before the source is saved. */
  discoverModels(draft?: { readonly kind: DesktopLocalAIProviderKind; readonly endpoint: string }): Promise<readonly DesktopLocalAIModel[]>;
  health(): Promise<AIHealthSnapshot | undefined>;
  runPrivate(request: Omit<AIRequest, 'taskPrivacy' | 'privacy'> & { readonly model?: AIModelRef | string }): Promise<{ readonly text: string; readonly model: AIModelRef }>;
  providerKind(): DesktopLocalAIProviderKind | undefined;
  subscribe?(listener: () => void): () => void;
}

let current: DesktopAIRuntime | undefined;
const listeners = new Set<() => void>();

export function installDesktopAIRuntime(runtime: DesktopAIRuntime | undefined): void {
  current = runtime;
  listeners.forEach(listener => listener());
}
export function getDesktopAIRuntime(): DesktopAIRuntime | undefined { return current; }
export function subscribeDesktopAIRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

export function createDesktopAIRuntime(settings: AISettingsService, initialRouter = new AIRouter({ remoteEnabled: false })): DesktopAIRuntime {
  let router = initialRouter;
  let provider: OllamaAIProvider | OpenAICompatibleAIProvider | undefined;
  let kind: DesktopLocalAIProviderKind | undefined;
  const localListeners = new Set<() => void>();
  let restorePromise: Promise<void> = Promise.resolve();

  const build = (input: DesktopLocalAIProviderInput) => {
    if (input.kind === 'built-in' || input.kind === 'llama.cpp') throw new Error(`${input.kind} requires a native local model host`);
    const model = cleanModel(input.model);
    const endpoint = input.kind === 'ollama' ? cleanEndpoint(input.endpoint || 'http://127.0.0.1:11434/api/chat') : cleanEndpoint(input.endpoint || 'http://127.0.0.1:1234/v1/chat/completions');
    const id = input.kind === 'ollama' ? 'ollama' : input.kind === 'lm-studio' ? 'lm-studio' : 'local-openai';
    if (input.kind === 'ollama') provider = new OllamaAIProvider({ fetch: localModelFetch, id, endpoint, model, displayName: input.displayName || 'Ollama', contextLimit: input.contextLimit ?? 8_192 });
    else provider = new OpenAICompatibleAIProvider({ fetch: localModelFetch, id, endpoint, model, scope: 'local', displayName: input.displayName || (input.kind === 'lm-studio' ? 'LM Studio' : 'Local OpenAI-compatible'), contextLimit: input.contextLimit ?? 8_192 });
    kind = input.kind;
    router = new AIRouter({ providers: [provider], defaultModel: `${id}/${model}`, remoteEnabled: false });
    return { id, model, endpoint, displayName: input.displayName || provider.models[0]?.displayName || model, contextLimit: input.contextLimit ?? 8_192 };
  };

  const discoverModels = async (draft?: { readonly kind: DesktopLocalAIProviderKind; readonly endpoint: string }): Promise<readonly DesktopLocalAIModel[]> => {
    const sourceKind = draft?.kind ?? kind;
    const endpoint = draft ? cleanEndpoint(draft.endpoint) : provider?.models[0]?.endpoint;
    if (!sourceKind || !endpoint) return [];
    return discoverDesktopLocalModels(sourceKind, endpoint);
  };

  const runtime: DesktopAIRuntime = {
    settings,
    get router() { return router; },
    set router(value: AIRouter) { router = value; },
    ready: () => restorePromise,
    async configureLocalProvider(input) {
      const configured = build(input);
      const next = await settings.update({ models: [{ ref: `${configured.id}/${configured.model}`, scope: 'local', enabled: true, endpoint: configured.endpoint, displayName: configured.displayName, contextLimit: configured.contextLimit }], defaultModel: `${configured.id}/${configured.model}`, fallbacks: [], remoteEnabled: false, personalTarget: 'this-device' });
      await settings.bindRouter(router);
      localListeners.forEach(listener => listener());
      listeners.forEach(listener => listener());
      return next;
    },
    async clearLocalProvider() {
      provider = undefined;
      kind = undefined;
      router = new AIRouter({ remoteEnabled: false });
      const next = await settings.update({ models: [], defaultModel: null, fallbacks: [], remoteEnabled: false, personalTarget: 'this-device' });
      localListeners.forEach(listener => listener());
      listeners.forEach(listener => listener());
      return next;
    },
    discoverModels,
    async health() { return provider?.health(); },
    async runPrivate(request) {
      const response = await router.run({ ...request, taskPrivacy: 'private', privacy: 'private' });
      return { text: response.text, model: response.model };
    },
    providerKind: () => kind,
    subscribe(listener) { localListeners.add(listener); return () => localListeners.delete(listener); },
  };

  restorePromise = restore(settings, build, runtime).catch(() => undefined);
  return runtime;
}

async function restore(settings: AISettingsService, build: (input: DesktopLocalAIProviderInput) => { id: string; model: string; endpoint: string; displayName: string; contextLimit: number }, runtime: DesktopAIRuntime): Promise<void> {
  await settings.ready();
  const model = settings.snapshot().models.find(value => value.scope === 'local' && value.endpoint);
  if (!model || !model.endpoint) return;
  const separator = model.ref.indexOf('/');
  if (separator <= 0) return;
  const id = model.ref.slice(0, separator);
  const kind: DesktopLocalAIProviderKind = id === 'ollama' ? 'ollama' : id === 'lm-studio' ? 'lm-studio' : 'openai-compatible';
  try {
    const configured = build({ kind, endpoint: model.endpoint, model: model.ref.slice(separator + 1), displayName: model.displayName, contextLimit: model.contextLimit });
    runtime.router = new AIRouter({ providers: [kind === 'ollama' ? new OllamaAIProvider({ fetch: localModelFetch, id: configured.id, endpoint: configured.endpoint, model: configured.model, displayName: configured.displayName, contextLimit: configured.contextLimit }) : new OpenAICompatibleAIProvider({ fetch: localModelFetch, id: configured.id, endpoint: configured.endpoint, model: configured.model, scope: 'local', displayName: configured.displayName, contextLimit: configured.contextLimit })], defaultModel: model.ref, remoteEnabled: false });
    await settings.bindRouter(runtime.router);
  } catch {
    // Persisted configuration remains visible as configuration metadata, but
    // an invalid/unavailable provider never becomes a fake ready state.
  }
}

// '@' and '/' occur in LM Studio variants and org/model names; the name only travels in a JSON body.
function cleanModel(value: string): string { const model = String(value ?? '').trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:@\/-]{0,127}$/.test(model)) throw new Error('AI model name is invalid'); return model; }
function cleanEndpoint(value: string): string { const endpoint = String(value ?? '').trim(); const url = new URL(endpoint); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Desktop local AI endpoints must point to localhost'); return endpoint; }

export async function discoverDesktopLocalModels(kind: DesktopLocalAIProviderKind, endpoint: string): Promise<readonly DesktopLocalAIModel[]> {
  const response = await localModelFetch(localModelDiscoveryEndpoint(cleanEndpoint(endpoint), kind), { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Local AI model discovery failed with HTTP ${response.status}`);
  const value = await response.json() as unknown;
  const rows = kind === 'ollama' ? ollamaModels(value) : openAIModels(value);
  return rows.flatMap(row => {
    try {
      const model = cleanModel(row.model);
      return [{ model, displayName: row.displayName || model, ...(row.ownedBy ? { ownedBy: row.ownedBy } : {}) }];
    } catch {
      return [];
    }
  });
}

function localModelDiscoveryEndpoint(endpoint: string, kind: DesktopLocalAIProviderKind): string {
  const url = new URL(endpoint);
  if (kind === 'ollama') return `${url.origin}/api/tags`;
  if (/\/chat\/completions$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
  else if (/\/chat$/.test(url.pathname)) url.pathname = url.pathname.replace(/\/chat$/, '/models');
  else if (!url.pathname.endsWith('/models')) url.pathname = `${url.pathname.replace(/\/$/, '')}/models`;
  return url.toString();
}

type LocalModelDiscoveryRow = { readonly model: string; readonly displayName?: string; readonly ownedBy?: string };

function ollamaModels(value: unknown): readonly LocalModelDiscoveryRow[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).models)) return [];
  return ((value as Record<string, unknown>).models as unknown[]).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const model = typeof row.name === 'string' ? row.name : typeof row.model === 'string' ? row.model : undefined;
    return model ? [{ model, displayName: model }] : [];
  });
}

function openAIModels(value: unknown): readonly LocalModelDiscoveryRow[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).data)) return [];
  return ((value as Record<string, unknown>).data as unknown[]).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const model = typeof row.id === 'string' ? row.id : undefined;
    const ownedBy = typeof row.owned_by === 'string' ? row.owned_by : undefined;
    return model ? [{ model, displayName: model, ...(ownedBy ? { ownedBy } : {}) }] : [];
  });
}
