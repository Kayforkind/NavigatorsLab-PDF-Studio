/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' keeps every asset URL relative, so the same dist/ works at a site
// root AND under a GitHub Pages project subpath (/user.github.io/repo/).
const base = process.env.VITE_BASE ?? './';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'maskable-icon.svg'],
      manifest: {
        name: 'PDF Studio — by NavigatorsLab',
        short_name: 'PDF Studio',
        description:
          'Edit PDF text in place, annotate, sign, redact, organize pages, merge and split — all locally in your browser. No uploads, no watermark, no limits.',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: './maskable-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: { cacheName: 'nl-pdf-studio-core' },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
