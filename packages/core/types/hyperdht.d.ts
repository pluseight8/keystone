declare module 'hyperdht' {

  export interface KeyPair { publicKey: Buffer; secretKey: Buffer }
  export interface RelayAddress { host: string; port: number }
  export interface ConnectOptions {
    keyPair?: KeyPair;
    relayAddresses?: RelayAddress[];
  }
  export interface RelaySocket extends NodeJS.ReadWriteStream {
    opened: boolean;
    remotePublicKey?: Buffer;
    once(event: string, handler: (...args: any[]) => void): this;
    removeListener(event: string, handler: (...args: any[]) => void): this;
    unshift(chunk: Buffer): void;
  }
  export interface DHTServer {
    listen(keyPair?: KeyPair): Promise<void>;
    close(): Promise<void>;
    on(event: 'connection', handler: (socket: RelaySocket) => void): this;
    on(event: 'error', handler: (error: Error) => void): this;
  }

  export default class DHT {
    constructor(options?: { keyPair?: KeyPair; bootstrap?: Array<{ host: string; port: number } | string> });
    static keyPair(seed?: Buffer): KeyPair;
    static bootstrapper(port: number, host?: string): DHT;
    createServer(onconnection?: (socket: RelaySocket) => void): DHTServer;
    connect(publicKey: Buffer, options?: ConnectOptions): RelaySocket;
    destroy(): Promise<void>;
  }
}
