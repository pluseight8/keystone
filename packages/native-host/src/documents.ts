/**
 * R0P93 production document boundary for Linux hosts.
 *
 * Core receives bounded bytes, text and raster results.  It never receives a
 * child process, executable path, temporary filename or shell capability.
 * Commands are fixed and every input is sent as bytes or to an internally
 * generated temporary file with shell execution disabled.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeHostError } from './index.js';

export interface NativeDocumentOcrInput {
  readonly imageBytes: Uint8Array;
  readonly mimeType: string;
  readonly language: string;
  readonly maxOutputChars: number;
  readonly maxRegions: number;
  readonly signal?: AbortSignal;
}

export interface NativeDocumentOcrResult {
  readonly text: string;
  readonly language?: string;
  readonly engineVersion?: string;
}

/** Structurally compatible with core's OcrAdapter without a package cycle. */
export interface NativeDocumentOcrAdapter {
  readonly id: string;
  readonly version: string;
  readonly languages: readonly string[];
  recognize(input: NativeDocumentOcrInput): Promise<NativeDocumentOcrResult>;
}

export interface NativePdfRuntimePage {
  readonly pageNumber: number;
  readonly text: string;
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly textLayer?: 'EXTRACTED' | 'NONE';
}

export interface NativePdfRuntimeInspection {
  readonly pages: readonly NativePdfRuntimePage[];
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | undefined>>;
}

/** Structurally compatible with core's PdfRuntimeAdapter without a package cycle. */
export interface NativePdfRuntimeAdapter {
  readonly kind: string;
  inspect(input: { readonly bytes: Uint8Array; readonly maxPages: number; readonly maxTextBytes: number; readonly signal?: AbortSignal }): Promise<NativePdfRuntimeInspection>;
  renderPage(input: { readonly bytes: Uint8Array; readonly pageNumber: number; readonly scale?: number; readonly signal?: AbortSignal }): Promise<{ readonly imageBytes: Uint8Array; readonly mimeType: 'image/png'; readonly width: number; readonly height: number; readonly rotation?: number }>;
}

export interface LinuxDocumentCommandSet {
  readonly tesseract?: string;
  readonly pdfinfo?: string;
  readonly pdftotext?: string;
  readonly pdftoppm?: string;
  readonly pdftocairo?: string;
}

export interface LinuxDocumentHostOptions {
  readonly commandTimeoutMs?: number;
  readonly maxConcurrentProcesses?: number;
  readonly maxQueue?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxStderrBytes?: number;
  readonly commands?: LinuxDocumentCommandSet;
  readonly languages?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MAX_INPUT = 64 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;
const DEFAULT_MAX_STDERR = 128 * 1024;
const SAFE_IMAGE_MIME = new Set(['image/png', 'image/jpeg']);

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

interface QueuedTask {
  readonly signal?: AbortSignal;
  readonly task: () => Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export class LinuxNativeOcrAdapter implements NativeDocumentOcrAdapter {
  readonly id = 'tesseract-local';
  readonly kind = 'PRODUCTION_OCR' as const;
  version = 'unknown';
  languages: readonly string[];
  private readonly command?: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxStderrBytes: number;
  private readonly queue: QueuedTask[] = [];
  private active = 0;
  private readyPromise?: Promise<void>;

  constructor(options: LinuxDocumentHostOptions = {}) {
    this.command = options.commands?.tesseract ?? findExecutable('tesseract');
    this.languages = [...(options.languages ?? ['eng'])].filter(isSafeLanguage).slice(0, 128);
    if (!this.languages.length) this.languages = ['eng'];
    this.timeoutMs = boundedInteger(options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, DEFAULT_TIMEOUT_MS);
    this.maxConcurrent = boundedInteger(options.maxConcurrentProcesses ?? DEFAULT_MAX_CONCURRENT, 1, 8);
    this.maxQueue = boundedInteger(options.maxQueue ?? DEFAULT_MAX_QUEUE, 0, 256);
    this.maxInputBytes = boundedInteger(options.maxInputBytes ?? DEFAULT_MAX_INPUT, 1, DEFAULT_MAX_INPUT);
    this.maxOutputBytes = boundedInteger(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT, 1, DEFAULT_MAX_OUTPUT);
    this.maxStderrBytes = boundedInteger(options.maxStderrBytes ?? DEFAULT_MAX_STDERR, 1, DEFAULT_MAX_STDERR);
  }

  available(): boolean { return Boolean(this.command); }
  activeProcesses(): number { return this.active; }
  queuedJobs(): number { return this.queue.length; }

  /** Discovers the actual installed language packs without requiring a package install. */
  async ready(): Promise<void> {
    this.readyPromise ??= this.discover();
    await this.readyPromise;
  }

  async recognize(input: NativeDocumentOcrInput): Promise<NativeDocumentOcrResult> {
    if (!(input.imageBytes instanceof Uint8Array) || input.imageBytes.byteLength < 1 || input.imageBytes.byteLength > this.maxInputBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'OCR image exceeds the bounded input limit');
    if (!SAFE_IMAGE_MIME.has(input.mimeType.toLowerCase())) throw new NativeHostError('UNSUPPORTED', 'OCR accepts only PNG or JPEG raster input');
    if (!isSafeLanguage(input.language) || !this.languages.includes(input.language)) throw new NativeHostError('UNSUPPORTED', `OCR language is unavailable: ${input.language}`);
    if (input.signal?.aborted) throw new NativeHostError('CANCELLED', 'OCR operation was cancelled');
    const maxOutputChars = boundedInteger(input.maxOutputChars, 1, 16 * 1024 * 1024);
    return this.runQueued(input.signal, async () => {
      if (!this.command) throw new NativeHostError('UNSUPPORTED', 'Tesseract is unavailable on this host');
      const result = await runProcess(this.command, ['stdin', 'stdout', '--psm', '6', '-l', input.language], input.imageBytes, input.signal, Math.min(this.maxOutputBytes, Math.max(4_096, maxOutputChars * 4)), this.maxStderrBytes, this.timeoutMs);
      if (result.code !== 0) throw new NativeHostError('UNSUPPORTED', 'Local OCR failed');
      const text = decodeUtf8(result.stdout).replace(/\u0000/g, '').trim();
      if (text.length > maxOutputChars) throw new NativeHostError('RESOURCE_EXHAUSTED', 'OCR text exceeds the bounded output limit');
      return { text, language: input.language, ...(this.version === 'unknown' ? {} : { engineVersion: this.version }) };
    });
  }

  private async discover(): Promise<void> {
    if (!this.command) return;
    try {
      const version = await runProcess(this.command, ['--version'], undefined, undefined, 64 * 1024, this.maxStderrBytes, this.timeoutMs);
      const versionText = `${decodeUtf8(version.stdout)}\n${decodeUtf8(version.stderr)}`;
      const match = versionText.match(/tesseract\s+(\d+(?:\.\d+){1,3})/i);
      if (match?.[1]) this.version = match[1];
    } catch {
      // A later recognize call still reports the actual bounded process error.
    }
    try {
      const listed = await runProcess(this.command, ['--list-langs'], undefined, undefined, 64 * 1024, this.maxStderrBytes, this.timeoutMs);
      if (listed.code !== 0) return;
      const discovered = decodeUtf8(listed.stdout).split(/\r?\n/).map(value => value.trim()).filter(isSafeLanguage);
      if (discovered.length) this.languages = [...new Set(discovered)].slice(0, 128);
    } catch {
      // The conservative constructor language list remains in force.
    }
  }

  private runQueued<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(new NativeHostError('CANCELLED', 'OCR operation was cancelled'));
    if (this.active < this.maxConcurrent) {
      this.active++;
      return task().finally(() => { this.active--; this.drain(); });
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new NativeHostError('RESOURCE_EXHAUSTED', 'OCR process queue is full'));
    return new Promise<T>((resolve, reject) => { this.queue.push({ signal, task: async () => task(), resolve: value => resolve(value as T), reject }); });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift()!;
      if (next.signal?.aborted) { next.reject(new NativeHostError('CANCELLED', 'OCR operation was cancelled')); continue; }
      this.active++;
      next.task().then(next.resolve, next.reject).finally(() => { this.active--; this.drain(); });
    }
  }
}

export class LinuxPdfRuntimeAdapter implements NativePdfRuntimeAdapter {
  readonly kind = 'PRODUCTION_PDF' as const;
  private readonly commands: LinuxDocumentCommandSet;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxStderrBytes: number;
  private readonly queue: QueuedTask[] = [];
  private active = 0;

  constructor(options: LinuxDocumentHostOptions = {}) {
    this.commands = { pdfinfo: options.commands?.pdfinfo ?? findExecutable('pdfinfo'), pdftotext: options.commands?.pdftotext ?? findExecutable('pdftotext'), pdftoppm: options.commands?.pdftoppm ?? findExecutable('pdftoppm'), pdftocairo: options.commands?.pdftocairo ?? findExecutable('pdftocairo') };
    this.timeoutMs = boundedInteger(options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, DEFAULT_TIMEOUT_MS);
    this.maxConcurrent = boundedInteger(options.maxConcurrentProcesses ?? DEFAULT_MAX_CONCURRENT, 1, 8);
    this.maxQueue = boundedInteger(options.maxQueue ?? DEFAULT_MAX_QUEUE, 0, 256);
    this.maxInputBytes = boundedInteger(options.maxInputBytes ?? 512 * 1024 * 1024, 1, 512 * 1024 * 1024);
    this.maxOutputBytes = boundedInteger(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT, 1, DEFAULT_MAX_OUTPUT);
    this.maxStderrBytes = boundedInteger(options.maxStderrBytes ?? DEFAULT_MAX_STDERR, 1, DEFAULT_MAX_STDERR);
  }

  available(): boolean { return Boolean(this.commands.pdfinfo && this.commands.pdftotext && (this.commands.pdftoppm || this.commands.pdftocairo)); }
  activeProcesses(): number { return this.active; }
  queuedJobs(): number { return this.queue.length; }

  async inspect(input: { readonly bytes: Uint8Array; readonly maxPages: number; readonly maxTextBytes: number; readonly signal?: AbortSignal }): Promise<NativePdfRuntimeInspection> {
    this.validateInput(input.bytes, input.signal);
    return this.runQueued(input.signal, () => this.withPdfFile(input.bytes, async pdfPath => {
      const pdfinfo = this.commands.pdfinfo;
      const pdftotext = this.commands.pdftotext;
      if (!pdfinfo || !pdftotext) throw new NativeHostError('UNSUPPORTED', 'Poppler PDF inspection tools are unavailable');
      const info = await runProcess(pdfinfo, [pdfPath], undefined, input.signal, 128 * 1024, this.maxStderrBytes, this.timeoutMs);
      if (info.code !== 0) throw new NativeHostError('UNSUPPORTED', 'PDF metadata inspection failed');
      const infoText = decodeUtf8(info.stdout);
      const pageCount = parseBoundedInteger(infoText.match(/^Pages:\s*(\d+)/mi)?.[1], 1, Math.min(input.maxPages, 10_000));
      if (pageCount === undefined) throw new NativeHostError('UNSUPPORTED', 'PDF page count is unavailable');
      const width = parsePositiveNumber(infoText.match(/^Page size:\s*([\d.]+)\s+x\s+([\d.]+)/mi)?.[1]);
      const height = parsePositiveNumber(infoText.match(/^Page size:\s*([\d.]+)\s+x\s+([\d.]+)/mi)?.[2]);
      const rotation = parseBoundedInteger(infoText.match(/^Page rot:\s*(-?\d+)/mi)?.[1], 0, 359) ?? 0;
      const title = boundedText(infoText.match(/^Title:\s*(.+)$/mi)?.[1]?.trim() ?? '', 512) || undefined;
      const text = await runProcess(pdftotext, ['-layout', '-enc', 'UTF-8', pdfPath, '-'], undefined, input.signal, Math.min(this.maxOutputBytes, boundedInteger(input.maxTextBytes, 1, 16 * 1024 * 1024)), this.maxStderrBytes, this.timeoutMs);
      const pageText = text.code === 0 ? decodeUtf8(text.stdout).split('\f').slice(0, pageCount) : [];
      const pages: NativePdfRuntimePage[] = Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1, text: boundedText(pageText[index] ?? '', boundedInteger(input.maxTextBytes, 1, 16 * 1024 * 1024)), ...(width === undefined ? {} : { width }), ...(height === undefined ? {} : { height }), rotation, textLayer: (pageText[index] ?? '').trim() ? 'EXTRACTED' as const : 'NONE' as const }));
      return { pages, ...(title ? { title } : {}), metadata: { pageCount, sourceMetadataUntrusted: true } };
    }));
  }

  async renderPage(input: { readonly bytes: Uint8Array; readonly pageNumber: number; readonly scale?: number; readonly signal?: AbortSignal }): Promise<{ readonly imageBytes: Uint8Array; readonly mimeType: 'image/png'; readonly width: number; readonly height: number; readonly rotation?: number }> {
    this.validateInput(input.bytes, input.signal);
    if (!Number.isSafeInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > 10_000) throw new NativeHostError('INVALID_REQUEST', 'PDF page number is invalid');
    const scale = boundedNumber(input.scale ?? 1, 0.25, 4);
    return this.runQueued(input.signal, () => this.withPdfFile(input.bytes, async (pdfPath, directory) => {
      const command = this.commands.pdftoppm ?? this.commands.pdftocairo;
      if (!command) throw new NativeHostError('UNSUPPORTED', 'Poppler PDF rasterizer is unavailable');
      const outputBase = join(directory, 'rendered-page');
      const dpi = String(Math.round(72 * scale));
      const args = this.commands.pdftoppm ? ['-f', String(input.pageNumber), '-l', String(input.pageNumber), '-singlefile', '-png', '-r', dpi, pdfPath, outputBase] : ['-f', String(input.pageNumber), '-l', String(input.pageNumber), '-singlefile', '-png', '-r', dpi, pdfPath, outputBase];
      const result = await runProcess(command, args, undefined, input.signal, this.maxOutputBytes, this.maxStderrBytes, this.timeoutMs);
      if (result.code !== 0) throw new NativeHostError('UNSUPPORTED', 'PDF page rasterization failed');
      const imagePath = `${outputBase}.png`;
      let image: Uint8Array;
      try { image = new Uint8Array(await readFile(imagePath)); } catch { throw new NativeHostError('UNSUPPORTED', 'PDF rasterizer produced no page image'); }
      if (image.byteLength < 24 || image.byteLength > this.maxOutputBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Rendered PDF page exceeds the bounded output limit');
      const dimensions = pngDimensions(image);
      if (!dimensions) throw new NativeHostError('UNSUPPORTED', 'PDF rasterizer returned an invalid PNG');
      return { imageBytes: image, mimeType: 'image/png' as const, width: dimensions.width, height: dimensions.height, rotation: 0 };
    }));
  }

  private validateInput(bytes: Uint8Array, signal?: AbortSignal): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > this.maxInputBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'PDF input exceeds the bounded limit');
    if (signal?.aborted) throw new NativeHostError('CANCELLED', 'PDF operation was cancelled');
  }

  private withPdfFile<T>(bytes: Uint8Array, operation: (pdfPath: string, directory: string) => Promise<T>): Promise<T> {
    return mkdtemp(join(tmpdir(), 'keystone-document-pdf-')).then(async directory => {
      const pdfPath = join(directory, 'source.pdf');
      try { await writeFile(pdfPath, Buffer.from(bytes)); return await operation(pdfPath, directory); } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  private runQueued<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(new NativeHostError('CANCELLED', 'PDF operation was cancelled'));
    if (this.active < this.maxConcurrent) { this.active++; return task().finally(() => { this.active--; this.drain(); }); }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new NativeHostError('RESOURCE_EXHAUSTED', 'PDF process queue is full'));
    return new Promise<T>((resolve, reject) => { this.queue.push({ signal, task: async () => task(), resolve: value => resolve(value as T), reject }); });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift()!;
      if (next.signal?.aborted) { next.reject(new NativeHostError('CANCELLED', 'PDF operation was cancelled')); continue; }
      this.active++;
      next.task().then(next.resolve, next.reject).finally(() => { this.active--; this.drain(); });
    }
  }
}

export interface LinuxNativeDocumentHost {
  readonly pdf: LinuxPdfRuntimeAdapter;
  readonly ocr: LinuxNativeOcrAdapter;
  capabilities(): Readonly<{ readonly pdf: boolean; readonly ocr: boolean }>;
}

export function createLinuxNativeDocumentHost(options: LinuxDocumentHostOptions = {}): LinuxNativeDocumentHost {
  const pdf = new LinuxPdfRuntimeAdapter(options);
  const ocr = new LinuxNativeOcrAdapter(options);
  return { pdf, ocr, capabilities: () => ({ pdf: pdf.available(), ocr: ocr.available() }) };
}

export const NativeLocalOcrHost = LinuxNativeOcrAdapter;
export const LinuxNativePdfRuntimeAdapter = LinuxPdfRuntimeAdapter;

function findExecutable(name: string): string | undefined {
  if (process.platform !== 'linux') return undefined;
  const paths = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), '/usr/bin', '/bin'];
  for (const directory of paths) {
    const candidate = join(directory, name);
    try { if (existsSync(candidate)) { accessSync(candidate, fsConstants.X_OK); return candidate; } } catch { /* continue */ }
  }
  return undefined;
}

function runProcess(command: string, args: readonly string[], input: Uint8Array | undefined, signal: AbortSignal | undefined, outputLimit: number, stderrLimit: number, timeoutMs: number): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], cwd: '/tmp', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'production', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', OMP_THREAD_LIMIT: '1' } });
    } catch { rejectPromise(new NativeHostError('PLATFORM_FAILURE', 'Document process could not start')); return; }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutLength = 0;
    let stderrLength = 0;
    let settled = false;
    let timedOut = false;
    let canceled = signal?.aborted === true;
    let outputExceeded = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, timeoutMs);
    const abort = () => { canceled = true; terminate(child); };
    signal?.addEventListener('abort', abort, { once: true });
    const rejectWith = (error: NativeHostError) => { if (settled) return; settled = true; clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener('abort', abort); rejectPromise(error); };
    child.stdout.on('data', (chunk: Buffer) => { if (outputExceeded) return; stdoutLength += chunk.byteLength; if (stdoutLength > outputLimit) { outputExceeded = true; terminate(child); return; } stdout.push(Buffer.from(chunk)); });
    child.stderr.on('data', (chunk: Buffer) => { stderrLength += chunk.byteLength; if (stderrLength <= stderrLimit) stderr.push(Buffer.from(chunk).subarray(0, stderrLimit - (stderrLength - chunk.byteLength))); });
    child.stdin.on('error', () => undefined);
    child.once('error', () => rejectWith(new NativeHostError('PLATFORM_FAILURE', 'Document process failed')));
    child.once('close', (code, closeSignal) => {
      if (settled) return;
      if (canceled) { rejectWith(new NativeHostError('CANCELLED', 'Document operation was cancelled')); return; }
      if (timedOut) { rejectWith(new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Document process timed out')); return; }
      if (outputExceeded) { rejectWith(new NativeHostError('RESOURCE_EXHAUSTED', 'Document process output exceeds the bounded limit')); return; }
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      resolvePromise({ code, signal: closeSignal, stdout: concatBuffers(stdout, stdoutLength), stderr: concatBuffers(stderr, Math.min(stderrLength, stderrLimit)) });
    });
    if (canceled) { terminate(child); return; }
    child.stdin.end(input ? Buffer.from(input) : undefined);

    const terminateWithKill = () => { if (!settled) { try { child.kill('SIGKILL'); } catch { /* process already exited */ } } };
    function terminate(process: ChildProcessWithoutNullStreams): void { try { process.kill('SIGTERM'); } catch { return; } killTimer = setTimeout(terminateWithKill, 150); }
  });
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | undefined {
  if (bytes.byteLength < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width > 0 && height > 0 && width <= 32_768 && height <= 32_768 ? { width, height } : undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined { const number = Number(value); return Number.isFinite(number) && number > 0 && number <= 100_000 ? number : undefined; }
function parseBoundedInteger(value: string | undefined, min: number, max: number): number | undefined { const number = Number(value); return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined; }
function boundedInteger(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min; }
function boundedNumber(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function isSafeLanguage(value: string): boolean { return /^[A-Za-z0-9_-]{1,32}$/.test(value); }
function boundedText(value: string, max: number): string { return value.slice(0, max); }
function decodeUtf8(value: Uint8Array): string { return new TextDecoder('utf-8', { fatal: false }).decode(value); }
function concatBuffers(values: readonly Buffer[], length: number): Uint8Array { return new Uint8Array(Buffer.concat(values, Math.max(0, length))); }
