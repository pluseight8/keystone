/**
 * R0P94 Linux capture boundary.
 *
 * This adapter performs one explicit Wayland clipboard read at a time.  It
 * deliberately has no watcher/history API and never opens a URL, executes a
 * command or turns an OS path into a Keystone capability by itself.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { NativeFileHandle, NativeFileSystemService, NativeHostError, type NativeHostRequest } from './index.js';

export interface NativeCaptureClipboardValue {
  readonly text?: string;
  readonly mimeType: 'text/plain';
}

export interface NativeCaptureCommandResult {
  readonly code: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export type NativeCaptureCommandRunner = (command: string, args: readonly string[], options: { readonly maxBytes: number; readonly signal?: AbortSignal }) => Promise<NativeCaptureCommandResult>;

export interface NativeCaptureClipboard {
  readonly available: () => boolean;
  readonly read: (request: NativeHostRequest, options?: { readonly maxBytes?: number; readonly signal?: AbortSignal }) => Promise<NativeCaptureClipboardValue | undefined>;
}

export interface NativeCaptureFileHandle {
  readonly kind: 'NATIVE_CAPTURE_FILE_HANDLE';
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly read: (signal?: AbortSignal) => Promise<Uint8Array>;
  readonly close: () => void;
}

export interface NativeCaptureFileBoundary {
  readonly selectFile: (path: string, request: NativeHostRequest) => Promise<NativeCaptureFileHandle>;
}

export interface NativeCaptureHost {
  readonly platform: 'linux';
  readonly clipboard: NativeCaptureClipboard;
  readonly files: NativeCaptureFileBoundary;
  readonly shareIn: NativeShareInBoundary;
}

export interface NativeShareInPayload {
  readonly kind: 'TEXT' | 'URL' | 'FILE' | 'IMAGE' | 'REFERENCE';
  readonly text?: string;
  readonly url?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly opaqueHandleId?: string;
}

export interface NativeShareInBoundary {
  readonly status: () => 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED';
  /** Native integrations call this only after the owner accepts the share-in UI. */
  readonly receive: (payload: NativeShareInPayload, request: NativeHostRequest) => Promise<NativeShareInPayload>;
}

const MAX_CLIPBOARD_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;

function findExecutable(name: string): string | undefined {
  for (const path of [`/usr/bin/${name}`, `/bin/${name}`, `/usr/local/bin/${name}`]) if (existsSync(path)) return path;
  return undefined;
}

function bounded(value: number | undefined, fallback: number, max: number): number {
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(max, value!)) : fallback;
}

function runCommand(command: string, args: readonly string[], options: { readonly maxBytes: number; readonly signal?: AbortSignal }): Promise<NativeCaptureCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const output: Uint8Array[] = []; const errors: Uint8Array[] = []; let outputLength = 0; let errorLength = 0; let settled = false;
    const finish = (error?: Error, code: number | null = null) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve({ code, stdout: join(output), stderr: join(errors) }); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Clipboard command timed out')); }, 5_000);
    const abort = () => { child.kill('SIGKILL'); finish(new NativeHostError('CANCELLED', 'Clipboard read was cancelled')); };
    if (options.signal?.aborted) return abort(); options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Uint8Array) => { if (outputLength < options.maxBytes) { const value = Buffer.from(chunk).subarray(0, options.maxBytes - outputLength); output.push(new Uint8Array(value)); outputLength += value.byteLength; } });
    child.stderr.on('data', (chunk: Uint8Array) => { if (errorLength < 8 * 1024) { const value = Buffer.from(chunk).subarray(0, 8 * 1024 - errorLength); errors.push(new Uint8Array(value)); errorLength += value.byteLength; } });
    child.once('error', error => finish(new NativeHostError('PLATFORM_FAILURE', `Clipboard command failed: ${error.message}`)));
    child.once('close', code => { options.signal?.removeEventListener('abort', abort); finish(undefined, code); });
  });
}

function join(parts: readonly Uint8Array[]): Uint8Array { const total = parts.reduce((sum, part) => sum + part.byteLength, 0); const result = new Uint8Array(total); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.byteLength; } return result; }

export class LinuxNativeClipboardCapture implements NativeCaptureClipboard {
  private readonly command?: string;
  private readonly runner: NativeCaptureCommandRunner;
  constructor(options: { readonly command?: string; readonly runner?: NativeCaptureCommandRunner } = {}) { this.command = options.command ?? findExecutable('wl-paste'); this.runner = options.runner ?? runCommand; }
  available(): boolean { return Boolean(this.command) && process.platform === 'linux'; }
  async read(request: NativeHostRequest, options: { readonly maxBytes?: number; readonly signal?: AbortSignal } = {}): Promise<NativeCaptureClipboardValue | undefined> {
    if (request.capability !== 'clipboard.read' || request.principal.kind !== 'OWNER_UI') throw new NativeHostError('POLICY_DENIED', 'Clipboard capture requires owner UI and clipboard.read');
    if (!this.command || process.platform !== 'linux') throw new NativeHostError('UNSUPPORTED', 'Wayland clipboard capture is unavailable on this host');
    const maxBytes = bounded(options.maxBytes, MAX_CLIPBOARD_BYTES, MAX_CLIPBOARD_BYTES); const result = await this.runner(this.command, ['--no-newline', '--type', 'text/plain'], { maxBytes, signal: options.signal });
    if (result.code !== 0) { if (result.code === 1) return undefined; throw new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Wayland clipboard read failed'); }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(result.stdout).replace(/\u0000/g, '').trim(); return text ? { text, mimeType: 'text/plain' } : undefined;
  }
}

export class NativeCaptureFileBoundaryImpl implements NativeCaptureFileBoundary {
  constructor(private readonly fileSystem: NativeFileSystemService) {}
  async selectFile(path: string, request: NativeHostRequest): Promise<NativeCaptureFileHandle> {
    const handle = await this.fileSystem.selectFile(path, request, { writable: false }); const metadata = handle.metadata; if (metadata.size > MAX_FILE_BYTES) { this.fileSystem.close(handle); throw new NativeHostError('RESOURCE_EXHAUSTED', 'Capture file exceeds the bounded size limit'); }
    let closed = false; return { kind: 'NATIVE_CAPTURE_FILE_HANDLE', id: handle.id, name: metadata.name, mimeType: guessMime(metadata.name), size: metadata.size, read: async signal => { if (closed) throw new NativeHostError('HANDLE_INVALID', 'Capture file handle is closed'); return this.fileSystem.read(handle, signal); }, close: () => { if (!closed) { closed = true; this.fileSystem.close(handle); } } };
  }
}

export class UnavailableNativeShareInBoundary implements NativeShareInBoundary {
  status(): 'UNAVAILABLE' { return 'UNAVAILABLE'; }
  receive(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Native OS Share-In is unavailable on this host')); }
}

export function createLinuxNativeCaptureHost(options: { readonly fileSystem?: NativeFileSystemService; readonly clipboard?: NativeCaptureClipboard; readonly command?: string; readonly runner?: NativeCaptureCommandRunner } = {}): NativeCaptureHost {
  const fileSystem = options.fileSystem ?? new NativeFileSystemService(joinPath(tmpdir(), 'keystone-capture'), () => 'capture-host'); void fileSystem.init(); return { platform: 'linux', clipboard: options.clipboard ?? new LinuxNativeClipboardCapture({ command: options.command, runner: options.runner }), files: new NativeCaptureFileBoundaryImpl(fileSystem), shareIn: new UnavailableNativeShareInBoundary() };
}

function guessMime(name: string): string { const extension = name.toLowerCase().split('.').pop(); const known: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', json: 'application/json', pdf: 'application/pdf', epub: 'application/epub+zip', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }; return known[extension ?? ''] ?? 'application/octet-stream'; }

/** A narrow structural adapter for the core CaptureFileHandle contract. */
export function asCoreCaptureFileHandle(handle: NativeCaptureFileHandle): { readonly id: string; readonly read: (signal?: AbortSignal) => Promise<Uint8Array>; readonly close: () => void } { return { id: handle.id, read: handle.read, close: handle.close }; }
