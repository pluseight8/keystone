import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  // Shared UI is authored against React Native primitives. Desktop renders the
  // same components through react-native-web; package export conditions alone
  // do not rewrite direct `react-native` imports inside the workspace package.
  resolve: {
    alias: { 'react-native': 'react-native-web' },
    conditions: ['browser', 'import', 'module', 'default'],
  },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true },
});
