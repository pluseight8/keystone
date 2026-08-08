declare module 'hyperswarm' {
  export default class Hyperswarm {
    constructor(options?: unknown);
    join(topic: Buffer, options?: { server?: boolean; client?: boolean; limit?: number }): unknown;
    joinPeer(publicKey: Buffer): void;
    leave(topic: Buffer): Promise<void>;
    flush(): Promise<void>;
    destroy(): Promise<void>;
    on(event: string, handler: (...args: any[]) => void): this;
  }
}
declare module 'libsodium-wrappers' {
  const sodium: any;
  export default sodium;
}
declare module 'hyperdht' {
  export default class DHT {
    constructor(options?: unknown);
    static keyPair(seed?: Buffer): { publicKey: Buffer; secretKey: Buffer };
    createServer(onconnection?: (socket: any) => void): any;
    connect(publicKey: Buffer, options?: { relayAddresses?: Array<{host:string;port:number}> }): any;
    destroy(): Promise<void>;
  }
}
