/**
 * Build dist/index.js as ONE self-contained file.
 *
 * Two dependencies stay external on purpose:
 *  - `pdfjs-dist` — bundling it rewrites `import.meta.url`, and pdf.js then
 *    looks for `pdf.worker.mjs` beside the bundle and fails ("Setting up fake
 *    worker failed"). It is a normal dependency, resolved from node_modules.
 *  - `canvas` — an optional native addon pdf.js only needs for rendering.
 *
 * The banner supplies a real `require` for the CommonJS dependencies that get
 * inlined (pngjs calls `require('util')`), which esbuild's ESM output cannot
 * do on its own.
 */
import { build } from 'esbuild';

const banner = [
  "import { createRequire as __createRequire } from 'node:module';",
  'const require = __createRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['pdfjs-dist', 'canvas'],
  banner: { js: banner },
  logLevel: 'warning',
});

console.log('bundled dist/index.js');
