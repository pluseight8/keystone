import type { InferenceBackend, InferenceRequest } from '../ai/llama-cpp.js';
import type { NodeId } from '../types.js';
import type { Envelope, EnvelopeSecurity, Transport, UnsignedEnvelope } from '../transport.js';

export const AI_INFERENCE_REQUEST = 'ai_inference_request' as const;
export const AI_INFERENCE_STREAM = 'ai_inference_stream' as const;

export interface AiInferenceRequestBody {
  requestId: string;
  context: { system: string; prompt: string; temperature?: number; maxTokens?: number };
}

export type AiInferenceStreamBody = {
  requestId: string;
  sequence: number;
  token?: string;
  done?: boolean;
  error?: string;
};

export interface AiInferenceRpcOptions {
  localNodeId: NodeId;
  security: EnvelopeSecurity;
  isSelfNode(nodeId: NodeId): boolean;
  allowRemoteInference(): boolean;
  backend?: InferenceBackend;
  expiresInMs?: number;
  maxConcurrentRequests?: number;
}

type StreamEvent = AiInferenceStreamBody & { sender: NodeId };
type PendingStream = { events: StreamEvent[]; wake?: () => void };

/** Signed, Self-only streaming inference RPC over the existing Hyperswarm transport. */
export class AiInferenceRpc implements AsyncDisposable {
  private readonly streams = new Map<string, PendingStream>();
  private readonly seenNonces = new Map<string, number>();
  private readonly active = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: Transport, private readonly options: AiInferenceRpcOptions) {
    this.unsubscribe = transport.onMessage(envelope => { void this.receive(envelope).catch(() => undefined); });
  }

  isOnline(peer: NodeId): boolean { return this.transport.isPeerConnected?.(peer) ?? false; }

  async *request(peer: NodeId, request: InferenceRequest): AsyncIterable<string> {
    if (!this.options.isSelfNode(peer)) throw new Error('Remote inference is restricted to trusted Self nodes');
    if (!this.isOnline(peer)) throw new MasterNodeOfflineError(peer);
    const requestId = crypto.randomUUID();
    const pending: PendingStream = { events: [] };
    this.streams.set(requestId, pending);
    const abort = () => { pending.wake?.(); pending.wake = undefined; };
    request.signal?.addEventListener('abort', abort, { once: true });
    try {
      await this.send(peer, AI_INFERENCE_REQUEST, {
        requestId,
        context: compactContext(request),
      } satisfies AiInferenceRequestBody);
      let expectedSequence = 0;
      for (;;) {
        while (!pending.events.length) {
          if (request.signal?.aborted) throw abortError();
          await new Promise<void>(resolve => { pending.wake = resolve; });
        }
        const event = pending.events.shift()!;
        if (event.sender !== peer) throw new Error('Inference stream sender changed');
        if (event.sequence !== expectedSequence++) throw new Error('Out-of-order inference stream');
        if (event.error) throw new Error(event.error);
        if (event.token !== undefined) yield event.token;
        if (event.done) return;
      }
    } finally {
      request.signal?.removeEventListener('abort', abort);
      this.streams.delete(requestId);
    }
  }

  dispose(): void { this.unsubscribe(); this.streams.clear(); this.active.clear(); }
  async [Symbol.asyncDispose](): Promise<void> { this.dispose(); }

  private async receive(envelope: Envelope): Promise<void> {
    if (envelope.recipient !== this.options.localNodeId || (envelope.type !== AI_INFERENCE_REQUEST && envelope.type !== AI_INFERENCE_STREAM)) return;
    if (Date.parse(envelope.expiresAt) <= Date.now() || !this.options.isSelfNode(envelope.sender)) return;
    if (!await this.options.security.verify(envelope) || this.isReplay(envelope)) return;
    if (envelope.type === AI_INFERENCE_STREAM) {
      const body = parseStream(envelope.body);
      const pending = this.streams.get(body.requestId);
      if (!pending) return;
      pending.events.push({ ...body, sender: envelope.sender });
      pending.wake?.(); pending.wake = undefined;
      return;
    }
    await this.serve(envelope.sender, parseRequest(envelope.body));
  }

  private async serve(peer: NodeId, request: AiInferenceRequestBody): Promise<void> {
    const limit = this.options.maxConcurrentRequests ?? 2;
    if (!this.options.allowRemoteInference()) return this.sendError(peer, request.requestId, 'Remote inference is disabled');
    if (!this.options.backend) return this.sendError(peer, request.requestId, 'No inference backend is configured');
    if (this.active.size >= limit) return this.sendError(peer, request.requestId, 'Inference server is busy');
    if (this.active.has(request.requestId)) return;
    this.active.add(request.requestId);
    let sequence = 0;
    try {
      for await (const token of this.options.backend.stream(request.context)) {
        await this.send(peer, AI_INFERENCE_STREAM, { requestId: request.requestId, sequence: sequence++, token } satisfies AiInferenceStreamBody);
      }
      await this.send(peer, AI_INFERENCE_STREAM, { requestId: request.requestId, sequence, done: true } satisfies AiInferenceStreamBody);
    } catch (error) {
      await this.send(peer, AI_INFERENCE_STREAM, { requestId: request.requestId, sequence, error: safeError(error), done: true } satisfies AiInferenceStreamBody);
    } finally { this.active.delete(request.requestId); }
  }

  private sendError(peer: NodeId, requestId: string, error: string): Promise<void> {
    return this.send(peer, AI_INFERENCE_STREAM, { requestId, sequence: 0, error, done: true } satisfies AiInferenceStreamBody);
  }

  private async send(peer: NodeId, type: typeof AI_INFERENCE_REQUEST | typeof AI_INFERENCE_STREAM, body: unknown): Promise<void> {
    const unsigned: UnsignedEnvelope = { version: 1, type, id: crypto.randomUUID(), sender: this.options.localNodeId, recipient: peer, nonce: crypto.randomUUID(), expiresAt: new Date(Date.now() + (this.options.expiresInMs ?? 60_000)).toISOString(), body };
    await this.transport.send(peer, { ...unsigned, signature: await this.options.security.sign(unsigned) });
  }

  private isReplay(envelope: Envelope): boolean {
    const now = Date.now();
    for (const [nonce, expires] of this.seenNonces) if (expires <= now) this.seenNonces.delete(nonce);
    const key = `${envelope.sender}:${envelope.nonce}`;
    if (this.seenNonces.has(key)) return true;
    this.seenNonces.set(key, Date.parse(envelope.expiresAt));
    return false;
  }
}

export interface RemoteInferenceAdapterOptions {
  masterNodeId(): NodeId | null;
  fallback?: InferenceBackend;
  onFallback?(reason: 'not_configured' | 'offline' | 'remote_error', error?: Error): void;
}

/** Routes to the configured online master and transparently falls back locally. */
export class RemoteInferenceAdapter implements InferenceBackend {
  readonly kind = 'remote' as const;
  constructor(private readonly rpc: AiInferenceRpc, private readonly options: RemoteInferenceAdapterOptions) {}
  async load(modelPath: string): Promise<void> { await this.options.fallback?.load(modelPath); }
  async unload(): Promise<void> { await this.options.fallback?.unload(); }

  async *stream(request: InferenceRequest): AsyncIterable<string> {
    const master = this.options.masterNodeId();
    if (!master) return yield* this.fallback(request, 'not_configured');
    if (!this.rpc.isOnline(master)) return yield* this.fallback(request, 'offline', new MasterNodeOfflineError(master));
    let emitted = false;
    try { for await (const token of this.rpc.request(master, request)) { emitted = true; yield token; } }
    catch (error) {
      // Never splice a fresh local completion onto a partially emitted remote one.
      if (request.signal?.aborted || emitted) throw error;
      yield* this.fallback(request, 'remote_error', asError(error));
    }
  }

  private async *fallback(request: InferenceRequest, reason: 'not_configured' | 'offline' | 'remote_error', error?: Error): AsyncIterable<string> {
    this.options.onFallback?.(reason, error);
    if (!this.options.fallback) throw error ?? new Error('No local inference fallback is configured');
    yield* this.options.fallback.stream(request);
  }
}

export class MasterNodeOfflineError extends Error {
  constructor(readonly nodeId: NodeId) { super(`Master AI node is offline: ${nodeId}`); this.name = 'MasterNodeOfflineError'; }
}

function compactContext(request: InferenceRequest): AiInferenceRequestBody['context'] {
  if (typeof request.system !== 'string' || typeof request.prompt !== 'string') throw new Error('Invalid inference context');
  return { system: request.system, prompt: request.prompt, ...(request.temperature === undefined ? {} : { temperature: request.temperature }), ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }) };
}
function parseRequest(value: unknown): AiInferenceRequestBody { const v = record(value); const context = record(v.context); if (!shortId(v.requestId) || typeof context.system !== 'string' || typeof context.prompt !== 'string' || !optionalFinite(context.temperature) || !optionalInteger(context.maxTokens)) throw new Error('Invalid inference request'); if (context.system.length + context.prompt.length > 2_000_000) throw new Error('Inference context is too large'); return { requestId:v.requestId, context:{ system:context.system, prompt:context.prompt, ...(context.temperature === undefined ? {} : {temperature:context.temperature}), ...(context.maxTokens === undefined ? {} : {maxTokens:context.maxTokens}) } }; }
function parseStream(value: unknown): AiInferenceStreamBody { const v=record(value); if(!shortId(v.requestId)||!Number.isSafeInteger(v.sequence)||(v.sequence as number)<0||(v.token!==undefined&&typeof v.token!=='string')||(v.done!==undefined&&typeof v.done!=='boolean')||(v.error!==undefined&&typeof v.error!=='string'))throw new Error('Invalid inference stream event'); return v as unknown as AiInferenceStreamBody; }
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an object');return value as Record<string,unknown>;}
function shortId(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=128;}
function optionalFinite(value:unknown):value is number|undefined{return value===undefined||(typeof value==='number'&&Number.isFinite(value));}
function optionalInteger(value:unknown):value is number|undefined{return value===undefined||(Number.isSafeInteger(value)&&(value as number)>0);}
function safeError(error:unknown):string{return asError(error).message.slice(0,512)||'Inference failed';}
function asError(error:unknown):Error{return error instanceof Error?error:new Error('Remote inference failed');}
function abortError():Error{const error=new Error('Inference aborted');error.name='AbortError';return error;}
