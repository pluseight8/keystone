import type { AudioChunk, LocalSTTProvider, TranscriptionSegment } from './stt.js';
import { synthesizeTokenStream, type LocalTTSProvider, type SynthesizedAudioChunk } from './tts.js';

export interface StreamingTextGenerator { stream(request:{system:string;prompt:string;signal?:AbortSignal}):AsyncIterable<string>; }
export interface VoiceTurn { transcript:string; transcription:AsyncIterable<TranscriptionSegment>; audio:AsyncIterable<SynthesizedAudioChunk>; }

/** Full-duplex orchestration is deliberately transport-independent (Android/WebRTC). */
export class LocalVoicePipeline {
  constructor(private readonly stt:LocalSTTProvider,private readonly llm:StreamingTextGenerator,private readonly tts:LocalTTSProvider){}
  async transcribe(audio:AsyncIterable<AudioChunk>,options:{language?:string;signal?:AbortSignal}={}):Promise<string>{
    const session=await this.stt.createSession(options);let text='';
    const consume=(async()=>{for await(const result of session.results)if(result.final)text=mergeTranscript(text,result.text);})();
    try{for await(const chunk of audio)await session.write(chunk);await session.finish();await consume;return text.trim();}catch(error){await session.cancel(String(error));throw error;}
  }
  async *respond(audio:AsyncIterable<AudioChunk>,options:{system:string;language?:string;signal?:AbortSignal}):AsyncIterable<SynthesizedAudioChunk>{
    const prompt=await this.transcribe(audio,{language:options.language,signal:options.signal});if(!prompt)throw new Error('No speech was recognized');
    yield*synthesizeTokenStream(this.llm.stream({system:options.system,prompt,signal:options.signal}),this.tts,{signal:options.signal});
  }
  speak(tokens:AsyncIterable<string>,signal?:AbortSignal):AsyncIterable<SynthesizedAudioChunk>{return synthesizeTokenStream(tokens,this.tts,{signal});}
}
function mergeTranscript(current:string,next:string):string{const clean=next.trim();if(!clean)return current;if(!current)return clean;if(current.endsWith(clean))return current;return `${current} ${clean}`;}
