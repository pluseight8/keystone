export interface DesktopCallSession {
  readonly callId: string;
  readonly peerId: string;
  readonly mode: 'audio' | 'video';
  readonly state: string;
  readonly localMicrophone: 'enabled' | 'disabled';
  readonly localCamera: 'enabled' | 'disabled';
  readonly localScreen: 'enabled' | 'disabled';
}

export interface DesktopCallHistoryEntry {
  readonly sessionId: string;
  readonly participant: string;
  readonly mode: 'audio' | 'video';
  readonly outcome: string;
}

export interface DesktopCallService {
  current(): readonly DesktopCallSession[];
  history(): readonly DesktopCallHistoryEntry[];
  accept(callId: string): Promise<DesktopCallSession>;
  reject(callId: string): Promise<void>;
  setMuted(callId: string, muted: boolean): Promise<void>;
  setCamera(callId: string, enabled: boolean): Promise<void>;
  startScreenShare(callId: string): Promise<void>;
  stopScreenShare(callId: string): Promise<void>;
  hangup(callId?: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

/** Host-provided CallService boundary for the desktop shell. */
export interface DesktopCallsRuntime {
  readonly calls: DesktopCallService;
  readonly localMediaAvailable: boolean;
}

let runtime: DesktopCallsRuntime | undefined;
const listeners = new Set<() => void>();

export function configureDesktopCallsRuntime(value: DesktopCallsRuntime | undefined): void {
  runtime = value;
  for (const listener of listeners) listener();
}

export function getDesktopCallsRuntime(): DesktopCallsRuntime | undefined { return runtime; }
export function subscribeDesktopCallsRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
