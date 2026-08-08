import { AICommandProcessor, type AIModelAdapter, type ActionPayload, type TrustedNode } from './ai.js';
import { SodiumCryptoProvider, type CryptoProvider } from './crypto.js';
import { HyperswarmTransport, type Transport } from './transport.js';

export interface ContextManager { search(query: string): Promise<TrustedNode[]>; }
export interface KeystoneEngineOptions { model: AIModelAdapter; publicKey?: Uint8Array; transport?: Transport; crypto?: CryptoProvider; context?: ContextManager; }
export class KeystoneEngine {
  readonly crypto: CryptoProvider; readonly transport: Transport; readonly processor: AICommandProcessor; readonly context?: ContextManager;
  private started = false;
  constructor(options: KeystoneEngineOptions) { this.crypto = options.crypto ?? new SodiumCryptoProvider(); this.transport = options.transport ?? new HyperswarmTransport(options.publicKey ?? new Uint8Array(32)); this.processor = new AICommandProcessor(options.model, this.crypto); this.context = options.context; }
  async start() { if (!this.started) { await (this.transport as any).start?.(); this.started = true; } return this; }
  async process(command: string): Promise<ActionPayload> { await this.start(); const nodes = this.context ? await this.context.search(command) : []; return this.processor.process(command, nodes); }
  async stop() { if (this.started) await this.transport.close(); this.started = false; }
}
