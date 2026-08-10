/// <reference path="../../types/scure-bip39.d.ts" />
import * as Y from 'yjs';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { KeystoneConfig } from '../config/schema.js';

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const MAGIC = enc.encode('KEYSTONE\0'), AAD = enc.encode('keystone-cold-backup-v1');
export interface ColdBackupSnapshot { masterSeed: Uint8Array; yjsState: Uint8Array; globalConfig: KeystoneConfig; oramaFiles: Readonly<Record<string, Uint8Array>>; }
export interface ColdBackupResult { mnemonic: string; filename: string; bytes: Uint8Array; }
export interface RestoreTransaction { commit(): Promise<void>; rollback(): Promise<void>; }
/** stage must only write to temporary storage; commit atomically swaps it into place. */
export interface ColdBackupRestoreTarget { stage(snapshot: ColdBackupSnapshot): Promise<RestoreTransaction>; }

export function createRecoveryMnemonic(words: 12 | 24 = 24): string { return generateMnemonic(wordlist, words === 12 ? 128 : 256); }
export function captureColdBackupState(masterSeed: Uint8Array, document: Y.Doc, globalConfig: KeystoneConfig, oramaFiles: Readonly<Record<string, Uint8Array>>): ColdBackupSnapshot { return { masterSeed: masterSeed.slice(), yjsState: Y.encodeStateAsUpdate(document), globalConfig: structuredClone(globalConfig), oramaFiles }; }
export async function createColdBackup(snapshot: ColdBackupSnapshot, words: 12 | 24 = 24, now = new Date()): Promise<ColdBackupResult> { const mnemonic = createRecoveryMnemonic(words); return { mnemonic, filename: `backup-${now.toISOString().slice(0, 10)}.keystone`, bytes: await encryptSnapshot(snapshot, mnemonic) }; }
export async function encryptSnapshot(snapshot: ColdBackupSnapshot, mnemonic: string): Promise<Uint8Array> {
  checkMnemonic(mnemonic); const s = await sodium(); const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) as Uint8Array; const key = derive(s, mnemonic); const plain = pack(snapshot);
  try { return join(MAGIC, Uint8Array.of(1), nonce, s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, AAD, null, nonce, key)); } finally { s.memzero(key); s.memzero(plain); }
}
export async function decryptColdBackup(file: Uint8Array, mnemonic: string): Promise<ColdBackupSnapshot> {
  checkMnemonic(mnemonic); const s = await sodium(), ns = s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES as number, start = MAGIC.length + 1 + ns;
  if (file.length < start + 16 || !same(file.subarray(0, MAGIC.length), MAGIC) || file[MAGIC.length] !== 1) throw new Error('Invalid Keystone backup header');
  const key = derive(s, mnemonic); let plain: Uint8Array;
  try { plain = s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, file.subarray(start), AAD, file.subarray(MAGIC.length + 1, start), key); } catch { throw new Error('Incorrect recovery phrase or damaged backup'); } finally { s.memzero(key); }
  try { return unpack(plain); } finally { s.memzero(plain); }
}
/** Authentication and complete parsing happen before target.stage, so failure cannot touch live state. */
export async function restoreColdBackup(file: Uint8Array, mnemonic: string, target: ColdBackupRestoreTarget): Promise<void> { const snapshot = await decryptColdBackup(file, mnemonic); let tx: RestoreTransaction | undefined; try { tx = await target.stage(snapshot); await tx.commit(); } catch (e) { await tx?.rollback().catch(() => undefined); throw e; } }

function pack(v: ColdBackupSnapshot): Uint8Array { const es: [string, Uint8Array][] = [['master-seed.bin',v.masterSeed],['state.yjs',v.yjsState],['global-config.json',enc.encode(JSON.stringify(v.globalConfig))],...Object.entries(v.oramaFiles).map(([p,b])=>[`orama/${path(p)}`,b] as [string,Uint8Array])]; const out: Uint8Array[]=[u32(es.length)]; for(const [n,b] of es){const nb=enc.encode(n);out.push(u32(nb.length),nb,u32(b.length),b);} return join(...out); }
function unpack(b: Uint8Array): ColdBackupSnapshot { let o=0; const r=()=>{if(o+4>b.length)throw new Error('Truncated archive');const n=new DataView(b.buffer,b.byteOffset+o,4).getUint32(0);o+=4;return n;}; const m=new Map<string,Uint8Array>(), count=r(); if(count>100000)throw new Error('Invalid archive'); for(let i=0;i<count;i++){const nl=r();if(!nl||nl>4096||o+nl>b.length)throw new Error('Invalid archive');const n=path(dec.decode(b.subarray(o,o+=nl))),z=r();if(o+z>b.length||m.has(n))throw new Error('Invalid archive');m.set(n,b.slice(o,o+=z));} if(o!==b.length)throw new Error('Trailing archive data'); const masterSeed=req(m,'master-seed.bin'),yjsState=req(m,'state.yjs');let globalConfig:KeystoneConfig;try{globalConfig=JSON.parse(dec.decode(req(m,'global-config.json')));}catch{throw new Error('Invalid backup configuration');}try{Y.applyUpdate(new Y.Doc(),yjsState);}catch{throw new Error('Invalid Yjs state');}return{masterSeed,yjsState,globalConfig,oramaFiles:Object.fromEntries([...m].filter(([p])=>p.startsWith('orama/')).map(([p,v])=>[p.slice(6),v]))}; }
function derive(s:any,m:string):Uint8Array{const seed=Uint8Array.from(mnemonicToSeedSync(norm(m)));try{return s.crypto_generichash(32,seed,AAD);}finally{seed.fill(0);}}
function checkMnemonic(m:string){if(!validateMnemonic(norm(m),wordlist))throw new Error('Invalid BIP39 recovery phrase');} function norm(s:string){return s.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');} function path(p:string){p=p.replaceAll('\\','/');if(!p||p.startsWith('/')||p.split('/').some(x=>!x||x==='..'))throw new Error('Unsafe archive path');return p;} function req(m:Map<string,Uint8Array>,k:string){const v=m.get(k);if(!v)throw new Error(`Missing ${k}`);return v;} function u32(n:number){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n);return b;} function join(...a:Uint8Array[]){const b=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let o=0;for(const x of a){b.set(x,o);o+=x.length;}return b;} function same(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;} async function sodium():Promise<any>{const{default:s}=await import('libsodium-wrappers');await s.ready;return s;}
