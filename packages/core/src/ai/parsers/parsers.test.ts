import { describe, expect, it } from 'vitest';
import { DocumentParser, csvToText, looksLikeBinary } from './index.js';
import { RecursiveCharacterTextSplitter, estimateTokens } from './recursive-character-text-splitter.js';

describe('document parsers', () => {
  it('parses quoted CSV and labels values with headers', () => {
    expect(csvToText('name,note\nAda,"hello, world"\nLinus,kernel')).toBe('name: Ada | note: hello, world\nname: Linus | note: kernel');
  });
  it('rejects binary text documents', async () => {
    expect(looksLikeBinary(Uint8Array.from([65, 0, 66]))).toBe(true);
    await expect(new DocumentParser().parse({ path: 'bad.txt', bytes: Uint8Array.from([65, 0, 66]) })).rejects.toThrow('Binary');
  });

  it('passes only a basename to the host PDF boundary', async () => {
    let receivedPath = '';
    const parser = new DocumentParser({ extract: async (_bytes, path) => { receivedPath = path; return 'bounded text'; } });
    await expect(parser.parse({ path: '../../report.pdf', bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]) })).resolves.toMatchObject({ text: 'bounded text' });
    expect(receivedPath).toBe('report.pdf');
  });
});

describe('RecursiveCharacterTextSplitter', () => {
  it('keeps chunks bounded with overlap', () => {
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 30, chunkOverlap: 5 });
    const chunks = splitter.splitText(Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => estimateTokens(chunk.text) <= 35)).toBe(true);
    expect(chunks.at(-1)!.text.split(/\s+/).length).toBeGreaterThan(5);
  });
});
