import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { sourceLocPlugin } from './vite-source-loc';

const root = path.dirname(fileURLToPath(import.meta.url));

/** 默认可读构建（不 minify）；正式压缩设 MCP_APP_DEV=0（只影响压缩 / sourcemap，与预览壳无关） */
const readable = process.env.MCP_APP_DEV !== '0' && process.env.MCP_APP_DEV !== 'false';

export default defineConfig({
  root: path.join(root, 'ui'),
  plugins: [sourceLocPlugin(readable), react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.join(root, 'ui', 'src'),
    },
  },
  build: {
    outDir: path.join(root, 'ui', 'dist'),
    emptyOutDir: readable ? false : true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    minify: readable ? false : 'esbuild',
    sourcemap: readable ? 'inline' : false,
  },
  esbuild: readable
    ? {
        keepNames: true,
      }
    : undefined,
});
