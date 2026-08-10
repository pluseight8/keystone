import type { MediaCaptureAdapter } from './platform.js';
export interface ReactNativeMediaDevices { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>; getDisplayMedia(constraints?: DisplayMediaStreamOptions): Promise<MediaStream>; }
export class ReactNativeMediaCaptureAdapter implements MediaCaptureAdapter {
  constructor(private readonly mediaDevices: ReactNativeMediaDevices) {}
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> { return this.mediaDevices.getUserMedia(constraints); }
  getDisplayMedia(constraints: DisplayMediaStreamOptions = { video: true, audio: false }): Promise<MediaStream> { return this.mediaDevices.getDisplayMedia(constraints); }
}
