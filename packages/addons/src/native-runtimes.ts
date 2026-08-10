import type { AddonSandboxRuntime, AddonSandboxSession, JsonValue, SandboxHostCall } from './types.js';

export interface NativeSandboxBridge {
  create(input: {
    isolation: 'tauri-isolated-webview' | 'quickjs' | 'wasmtime' | 'mobile-isolated-js';
    addonId: string;
    entrypoint: string;
    bundle: Uint8Array;
    /** Must be the only native-to-host callback exposed to the sandbox. */
    onHostCall: (call: SandboxHostCall) => Promise<JsonValue>;
    policy: {
      network: 'deny';
      filesystem: 'deny';
      process: 'deny';
      clipboard: 'deny';
    };
  }): Promise<{
    invoke(method: string, input: JsonValue): Promise<JsonValue>;
    destroy(): Promise<void>;
  }>;
}

/**
 * Adapter for a native Tauri sandbox provider. The bridge implementation must use
 * a separate WebView with a deny-all CSP/IPC allowlist, QuickJS without host
 * modules, or Wasmtime without WASI filesystem/socket imports.
 */
export function createDesktopAddonRuntime(
  bridge: NativeSandboxBridge,
  isolation: 'tauri-isolated-webview' | 'quickjs' | 'wasmtime' = 'tauri-isolated-webview',
): AddonSandboxRuntime {
  return createNativeRuntime(bridge, isolation);
}

/** Adapter for an Expo native module backed by a separate JavaScript runtime. */
export function createMobileAddonRuntime(bridge: NativeSandboxBridge): AddonSandboxRuntime {
  return createNativeRuntime(bridge, 'mobile-isolated-js');
}

function createNativeRuntime(bridge: NativeSandboxBridge, isolation: AddonSandboxRuntime['isolation']): AddonSandboxRuntime {
  if (isolation === 'test') throw new Error('Native addon runtime cannot use test isolation');
  return {
    isolation,
    async load({ manifest, bundle, hostCall }): Promise<AddonSandboxSession> {
      const native = await bridge.create({
        isolation,
        addonId: manifest.id,
        entrypoint: manifest.entrypoint,
        bundle,
        onHostCall: hostCall,
        policy: { network: 'deny', filesystem: 'deny', process: 'deny', clipboard: 'deny' },
      });
      return { invoke: (method, input) => native.invoke(method, input), dispose: () => native.destroy() };
    },
  };
}
