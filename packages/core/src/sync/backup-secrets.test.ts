import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { encryptSnapshot, inspectColdBackup, captureColdBackupState, type ColdBackupSnapshot } from './backup.js';
import { LegacySecretCompatibilityBoundary } from '../security/secrets.js';

describe('cold backup secret boundary', () => {
  it('exposes only encrypted-container metadata', async () => {
    const snapshot = {
      masterSeed: new Uint8Array([1, 2, 3]),
      yjsState: new Uint8Array([4, 5]),
      globalConfig: {} as ColdBackupSnapshot['globalConfig'],
      oramaFiles: {},
    } satisfies ColdBackupSnapshot;
    const bytes = await encryptSnapshot(snapshot, 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    const inspection = inspectColdBackup(bytes);
    expect(inspection).toMatchObject({ format: 'KEYSTONE_COLD_BACKUP', version: 1, encrypted: true, containsPlaintext: false });
    expect(inspection.payloadByteLength).toBeGreaterThan(16);
    expect(inspectColdBackup(bytes.slice(0, -1)).payloadByteLength).toBe(inspection.payloadByteLength - 1);
    expect(() => inspectColdBackup(Uint8Array.of(1, 2, 3))).toThrow(/header/);
  });

  it('does not expose a captured legacy seed through JSON serialization', () => {
    const document = new Y.Doc(); const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1); const snapshot = captureColdBackupState(seed, document, {} as ColdBackupSnapshot['globalConfig'], {}, LegacySecretCompatibilityBoundary.open({ environment: 'DEVELOPMENT', purpose: 'MIGRATION', caller: 'backup-test' }));
    expect(JSON.stringify(snapshot)).toBe('{"kind":"KEYSTONE_COLD_BACKUP_SNAPSHOT","version":1,"encryptedRepresentation":true}');
    expect(snapshot.masterSeed).toEqual(seed);
  });
});
