import { once } from 'node:events';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { KeystoneConfigSchema, type KeystoneConfig } from '../config/schema.js';
import type { NodeId } from '../types.js';

export interface MigrationFile { path: string; size: number; open(): AsyncIterable<Uint8Array>; sha256?: string; }
export interface MigrationSource { config: KeystoneConfig; document: Y.Doc; ragFiles: AsyncIterable<MigrationFile>; }
export interface MigrationWritable { write(chunk: Uint8Array): boolean; once(event: 'drain', listener: () => void): unknown; end(): void; destroy(error?: Error): void; }
export interface MigrationChannel { openAuthenticated(peer: NodeId, sessionToken: string): Promise<MigrationWritable>; }
export interface MigrationProgress { phase: 'config' | 'yjs' | 'rag' | 'complete'; bytesSent: number; totalBytes: number; currentPath?: string; }
type EntryHeader = { type: 'config' | 'yjs' | 'rag'; path: string; size: number; sha256: string };
const MAGIC = new TextEncoder().encode('KEYSTONE-MIGRATION\u0001');

/** Constant-memory, backpressure-aware archive sender over an authenticated Hyperswarm channel. */
export class MigrationManager {
  constructor(private readonly channel: MigrationChannel, private readonly chunkSize = 64 * 1024) { if (!Number.isInteger(chunkSize) || chunkSize < 4_096 || chunkSize > 1024 * 1024) throw new Error('Invalid migration chunk size'); }
  async migrate(peer: NodeId, sessionToken: string, source: MigrationSource, onProgress: (progress: MigrationProgress) => void = () => undefined): Promise<void> {
    if (sessionToken.length < 32) throw new Error('Handover session token must have at least 32 characters');
    const config = new TextEncoder().encode(JSON.stringify(KeystoneConfigSchema.parse(source.config))); const yjs = Y.encodeStateAsUpdate(source.document);
    const files: MigrationFile[] = []; let total = config.byteLength + yjs.byteLength;
    for await (const file of source.ragFiles) { validateFile(file); files.push(file); total += file.size; }
    const stream = await this.channel.openAuthenticated(peer, sessionToken); let sent = 0;
    try {
      await write(stream, MAGIC);
      sent = await this.writeBytes(stream, { type: 'config', path: 'global-config.json', size: config.byteLength, sha256: digest(config) }, config, sent, total, onProgress);
      sent = await this.writeBytes(stream, { type: 'yjs', path: 'ecosystem.yjs', size: yjs.byteLength, sha256: digest(yjs) }, yjs, sent, total, onProgress);
      for (const file of files) {
        const expected = file.sha256?.toLowerCase(); await writeHeader(stream, { type: 'rag', path: safePath(file.path), size: file.size, sha256: expected ?? 'stream-verified-at-receiver' });
        const hash = createHash('sha256'); let count = 0;
        for await (const input of file.open()) for (let offset = 0; offset < input.byteLength; offset += this.chunkSize) { const chunk = input.subarray(offset, Math.min(offset + this.chunkSize, input.byteLength)); count += chunk.byteLength; if (count > file.size) throw new Error(`RAG file exceeds declared size: ${file.path}`); hash.update(chunk); await write(stream, chunk); sent += chunk.byteLength; onProgress({ phase: 'rag', bytesSent: sent, totalBytes: total, currentPath: file.path }); }
        if (count !== file.size) throw new Error(`RAG file size mismatch: ${file.path}`); if (expected && hash.digest('hex') !== expected) throw new Error(`RAG file hash mismatch: ${file.path}`);
      }
      stream.end(); onProgress({ phase: 'complete', bytesSent: sent, totalBytes: total });
    } catch (error) { stream.destroy(error instanceof Error ? error : new Error(String(error))); throw error; }
  }
  private async writeBytes(stream: MigrationWritable, header: EntryHeader, bytes: Uint8Array, sent: number, total: number, report: (p: MigrationProgress) => void): Promise<number> { await writeHeader(stream, header); for (let offset = 0; offset < bytes.byteLength; offset += this.chunkSize) { const chunk = bytes.subarray(offset, offset + this.chunkSize); await write(stream, chunk); sent += chunk.byteLength; report({ phase: header.type, bytesSent: sent, totalBytes: total }); } return sent; }
}
async function writeHeader(stream: MigrationWritable, header: EntryHeader): Promise<void> { const bytes = new TextEncoder().encode(JSON.stringify(header)); if (bytes.byteLength > 65_536) throw new Error('Migration header too large'); const prefix = new Uint8Array(4); new DataView(prefix.buffer).setUint32(0, bytes.byteLength); await write(stream, prefix); await write(stream, bytes); }
async function write(stream: MigrationWritable, bytes: Uint8Array): Promise<void> { if (!stream.write(bytes)) await once(stream as never, 'drain'); }
function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function safePath(path: string): string { if (!path || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error(`Unsafe RAG path: ${path}`); return path; }
function validateFile(file: MigrationFile): void { safePath(file.path); if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`Invalid RAG file size: ${file.path}`); if (file.sha256 && !/^[a-f0-9]{64}$/i.test(file.sha256)) throw new Error(`Invalid SHA-256: ${file.path}`); }
