import { defineConfig } from 'vite';

// base './' so the built checker runs from any path: a static host, a CDN,
// a subdirectory, or a file:// copy of the dist folder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: { host: true },
});
