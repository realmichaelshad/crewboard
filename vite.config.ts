import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: { port: 5312, strictPort: true },
  preview: { port: 5312, strictPort: true },
  resolve: {
    alias: {
      '@fontsource': fileURLToPath(new URL('./node_modules/@fontsource', import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
