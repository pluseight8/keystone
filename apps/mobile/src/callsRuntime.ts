import type { CallService } from '@keystone/core';

/** Native host boundary for Calls. Core never touches OS microphone/camera APIs. */
export interface MobileCallRuntime {
  readonly calls: CallService;
  readonly localMediaAvailable: boolean;
}

let runtime: MobileCallRuntime | undefined;
const listeners = new Set<() => void>();

export function configureMobileCallRuntime(value: MobileCallRuntime | undefined): void { runtime = value; listeners.forEach(listener => listener()); }
export function getMobileCallRuntime(): MobileCallRuntime | undefined { return runtime; }
export function subscribeMobileCallRuntime(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
