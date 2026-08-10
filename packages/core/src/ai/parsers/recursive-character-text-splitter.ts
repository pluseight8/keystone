export interface TextChunk { text: string; start: number; end: number; index: number; }
export interface RecursiveCharacterTextSplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: readonly string[];
  lengthFunction?: (text: string) => number;
}

/** LangChain-style recursive splitter. Defaults approximate 1,000 tokens/200 overlap. */
export class RecursiveCharacterTextSplitter {
  private readonly chunkSize: number;
  private readonly overlap: number;
  private readonly separators: readonly string[];
  private readonly length: (text: string) => number;

  constructor(options: RecursiveCharacterTextSplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1_000;
    this.overlap = options.chunkOverlap ?? 200;
    this.separators = options.separators ?? ['\n\n', '\n', '. ', ' ', ''];
    this.length = options.lengthFunction ?? estimateTokens;
    if (this.chunkSize <= 0 || this.overlap < 0 || this.overlap >= this.chunkSize) throw new Error('chunkOverlap must be non-negative and smaller than chunkSize');
  }

  splitText(text: string): TextChunk[] {
    const clean = text.trim(); if (!clean) return [];
    const semantic = this.splitRecursive(clean, 0);
    const chunks: TextChunk[] = []; let pending = '', dirty = false;
    const flush = () => {
      const value = pending.trim(); if (!value) return;
      const searchFrom = chunks.length ? Math.max(0, chunks[chunks.length - 1]!.end - value.length) : 0;
      const start = Math.max(0, clean.indexOf(value, searchFrom));
      chunks.push({ text: value, start, end: start + value.length, index: chunks.length });
      pending = tailByTokens(value, this.overlap);
      dirty = false;
    };
    for (const part of semantic) {
      const candidate = pending ? `${pending}${part}` : part;
      if (pending && this.length(candidate) > this.chunkSize) flush();
      pending += part; dirty = true;
      if (this.length(pending) >= this.chunkSize) flush();
    }
    if (dirty) flush();
    return chunks;
  }

  private splitRecursive(text: string, separatorIndex: number): string[] {
    if (this.length(text) <= this.chunkSize) return [text];
    const separator = this.separators[separatorIndex] ?? '';
    if (!separator) return sliceByTokens(text, this.chunkSize);
    const pieces = text.split(separator).filter(Boolean).map((piece, index, all) => piece + (index < all.length - 1 ? separator : ''));
    if (pieces.length === 1) return this.splitRecursive(text, separatorIndex + 1);
    return pieces.flatMap(piece => this.length(piece) > this.chunkSize ? this.splitRecursive(piece, separatorIndex + 1) : [piece]);
  }
}

export function estimateTokens(text: string): number {
  const words = text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)?.length ?? 0;
  return Math.ceil(words * 1.3);
}

function sliceByTokens(text: string, limit: number): string[] {
  const approximateChars = Math.max(1, Math.floor(limit * 3.5));
  return Array.from({ length: Math.ceil(text.length / approximateChars) }, (_, index) => text.slice(index * approximateChars, (index + 1) * approximateChars));
}

function tailByTokens(text: string, count: number): string {
  if (!count) return '';
  const words = text.match(/\S+\s*/g) ?? [];
  let used = 0, start = words.length;
  while (start > 0 && used < count) { start -= 1; used += estimateTokens(words[start]!); }
  return words.slice(start).join('');
}
