import { describe, expect, it } from 'vitest';
import { parseThemeManifest, presets } from './index.js';
describe('theme engine', () => { it('parses a safe manifest', () => { const theme = parseThemeManifest({ schema:'keystone.theme.v1', id:'community', name:'Community', version:1, author:'Keystone', license:'MIT', tokens:{ colors:presets.neumorphism.colors } }); expect(theme.name).toBe('Community'); }); it('rejects unsafe manifests', () => { expect(() => parseThemeManifest({ schema:'wrong' })).toThrow(); }); });
