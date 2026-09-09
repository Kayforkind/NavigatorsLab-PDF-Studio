/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Copy pdf.js support files FLAT into dist (vite-plugin-static-copy nests
 * source paths on this version, which breaks the cMapUrl/stdFontUrl bases). */
function flatCopyPlugin() {
  const pairs = [
    { from: 'node_modules/pdfjs-dist/cmaps', to: 'cmaps' },
    { from: 'node_modules/pdfjs-dist/standard_fonts', to: 'standard_fonts' },
  ];
  return {
    name: 'flat-copy-pdfjs-assets',
    apply: 'build' as const,
    closeBundle() {
      for (const { from, to } of pairs) {
        const destDir = join('dist', to);
        mkdirSync(destDir, { recursive: true });
        for (const f of readdirSync(from)) cpSync(join(from, f), join(destDir, f));
      }
    },
  };
}

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
        // never precache the multi-MB OCR engine — it is runtime-cached on
        // first use instead (see navigateFallback + globIgnores below)
        globIgnores: ['tess/**', 'tessdata/**', 'cmaps/**', 'standard_fonts/**'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            // OCR engine assets: cache-first (immutable per release)
            urlPattern: /\/(tess|tessdata)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nl-pdf-studio-ocr-engine',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // pdf.js cmaps + standard font data: cache-first, small
            urlPattern: /\/(cmaps|standard_fonts)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nl-pdf-studio-pdfrs',
              expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin,
            handler: 'NetworkFirst',
            options: { cacheName: 'nl-pdf-studio-core' },
          },
        ],
      },
    }),
    // pdf.js auxiliary resources: without these, documents using CJK cmaps
    // or the 14 standard fonts render blank pages and extract no text.
    flatCopyPlugin(),
  ],
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
