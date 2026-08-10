/** Fallback declarations for the ESM package; runtime code is supplied by @scure/bip39. */
// @scure/bip39 publishes ESM subpath exports. `moduleResolution: Bundler` in the
// core tsconfig makes TypeScript honor that exports map in web and native builds.
declare module '@scure/bip39' {
  export function generateMnemonic(wordlist: readonly string[], strength?: number): string;
  export function mnemonicToEntropy(mnemonic: string, wordlist: readonly string[]): Uint8Array;
  export function entropyToMnemonic(entropy: Uint8Array, wordlist: readonly string[]): string;
  export function mnemonicToSeed(mnemonic: string, passphrase?: string): Promise<Uint8Array>;
  export function mnemonicToSeedSync(mnemonic: string, passphrase?: string): Uint8Array;
  export function validateMnemonic(mnemonic: string, wordlist: readonly string[]): boolean;
}

declare module '@scure/bip39/wordlists/english' {
  export const wordlist: readonly string[];
}
