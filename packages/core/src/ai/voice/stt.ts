import type { DownloadProgress, LocalModelDescriptor, LocalModelManager } from '../../models/local-model-manager.js';

export type AudioEncoding = 'pcm-s16le' | 'pcm-f32le' | 'wav';
export interface AudioFormat { encoding: AudioEncoding; sampleRate: number; channels: number; }
export interface AudioChunk { data: Uint8Array; format: AudioFormat; timestampMs?: number; }
export interface TranscriptionSegment { text: string; startMs: number; endMs: number; final: boolean; language?: string; }
export interface STTSession {
  readonly results: AsyncIterable<TranscriptionSegment>;
  write(chunk: AudioChunk): Promise<void>;
  finish(): Promise<void>;
  cancel(reason?: string): Promise<void>;
}
export interface LocalSTTProvider {
  readonly id: string;
  prepare(model: LocalModelDescriptor, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void>;
  createSession(options?: { language?: string; translateToEnglish?: boolean; signal?: AbortSignal }): Promise<STTSession>;
}

export interface WhisperCppBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
}
type NativeResult = { sessionId: string; text?: string; startMs?: number; endMs?: number; final?: boolean; language?: string; done?: boolean; error?: string };

/** Native-host-neutral wrapper around an embedded whisper.cpp library. */
export class WhisperCppSTTProvider implements LocalSTTProvider {
  readonly id = 'whisper.cpp';
  private modelPath?: string;
  constructor(private readonly models: LocalModelManager, private readonly bridge: WhisperCppBridge) {}

  async prepare(model: LocalModelDescriptor, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
    if (model.runtime && model.runtime !== 'whisper.cpp') throw new Error('The selected model is not a whisper.cpp model');
    if (!/\.bin$/i.test(model.fileName)) throw new Error('whisper.cpp requires a ggml .bin model');
    const path = await this.models.download(model, onProgress, signal);
    await this.bridge.invoke('whisper_load_model', { modelPath: path });
    this.modelPath = path;
  }

  async createSession(options: { language?: string; translateToEnglish?: boolean; signal?: AbortSignal } = {}): Promise<STTSession> {
    if (!this.modelPath) throw new Error('Whisper model is not prepared');
    const sessionId = crypto.randomUUID();
    const stream = new EventStream<NativeResult, TranscriptionSegment>(
      event => event.text === undefined ? undefined : { text: event.text, startMs: event.startMs ?? 0, endMs: event.endMs ?? 0, final: event.final ?? event.done ?? false, language: event.language },
    );
    const unlisten = await this.bridge.listen<NativeResult>('whisper://transcript', event => { if (event.sessionId === sessionId) stream.push(event); });
    let closed = false;
    const close = async (cancel: boolean, reason?: string) => {
      if (closed) return; closed = true;
      try { await this.bridge.invoke(cancel ? 'whisper_cancel' : 'whisper_finish_stream', { sessionId, reason }); }
      finally { if (cancel) stream.end(); }
    };
    const onAbort = () => { void close(true, 'aborted'); };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    await this.bridge.invoke('whisper_start_stream', { sessionId, language: options.language ?? 'auto', translateToEnglish: options.translateToEnglish ?? false });
    stream.finally(() => { options.signal?.removeEventListener('abort', onAbort); unlisten(); });
    const thisBridge = this.bridge;
    return {
      results: stream,
      async write(chunk) {
        if (closed) throw new Error('STT session is closed');
        validateAudio(chunk);
        await thisBridge.invoke('whisper_push_audio', { sessionId, audio: chunk.data, format: chunk.format, timestampMs: chunk.timestampMs });
      },
      finish: () => close(false), cancel: reason => close(true, reason),
    };
  }
}

/** Descriptor metadata comes from Keystone's signed/self-hosted voice manifest. */
export function whisperModel(input: Omit<LocalModelDescriptor, 'runtime'>): LocalModelDescriptor {
  return { ...input, runtime: 'whisper.cpp' };
}

function validateAudio(chunk: AudioChunk): void {
  if (!chunk.data.length) throw new Error('Audio chunk is empty');
  if (!Number.isInteger(chunk.format.sampleRate) || chunk.format.sampleRate < 8_000 || chunk.format.sampleRate > 192_000) throw new Error('Invalid audio sample rate');
  if (!Number.isInteger(chunk.format.channels) || chunk.format.channels < 1 || chunk.format.channels > 2) throw new Error('Invalid channel count');
}

class EventStream<E extends { done?: boolean; error?: string }, T> implements AsyncIterable<T> {
  private queue: T[] = []; private waiters: Array<() => void> = []; private stopped = false; private error?: Error; private cleanup?: () => void;
  constructor(private readonly map: (event: E) => T | undefined) {}
  push(event: E): void { if (this.stopped) return; if (event.error) { this.error = new Error(event.error); this.end(); return; } const item=this.map(event); if(item!==undefined)this.queue.push(item); if(event.done)this.end(); else this.wake(); }
  end(): void { this.stopped=true; this.wake(); this.cleanup?.(); }
  finally(cleanup:()=>void):void { this.cleanup=cleanup; if(this.stopped)cleanup(); }
  private wake():void { for(const waiter of this.waiters.splice(0))waiter(); }
  async *[Symbol.asyncIterator](): AsyncIterator<T> { while(!this.stopped||this.queue.length){ if(!this.queue.length)await new Promise<void>(resolve=>this.waiters.push(resolve)); while(this.queue.length)yield this.queue.shift()!; } if(this.error)throw this.error; }
}
