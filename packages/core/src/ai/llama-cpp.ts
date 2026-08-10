import type { AIModelAdapter, ModelToolCall, ModelToolDefinition } from '../ai.js';

export interface InferenceRequest { system: string; prompt: string; temperature?: number; maxTokens?: number; signal?: AbortSignal; }
export interface InferenceBackend {
  readonly kind: 'local' | 'remote';
  load(modelPath: string): Promise<void>;
  unload(): Promise<void>;
  stream(request: InferenceRequest): AsyncIterable<string>;
}

export interface LlamaCppBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
}
type NativeToken = { requestId: string; token?: string; done?: boolean; error?: string };

/** Adapter for the in-process llama.cpp Tauri command; no HTTP daemon involved. */
export class LlamaCppAdapter implements InferenceBackend, AIModelAdapter {
  readonly kind = 'local' as const;
  private loadedPath?: string;
  constructor(private readonly bridge: LlamaCppBridge, private readonly defaults: { maxTokens?: number; temperature?: number } = {}) {}

  async load(modelPath: string): Promise<void> {
    if (!modelPath.toLowerCase().endsWith('.gguf')) throw new Error('Only GGUF models are supported');
    await this.bridge.invoke('llama_load_model', { modelPath }); this.loadedPath = modelPath;
  }
  async unload(): Promise<void> { await this.bridge.invoke('llama_unload_model'); this.loadedPath = undefined; }

  async *stream(request: InferenceRequest): AsyncIterable<string> {
    if (!this.loadedPath) throw new Error('No local model is loaded');
    const requestId = crypto.randomUUID();
    const queue: NativeToken[] = []; let wake: (()=>void)|undefined; let stopped = false;
    const unlisten = await this.bridge.listen<NativeToken>('llama://token', payload => {
      if (payload.requestId !== requestId) return; queue.push(payload); wake?.(); wake=undefined;
    });
    const cancel = () => { stopped=true; void this.bridge.invoke('llama_cancel', { requestId }); wake?.(); };
    request.signal?.addEventListener('abort', cancel, { once:true });
    try {
      await this.bridge.invoke('llama_generate', { request: { requestId, system:request.system, prompt:request.prompt, maxTokens:request.maxTokens??this.defaults.maxTokens??512, temperature:request.temperature??this.defaults.temperature??0 } });
      while (!stopped) {
        if (!queue.length) await new Promise<void>(resolve => { wake=resolve; });
        const event=queue.shift(); if(!event) continue;
        if(event.error) throw new Error(event.error); if(event.token) yield event.token; if(event.done) return;
      }
      throw abortError();
    } finally { request.signal?.removeEventListener('abort',cancel); unlisten(); }
  }

  async completeText(input:{system:string;user:string}):Promise<string> { let text='';for await(const token of this.stream({system:input.system,prompt:input.user}))text+=token;return text; }
  streamText(input:{system:string;user:string;signal?:AbortSignal}):AsyncIterable<string>{return this.stream({system:input.system,prompt:input.user,signal:input.signal});}
  async complete(input:{system:string;user:string;tool:ModelToolDefinition}):Promise<ModelToolCall> {
    const schema=JSON.stringify(input.tool.parameters);
    const text=await this.completeText({system:`${input.system}\nCall ${input.tool.name}. Return ONLY one JSON object matching this JSON Schema: ${schema}`,user:input.user});
    let args:unknown;try{args=JSON.parse(extractJson(text));}catch{throw new Error('Local model returned invalid tool JSON');}
    return {name:input.tool.name,arguments:args};
  }
}

/** Selects embedded llama.cpp whenever a downloaded model was explicitly chosen. */
export function selectInferenceBackend(input:{localModelPath?:string;llamaCpp:LlamaCppAdapter;fallback:AIModelAdapter}):AIModelAdapter {
  return input.localModelPath ? input.llamaCpp : input.fallback;
}
function extractJson(value:string):string { const fenced=value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];if(fenced)return fenced.trim();const start=value.indexOf('{'),end=value.lastIndexOf('}');if(start<0||end<start)throw new Error('No JSON object');return value.slice(start,end+1); }
function abortError():Error{const e=new Error('Inference aborted');e.name='AbortError';return e;}
