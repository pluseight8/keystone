import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import {
  BoundedFrameDecoder,
  DEFAULT_PROTOCOL_LIMITS,
  DEFAULT_PROTOCOL_SECURITY_PROFILE,
  MonotonicStateGuard,
  NetworkResourceGovernor,
  ProtocolBoundsError,
  ProtocolFuzzHarness,
  ProtocolSecurityError,
  ProtocolStateMachineGuard,
  ReplayWindow,
  generateHostileProtocolInputs,
  negotiateProtocolSecurity,
  parseBoundedJson,
  protocolSignedPayload,
  validateCompressionMetadata,
  validateFileChunk,
  validateRemoteEnvelope,
} from './protocol-security.js';

function envelope(overrides: Record<string, unknown> = {}) {
  return { version: 1 as const, type: 'security.test', id: 'message-1', sender: 'a'.repeat(64), recipient: 'b'.repeat(64), nonce: 'nonce-1', expiresAt: new Date(Date.now() + 10_000).toISOString(), body: { value: 'bounded' }, signature: 'signature', ...overrides };
}

describe('zero-trust protocol security', () => {
  it('rejects a protocol downgrade even when the peer offers legacy compatibility', () => {
    const remote = { ...DEFAULT_PROTOCOL_SECURITY_PROFILE, minimumEnvelopeVersion: 2, supportedEnvelopeVersions: [1, 2] as const };
    expect(negotiateProtocolSecurity(DEFAULT_PROTOCOL_SECURITY_PROFILE, remote).decision).toBe('REJECT_DOWNGRADE');
    const weakSuite = { ...DEFAULT_PROTOCOL_SECURITY_PROFILE, minimumCryptoSuite: 'ed25519+xsalsa20poly1305' as const, supportedCryptoSuites: ['ed25519+xsalsa20poly1305'] as const };
    const localStrong = { ...DEFAULT_PROTOCOL_SECURITY_PROFILE, minimumCryptoSuite: 'ed25519+x25519+xchacha20poly1305' as const };
    expect(negotiateProtocolSecurity(localStrong, weakSuite).accepted).toBe(false);
  });

  it('rejects oversized declared frames before allocation and bounds partial data', () => {
    const decoder = new BoundedFrameDecoder({ maxFrameBytes: 1_024, maxPendingBytes: 2_048 }); const header = new Uint8Array(4); new DataView(header.buffer).setUint32(0, 8 * 1024 * 1024);
    expect(() => decoder.push(header)).toThrowError(ProtocolBoundsError); expect(() => decoder.push(new Uint8Array(2_048))).toThrowError(ProtocolBoundsError);
  });

  it('parses bounded JSON and rejects duplicate keys, deep nesting and huge collections', () => {
    expect(() => parseBoundedJson('{"a":1,"a":2}')).toThrowError(ProtocolBoundsError);
    expect(() => parseBoundedJson('['.repeat(40) + '0' + ']'.repeat(40), { maxDepth: 8 })).toThrowError(ProtocolBoundsError);
    expect(() => parseBoundedJson(`[${'0,'.repeat(100)}0]`, { maxCollectionItems: 32 })).toThrowError(ProtocolBoundsError);
    expect(parseBoundedJson<{ ok: boolean }>(JSON.stringify({ ok: true })).ok).toBe(true);
  });

  it('requires bounded expiry and rejects unknown critical envelope fields', async () => {
    await expect(validateRemoteEnvelope(envelope({ criticalPolicy: 'disabled' }))).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(validateRemoteEnvelope(envelope({ expiresAt: new Date(Date.now() + DEFAULT_PROTOCOL_LIMITS.maxLifetimeMs * 4).toISOString() }))).rejects.toMatchObject({ code: 'EXPIRED_MESSAGE' });
  });

  it('binds signatures to an explicit object type domain', async () => {
    const crypto = new SodiumCryptoProvider(); const keys = await crypto.generateIdentity(); const value = { id: 'object-1', revision: 1, state: 'active' };
    const signature = await crypto.sign(protocolSignedPayload('agent.profile', value), keys.privateKey);
    expect(await crypto.verify(protocolSignedPayload('agent.profile', value), signature, keys.publicKey)).toBe(true);
    expect(await crypto.verify(protocolSignedPayload('agent.presence', value), signature, keys.publicKey)).toBe(false);
    expect(await crypto.verify(protocolSignedPayload('agent.profile', { ...value, revision: 2 }), signature, keys.publicKey)).toBe(false);
  });

  it('completes signature, replay and authorization stages exactly once', async () => {
    const crypto = new SodiumCryptoProvider(); const keys = await crypto.generateIdentity(); const replay = new ReplayWindow({ maxEntries: 8 }); const value = envelope({ sender: keys.publicKey, signature: undefined }); const { signature: _signature, ...unsigned } = value; const signature = await crypto.sign(protocolSignedPayload(value.type, unsigned), keys.privateKey); const signed = { ...unsigned, signature };
    const accepted = await validateRemoteEnvelope(signed, { replay, verifySignature: (item, domain) => crypto.verify(protocolSignedPayload(domain, (() => { const { signature: _ignored, ...without } = item; return without; })()), item.signature, keys.publicKey), authorize: () => true });
    expect(accepted.authorized).toBe(true); await expect(validateRemoteEnvelope(signed, { replay, verifySignature: (item, domain) => crypto.verify(protocolSignedPayload(domain, (() => { const { signature: _ignored, ...without } = item; return without; })()), item.signature, keys.publicKey) })).rejects.toMatchObject({ code: 'REPLAY' });
  });

  it('keeps tombstones and epochs monotonic', () => {
    const guard = new MonotonicStateGuard(); expect(guard.accept('device', { revision: 2, epoch: 2 })).toBe(true); expect(guard.markTombstone('device', 3, 3)).toBe(true); expect(guard.accept('device', { revision: 4, epoch: 4, tombstoned: false })).toBe(false); expect(guard.accept('device', { revision: 2, epoch: 2 })).toBe(false);
  });

  it('rejects illegal protocol state transitions', () => {
    const guard = new ProtocolStateMachineGuard<'NEW' | 'RUNNING' | 'DONE', 'START' | 'COMPLETE'>(
      'NEW', [{ from: 'NEW', event: 'START', to: 'RUNNING' }, { from: 'RUNNING', event: 'COMPLETE', to: 'DONE' }],
    ); expect(() => guard.transition('COMPLETE', 'DONE')).toThrowError(ProtocolSecurityError); guard.transition('START', 'RUNNING'); expect(() => guard.transition('START', 'RUNNING')).toThrowError(ProtocolSecurityError); guard.transition('COMPLETE', 'DONE');
  });

  it('bounds unknown-peer state, connections, frames and strikes', () => {
    const governor = new NetworkResourceGovernor({ maxTrackedPeers: 2, strikeThreshold: 2, quarantineThreshold: 3 }); expect(governor.admitConnection('peer-a')).toBe('ALLOW'); expect(governor.admitConnection('peer-a')).toBe('ALLOW'); expect(governor.admitConnection('peer-a')).not.toBe('ALLOW'); expect(governor.admitConnection('peer-b')).toBe('ALLOW'); expect(governor.admitConnection('peer-c')).toBe('REJECT'); expect(governor.strike('peer-a', 'malformed')).toBe('REJECT'); expect(governor.strike('peer-a', 'malformed')).toBe('DISCONNECT'); expect(governor.isDisconnected('peer-a')).toBe(true); expect(governor.trackedPeers()).toBeLessThanOrEqual(2);
  });

  it('bounds file chunks and has no filesystem-path interpretation', () => {
    const valid = { transferId: 't', objectId: 'content', index: 0, totalChunks: 1, totalSize: 3, chunkSize: 3, contentHash: 'a'.repeat(64), bytes: new Uint8Array([1, 2, 3]) }; expect(validateFileChunk(valid).index).toBe(0); expect(() => validateFileChunk({ ...valid, index: 2 })).toThrowError(ProtocolSecurityError); expect(() => validateFileChunk({ ...valid, bytes: new Uint8Array(5 * 1024 * 1024) })).toThrowError(ProtocolSecurityError); expect(JSON.stringify(valid)).not.toContain('/etc');
  });

  it('keeps compression disabled and fuzz input bounded without crashes', () => {
    expect(() => validateCompressionMetadata({ algorithm: 'gzip', declaredSize: 1 })).toThrowError(ProtocolSecurityError); expect(() => validateCompressionMetadata({ algorithm: 'none', declaredSize: DEFAULT_PROTOCOL_LIMITS.maxDecompressedBytes + 1 })).toThrowError(ProtocolSecurityError);
    const result = new ProtocolFuzzHarness(() => new BoundedFrameDecoder({ maxFrameBytes: 1_024, maxPendingBytes: 2_048 })).run(generateHostileProtocolInputs(128)); expect(result).toHaveLength(128); expect(result.every(value => value.crashed === false)).toBe(true);
  });
});
