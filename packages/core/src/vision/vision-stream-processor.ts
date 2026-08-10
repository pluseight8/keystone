import type { AICommandProcessor } from '../ai.js';

export interface VisionFrame {
  base64: string;
  capturedAt: number;
  mimeType: 'image/jpeg' | 'image/png';
}

export interface VisionStreamProcessorOptions {
  fps?: number;
  jpegQuality?: number;
  maxBufferedFrames?: number;
  videoFactory?: () => HTMLVideoElement;
  canvasFactory?: () => HTMLCanvasElement;
}

/** Samples an authorized local/remote MediaStream without sending video to a cloud service. */
export class VisionStreamProcessor {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly frames: VisionFrame[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private stream?: MediaStream;

  constructor(private readonly commands: AICommandProcessor, private readonly options: VisionStreamProcessorOptions = {}) {
    this.video = options.videoFactory?.() ?? document.createElement('video');
    this.canvas = options.canvasFactory?.() ?? document.createElement('canvas');
    this.video.muted = true; this.video.playsInline = true;
  }

  async start(stream: MediaStream): Promise<void> {
    if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('Vision source has no live video track');
    this.stop(); this.stream = stream; this.video.srcObject = stream;
    await this.video.play();
    const fps = this.options.fps ?? 1;
    if (!Number.isFinite(fps) || fps <= 0 || fps > 10) throw new Error('fps must be between 0 and 10');
    await this.capture();
    this.timer = setInterval(() => { void this.capture(); }, 1_000 / fps);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.stream = undefined; this.video.pause(); this.video.srcObject = null;
  }

  get latestFrame(): VisionFrame | undefined { return this.frames.at(-1); }

  async ask(question: string, frameCount = 1): Promise<string> {
    const selected = this.frames.slice(-Math.max(1, frameCount)).map(frame => stripDataUrl(frame.base64));
    return this.commands.processVision(question, selected);
  }

  private async capture(): Promise<void> {
    if (!this.stream || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const width = this.video.videoWidth; const height = this.video.videoHeight;
    if (!width || !height) return;
    this.canvas.width = width; this.canvas.height = height;
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(this.video, 0, 0, width, height);
    const mimeType = 'image/jpeg' as const;
    const base64 = this.canvas.toDataURL(mimeType, this.options.jpegQuality ?? 0.82);
    this.frames.push({ base64, capturedAt: Date.now(), mimeType });
    const max = this.options.maxBufferedFrames ?? 5;
    if (this.frames.length > max) this.frames.splice(0, this.frames.length - max);
  }
}

function stripDataUrl(value: string): string { const separator = value.indexOf(','); return separator < 0 ? value : value.slice(separator + 1); }
