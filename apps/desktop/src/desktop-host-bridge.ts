/**
 * Narrow Tauri host boundary used by the local desktop product.
 *
 * The renderer may request a file selected by the user and may ask the native
 * host to sign an already-canonical payload. It never receives a filesystem
 * path or a private signing key.
 */
import { invoke } from '@tauri-apps/api/core';
import { SodiumCryptoProvider } from '../../../packages/core/src/browser.js';
import {
  SecretAccessError,
  SecretHandle,
  signCanonical,
  verifyCanonical,
  type SecretCapability,
  type SecretCreateInput,
  type SecretReference,
  type SecretStatus,
  type SecureSecretHost,
  type SigningDomain,
} from '@keystone/core';

export interface PickedDesktopFile {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bytes: Uint8Array;
}

export interface DesktopDecodedAudio {
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationMs: number;
  readonly pcmBase64: string;
}

export interface DesktopVideoProbe {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly videoCodec: string;
  readonly container: string;
}

interface NativePickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bytes: number[];
}

export function pickDesktopFile(kind: 'audio' | 'video' | 'file' | 'document'): Promise<PickedDesktopFile | null> {
  return invoke<NativePickedFile | null>('pick_local_file', { kind }).then(value => {
    if (!value) return null;
    if (!value.name || !value.mimeType || !Array.isArray(value.bytes) || !Number.isSafeInteger(value.size)) throw new Error('Native file picker returned an invalid file');
    const bytes = Uint8Array.from(value.bytes);
    if (bytes.byteLength !== value.size) throw new Error('Native file picker returned a truncated file');
    return { name: value.name, mimeType: value.mimeType, size: value.size, bytes };
  });
}

export function decodeDesktopAudio(bytes: Uint8Array, mimeType: string): Promise<DesktopDecodedAudio> {
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024) return Promise.reject(new Error('Selected audio exceeds the 64 MiB decoder input limit'));
  return invoke<DesktopDecodedAudio>('decode_local_audio', { payload: { mimeType, bytes: Array.from(bytes) } }).then(value => {
    if (!value || !Number.isSafeInteger(value.sampleRate) || value.sampleRate <= 0 || !Number.isSafeInteger(value.channels) || value.channels < 1 || !Number.isSafeInteger(value.durationMs) || value.durationMs <= 0 || typeof value.pcmBase64 !== 'string' || value.pcmBase64.length === 0) throw new Error('Native audio decoder returned invalid PCM metadata');
    return value;
  });
}

export function startDesktopAudio(sessionId: string, decoded: DesktopDecodedAudio, positionMs: number, volume: number): Promise<void> {
  return invoke('desktop_audio_start', { payload: { sessionId, ...decoded, positionMs, volume } });
}

export function pauseDesktopAudio(sessionId: string): Promise<void> {
  return invoke('desktop_audio_pause', { payload: { sessionId } });
}

export function resumeDesktopAudio(sessionId: string): Promise<void> {
  return invoke('desktop_audio_resume', { payload: { sessionId } });
}

export function seekDesktopAudio(sessionId: string, positionMs: number): Promise<void> {
  return invoke('desktop_audio_seek', { payload: { sessionId, positionMs } });
}

export function setDesktopAudioVolume(sessionId: string, volume: number): Promise<void> {
  return invoke('desktop_audio_volume', { payload: { sessionId, volume } });
}

export function stopDesktopAudio(sessionId: string): Promise<void> {
  return invoke('desktop_audio_stop', { payload: { sessionId } });
}

export function probeDesktopVideo(bytes: Uint8Array, mimeType: string): Promise<DesktopVideoProbe> {
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024 * 1024) return Promise.reject(new Error('Selected video exceeds the 512 MiB probe input limit'));
  return invoke<DesktopVideoProbe>('probe_local_video', { payload: { mimeType, bytes: Array.from(bytes) } }).then(value => {
    if (!value || !Number.isSafeInteger(value.durationMs) || value.durationMs <= 0 || !Number.isSafeInteger(value.width) || value.width <= 0 || !Number.isSafeInteger(value.height) || value.height <= 0 || typeof value.videoCodec !== 'string' || value.videoCodec.length === 0 || typeof value.container !== 'string' || value.container.length === 0) throw new Error('Native video probe returned invalid metadata');
    return value;
  });
}

export function startDesktopVideo(sessionId: string, mimeType: string, bytes: Uint8Array, durationMs: number, positionMs: number, volume: number): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024 * 1024) return Promise.reject(new Error('Selected video exceeds the 512 MiB playback input limit'));
  return invoke('desktop_video_start', { payload: { sessionId, mimeType, bytes: Array.from(bytes), durationMs, positionMs, volume } });
}

export function pauseDesktopVideo(sessionId: string): Promise<void> {
  return invoke('desktop_video_pause', { payload: { sessionId } });
}

export function resumeDesktopVideo(sessionId: string): Promise<void> {
  return invoke('desktop_video_resume', { payload: { sessionId } });
}

export function seekDesktopVideo(sessionId: string, positionMs: number): Promise<void> {
  return invoke('desktop_video_seek', { payload: { sessionId, positionMs } });
}

export function setDesktopVideoVolume(sessionId: string, volume: number): Promise<void> {
  return invoke('desktop_video_volume', { payload: { sessionId, volume } });
}

export function stopDesktopVideo(sessionId: string): Promise<void> {
  return invoke('desktop_video_stop', { payload: { sessionId } });
}

export function signDesktopPayload(deviceId: string, payload: string): Promise<string> {
  return invoke<string>('desktop_identity_sign', { payload: { deviceId, message: payload } });
}

export function removeDesktopIdentity(deviceId: string): Promise<void> {
  return invoke('desktop_identity_remove', { deviceId });
}

export function desktopIdentityAvailable(deviceId: string): Promise<boolean> {
  return invoke<boolean>('desktop_identity_status', { deviceId });
}

/**
 * Implements the Core SecureSecretHost contract over the native OS-protected
 * app-data key store. Only the identity signing methods are intentionally
 * available in this first desktop host; unsupported crypto operations fail
 * closed instead of falling back to renderer memory.
 */
export class TauriSecureSecretHost implements SecureSecretHost {
  readonly environment = 'PRODUCTION' as const;
  readonly securityLevel = 'OS_PROTECTED' as const;

  constructor(private readonly deviceId: string) {}

  async generate(_input: SecretCreateInput): Promise<SecretHandle> {
    throw new SecretAccessError('The desktop host accepts only explicitly derived identity material');
  }

  async importSecret(input: SecretCreateInput, secretBytes: Uint8Array): Promise<SecretHandle> {
    if (input.algorithm !== 'ED25519' || input.scope !== 'IDENTITY' || input.secretClass !== 'IDENTITY_PRIVATE_KEY') throw new SecretAccessError('Only identity ED25519 material may be provisioned by this host');
    if (!(secretBytes instanceof Uint8Array) || secretBytes.byteLength !== 64) throw new SecretAccessError('Identity signing material has an invalid size');
    await invoke('desktop_identity_provision', { payload: { deviceId: this.deviceId, privateKey: Array.from(secretBytes) } });
    return new SecretHandle(identityReference(this.deviceId, input));
  }

  async status(handle: SecretHandle): Promise<SecretStatus> {
    handle.assertUsable();
    const present = await desktopIdentityAvailable(this.deviceId);
    if (!present) throw new SecretAccessError('Desktop identity key is unavailable');
    return { ...handle.reference, activeCapabilities: 0 };
  }

  async rotate(_handle: SecretHandle): Promise<SecretHandle> {
    throw new SecretAccessError('Identity rotation requires an explicit recovery flow');
  }

  async revoke(handle: SecretHandle): Promise<void> {
    handle.assertUsable('REVOKE');
    await removeDesktopIdentity(this.deviceId);
    handle.close();
  }

  async delete(handle: SecretHandle): Promise<void> {
    await removeDesktopIdentity(this.deviceId);
    handle.close();
  }

  async sign(handle: SecretHandle, domain: SigningDomain, payload: unknown, capability: SecretCapability): Promise<string> {
    handle.assertUsable('SIGN');
    const operation = domain === 'KEYSTONE_IDENTITY_PROFILE' ? 'SIGN_IDENTITY_OBJECT' : domain === 'KEYSTONE_OWNER_INTENT' ? 'SIGN_OWNER_INTENT' : 'SIGN_PROTOCOL_ENVELOPE';
    capability.consume(operation, handle, { callerId: capability.grant.callerId, ...(capability.grant.target ? { target: capability.grant.target } : {}) });
    return signCanonical({ domain, payload }, bytes => signDesktopPayload(this.deviceId, bytes));
  }

  async verify(domain: SigningDomain, payload: unknown, signature: string, publicKey: string): Promise<boolean> {
    return verifyCanonical({ domain, payload }, signature, (bytes, raw) => new SodiumCryptoProvider().verify(bytes, raw, publicKey));
  }

  async derive(): Promise<never> { throw new SecretAccessError('Desktop identity derivation is not exposed to the renderer'); }
  async encrypt(): Promise<never> { throw new SecretAccessError('Desktop encryption is not exposed to the renderer'); }
  async decrypt(): Promise<never> { throw new SecretAccessError('Desktop decryption is not exposed to the renderer'); }

  readForScopedAdapter(): never { throw new SecretAccessError('Identity material is non-exportable'); }

  async restoreHandle(reference: SecretReference): Promise<SecretHandle | undefined> {
    if (reference.handleId !== `identity:${this.deviceId}` || !(await desktopIdentityAvailable(this.deviceId))) return undefined;
    return new SecretHandle({ ...reference });
  }
}

export interface DesktopIdentitySigner {
  readonly sign: (payload: string) => Promise<string>;
}

export function createDesktopIdentitySigner(deviceId: string): DesktopIdentitySigner {
  return { sign: payload => signDesktopPayload(deviceId, payload) };
}

function identityReference(deviceId: string, input: SecretCreateInput): SecretReference {
  return {
    kind: 'SECRET_REFERENCE',
    handleId: `identity:${deviceId}`,
    secretClass: input.secretClass,
    risk: input.risk ?? 'CRITICAL',
    lifetime: input.lifetime ?? 'DURABLE',
    scope: 'IDENTITY',
    origin: 'HOST_PROVISIONED',
    exportPolicy: 'NON_EXPORTABLE',
    algorithm: 'ED25519',
    generation: 1,
    state: 'ACTIVE',
    createdAt: new Date().toISOString(),
    securityLevel: 'OS_PROTECTED',
    environment: 'PRODUCTION',
  };
}
