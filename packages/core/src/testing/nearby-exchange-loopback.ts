import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import type { NearbyDutyCycle, NearbyLinkAdapter, NearbyLinkCapabilities, NearbyLinkChannel, NearbyLinkObservation, NearbyEndpointToken } from '../nearby.js';

const MAGIC = Buffer.from('K85', 'ascii');
const ADVERTISEMENT_BYTES = 24;
const MAX_FRAME_BYTES = 256 * 1024;

export interface LoopbackNearbyPeerAddress {
  readonly host: string;
  readonly tcpPort: number;
  readonly udpPort: number;
}

class LoopbackChannel implements NearbyLinkChannel {
  readonly id = crypto.randomUUID();
  readonly openedAt = new Date().toISOString();
  readonly maxWriteBytes = MAX_FRAME_BYTES;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private readonly byteListeners = new Set<(bytes: Uint8Array) => void | Promise<void>>();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly socket: Socket, readonly endpointToken: NearbyEndpointToken, private readonly record: (direction: 'send' | 'receive', bytes: Uint8Array) => void) {
    socket.setNoDelay(true);
    socket.on('data', value => { this.record('receive', new Uint8Array(value)); this.receive(value); });
    socket.on('close', () => this.finishClose());
    socket.on('error', () => this.finishClose());
  }

  async send(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Loopback nearby channel is closed');
    if (bytes.byteLength > MAX_FRAME_BYTES) throw new Error('Loopback nearby frame exceeds bound');
    const frame = Buffer.allocUnsafe(4 + bytes.byteLength);
    frame.writeUInt32BE(bytes.byteLength, 0); Buffer.from(bytes).copy(frame, 4); this.record('send', new Uint8Array(frame));
    await new Promise<void>((resolve, reject) => { this.socket.write(frame, error => error ? reject(error) : resolve()); });
  }

  onBytes(handler: (bytes: Uint8Array) => void | Promise<void>): () => void { this.byteListeners.add(handler); return () => this.byteListeners.delete(handler); }
  onClose(handler: () => void): () => void { this.closeListeners.add(handler); return () => this.closeListeners.delete(handler); }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; this.socket.end(); this.finishClose(); }

  private receive(value: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, value]);
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length < 1 || length > MAX_FRAME_BYTES) { this.socket.destroy(); return; }
      if (this.buffer.byteLength < 4 + length) return;
      const frame = new Uint8Array(this.buffer.subarray(4, 4 + length)); this.buffer = this.buffer.subarray(4 + length);
      for (const listener of [...this.byteListeners]) void Promise.resolve(listener(frame)).catch(() => this.socket.destroy());
    }
  }

  private finishClose(): void { if (!this.closed) this.closed = true; for (const listener of [...this.closeListeners]) listener(); this.closeListeners.clear(); }
}

/** A localhost socket adapter used only by the multi-process hybrid proof.
 * It exercises the real R0P68 provider/session crypto and R0P85 exchange while
 * remaining clearly distinct from physical Bluetooth evidence. */
export class LoopbackNearbyLinkAdapter implements NearbyLinkAdapter {
  readonly kind = 'CONTROLLED_NEARBY' as const;
  private readonly channels = new Set<LoopbackChannel>();
  private readonly incoming = new Set<(channel: NearbyLinkChannel) => void | Promise<void>>();
  private readonly transcripts: Uint8Array[] = [];
  private server?: Server;
  private scanner?: UdpSocket;
  private advertiser?: UdpSocket;
  private advertisement?: Uint8Array;
  private advertisingTimer?: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(private readonly local: LoopbackNearbyPeerAddress, private readonly remote: LoopbackNearbyPeerAddress) {}

  async capabilities(): Promise<NearbyLinkCapabilities> {
    return { availability: 'AVAILABLE', scanning: true, advertising: true, sessions: true, maxAdvertisementBytes: ADVERTISEMENT_BYTES, maxWriteBytes: MAX_FRAME_BYTES, phys: ['UNKNOWN'], evidence: 'IMPLEMENTED', limitation: 'localhost loopback proof is not physical BLE evidence' };
  }

  async startAdvertising(advertisement: Uint8Array, _duty: NearbyDutyCycle): Promise<void> {
    this.advertisement = new Uint8Array(advertisement);
    this.advertiser = createSocket('udp4');
    await new Promise<void>((resolve, reject) => { this.advertiser!.once('error', reject); this.advertiser!.bind(() => { this.advertiser!.removeListener('error', reject); resolve(); }); });
    await this.ensureServer();
    await this.sendAdvertisement();
    this.advertisingTimer = setInterval(() => { void this.sendAdvertisement(); }, 250);
    this.advertisingTimer.unref?.();
  }

  async updateAdvertisement(advertisement: Uint8Array, duty: NearbyDutyCycle): Promise<void> { await this.stopAdvertising(); await this.startAdvertising(advertisement, duty); }

  async stopAdvertising(): Promise<void> {
    if (this.advertisingTimer) clearInterval(this.advertisingTimer); this.advertisingTimer = undefined;
    this.advertiser?.close(); this.advertiser = undefined; this.advertisement = undefined;
  }

  async startScanning(_duty: NearbyDutyCycle, onObservation: (observation: NearbyLinkObservation) => void | Promise<void>): Promise<void> {
    this.scanner = createSocket('udp4');
    this.scanner.on('message', (message, remote) => {
      if (message.byteLength !== MAGIC.byteLength + 2 + ADVERTISEMENT_BYTES || !message.subarray(0, MAGIC.byteLength).equals(MAGIC)) return;
      const tcpPort = message.readUInt16BE(MAGIC.byteLength); const advertisement = new Uint8Array(message.subarray(MAGIC.byteLength + 2));
      void onObservation({ endpointToken: `${remote.address}:${tcpPort}` as NearbyEndpointToken, advertisement, observedAt: new Date().toISOString(), signalQuality: 'UNKNOWN', phy: 'UNKNOWN' });
    });
    await new Promise<void>((resolve, reject) => { this.scanner!.once('error', reject); this.scanner!.bind(this.local.udpPort, this.local.host, () => { this.scanner!.removeListener('error', reject); resolve(); }); });
  }

  async stopScanning(): Promise<void> { this.scanner?.close(); this.scanner = undefined; }
  onIncomingChannel(handler: (channel: NearbyLinkChannel) => void | Promise<void>): () => void { this.incoming.add(handler); return () => this.incoming.delete(handler); }

  async openChannel(endpointToken: NearbyEndpointToken): Promise<NearbyLinkChannel> {
    const separator = endpointToken.lastIndexOf(':'); const host = endpointToken.slice(0, separator); const port = Number(endpointToken.slice(separator + 1));
    if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('Loopback nearby endpoint token is invalid');
    const socket = await new Promise<Socket>((resolve, reject) => { const value = createConnection({ host, port }); value.once('connect', () => resolve(value)); value.once('error', reject); });
    const channel = this.channel(socket, endpointToken); return channel;
  }

  async stop(): Promise<void> {
    if (this.closed) return; this.closed = true;
    if (this.advertisingTimer) clearInterval(this.advertisingTimer); this.advertisingTimer = undefined;
    this.advertiser?.close(); this.advertiser = undefined; this.scanner?.close(); this.scanner = undefined;
    for (const channel of [...this.channels]) await channel.close();
    await new Promise<void>(resolve => { if (!this.server) return resolve(); this.server.close(() => resolve()); this.server = undefined; });
    this.incoming.clear();
  }

  transcript(): readonly Uint8Array[] { return this.transcripts.map(value => new Uint8Array(value)); }

  private async ensureServer(): Promise<void> {
    if (this.server) return;
    this.server = createServer(socket => { const channel = this.channel(socket, 'loopback-incoming' as NearbyEndpointToken); for (const listener of [...this.incoming]) void Promise.resolve(listener(channel)).catch(() => { void channel.close(); }); });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.local.tcpPort, this.local.host, () => { this.server!.removeListener('error', reject); resolve(); }); });
  }

  private channel(socket: Socket, endpointToken: NearbyEndpointToken): LoopbackChannel {
    const channel = new LoopbackChannel(socket, endpointToken, (_direction, bytes) => { this.transcripts.push(bytes); while (this.transcripts.length > 2_048) this.transcripts.shift(); });
    this.channels.add(channel); channel.onClose(() => this.channels.delete(channel)); return channel;
  }

  private async sendAdvertisement(): Promise<void> {
    if (!this.advertiser || !this.advertisement || this.closed) return;
    const packet = Buffer.alloc(MAGIC.byteLength + 2 + this.advertisement.byteLength); MAGIC.copy(packet, 0); packet.writeUInt16BE(this.local.tcpPort, MAGIC.byteLength); Buffer.from(this.advertisement).copy(packet, MAGIC.byteLength + 2);
    await new Promise<void>(resolve => { this.advertiser!.send(packet, this.remote.udpPort, this.remote.host, () => resolve()); });
  }
}
