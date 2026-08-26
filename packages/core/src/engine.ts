import { AICommandProcessor, type AIModelAdapter, type ActionPayload, type TrustedNode } from './ai.js';
import { SodiumCryptoProvider, type CryptoProvider } from './crypto.js';
import { type EnvelopeSecurity, type Transport } from './transport.js';
import { ConnectivityFabric, FabricTransport, type KeystoneDeliveryInterface } from './connectivity.js';
import type { ImmutableCore, IntegrityManifest } from './security/immutable-core.js';
import type { NetworkResourceGovernor } from './security/protocol-security.js';
import type { ProtocolTransportSecurity } from './transport.js';

export interface ContextManager { search(query: string): Promise<TrustedNode[]>; }
export interface KeystoneEngineOptions {
  model: AIModelAdapter;
  publicKey?: Uint8Array;
  /**
   * @deprecated Compatibility-only low-level seam.  A production engine must
   * provide `fabric` or `fabricTransport`.  Keeping the field lets old
   * migration fixtures compile, but it is rejected unless the caller states
   * the non-production purpose explicitly.
   */
  transport?: Transport;
  /** Explicit classification for the deprecated transport seam. */
  legacyTransportPurpose?: 'TEST' | 'MIGRATION';
  /** Fabric-backed compatibility facade for high-level delivery. */
  fabricTransport?: KeystoneDeliveryInterface;
  /** Secure Fabric construction path; application signing remains mandatory. */
  fabric?: ConnectivityFabric;
  fabricLocalNodeId?: string;
  fabricSecurity?: EnvelopeSecurity;
  crypto?: CryptoProvider;
  context?: ContextManager;
  immutableCore?: ImmutableCore;
  releaseManifest?: IntegrityManifest;
  protocolSecurity?: ProtocolTransportSecurity;
  networkResources?: NetworkResourceGovernor;
}
export class KeystoneEngine {
  readonly crypto: CryptoProvider;
  /**
   * Canonical application delivery dependency.  `transport` is retained as a
   * source-compatible alias for older callers, but both references always
   * point at the same Fabric-backed delivery implementation in production.
   */
  readonly delivery: KeystoneDeliveryInterface;
  readonly transport: KeystoneDeliveryInterface;
  /** The Fabric is exposed for diagnostics/provider lifecycle, never for
   * application code to select a physical transport. */
  readonly fabric?: ConnectivityFabric;
  readonly processor: AICommandProcessor; readonly context?: ContextManager;
  private started = false;
  private readonly immutableCore?: ImmutableCore;
  private readonly releaseManifest?: IntegrityManifest;
  constructor(options: KeystoneEngineOptions) {
    this.crypto = options.crypto ?? new SodiumCryptoProvider();
    if (options.fabric) {
      if (!options.fabricLocalNodeId || !options.fabricSecurity) throw new Error('Fabric-backed engine requires local node ID and application envelope security');
      this.fabric = options.fabric;
      this.delivery = new FabricTransport({ fabric: options.fabric, localNodeId: options.fabricLocalNodeId, applicationSecurity: options.fabricSecurity });
    } else if (options.fabricTransport) {
      this.delivery = options.fabricTransport;
      this.fabric = options.fabricTransport instanceof FabricTransport ? options.fabricTransport.fabric : undefined;
    } else if (options.transport && options.legacyTransportPurpose) {
      // This is intentionally an explicit migration/test escape hatch.  It
      // must never become a silent production fallback when Fabric is down.
      this.delivery = options.transport;
    } else if (options.transport) {
      throw new Error('KeystoneEngine rejects an unclassified legacy Transport; provide Fabric/FabricTransport or explicit TEST/MIGRATION purpose');
    } else {
      throw new Error('KeystoneEngine requires an explicit Fabric or FabricTransport for production network delivery');
    }
    this.transport = this.delivery;
    this.processor = new AICommandProcessor(options.model, this.crypto); this.context = options.context; this.immutableCore = options.immutableCore; this.releaseManifest = options.releaseManifest;
  }
  async start() { if (!this.started) { if (this.immutableCore) { if (!this.releaseManifest) throw new Error('Immutable Core requires a signed release manifest before startup'); const state = await this.immutableCore.bootstrap(this.releaseManifest); if (state.locked) throw new Error('Keystone entered SecurityLockdown during integrity bootstrap'); await this.immutableCore.unlockPrivilegedRuntime(); this.immutableCore.assertPrivileged('P2P_NETWORKING'); } await (this.transport as any).start?.(); this.started = true; } return this; }
  async process(command: string): Promise<ActionPayload> { await this.start(); this.immutableCore?.assertPrivileged('AGENT_EXECUTION'); const nodes = this.context ? await this.context.search(command) : []; return this.processor.process(command, nodes); }
  async stop() { if (this.started) await this.transport.close(); this.started = false; }
}
