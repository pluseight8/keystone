import { canonicalJson, sha256Hex } from './plugin-integrity.js';
import { manifestForIntegrity, validatePluginPackage } from './plugin-manifest.js';
import type {
  PluginDependencyLock,
  PluginManifest,
  PluginPackage,
  PluginPackageProvenance,
  PluginPublisherIdentity,
  PluginRevision,
  PluginRevocationRecord,
  PluginSigningPolicy,
  PluginSupplyChainPolicy,
  PluginTrustEvidence,
  PluginUpdateTrustDecision,
  PluginVerificationResult,
} from './plugin-types.js';

export type { PluginSupplyChainPolicy } from './plugin-types.js';

export const DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY: PluginSupplyChainPolicy = {
  signing: { requireSignature: false, rejectRevokedPublishers: true },
  requireDependencyLocks: true,
  maxBundleBytes: 64 * 1024 * 1024,
  maxResourceCount: 256,
  maxResourceBytes: 16 * 1024 * 1024,
  rejectNativePayloads: true,
};

export interface PluginSignatureVerifier {
  verify(input: { readonly signer: PluginPublisherIdentity; readonly message: Uint8Array; readonly signature: string }): Promise<boolean>;
}
export interface PluginSupplyChainOptions {
  readonly policy?: Partial<PluginSupplyChainPolicy>;
  readonly verifier?: PluginSignatureVerifier;
  readonly now?: () => number;
  readonly revocations?: readonly PluginRevocationRecord[];
}

/** Domain-separated, deterministic bytes signed by a publisher. */
export function pluginSignaturePayload(manifest: PluginManifest): string {
  return `keystone.plugin.signature.v1:${canonicalJson({
    pluginId: manifest.id, version: manifest.version, manifest: manifestForIntegrity(manifest),
    integrity: manifest.integrity, entrypoint: manifest.entrypoint,
    requestedCapabilities: manifest.requestedCapabilities, dependencies: manifest.dependencies,
  })}`;
}

export function createDependencyLock(manifest: PluginManifest): PluginDependencyLock {
  const dependencies = manifest.dependencies.map(dep => ({ id: dep.id, version: dep.version, integrity: dep.integrity ?? '' })).sort((a, b) => a.id.localeCompare(b.id));
  return { pluginId: manifest.id, dependencies, graphHash: stableHash(canonicalJson({ pluginId: manifest.id, dependencies })) };
}

export function verifyDependencyLock(manifest: PluginManifest, lock: PluginDependencyLock | undefined, required = true): void {
  if (!lock) { if (required && manifest.dependencies.length) throw new Error('Plugin dependency lock is required'); return; }
  if (lock.pluginId !== manifest.id) throw new Error('Dependency lock belongs to another Plugin');
  const expected = createDependencyLock(manifest); if (lock.graphHash !== expected.graphHash || canonicalJson(lock.dependencies) !== canonicalJson(expected.dependencies)) throw new Error('Plugin dependency lock does not match manifest');
}

export function packageProvenance(plugin: PluginPackage, now = Date.now()): PluginPackageProvenance { const signer = plugin.manifest.signatureMetadata; return { source: { ...plugin.source }, receivedAt: new Date(now).toISOString(), ...(signer ? { publisher: { publisherId: signer.signerIdentity, keyId: signer.keyId ?? signer.signerIdentity, algorithm: 'ED25519', ...(signer.publicKey ? { publicKey: signer.publicKey } : {}) } } : {}), components: Object.keys(plugin.resources ?? {}).sort() }; }

export async function verifyPluginSupplyChain(plugin: PluginPackage, options: PluginSupplyChainOptions = {}): Promise<PluginVerificationResult> {
  const policy = mergePolicy(options.policy); const manifest = await validatePluginPackage(plugin); const evidence: PluginTrustEvidence[] = [{ kind: 'INTEGRITY', value: manifest.integrity.packageHash, at: new Date(options.now?.() ?? Date.now()).toISOString() }];
  const revoked = (options.revocations ?? []).some(item => item.kind === 'PUBLISHER' && (item.subject === manifest.signatureMetadata?.signerIdentity || item.subject === manifest.signatureMetadata?.keyId));
  let signature: PluginVerificationResult['signature'] = 'UNSIGNED'; let publisher: PluginVerificationResult['publisher'] = 'UNKNOWN';
  const metadata = manifest.signatureMetadata;
  if (metadata) {
    if (!metadata.signature || !metadata.signerIdentity || revoked) { signature = revoked ? 'INVALID' : 'INVALID'; publisher = revoked ? 'REVOKED' : 'UNKNOWN'; }
    else if (!options.verifier) { signature = 'UNVERIFIED'; publisher = revoked ? 'REVOKED' : 'UNKNOWN'; }
    else {
      const ok = await options.verifier.verify({ signer: { publisherId: metadata.signerIdentity, keyId: metadata.keyId ?? metadata.signerIdentity, algorithm: 'ED25519', ...(metadata.publicKey ? { publicKey: metadata.publicKey } : {}) }, message: new TextEncoder().encode(pluginSignaturePayload(manifest)), signature: metadata.signature });
      signature = ok ? 'SIGNED' : 'INVALID'; publisher = ok && !revoked ? 'VERIFIED_PUBLISHER' : revoked ? 'REVOKED' : 'UNKNOWN'; if (ok) evidence.push({ kind: 'SIGNATURE', value: metadata.keyId ?? metadata.signerIdentity, at: new Date(options.now?.() ?? Date.now()).toISOString() });
    }
  }
  const requiredSignature = policy.signing.requireSignature && manifest.pluginType !== 'DEVELOPMENT';
  const security = revoked || signature === 'INVALID' || (requiredSignature && signature !== 'SIGNED') ? 'REJECTED' : 'REVIEW_REQUIRED';
  return { pluginId: manifest.id, version: manifest.version, packageHash: manifest.integrity.packageHash, integrity: 'VERIFIED', signature, publisher, security, evidence };
}

export function decidePluginUpdateTrust(input: { pluginId: string; from: PluginRevision; to: PluginRevision; verification: PluginVerificationResult; addedCapabilities: readonly string[]; revokedRevision?: boolean }): PluginUpdateTrustDecision {
  const reasons: string[] = []; if (input.verification.integrity !== 'VERIFIED') reasons.push('integrity failed'); if (input.verification.signature === 'INVALID') reasons.push('invalid signature'); if (input.verification.publisher === 'REVOKED') reasons.push('publisher revoked'); if (input.revokedRevision) reasons.push('target revision security revoked'); if (input.addedCapabilities.length) reasons.push('capability expansion requires owner review');
  return { pluginId: input.pluginId, from: input.from, to: input.to, decision: reasons.some(reason => /failed|invalid|revoked/.test(reason)) ? 'REJECT' : reasons.length ? 'REVIEW' : 'ALLOW', reasons, verification: input.verification };
}

export function mergePolicy(value?: Partial<PluginSupplyChainPolicy>): PluginSupplyChainPolicy { return { ...DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY, ...value, signing: { ...DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY.signing, ...(value?.signing ?? {}) } }; }
export function assertPackageBounds(plugin: PluginPackage, policy: PluginSupplyChainPolicy = DEFAULT_PLUGIN_SUPPLY_CHAIN_POLICY): void {
  if (plugin.executable.byteLength > policy.maxBundleBytes) throw new Error('Plugin package exceeds the supply-chain bundle limit');
  const resources = Object.entries(plugin.resources ?? {}); if (resources.length > policy.maxResourceCount) throw new Error('Plugin package contains too many resources');
  for (const [path, bytes] of resources) { if (bytes.byteLength > policy.maxResourceBytes) throw new Error(`Plugin resource is too large: ${path}`); if (/\.(?:node|dll|dylib|so|exe|bin)$/i.test(path) && policy.rejectNativePayloads) throw new Error('Native Plugin payloads are unsupported in this runtime'); }
}
function stableHash(value: string): string { let hash = 2166136261; for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }

/** Explicit revocation source boundary; no central authority is assumed. */
export class PluginRevocationStore {
  private readonly values = new Map<string, PluginRevocationRecord>();
  add(record: PluginRevocationRecord): void { this.values.set(`${record.kind}:${record.subject}`, structuredClone(record)); }
  isRevoked(kind: PluginRevocationRecord['kind'], subject: string, now = Date.now()): boolean { const value = this.values.get(`${kind}:${subject}`); return Boolean(value && (!value.expiresAt || Date.parse(value.expiresAt) > now)); }
  list(): readonly PluginRevocationRecord[] { return [...this.values.values()].map(value => structuredClone(value)); }
}
