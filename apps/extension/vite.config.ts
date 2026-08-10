import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({base:'./',build:{outDir:'dist',emptyOutDir:true,rollupOptions:{input:{popup:resolve(__dirname,'popup.html'),background:resolve(__dirname,'src/background.ts')},output:{entryFileNames:'[name].js'}},copyPublicDir:true}});
