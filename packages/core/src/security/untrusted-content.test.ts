import { describe, expect, it } from 'vitest';
import {
  ArchiveInspectionService,
  FileContainmentService,
  FileFuzzHarness,
  FileTypeDetector,
  InMemoryQuarantineStateStore,
  QuarantineReleaseService,
  QuarantineStore,
  SandboxedMediaDecoder,
  createSyntheticAdversarialFixtures,
  isDangerousFileTool,
  isQuarantinedContent,
  type MalwareScannerAdapter,
} from './untrusted-content.js';

const cleanScanner: MalwareScannerAdapter = { async scan(input) { return { version: 1, status: 'CLEAN', scannedHash: input.contentHash, scannedAt: new Date().toISOString(), engine: 'synthetic-local' }; } };
const failingScanner: MalwareScannerAdapter = { async scan() { throw new Error('scanner unavailable'); } };

describe('R0P59 untrusted content containment', () => {
  it('keeps received bytes in quarantine and ignores remote path authority', async () => {
    const store = new QuarantineStore();
    const entry = await store.receive({ version: 1, transferId: 'transfer-1', sourceIdentity: 'mallory', objectId: 'file-1', filename: '../../system/run.sh', mimeType: 'image/jpeg', size: 2 }, new Uint8Array([0x4d, 0x5a]));
    expect(entry.state).toBe('QUARANTINED'); expect(entry.metadata.generatedPath).toMatch(/^quarantine\/quarantine-/); expect(entry.metadata.originalFilename).toContain('..'); expect(entry.metadata.generatedPath).not.toContain('..');
    await expect(store.mark(entry.metadata.entryId, 'OWNER_RELEASED')).rejects.toThrow(/authority/i);
  });

  it('detects executable bytes renamed as media and MIME mismatch', () => {
    const evidence = new FileTypeDetector().detect({ bytes: Uint8Array.from([0x4d, 0x5a, 1, 2]), filename: 'cat.jpg', mimeType: 'image/jpeg' });
    expect(evidence.executableRisk).toBe('CRITICAL'); expect(evidence.mismatch).toBe(true); expect(evidence.detectedType).toBe('PE');
  });

  it('classifies macro-capable document hints as executable risk', () => {
    const bytes = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); const evidence = new FileTypeDetector().detect({ bytes, filename: 'invoice.docm', mimeType: 'application/vnd.ms-word' });
    expect(evidence.detectedType).toBe('OLE'); expect(evidence.executableRisk).toBe('HIGH'); expect(evidence.containerRisk).toBe('ARCHIVE');
  });

  it('fails closed when the malware scanner crashes', async () => {
    const containment = new FileContainmentService({ scanner: failingScanner });
    const entry = await containment.receive({ version: 1, transferId: 'scan-fail', sourceIdentity: 'peer', objectId: 'object-scan-fail', filename: 'note.txt', mimeType: 'text/plain', size: 4 }, new TextEncoder().encode('safe'));
    const inspected = await containment.inspect(entry.metadata.entryId);
    expect(inspected.inspection.scanner.status).toBe('SCAN_FAILED'); expect(inspected.inspection.state).toBe('INSPECTION_FAILED'); expect(await containment.preview(entry.metadata.entryId)).toBeUndefined();
  });

  it('does not turn a clean scanner result into execution authority', async () => {
    const containment = new FileContainmentService({ scanner: cleanScanner });
    const entry = await containment.receive({ version: 1, transferId: 'clean-exe', sourceIdentity: 'peer', objectId: 'object-clean-exe', filename: 'tool.exe', mimeType: 'application/octet-stream', size: 3 }, Uint8Array.from([0x4d, 0x5a, 0]));
    const inspected = await containment.inspect(entry.metadata.entryId); expect(inspected.inspection.scanner.status).toBe('CLEAN'); expect(await containment.canEnterProcessExecution(inspected)).toBe(false);
    const release = new QuarantineReleaseService(containment.store, { ownerIdentityId: 'owner', now: () => Date.parse('2026-08-18T12:00:00.000Z') });
    await expect(release.release(entry.metadata.entryId, { version: 1, intentId: 'release-1', explicitOwnerRequest: true, source: 'REMOTE_AGENT', ownerIdentityId: 'owner', objectId: 'object-clean-exe', contentHash: entry.contentHash, requestedAt: '2026-08-18T11:59:00.000Z', expiresAt: '2026-08-18T12:05:00.000Z', confirmed: true, riskAcknowledged: true })).rejects.toThrow();
    const released = await release.release(entry.metadata.entryId, { version: 1, intentId: 'release-2', explicitOwnerRequest: true, source: 'OWNER', ownerIdentityId: 'owner', objectId: 'object-clean-exe', contentHash: entry.contentHash, requestedAt: '2026-08-18T11:59:00.000Z', expiresAt: '2026-08-18T12:05:00.000Z', confirmed: true, riskAcknowledged: true });
    expect(released.executableAuthority).toBe(false); expect(released.trust).toBe('OWNER_RELEASED');
  });

  it('enforces archive traversal, entry and ratio bounds before extraction', () => {
    const archive = new ArchiveInspectionService({ maxEntries: 1 });
    const malformed = archive.inspect(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), { filename: 'archive.zip' });
    expect(malformed.accepted).toBe(false); expect(malformed.risk).toBe('MALFORMED');
    const plan = archive.boundedExtractionPlan({ bytes: new TextEncoder().encode('plain'), sourceHash: 'sha256-test', objectId: 'object', filename: 'note.txt', provenance: [] });
    expect(plan?.accepted).toBe(true); // non-archives have a bounded empty plan
  });

  it('rejects absurd image dimensions before decode allocation', async () => {
    const bytes = new Uint8Array(24); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const view = new DataView(bytes.buffer); view.setUint32(16, 0xfffffff0, false); view.setUint32(20, 0xfffffff0, false);
    await expect(new SandboxedMediaDecoder().decode({ sourceHash: 'sha256-image', objectId: 'image', mimeType: 'image/png', bytes, provenance: [] })).rejects.toThrow(/dimension|budget/i);
  });

  it('keeps active markup non-active and preserves derived provenance', async () => {
    const containment = new FileContainmentService({ scanner: cleanScanner }); const bytes = new TextEncoder().encode('<svg onclick="javascript:alert(1)"><script>bad()</script><a href="javascript:bad">x</a></svg>');
    const entry = await containment.receive({ version: 1, transferId: 'markup', sourceIdentity: 'peer', objectId: 'markup-object', filename: 'x.svg', mimeType: 'image/svg+xml', size: bytes.length }, bytes); await containment.inspect(entry.metadata.entryId); const preview = await containment.preview(entry.metadata.entryId);
    expect(preview?.representation).toBe('SANITIZED_MARKUP'); expect(JSON.stringify(preview)).not.toMatch(/<script|onclick|javascript:/i); expect(preview?.provenance.length).toBeGreaterThan(1);
  });

  it('bounds storage, preserves restart state, and never executes fuzz fixtures', async () => {
    const backend = new InMemoryQuarantineStateStore(); const first = new FileContainmentService({ store: new QuarantineStore({ stateStore: backend, budget: { maxPendingBytes: 32, maxPerPeerBytes: 16, maxPerTransferBytes: 16, maxEntries: 8 } }) });
    const entry = await first.receive({ version: 1, transferId: 'persisted', sourceIdentity: 'peer', filename: 'x.bin', size: 3 }, Uint8Array.from([1, 2, 3]));
    const restartedStore = new QuarantineStore({ stateStore: backend }); await restartedStore.ready(); expect(await restartedStore.get(entry.metadata.entryId)).toBeDefined();
    const fuzz = await new FileFuzzHarness(new FileContainmentService({ scanner: cleanScanner })).run(createSyntheticAdversarialFixtures()); expect(fuzz.cases).toBeGreaterThan(0); expect(fuzz.violations).toHaveLength(0);
    await expect(first.receive({ version: 1, transferId: 'flood', sourceIdentity: 'peer', size: 20 }, new Uint8Array(20))).rejects.toThrow(/budget/i);
  });

  it('persists an interrupted bounded transfer as receiving/quarantined state', async () => {
    const backend = new InMemoryQuarantineStateStore();
    const first = new QuarantineStore({ stateStore: backend, budget: { maxPendingBytes: 64, maxPerPeerBytes: 64, maxPerTransferBytes: 64, maxIncompleteObjects: 4 } });
    const transfer = first.beginTransfer({ version: 1, transferId: 'partial-transfer', sourceIdentity: 'peer', objectId: 'partial-object', filename: 'partial.bin', mimeType: 'application/octet-stream', size: 8 });
    transfer.append(Uint8Array.from([1, 2, 3])); await first.flush();
    const restarted = new QuarantineStore({ stateStore: backend });
    expect((await restarted.incompleteTransfers()).map(value => value.transferId)).toContain('partial-transfer');
    const resumed = await restarted.resumeTransfer('partial-transfer'); expect(resumed).toBeDefined(); resumed!.append(Uint8Array.from([4, 5, 6, 7, 8]));
    const entry = await restarted.completeTransfer(resumed!); expect(entry.state).toBe('QUARANTINED'); expect(entry.bytes).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('marks quarantine objects as blocked for dangerous tools only', () => {
    expect(isQuarantinedContent({ kind: 'QuarantinedBlob', trust: 'QUARANTINED' })).toBe(true); expect(isQuarantinedContent({ kind: 'QuarantinedBlob', trust: 'OWNER_RELEASED' })).toBe(true); expect(isQuarantinedContent({ kind: 'UserReleasedFileObject', trust: 'OWNER_RELEASED' })).toBe(false); expect(isDangerousFileTool('processExecution')).toBe(true); expect(isDangerousFileTool('openFile')).toBe(true); expect(isDangerousFileTool('readAllowedFile')).toBe(false);
  });

  it('keeps private ciphertext opaque until an authorized materialization boundary', async () => {
    const containment = new FileContainmentService(); const bytes = Uint8Array.from([0x00, 0x91, 0x7f, 0x22]);
    const entry = await containment.receive({ version: 1, transferId: 'ciphertext', sourceIdentity: 'peer', objectId: 'private-file', filename: 'secret.pdf', mimeType: 'application/pdf', size: bytes.length, encrypted: true, visibility: 'private' }, bytes);
    const inspected = await containment.inspect(entry.metadata.entryId);
    expect(inspected.inspection.reason).toMatch(/ciphertext/i); expect(inspected.inspection.scanner.status).toBe('UNKNOWN'); expect(await containment.preview(entry.metadata.entryId)).toBeUndefined();
  });
});
