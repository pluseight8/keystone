import type { DownloadProgress, LocalModelDescriptor, LocalModelManager } from '../../models/local-model-manager.js';

export interface SynthesizedAudioChunk { data: Uint8Array; sampleRate: number; channels: number; encoding: 'pcm-s16le'; final: boolean; }
export interface TTSVoice { model: LocalModelDescriptor; config?: LocalModelDescriptor; speakerId?: number; }
export interface LocalTTSProvider {
  readonly id: string;
  prepare(voice: TTSVoice, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<void>;
  synthesize(text: string, options?: { rate?: number; signal?: AbortSignal }): AsyncIterable<SynthesizedAudioChunk>;
}
export interface PiperBridge { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>; listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>; }
type PiperEvent={requestId:string;audio?:Uint8Array|number[];sampleRate?:number;channels?:number;done?:boolean;error?:string};

/** Piper's ONNX Runtime and phonemizer live in the native host, not JS. */
export class PiperTTSProvider implements LocalTTSProvider {
  readonly id='piper'; private ready=false; private speakerId?:number;
  constructor(private readonly models:LocalModelManager,private readonly bridge:PiperBridge){}
  async prepare(voice:TTSVoice,onProgress?:(progress:DownloadProgress)=>void,signal?:AbortSignal):Promise<void>{
    if(voice.model.runtime&&voice.model.runtime!=='piper')throw new Error('The selected voice is not a Piper voice');
    const modelPath=await this.models.download(voice.model,onProgress,signal);
    const configPath=voice.config?await this.models.download(voice.config,onProgress,signal):undefined;
    await this.bridge.invoke('piper_load_voice',{modelPath,configPath,speakerId:voice.speakerId});this.speakerId=voice.speakerId;this.ready=true;
  }
  async *synthesize(text:string,options:{rate?:number;signal?:AbortSignal}={}):AsyncIterable<SynthesizedAudioChunk>{
    if(!this.ready)throw new Error('Piper voice is not prepared');if(!text.trim())return;
    const requestId=crypto.randomUUID(),queue:PiperEvent[]=[];let wake:(()=>void)|undefined,ended=false;
    const unlisten=await this.bridge.listen<PiperEvent>('piper://audio',e=>{if(e.requestId!==requestId)return;queue.push(e);if(e.done||e.error)ended=true;wake?.();wake=undefined;});
    const abort=()=>{ended=true;void this.bridge.invoke('piper_cancel',{requestId});wake?.();};options.signal?.addEventListener('abort',abort,{once:true});
    try{
      await this.bridge.invoke('piper_synthesize_stream',{requestId,text:text.trim(),speakerId:this.speakerId,rate:options.rate??1});
      while(!ended||queue.length){if(!queue.length)await new Promise<void>(resolve=>{wake=resolve;});const e=queue.shift();if(!e)continue;if(e.error)throw new Error(e.error);if(e.audio)yield{data:e.audio instanceof Uint8Array?e.audio:Uint8Array.from(e.audio),sampleRate:e.sampleRate??22050,channels:e.channels??1,encoding:'pcm-s16le',final:e.done??false};}
      if(options.signal?.aborted)throw abortError();
    }finally{options.signal?.removeEventListener('abort',abort);unlisten();}
  }
}

export function piperVoiceModel(input:Omit<LocalModelDescriptor,'runtime'>):LocalModelDescriptor{return{...input,runtime:'piper'};}

/** Turns an LLM token stream into complete speakable clauses, preserving order. */
export async function* synthesizeTokenStream(tokens:AsyncIterable<string>,tts:LocalTTSProvider,options:{minCharacters?:number;maxCharacters?:number;rate?:number;signal?:AbortSignal}={}):AsyncIterable<SynthesizedAudioChunk>{
  let buffer='';const min=options.minCharacters??24,max=options.maxCharacters??240;
  const speak=async function*(text:string){yield*tts.synthesize(text,{rate:options.rate,signal:options.signal});};
  for await(const token of tokens){if(options.signal?.aborted)throw abortError();buffer+=token;let boundary=findBoundary(buffer,min,max);while(boundary>0){const sentence=buffer.slice(0,boundary).trim();buffer=buffer.slice(boundary);if(sentence)yield*speak(sentence);boundary=findBoundary(buffer,min,max);}}
  if(buffer.trim())yield*speak(buffer.trim());
}
function findBoundary(value:string,min:number,max:number):number{if(value.length<min)return 0;const upto=Math.min(value.length,max);for(let i=upto-1;i>=min-1;i--)if(/[.!?。！？\n]/u.test(value[i]))return i+1;if(value.length>=max){const space=value.lastIndexOf(' ',max);return space>=min?space+1:max;}return 0;}
function abortError():Error{const e=new Error('Speech synthesis aborted');e.name='AbortError';return e;}
