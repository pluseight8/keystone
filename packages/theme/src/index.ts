/**
 * Keystone Signature Design Language.
 *
 * This package intentionally has no theme loader, manifest parser, presets or
 * runtime switching API. Every host consumes this one immutable token set.
 */
export const COLORS = {
  background: '#000000',
  surface: '#121212',
  surfaceRaised: '#1a1a1a',
  text: '#f5f5f5',
  muted: '#a3a3a3',
  accent: '#990000',
  accentStrong: '#b30000',
  accentSoft: '#3d0000',
  border: '#2a2a2a',
  critical: '#b30000',
  onAccent: '#ffffff',
} as const;

export const RADII = { sm: 2, md: 3, lg: 4 } as const;

export const MOTION = {
  durationInstant: 0,
  durationFast: 90,
  easing: 'linear',
} as const;

export interface ThemeTokens {
  readonly name: 'Keystone Signature';
  readonly version: 1;
  readonly colors: typeof COLORS;
  readonly radii: typeof RADII;
  readonly shadows: { readonly accent: string; readonly none: 'none' };
  readonly motion: typeof MOTION;
}

export const tokens: ThemeTokens = Object.freeze({
  name: 'Keystone Signature',
  version: 1,
  colors: COLORS,
  radii: RADII,
  shadows: {
    accent: '0 0 14px rgba(153, 0, 0, 0.28)',
    none: 'none' as const,
  },
  motion: MOTION,
});

export default tokens;
