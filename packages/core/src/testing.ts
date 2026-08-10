import type { CryptoProvider } from './crypto.js';
import type { Envelope, Transport } from './transport.js';
import type { NodeId } from './types.js';

/** Insecure helpers intentionally excluded from the package's public exports. */
export const testCrypto: CryptoProvider = {
  async hash(value) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''); },
  async sign(value, key) { return `test:${key}:${value}`; },
  async verify(value, signature, key) { return signature === `test:${key}:${value}`; },
  async randomNonce() { return crypto.randomUUID(); },
};
export class TestLoopbackTransport implements Transport {
  private listeners = new Set<(envelope: Envelope) => void>();
  async connect(_peer: NodeId) {}
  async send(peerOrEnvelope: NodeId | Envelope, envelope?: Envelope) { this.listeners.forEach(listener => listener(envelope ?? peerOrEnvelope as Envelope)); }
  onMessage(handler: (envelope: Envelope) => void) { this.listeners.add(handler); return () => this.listeners.delete(handler); }
  isPeerConnected(_peer: NodeId) { return true; }
  async close() { this.listeners.clear(); }
}
