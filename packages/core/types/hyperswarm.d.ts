declare module 'hyperswarm' {

  export interface PeerInfo {
    publicKey?: Buffer;
    topics?: Buffer[];
    client?: boolean;
    server?: boolean;
  }

  export interface SwarmConnection extends NodeJS.ReadWriteStream {
    remotePublicKey?: Buffer;
    opened?: boolean;
    once(event: string, handler: (...args: any[]) => void): this;
    removeListener(event: string, handler: (...args: any[]) => void): this;
    unshift(chunk: Buffer): void;
  }

  export interface Discovery {
    flushed(): Promise<void>;
    destroy(): Promise<void>;
  }

  export interface HyperswarmOptions {
    keyPair?: { publicKey: Buffer; secretKey: Buffer };
    maxPeers?: number;
    firewall?: (remotePublicKey: Buffer, payload: unknown) => boolean | Promise<boolean>;
  }

  export default class Hyperswarm {
    constructor(options?: HyperswarmOptions);
    readonly connections: Set<SwarmConnection>;
    join(topic: Buffer, options?: { server?: boolean; client?: boolean; limit?: number }): Discovery;
    joinPeer(publicKey: Buffer): void;
    leavePeer(publicKey: Buffer): void;
    leave(topic: Buffer): Promise<void>;
    flush(): Promise<void>;
    destroy(options?: { force?: boolean }): Promise<void>;
    on(event: 'connection', handler: (connection: SwarmConnection, info: PeerInfo) => void): this;
    on(event: 'update' | 'close', handler: () => void): this;
    on(event: 'error', handler: (error: Error) => void): this;
  }
}
