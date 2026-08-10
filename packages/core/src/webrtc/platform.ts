export interface MediaCaptureAdapter {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  getDisplayMedia(constraints?: DisplayMediaStreamOptions): Promise<MediaStream>;
}

/** Tauri's webview exposes the standard browser capture APIs. */
export class DesktopMediaCaptureAdapter implements MediaCaptureAdapter {
  constructor(private readonly devices: MediaDevices = navigator.mediaDevices) {}
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> { return this.devices.getUserMedia(constraints); }
  getDisplayMedia(constraints: DisplayMediaStreamOptions = { video: true, audio: false }): Promise<MediaStream> {
    if (!this.devices.getDisplayMedia) throw new Error('Screen capture is unavailable in this webview');
    return this.devices.getDisplayMedia(constraints);
  }
}
