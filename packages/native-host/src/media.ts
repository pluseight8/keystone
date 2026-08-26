/**
 * R0P86 production media boundary.
 *
 * This is deliberately a NativeHost adapter.  Core receives typed bytes and
 * bounded metadata/results; command names, child processes and decoder
 * details never cross the host boundary.  User supplied filenames are
 * metadata only and are never interpolated into a command or a shell.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { NativeHostError } from './index.js';

export type NativeMediaCapability =
  | 'IMAGE_METADATA'
  | 'IMAGE_THUMBNAIL'
  | 'IMAGE_PREVIEW'
  | 'IMAGE_EDIT_RENDITION'
  | 'VIDEO_METADATA'
  | 'VIDEO_THUMBNAIL';

export interface NativeMediaMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
  readonly rotationDegrees?: 0 | 90 | 180 | 270;
  readonly orientation?: number;
  readonly captureTime?: string;
  readonly cameraMake?: string;
  readonly cameraModel?: string;
  readonly metadataTruncated: boolean;
}

export interface NativeMediaProbeRequest {
  readonly bytes: Uint8Array;
  /** Kept for diagnostics/format selection only; never passed to a process. */
  readonly filename: string;
  readonly declaredMimeType?: string;
  readonly maxInputBytes: number;
  readonly maxDimension: number;
  readonly maxPixels: number;
  readonly signal?: AbortSignal;
}

export interface NativeMediaProbeResult {
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly mimeType: string;
  readonly metadata?: NativeMediaMetadata;
}

export type NativeMediaDerivativeKind = 'THUMBNAIL' | 'PREVIEW' | 'VIDEO_FRAME' | 'EDIT_RENDITION';

export interface NativeMediaDerivativeRequest {
  readonly bytes: Uint8Array;
  /** Kept for content naming only; never passed to a process. */
  readonly filename: string;
  readonly mimeType: string;
  readonly kind: NativeMediaDerivativeKind;
  readonly recipe: Readonly<Record<string, string | number | boolean>>;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDimension: number;
  readonly maxPixels: number;
  readonly signal?: AbortSignal;
}

export interface NativeMediaDerivativeResult {
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/png';
}

export interface NativeMediaHost {
  readonly kind: 'PRODUCTION_MEDIA' | 'UNAVAILABLE' | 'TEST_MEDIA';
  capabilities(): readonly NativeMediaCapability[];
  probe(request: NativeMediaProbeRequest): Promise<NativeMediaProbeResult>;
  generate(request: NativeMediaDerivativeRequest): Promise<NativeMediaDerivativeResult>;
  activeProcesses(): number;
}

export interface LinuxNativeMediaHostOptions {
  readonly commandTimeoutMs?: number;
  readonly maxConcurrentProcesses?: number;
  readonly maxQueue?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
  readonly maxInputBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MAX_QUEUE = 32;
const DEFAULT_MAX_STDOUT = 32 * 1024 * 1024;
const DEFAULT_MAX_STDERR = 64 * 1024;
const DEFAULT_MAX_INPUT = 256 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 16_384;
const DEFAULT_MAX_PIXELS = 100_000_000;
const SAFE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg', 'video/mpeg']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg', 'video/mpeg']);

interface CommandSet {
  readonly identify?: string;
  readonly imageConvert?: string;
  readonly ffprobe?: string;
  readonly ffmpeg?: string;
}

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

interface QueuedTask<T> {
  readonly signal?: AbortSignal;
  readonly task: () => Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export class UnavailableNativeMediaHost implements NativeMediaHost {
  readonly kind = 'UNAVAILABLE' as const;
  capabilities(): readonly NativeMediaCapability[] { return []; }
  activeProcesses(): number { return 0; }
  probe(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Media decoder is unavailable')); }
  generate(): Promise<never> { return Promise.reject(new NativeHostError('UNSUPPORTED', 'Media decoder is unavailable')); }
}

export class LinuxNativeMediaHost implements NativeMediaHost {
  readonly kind = 'PRODUCTION_MEDIA' as const;
  private readonly commands: CommandSet;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly maxStdoutBytes: number;
  private readonly maxStderrBytes: number;
  private readonly maxInputBytes: number;
  private active = 0;
  private readonly queue: QueuedTask<any>[] = [];

  constructor(options: LinuxNativeMediaHostOptions = {}) {
    this.commands = discoverCommands();
    this.timeoutMs = boundedInteger(options.commandTimeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 120_000);
    this.maxConcurrent = boundedInteger(options.maxConcurrentProcesses ?? DEFAULT_MAX_CONCURRENT, 1, 8);
    this.maxQueue = boundedInteger(options.maxQueue ?? DEFAULT_MAX_QUEUE, 0, 256);
    this.maxStdoutBytes = boundedInteger(options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT, 4 * 1024, 64 * 1024 * 1024);
    this.maxStderrBytes = boundedInteger(options.maxStderrBytes ?? DEFAULT_MAX_STDERR, 1 * 1024, 1 * 1024 * 1024);
    this.maxInputBytes = boundedInteger(options.maxInputBytes ?? DEFAULT_MAX_INPUT, 1, 2 * 1024 * 1024 * 1024);
  }

  capabilities(): readonly NativeMediaCapability[] {
    const values: NativeMediaCapability[] = [];
    if (this.commands.identify) values.push('IMAGE_METADATA');
    if (this.commands.imageConvert) values.push('IMAGE_THUMBNAIL', 'IMAGE_PREVIEW', 'IMAGE_EDIT_RENDITION');
    if (this.commands.ffprobe) values.push('VIDEO_METADATA');
    if (this.commands.ffmpeg) values.push('VIDEO_THUMBNAIL');
    return values;
  }

  activeProcesses(): number { return this.active; }

  async probe(request: NativeMediaProbeRequest): Promise<NativeMediaProbeResult> {
    this.validateInput(request.bytes, request.maxInputBytes);
    const mimeType = normalizeMime(request.declaredMimeType);
    if (mimeType && VIDEO_MIME.has(mimeType)) return this.probeVideo(request, mimeType);
    if (mimeType && !IMAGE_MIME.has(mimeType)) throw new NativeHostError('UNSUPPORTED', 'The requested media type is unsupported');
    if (!this.commands.identify) throw new NativeHostError('UNSUPPORTED', 'Image metadata decoder is unavailable');
    const result = await this.runQueued(request.signal, () => this.runIdentify(request));
    return result;
  }

  async generate(request: NativeMediaDerivativeRequest): Promise<NativeMediaDerivativeResult> {
    this.validateInput(request.bytes, request.maxInputBytes);
    const mimeType = normalizeMime(request.mimeType);
    if (!mimeType || !SAFE_MIME.has(mimeType)) throw new NativeHostError('UNSUPPORTED', 'The requested media type is unsupported');
    const dimension = derivativeDimension(request.recipe, request.kind, Math.min(safeMaxDimension(request.maxDimension), Math.max(1, Math.floor(Math.sqrt(safeMaxPixels(request.maxPixels))))));
    if (mimeType.startsWith('video/')) {
      if (request.kind !== 'VIDEO_FRAME' && request.kind !== 'THUMBNAIL' && request.kind !== 'PREVIEW') throw new NativeHostError('UNSUPPORTED', 'Video edit renditions are unsupported');
      if (!this.commands.ffmpeg) throw new NativeHostError('UNSUPPORTED', 'Video frame decoder is unavailable');
      return this.runQueued(request.signal, () => this.runVideoFrame(request, mimeType, dimension));
    }
    if (!this.commands.imageConvert) throw new NativeHostError('UNSUPPORTED', 'Image derivative decoder is unavailable');
    if (request.kind === 'VIDEO_FRAME') throw new NativeHostError('INVALID_REQUEST', 'Video frame is only valid for video media');
    return this.runQueued(request.signal, () => this.runImageDerivative(request, mimeType, dimension));
  }

  private async probeVideo(request: NativeMediaProbeRequest, mimeType: string): Promise<NativeMediaProbeResult> {
    if (!this.commands.ffprobe) throw new NativeHostError('UNSUPPORTED', 'Video metadata decoder is unavailable');
    return this.runQueued(request.signal, () => this.runFfprobe(request, mimeType));
  }

  private async runIdentify(request: NativeMediaProbeRequest): Promise<NativeMediaProbeResult> {
    const command = this.commands.identify;
    if (!command) throw new NativeHostError('UNSUPPORTED', 'Image metadata decoder is unavailable');
    const maxDimension = safeMaxDimension(request.maxDimension);
    const maxPixels = safeMaxPixels(request.maxPixels);
    const result = await this.runProcess(command, [
      '-limit', 'memory', '256MiB',
      '-limit', 'map', '512MiB',
      '-limit', 'area', String(maxPixels),
      '-limit', 'width', String(maxDimension),
      '-limit', 'height', String(maxDimension),
      '-format', '%m|%w|%h|%[orientation]',
      '-',
    ], request.bytes, request.signal, 16 * 1024);
    if (result.code !== 0) throw new NativeHostError('UNSUPPORTED', 'Image metadata decode failed');
    const text = decodeUtf8(result.stdout).trim().split('\n')[0] ?? '';
    const fields = text.split('|');
    const format = fields[0]?.trim().toLowerCase();
    const width = safeDimension(Number(fields[1]), maxDimension, maxPixels);
    const height = safeDimension(Number(fields[2]), maxDimension, maxPixels);
    if (!format || width === undefined || height === undefined) throw new NativeHostError('UNSUPPORTED', 'Image metadata is incomplete');
    if (width * height > maxPixels) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Image pixel budget is exceeded');
    const detectedMime = imageFormatMime(format);
    if (!detectedMime) throw new NativeHostError('UNSUPPORTED', 'Image format is unsupported');
    const declared = normalizeMime(request.declaredMimeType);
    if (declared && IMAGE_MIME.has(declared) && declared !== detectedMime) throw new NativeHostError('UNSUPPORTED', 'Declared media type does not match the image');
    const orientation = parseOrientation(fields[3]);
    return { kind: 'IMAGE', mimeType: detectedMime, metadata: { width, height, ...(orientation !== undefined ? { orientation } : {}), metadataTruncated: request.bytes.byteLength > request.maxInputBytes } };
  }

  private async runFfprobe(request: NativeMediaProbeRequest, mimeType: string): Promise<NativeMediaProbeResult> {
    const command = this.commands.ffprobe;
    if (!command) throw new NativeHostError('UNSUPPORTED', 'Video metadata decoder is unavailable');
    const maxDimension = safeMaxDimension(request.maxDimension);
    const maxPixels = safeMaxPixels(request.maxPixels);
    const format = ffmpegInputFormat(mimeType);
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration:stream_tags=rotate,DURATION:stream_side_data=rotation:format=duration',
      '-of', 'json',
      ...(format ? ['-f', format] : []),
      '-i', 'pipe:0',
    ];
    const result = await this.runProcess(command, args, request.bytes, request.signal, 256 * 1024);
    if (result.code !== 0) throw new NativeHostError('UNSUPPORTED', 'Video metadata decode failed');
    let parsed: { streams?: Array<{ width?: unknown; height?: unknown; duration?: unknown; tags?: { rotate?: unknown; DURATION?: unknown }; side_data_list?: Array<{ rotation?: unknown }> }>; format?: { duration?: unknown } };
    try { parsed = JSON.parse(decodeUtf8(result.stdout)) as typeof parsed; } catch { throw new NativeHostError('UNSUPPORTED', 'Video metadata is invalid'); }
    const stream = parsed.streams?.[0];
    const width = safeDimension(Number(stream?.width), maxDimension, maxPixels);
    const height = safeDimension(Number(stream?.height), maxDimension, maxPixels);
    if (width === undefined || height === undefined) throw new NativeHostError('UNSUPPORTED', 'Video dimensions are unavailable');
    if (width * height > maxPixels) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Video pixel budget is exceeded');
    const durationSeconds = parseDurationSeconds(stream?.duration) ?? parseDurationSeconds(parsed.format?.duration) ?? parseDurationSeconds(stream?.tags?.DURATION);
    const durationMs = durationSeconds !== undefined && finitePositive(durationSeconds) ? Math.min(Math.floor(durationSeconds * 1_000), 31_536_000_000) : undefined;
    const rotation = normalizeRotation(Number(stream?.tags?.rotate ?? stream?.side_data_list?.[0]?.rotation));
    return { kind: 'VIDEO', mimeType: mimeType === 'video/quicktime' ? 'video/quicktime' : mimeType, metadata: { width, height, ...(durationMs !== undefined ? { durationMs } : {}), ...(rotation !== undefined ? { rotationDegrees: rotation } : {}), metadataTruncated: false } };
  }

  private async runImageDerivative(request: NativeMediaDerivativeRequest, mimeType: string, dimension: number): Promise<NativeMediaDerivativeResult> {
    const command = this.commands.imageConvert;
    if (!command) throw new NativeHostError('UNSUPPORTED', 'Image derivative decoder is unavailable');
    const maxDimension = safeMaxDimension(request.maxDimension);
    const maxPixels = safeMaxPixels(request.maxPixels);
    const maxOutputBytes = safeMaxOutputBytes(request.maxOutputBytes);
    const args = [
      '-limit', 'memory', '256MiB',
      '-limit', 'map', '512MiB',
      '-limit', 'area', String(maxPixels),
      '-limit', 'width', String(maxDimension),
      '-limit', 'height', String(maxDimension),
      '-',
      '-auto-orient',
      ...editArguments(request.recipe),
      '-thumbnail', `${dimension}x${dimension}>`,
      '-strip',
      'png:-',
    ];
    const result = await this.runProcess(command, args, request.bytes, request.signal, maxOutputBytes);
    if (result.code !== 0 || result.stdout.byteLength < 8) throw new NativeHostError('UNSUPPORTED', 'Image derivative decode failed');
    if (result.stdout.byteLength > maxOutputBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Image derivative exceeds the output limit');
    return { bytes: result.stdout, mimeType: 'image/png' };
  }

  private async runVideoFrame(request: NativeMediaDerivativeRequest, mimeType: string, dimension: number): Promise<NativeMediaDerivativeResult> {
    const command = this.commands.ffmpeg;
    if (!command) throw new NativeHostError('UNSUPPORTED', 'Video frame decoder is unavailable');
    const maxOutputBytes = safeMaxOutputBytes(request.maxOutputBytes);
    const format = ffmpegInputFormat(mimeType);
    const args = [
      '-hide_banner', '-loglevel', 'error', '-threads', '1',
      ...(format ? ['-f', format] : []),
      '-i', 'pipe:0',
      '-ss', '0', '-frames:v', '1', '-an',
      '-vf', `scale=${dimension}:${dimension}:force_original_aspect_ratio=decrease`,
      '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ];
    const result = await this.runProcess(command, args, request.bytes, request.signal, maxOutputBytes);
    if (result.code !== 0 || result.stdout.byteLength < 8) throw new NativeHostError('UNSUPPORTED', 'Video frame decode failed');
    if (result.stdout.byteLength > maxOutputBytes) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Video frame exceeds the output limit');
    return { bytes: result.stdout, mimeType: 'image/png' };
  }

  private validateInput(bytes: Uint8Array, requestedMax: number): void {
    const max = Math.min(this.maxInputBytes, boundedInteger(requestedMax, 1, this.maxInputBytes));
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > max) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Media input exceeds the bounded decoder limit');
  }

  private runQueued<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    if (signal?.aborted) return Promise.reject(new NativeHostError('CANCELLED', 'Media operation was cancelled'));
    if (this.active < this.maxConcurrent) {
      this.active++;
      return task().finally(() => { this.active--; this.drain(); });
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new NativeHostError('RESOURCE_EXHAUSTED', 'Media decoder queue is full'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ signal, task, resolve, reject });
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const next = this.queue.shift()!;
      if (next.signal?.aborted) { next.reject(new NativeHostError('CANCELLED', 'Media operation was cancelled')); continue; }
      this.active++;
      next.task().then(next.resolve, next.reject).finally(() => { this.active--; this.drain(); });
    }
  }

  private runProcess(command: string, args: readonly string[], input: Uint8Array, signal: AbortSignal | undefined, outputLimit: number): Promise<ProcessResult> {
    return new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, [...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], cwd: safeWorkingDirectory() });
      } catch {
        rejectPromise(new NativeHostError('PLATFORM_FAILURE', 'Media decoder process could not start'));
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutLength = 0;
      let stderrLength = 0;
      let settled = false;
      let timedOut = false;
      let canceled = signal?.aborted === true;
      let outputExceeded = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const timer = setTimeout(() => { timedOut = true; terminate(child); }, this.timeoutMs);
      const abort = () => { canceled = true; terminate(child); };
      signal?.addEventListener('abort', abort, { once: true });
      const finish = (error?: NativeHostError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        if (error) rejectPromise(error);
      };
      child.stdout.on('data', (chunk: Buffer) => {
        if (outputExceeded) return;
        stdoutLength += chunk.byteLength;
        if (stdoutLength > Math.min(this.maxStdoutBytes, outputLimit)) { outputExceeded = true; terminate(child); return; }
        stdout.push(Buffer.from(chunk));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrLength += chunk.byteLength;
        if (stderrLength <= this.maxStderrBytes) stderr.push(Buffer.from(chunk).subarray(0, this.maxStderrBytes - (stderrLength - chunk.byteLength)));
      });
      child.stdin.on('error', () => undefined);
      child.once('error', () => finish(new NativeHostError('PLATFORM_FAILURE', 'Media decoder process failed')));
      child.once('close', (code, closeSignal) => {
        if (settled) return;
        if (canceled) { finish(new NativeHostError('CANCELLED', 'Media operation was cancelled')); return; }
        if (timedOut) { finish(new NativeHostError('TEMPORARILY_UNAVAILABLE', 'Media decoder timed out')); return; }
        if (outputExceeded) { finish(new NativeHostError('RESOURCE_EXHAUSTED', 'Media decoder output exceeds the bounded limit')); return; }
        finish();
        resolvePromise({ code, signal: closeSignal, stdout: concatBuffers(stdout, stdoutLength), stderr: concatBuffers(stderr, Math.min(stderrLength, this.maxStderrBytes)) });
      });
      if (canceled) { terminate(child); return; }
      child.stdin.end(Buffer.from(input));

      const terminateWithKill = () => { if (!settled) { try { child.kill('SIGKILL'); } catch { /* process already exited */ } } };
      function terminate(process: ChildProcessWithoutNullStreams): void {
        try { process.kill('SIGTERM'); } catch { return; }
        killTimer = setTimeout(terminateWithKill, 150);
      }
    });
  }
}

function discoverCommands(): CommandSet {
  if (platform() !== 'linux') return {};
  return {
    identify: findExecutable('identify'),
    imageConvert: findExecutable('magick') ?? findExecutable('convert'),
    ffprobe: findExecutable('ffprobe'),
    ffmpeg: findExecutable('ffmpeg'),
  };
}

function findExecutable(name: string): string | undefined {
  const paths = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), '/usr/bin', '/bin'];
  for (const directory of paths) {
    const candidate = join(directory, name);
    try { if (existsSync(candidate)) { accessSync(candidate, fsConstants.X_OK); return candidate; } } catch { /* continue */ }
  }
  return undefined;
}

function safeWorkingDirectory(): string | undefined {
  // A stable system directory avoids inheriting a user-selected path.  The
  // process receives bytes over stdin and therefore needs no working files.
  try { if (existsSync('/tmp')) return '/tmp'; } catch { /* ignore */ }
  return undefined;
}

function normalizeMime(value?: string): string | undefined { return typeof value === 'string' && SAFE_MIME.has(value.toLowerCase()) ? value.toLowerCase() : undefined; }
function imageFormatMime(format: string): string | undefined { return format === 'jpeg' || format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : format === 'gif' ? 'image/gif' : format === 'bmp' ? 'image/bmp' : undefined; }
function ffmpegInputFormat(mimeType: string): string | undefined { return mimeType === 'video/mp4' ? 'mp4' : mimeType === 'video/webm' ? 'webm' : mimeType === 'video/x-matroska' ? 'matroska' : mimeType === 'video/quicktime' ? 'mov' : mimeType === 'video/ogg' ? 'ogg' : undefined; }
function parseOrientation(value: string | undefined): number | undefined { const number = Number(value); return Number.isInteger(number) && number >= 1 && number <= 8 ? number : undefined; }
function normalizeRotation(value: number): 0 | 90 | 180 | 270 | undefined { if (!Number.isFinite(value)) return undefined; const normalized = ((Math.round(value) % 360) + 360) % 360; return normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270 ? normalized as 0 | 90 | 180 | 270 : undefined; }
function finitePositive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function parseDurationSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && finitePositive(value)) return value;
  if (typeof value !== 'string' || !value.trim() || value === 'N/A') return undefined;
  const numeric = Number(value);
  if (finitePositive(numeric)) return numeric;
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3]);
  return finitePositive(seconds) ? seconds : undefined;
}
function safeMaxDimension(value: number): number { return boundedInteger(value, 1, DEFAULT_MAX_DIMENSION); }
function safeMaxPixels(value: number): number { return boundedInteger(value, 1, DEFAULT_MAX_PIXELS); }
function safeMaxOutputBytes(value: number): number { return boundedInteger(value, 1, DEFAULT_MAX_STDOUT); }
function safeDimension(value: number, maxDimension: number, _maxPixels: number): number | undefined { if (!Number.isSafeInteger(value) || value < 1 || value > maxDimension) return undefined; return value; }
function derivativeDimension(recipe: Readonly<Record<string, string | number | boolean>>, kind: NativeMediaDerivativeKind, maxDimension: number): number {
  const value = recipe.width ?? recipe.maxDimension;
  const requested = value === undefined ? kind === 'THUMBNAIL' || kind === 'VIDEO_FRAME' ? 320 : kind === 'PREVIEW' ? 1_600 : 4_096 : typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > maxDimension) throw new NativeHostError('INVALID_REQUEST', 'Media derivative dimensions are invalid');
  return requested;
}
function editArguments(recipe: Readonly<Record<string, string | number | boolean>>): string[] {
  const raw = recipe.operations;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let operations: unknown;
  try { operations = JSON.parse(raw); } catch { throw new NativeHostError('INVALID_REQUEST', 'Media edit recipe is invalid'); }
  if (!Array.isArray(operations) || operations.length > 32) throw new NativeHostError('INVALID_REQUEST', 'Media edit recipe is invalid');
  const args: string[] = [];
  for (const value of operations) {
    if (!value || typeof value !== 'object') throw new NativeHostError('INVALID_REQUEST', 'Media edit operation is invalid');
    const operation = value as { type?: unknown; degrees?: unknown; left?: unknown; top?: unknown; width?: unknown; height?: unknown; value?: unknown };
    if (operation.type === 'ROTATE') {
      if (operation.degrees !== 90 && operation.degrees !== 180 && operation.degrees !== 270) throw new NativeHostError('INVALID_REQUEST', 'Media rotation is invalid');
      args.push('-rotate', String(operation.degrees));
    } else if (operation.type === 'CROP') {
      const left = strictDimension(operation.left, 0);
      const top = strictDimension(operation.top, 0);
      const width = strictDimension(operation.width, 1);
      const height = strictDimension(operation.height, 1);
      if (left + width > DEFAULT_MAX_DIMENSION || top + height > DEFAULT_MAX_DIMENSION) throw new NativeHostError('RESOURCE_EXHAUSTED', 'Media crop exceeds the bounded dimension limit');
      args.push('-crop', `${width}x${height}+${left}+${top}`);
    } else if (operation.type === 'FLIP_HORIZONTAL') args.push('-flop');
    else if (operation.type === 'FLIP_VERTICAL') args.push('-flip');
    else if (operation.type === 'EXPOSURE') {
      const exposure = Number(operation.value);
      if (!Number.isFinite(exposure) || exposure < -100 || exposure > 100) throw new NativeHostError('INVALID_REQUEST', 'Media exposure is invalid');
      args.push('-brightness-contrast', `${Math.round(exposure)}x0`);
    } else throw new NativeHostError('INVALID_REQUEST', 'Media edit operation is unsupported');
  }
  return args;
}
function boundedInteger(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min; }
function strictDimension(value: unknown, fallback: number): number { const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN; if (!Number.isSafeInteger(number) || number < fallback || number > DEFAULT_MAX_DIMENSION) throw new NativeHostError('INVALID_REQUEST', 'Media crop dimensions are invalid'); return number; }
function decodeUtf8(value: Uint8Array): string { return new TextDecoder().decode(value); }
function concatBuffers(values: readonly Buffer[], length: number): Uint8Array { const output = Buffer.concat(values, Math.max(0, length)); return new Uint8Array(output); }
