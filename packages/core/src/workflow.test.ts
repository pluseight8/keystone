import { describe, expect, it } from 'vitest';
import { KeystoneEngine } from './engine.js';
import { testCrypto, TestLoopbackTransport } from './testing.js';
import type { AIModelAdapter } from './ai.js';

describe('Keystone end-to-end workflow', () => {
  it('routes lunch request through node lookup, P2P and confirmation', async () => {
    const sent: unknown[] = []; const transport = new TestLoopbackTransport(); const original = transport.send.bind(transport); transport.send = async (peerOrEnvelope, envelope?) => { sent.push(envelope ?? peerOrEnvelope); return envelope ? original(peerOrEnvelope as string, envelope) : original(peerOrEnvelope); };
    const model: AIModelAdapter = { kind:'local', async complete() { return { name:'create_node_action', arguments:{ intent:'order_food', targetNodeId:'son', requestedFields:['read_address'], parameters:{recipient:'son'} } }; } };
    const engine = new KeystoneEngine({ model, crypto:testCrypto, transport, legacyTransportPurpose: 'TEST', context:{ async search() { return [{ nodeId:'son',displayName:'Сын',aliases:['сын'],allowedFields:['read_address'] }]; } } });
    const action = await engine.process('Закажи обед сыну'); expect(action.requiresConfirmation).toBe(true);
    await transport.send({ version:1,type:'address_request',id:'1',sender:'self',recipient:'son',nonce:'n',expiresAt:new Date(Date.now()+60_000).toISOString(),body:{fields:['read_address']},signature:'test:self:x' });
    expect(action.targetNodeId).toBe('son'); expect(sent.length).toBe(1);
  });
});
