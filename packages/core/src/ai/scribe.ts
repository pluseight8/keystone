import * as Y from 'yjs';
import type { AudioChunk, LocalSTTProvider, STTSession, TranscriptionSegment } from './voice/stt.js';

export type ScribeState = 'idle' | 'recording' | 'stopping' | 'stopped' | 'error';

export interface ScribeParagraph {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  language?: string;
}

/** The host owns microphone permissions and platform lifecycle (Android Foreground Service, Tauri, etc.). */
export interface AmbientAudioSource {
  start(options: { signal: AbortSignal; onLevel?: (level: number) => void }): Promise<AsyncIterable<AudioChunk>> | AsyncIterable<AudioChunk>;
  stop?(): Promise<void>;
}

/** Persisting Yjs updates makes the temporary transcript recoverable after a process crash. */
export interface TemporaryTranscriptStore {
  load(documentId: string): Promise<Uint8Array | undefined>;
  save(documentId: string, update: Uint8Array): Promise<void>;
  clear(documentId: string): Promise<void>;
}

export interface AmbientScribeOptions {
  documentId?: string;
  pauseThresholdMs?: number;
  language?: string;
  now?: () => number;
  transcriptStore?: TemporaryTranscriptStore;
}

export type ScribeEvent =
  | { type: 'state'; state: ScribeState; error?: Error }
  | { type: 'paragraph'; paragraph: ScribeParagraph; transcript: string }
  | { type: 'partial'; text: string }
  | { type: 'level'; level: number };

/**
 * Offline continuous transcription with pause-based paragraphing. The service is
 * platform-neutral: mobile hosts feed it from a Foreground Service while desktop
 * hosts can keep the audio source alive in the background.
 */
export class AmbientScribe {
  readonly document: Y.Doc;
  readonly paragraphs: Y.Array<ScribeParagraph>;
  readonly meta: Y.Map<unknown>;
  readonly documentId: string;

  private stateValue: ScribeState = 'idle';
  private readonly listeners = new Set<(event: ScribeEvent) => void>();
  private abort?: AbortController;
  private session?: STTSession;
  private run?: Promise<void>;
  private current?: ScribeParagraph;
  private readonly pauseThresholdMs: number;
  private readonly now: () => number;
  private persistenceQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stt: LocalSTTProvider,
    private readonly audio: AmbientAudioSource,
    private readonly options: AmbientScribeOptions = {},
  ) {
    this.documentId = options.documentId ?? `scribe-${crypto.randomUUID()}`;
    this.pauseThresholdMs = options.pauseThresholdMs ?? 1_500;
    if (this.pauseThresholdMs < 200) throw new Error('pauseThresholdMs must be at least 200ms');
    this.now = options.now ?? Date.now;
    this.document = new Y.Doc({ guid: `keystone-scribe:${this.documentId}` });
    this.paragraphs = this.document.getArray<ScribeParagraph>('paragraphs');
    this.meta = this.document.getMap('meta');
    this.meta.set('documentId', this.documentId);
    this.document.on('update', this.persistUpdate);
  }

  get state(): ScribeState { return this.stateValue; }
  get transcript(): string { return this.paragraphs.toArray().map(item => item.text).join('\n\n').trim(); }

  subscribe(listener: (event: ScribeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restore the last locally persisted CRDT state before starting capture. */
  async restore(): Promise<string> {
    const update = await this.options.transcriptStore?.load(this.documentId);
    if (update?.length) Y.applyUpdate(this.document, update, 'transcript-restore');
    this.current = this.paragraphs.get(this.paragraphs.length - 1);
    return this.transcript;
  }

  async start(): Promise<void> {
    if (this.stateValue === 'recording' || this.stateValue === 'stopping') throw new Error('Ambient Scribe is already recording');
    this.abort = new AbortController();
    // Native stream timestamps restart at zero for each session. Never merge a
    // recovered paragraph with the first segment of a new capture session.
    this.current = undefined;
    this.meta.set('startedAt', new Date(this.now()).toISOString());
    this.setState('recording');
    try {
      this.session = await this.stt.createSession({ language: this.options.language, signal: this.abort.signal });
      const chunks = await this.audio.start({ signal: this.abort.signal, onLevel: value => this.emit({ type: 'level', level: clamp(value) }) });
      this.run = this.pump(chunks, this.session);
    } catch (error) {
      this.setState('error', toError(error));
      throw error;
    }
  }

  async stop(): Promise<string> {
    if (this.stateValue === 'stopped' || this.stateValue === 'idle') return this.transcript;
    if (this.stateValue !== 'recording') throw new Error('Ambient Scribe is not recording');
    this.setState('stopping');
    await this.audio.stop?.();
    try {
      await this.run;
      this.meta.set('stoppedAt', new Date(this.now()).toISOString());
      this.meta.set('complete', true);
      await this.flushPersistence();
      this.setState('stopped');
      return this.transcript;
    } catch (error) {
      const failure = toError(error);
      this.setState('error', failure);
      throw failure;
    }
  }

  async discard(): Promise<void> {
    if (this.stateValue === 'recording' || this.stateValue === 'stopping') {
      this.abort?.abort();
      await this.audio.stop?.();
      await this.session?.cancel('discarded');
      await this.run?.catch(() => undefined);
    }
    this.document.transact(() => { this.paragraphs.delete(0, this.paragraphs.length); this.meta.clear(); }, 'scribe-discard');
    await this.flushPersistence();
    await this.options.transcriptStore?.clear(this.documentId);
    this.current = undefined;
    this.setState('idle');
  }

  destroy(): void { this.document.off('update', this.persistUpdate); this.abort?.abort(); this.listeners.clear(); }

  private async pump(chunks: AsyncIterable<AudioChunk>, session: STTSession): Promise<void> {
    const consume = this.consumeResults(session.results);
    try {
      for await (const chunk of chunks) {
        if (this.abort?.signal.aborted) break;
        await session.write(chunk);
      }
      if (!this.abort?.signal.aborted) await session.finish();
      await consume;
    } catch (error) {
      await session.cancel(String(error));
      if (this.abort?.signal.aborted) return;
      throw error;
    }
  }

  private async consumeResults(results: AsyncIterable<TranscriptionSegment>): Promise<void> {
    for await (const segment of results) {
      const text = normalize(segment.text);
      if (!text) continue;
      if (!segment.final) { this.emit({ type: 'partial', text }); continue; }
      this.appendFinal({ ...segment, text });
    }
  }

  private appendFinal(segment: TranscriptionSegment): void {
    const startsParagraph = !this.current || segment.startMs - this.current.endMs >= this.pauseThresholdMs;
    let next: ScribeParagraph;
    if (startsParagraph) {
      next = { id: crypto.randomUUID(), text: segment.text, startMs: segment.startMs, endMs: segment.endMs, ...(segment.language ? { language: segment.language } : {}) };
      this.paragraphs.push([next]);
    } else {
      const index = this.paragraphs.length - 1;
      next = { ...this.current!, text: mergeText(this.current!.text, segment.text), endMs: Math.max(this.current!.endMs, segment.endMs) };
      this.paragraphs.delete(index, 1); this.paragraphs.insert(index, [next]);
    }
    this.current = next;
    this.emit({ type: 'paragraph', paragraph: next, transcript: this.transcript });
  }

  private readonly persistUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (!this.options.transcriptStore || origin === 'transcript-restore') return;
    // Persist a full snapshot, not a lone incremental update: simple stores can atomically replace one value.
    const snapshot = Y.encodeStateAsUpdate(this.document);
    this.persistenceQueue = this.persistenceQueue.then(() => this.options.transcriptStore!.save(this.documentId, snapshot));
  };
  private async flushPersistence(): Promise<void> { await this.persistenceQueue; }
  private setState(state: ScribeState, error?: Error): void { this.stateValue = state; this.emit({ type: 'state', state, error }); }
  private emit(event: ScribeEvent): void { this.listeners.forEach(listener => listener(event)); }
}

function normalize(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function mergeText(current: string, next: string): string { if (current.endsWith(next)) return current; return `${current} ${next}`.trim(); }
function clamp(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function toError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
