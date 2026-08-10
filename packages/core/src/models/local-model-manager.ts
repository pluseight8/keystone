export interface LocalModelDescriptor {
  id: string;
  name: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
  requiredMemoryBytes: number;
  family?: string;
  description?: string;
  /** Runtime which consumes this asset. Defaults to llama.cpp for GGUF files. */
  runtime?: 'llama.cpp' | 'whisper.cpp' | 'piper' | 'kokoro';
}

export interface DownloadProgress {
  modelId: string;
  phase: 'downloading' | 'verifying' | 'complete';
  downloadedBytes: number;
  totalBytes: number;
  ratio: number;
}

export interface LocalFileSystem {
  mkdir(path: string): Promise<void>;
  size(path: string): Promise<number | undefined>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** Implementations must write at exactly `offset` (not append implicitly). */
  write(path: string, offset: number, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface LocalModelManagerOptions {
  fs: LocalFileSystem;
  /** Native hosts should pass appLocalDataDir()/models. */
  modelsDirectory: string;
  manifestUrl?: string;
  huggingFaceRepositories?: readonly string[];
  fetch?: typeof globalThis.fetch;
  chunkSizeBytes?: number;
  maxRetries?: number;
}

type HuggingFaceFile = { rfilename?: string; size?: number; lfs?: { size?: number; sha256?: string; oid?: string } };

/**
 * Native-IO-independent GGUF catalogue and resumable downloader. The desktop
 * bridge supplies LocalFileSystem; keeping Node APIs out of core also makes the
 * same manager usable by mobile hosts.
 */
export class LocalModelManager {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly active = new Map<string, Promise<string>>();

  constructor(private readonly options: LocalModelManagerOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error('A fetch implementation is required');
  }

  get directory(): string { return this.options.modelsDirectory.replace(/[\\/]+$/, ''); }
  modelPath(model: Pick<LocalModelDescriptor, 'fileName'>): string { return joinPath(this.directory, safeFileName(model.fileName)); }

  async listAvailable(): Promise<LocalModelDescriptor[]> {
    if (this.options.manifestUrl) {
      const response = await this.fetcher(this.options.manifestUrl, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`Model manifest failed with HTTP ${response.status}`);
      const value: unknown = await response.json();
      if (!Array.isArray(value)) throw new Error('Invalid model manifest');
      return value.map(parseDescriptor);
    }
    const repositories = this.options.huggingFaceRepositories ?? [
      'bartowski/Llama-3.2-3B-Instruct-GGUF',
      'bartowski/Qwen2.5-3B-Instruct-GGUF',
    ];
    const groups = await Promise.all(repositories.map(repo => this.listHuggingFaceRepository(repo)));
    return groups.flat();
  }

  async listDownloaded(catalogue: readonly LocalModelDescriptor[]): Promise<Array<LocalModelDescriptor & { path: string }>> {
    const result: Array<LocalModelDescriptor & { path: string }> = [];
    for (const model of catalogue) {
      const path = this.modelPath(model);
      if (await this.options.fs.size(path) === model.sizeBytes) result.push({ ...model, path });
    }
    return result;
  }

  download(model: LocalModelDescriptor, onProgress?: (progress: DownloadProgress) => void, signal?: AbortSignal): Promise<string> {
    const checked = parseDescriptor(model);
    const existing = this.active.get(checked.id);
    if (existing) return existing;
    const task = this.downloadInternal(checked, onProgress, signal).finally(() => this.active.delete(checked.id));
    this.active.set(checked.id, task);
    return task;
  }

  private async listHuggingFaceRepository(repository: string): Promise<LocalModelDescriptor[]> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error(`Invalid HuggingFace repository: ${repository}`);
    const response = await this.fetcher(`https://huggingface.co/api/models/${repository}?expand[]=siblings`);
    if (!response.ok) throw new Error(`HuggingFace catalogue failed with HTTP ${response.status}`);
    const json = await response.json() as { siblings?: HuggingFaceFile[] };
    return (json.siblings ?? []).flatMap(file => {
      const name = file.rfilename;
      const size = file.lfs?.size ?? file.size;
      const sha = file.lfs?.sha256 ?? file.lfs?.oid?.replace(/^sha256:/, '');
      if (!name?.toLowerCase().endsWith('.gguf') || !size || !sha || !/q4_k_m/i.test(name)) return [];
      return [{
        id: `${repository}/${name}`,
        name: name.replace(/\.gguf$/i, ''), fileName: name.split('/').pop()!,
        url: `https://huggingface.co/${repository}/resolve/main/${name.split('/').map(encodeURIComponent).join('/')}`,
        sizeBytes: size, sha256: sha.toLowerCase(),
        // KV cache and runtime overhead vary with context; 25% is an honest UI estimate.
        requiredMemoryBytes: Math.ceil(size * 1.25), family: repository.split('/')[1],
      }];
    }).map(parseDescriptor);
  }

  private async downloadInternal(model: LocalModelDescriptor, onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<string> {
    await this.options.fs.mkdir(this.directory);
    const finalPath = this.modelPath(model); const partialPath = `${finalPath}.part`;
    if (await this.options.fs.size(finalPath) === model.sizeBytes) {
      try { await this.verify(finalPath, model, onProgress, signal); return finalPath; }
      catch (error) { if (signal?.aborted) throw error; /* corrupt file was removed; download a clean copy */ }
    }
    let offset = Math.min(await this.options.fs.size(partialPath) ?? 0, model.sizeBytes);
    if ((await this.options.fs.size(partialPath) ?? 0) > model.sizeBytes) { await this.options.fs.remove(partialPath); offset = 0; }
    const chunkSize = Math.max(256 * 1024, this.options.chunkSizeBytes ?? 4 * 1024 * 1024);
    onProgress?.(progress(model.id, 'downloading', offset, model.sizeBytes));
    while (offset < model.sizeBytes) {
      if (signal?.aborted) throw abortError();
      const end = Math.min(model.sizeBytes - 1, offset + chunkSize - 1);
      const bytes = await this.fetchRange(model, offset, end, signal);
      if (!bytes.length || bytes.length !== end - offset + 1) throw new Error(`Invalid chunk length at byte ${offset}`);
      await this.options.fs.write(partialPath, offset, bytes); offset += bytes.length;
      onProgress?.(progress(model.id, 'downloading', offset, model.sizeBytes));
    }
    await this.verify(partialPath, model, onProgress, signal);
    await this.options.fs.rename(partialPath, finalPath);
    onProgress?.(progress(model.id, 'complete', model.sizeBytes, model.sizeBytes));
    return finalPath;
  }

  private async fetchRange(model: LocalModelDescriptor, start: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
    const attempts = Math.max(1, this.options.maxRetries ?? 4); let error: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await this.fetcher(model.url, { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' }, signal });
        if (response.status !== 206) throw new Error(`Server refused range request (HTTP ${response.status})`);
        const range = response.headers.get('content-range');
        if (range !== `bytes ${start}-${end}/${model.sizeBytes}`) throw new Error('Server returned an unexpected Content-Range');
        return new Uint8Array(await response.arrayBuffer());
      } catch (caught) {
        if (signal?.aborted) throw abortError(); error = caught;
        if (attempt + 1 < attempts) await delay(Math.min(8_000, 500 * 2 ** attempt), signal);
      }
    }
    throw error instanceof Error ? error : new Error('Model download failed');
  }

  private async verify(path: string, model: LocalModelDescriptor, onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
    const size = await this.options.fs.size(path);
    if (size !== model.sizeBytes) throw new Error(`Model size mismatch: expected ${model.sizeBytes}, received ${size ?? 0}`);
    const hash = new Sha256(); const block = 4 * 1024 * 1024;
    for (let offset = 0; offset < size; offset += block) {
      if (signal?.aborted) throw abortError();
      hash.update(await this.options.fs.read(path, offset, Math.min(block, size - offset)));
      onProgress?.(progress(model.id, 'verifying', offset + Math.min(block, size - offset), size));
    }
    const actual = hash.digestHex();
    if (actual !== model.sha256) { await this.options.fs.remove(path); throw new Error(`SHA-256 mismatch for ${model.fileName}`); }
  }
}

function parseDescriptor(value: unknown): LocalModelDescriptor {
  if (!value || typeof value !== 'object') throw new Error('Invalid model entry'); const v = value as Record<string, unknown>;
  const strings = ['id','name','fileName','url','sha256'] as const;
  for (const key of strings) if (typeof v[key] !== 'string' || !v[key]) throw new Error(`Invalid model ${key}`);
  if (!Number.isSafeInteger(v.sizeBytes) || (v.sizeBytes as number) <= 0 || !Number.isSafeInteger(v.requiredMemoryBytes) || (v.requiredMemoryBytes as number) <= 0) throw new Error('Invalid model size');
  if (!/^[a-fA-F0-9]{64}$/.test(v.sha256 as string)) throw new Error('Invalid model SHA-256');
  if (!/^https:\/\//.test(v.url as string)) throw new Error('Model URL must use HTTPS');
  const runtimes=['llama.cpp','whisper.cpp','piper','kokoro'] as const;
  if (v.runtime !== undefined && !runtimes.includes(v.runtime as typeof runtimes[number])) throw new Error('Invalid model runtime');
  return { id:v.id as string,name:v.name as string,fileName:safeFileName(v.fileName as string),url:v.url as string,sizeBytes:v.sizeBytes as number,sha256:(v.sha256 as string).toLowerCase(),requiredMemoryBytes:v.requiredMemoryBytes as number,family:typeof v.family==='string'?v.family:undefined,description:typeof v.description==='string'?v.description:undefined,...(v.runtime?{runtime:v.runtime as NonNullable<LocalModelDescriptor['runtime']>}:{}) };
}
function safeFileName(value:string):string {
  // Models are data, never executable libraries. Keep all assets in the flat,
  // app-private models directory and explicitly allow formats used by runtimes.
  if (!/^[\w .()+-]+\.(?:gguf|bin|onnx|json|ort)$/i.test(value) || value.includes('..')) throw new Error('Unsafe model file name');
  return value;
}
function joinPath(a:string,b:string):string { return `${a}/${b}`.replace(/([^:]\/)\/+/g,'$1'); }
function progress(modelId:string,phase:DownloadProgress['phase'],downloadedBytes:number,totalBytes:number):DownloadProgress { return {modelId,phase,downloadedBytes,totalBytes,ratio:totalBytes?downloadedBytes/totalBytes:0}; }
function abortError():Error { const e=new Error('Download aborted'); e.name='AbortError'; return e; }
function delay(ms:number,signal?:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{const id=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(id);reject(abortError());},{once:true});});}

/** Small incremental SHA-256 avoids buffering multi-gigabyte files in JS RAM. */
class Sha256 {
  private h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); private tail=new Uint8Array(0); private bytes=0;
  update(data:Uint8Array):void { this.bytes+=data.length; const all=new Uint8Array(this.tail.length+data.length);all.set(this.tail);all.set(data,this.tail.length);let i=0;for(;i+64<=all.length;i+=64)this.block(all.subarray(i,i+64));this.tail=all.slice(i); }
  digestHex():string { const bits=this.bytes*8;const padLength=((56-(this.bytes+1)%64)+64)%64;const end=new Uint8Array(this.tail.length+1+padLength+8);end.set(this.tail);end[this.tail.length]=0x80;const view=new DataView(end.buffer);view.setUint32(end.length-8,Math.floor(bits/0x100000000));view.setUint32(end.length-4,bits>>>0);for(let i=0;i<end.length;i+=64)this.block(end.subarray(i,i+64));return [...this.h].map(x=>x.toString(16).padStart(8,'0')).join(''); }
  private block(b:Uint8Array):void { const k=SHA_K,w=new Uint32Array(64),v=new DataView(b.buffer,b.byteOffset,64);for(let i=0;i<16;i++)w[i]=v.getUint32(i*4);for(let i=16;i<64;i++){const a=w[i-15],c=w[i-2];const s0=rotr(a,7)^rotr(a,18)^(a>>>3),s1=rotr(c,17)^rotr(c,19)^(c>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}let[a,c,d,e,f,g,h,j]=this.h;for(let i=0;i<64;i++){const s1=rotr(f,6)^rotr(f,11)^rotr(f,25),ch=(f&g)^(~f&h),t1=(j+s1+ch+k[i]+w[i])>>>0,s0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&c)^(a&d)^(c&d),t2=(s0+maj)>>>0;j=h;h=g;g=f;f=(e+t1)>>>0;e=d;d=c;c=a;a=(t1+t2)>>>0;}const z=[a,c,d,e,f,g,h,j];for(let i=0;i<8;i++)this.h[i]=(this.h[i]+z[i])>>>0; }
}
function rotr(x:number,n:number):number{return(x>>>n)|(x<<(32-n));}
const SHA_K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
