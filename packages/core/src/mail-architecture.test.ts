import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAIL_MAX_ACCOUNTS, MAIL_MAX_MESSAGES, MailService } from './mail.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('R0P83 mail architecture guards', () => {
  it('keeps external mail provider transport outside ConnectivityFabric and generic gateway code', () => {
    const source = readFileSync(join(here, 'mail.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/connectivity\.js['"]/);
    expect(source).not.toMatch(/from ['"]\.\/gateway\.js['"]/);
    expect(source).not.toMatch(/from ['"]@keystone\/native-host['"]/);
    expect(source).not.toMatch(/(?:^|\n)\s*import\s+[^;]*(?:hyperswarm|hyperdht|fabric|transport)/i);
    expect(source).not.toMatch(/(?:import|from|new|route|proxy)\s+[^\n;]*ConnectivityFabric/i);
    expect(source).not.toMatch(/\bLEGACY_BYPASS\b|\bautoContact\b|contact\.create/i);
    expect(source).not.toMatch(/navigator\.geolocation|globalThis\.location/i);
  });

  it('keeps mail local-first, bounded, and explicit about privacy-sensitive actions', () => {
    const source = readFileSync(join(here, 'mail.ts'), 'utf8');
    expect(source).toContain('MAIL_MAX_ACCOUNTS = 20');
    expect(source).toContain('MAIL_MAX_MESSAGES = 100_000');
    expect(source).toContain('BLOCK_BY_DEFAULT');
    expect(source).toContain('explicit owner action');
    expect(source).toContain('readForScopedAdapter');
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/console\.(log|error|warn)\s*\(/);
    expect(source).not.toMatch(/<script[^>]*src|<iframe/i);
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/\bBcc\s*:/);
    expect(source).not.toMatch(/readReceipt\s*:/i);
    expect(MAIL_MAX_ACCOUNTS).toBe(20);
    expect(MAIL_MAX_MESSAGES).toBe(100_000);
    expect(MailService).toBeDefined();
  });

  it('does not make contacts, AI or remote peers authoritative over external mail', () => {
    const source = readFileSync(join(here, 'mail.ts'), 'utf8');
    expect(source).not.toMatch(/createContact|importContacts|syncContacts/i);
    expect(source).not.toMatch(/agent|plugin.*send|remote.*instruction/i);
    expect(source).not.toMatch(/(?:create|provision|authenticate)\s+(?:a\s+)?Keystone account|central mailbox API|central relay API/i);
  });
});
