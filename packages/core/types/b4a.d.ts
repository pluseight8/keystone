declare module 'b4a' {
  export function alloc(size: number, fill?: string | number | Uint8Array): Buffer;
  export function allocUnsafe(size: number): Buffer;
  export function byteLength(value: string | Uint8Array, encoding?: BufferEncoding): number;
  export function concat(buffers: readonly Uint8Array[], totalLength?: number): Buffer;
  export function equals(left: Uint8Array, right: Uint8Array): boolean;
  export function from(value: string | ArrayBuffer | SharedArrayBuffer | ArrayLike<number> | Uint8Array, encoding?: BufferEncoding): Buffer;
  export function isBuffer(value: unknown): value is Buffer;
  export function toString(value: Uint8Array, encoding?: BufferEncoding): string;
}
