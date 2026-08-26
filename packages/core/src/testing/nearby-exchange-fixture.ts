import { AnonymousNearbyTransportProvider, ControlledNearbyNetwork } from '../nearby.js';
import { InMemoryNearbyExchangeStorage, NearbyExchangeService, type NearbyExchangeServiceOptions, type NearbyReceivePolicy } from '../nearby-exchange.js';

export async function pauseNearby(ms = 15): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function eventuallyNearby<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await pauseNearby(15);
    value = await read();
  }
  if (!predicate(value)) throw new Error(`Nearby fixture condition timed out after ${timeoutMs}ms`);
  return value;
}

export async function createNearbyPair(options: {
  readonly mtu?: number;
  readonly maxBytesPerSession?: number;
  readonly bobPolicy?: NearbyReceivePolicy;
  readonly aliceReceive?: boolean;
  readonly aliceOptions?: Omit<NearbyExchangeServiceOptions, 'nearby' | 'storage'>;
  readonly bobOptions?: Omit<NearbyExchangeServiceOptions, 'nearby' | 'storage'>;
} = {}) {
  const network = new ControlledNearbyNetwork();
  const mtu = options.mtu ?? 4 * 1024;
  const aliceProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('fixture-alice'), providerId: 'fixture-nearby-alice', mtu, ...(options.maxBytesPerSession === undefined ? {} : { maxBytesPerSession: options.maxBytesPerSession }) });
  const bobProvider = new AnonymousNearbyTransportProvider({ adapter: network.createAdapter('fixture-bob'), providerId: 'fixture-nearby-bob', mtu, ...(options.maxBytesPerSession === undefined ? {} : { maxBytesPerSession: options.maxBytesPerSession }) });
  const aliceStorage = new InMemoryNearbyExchangeStorage();
  const bobStorage = new InMemoryNearbyExchangeStorage();
  const alice = new NearbyExchangeService({ ...options.aliceOptions, nearby: aliceProvider, storage: aliceStorage, localAlias: options.aliceOptions?.localAlias ?? 'Alice fixture' });
  const bob = new NearbyExchangeService({ ...options.bobOptions, nearby: bobProvider, storage: bobStorage, localAlias: options.bobOptions?.localAlias ?? 'Bob fixture' });
  await bob.startReceive({ policy: options.bobPolicy ?? (options.aliceReceive === false ? 'NOT_ACCEPTING' : 'ASK_EVERY_TIME'), alias: 'Bob fixture' });
  await alice.start();
  await pauseNearby();
  await alice.refreshDiscovery();
  await pauseNearby();
  return {
    alice,
    bob,
    aliceProvider,
    bobProvider,
    aliceStorage,
    bobStorage,
    network,
    async close(): Promise<void> {
      await alice.close();
      await bob.close();
    },
  };
}
