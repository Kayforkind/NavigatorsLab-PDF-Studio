/**
 * Copy the built VitePress docs into dist/docs/ so the Cloudflare worker
 * serves them at /pdf-studio/docs/ (the worker strips the /pdf-studio prefix
 * and maps trailing-slash paths to index.html — no worker change needed).
 *
 * Run after the app build: `npm run build` already chains this via docs:build.
 */
const { rmSync, mkdirSync, cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const src = join(root, 'docs', 'site', '.vitepress', 'dist');
const dest = join(root, 'dist', 'docs');

if (!existsSync(src)) {
  console.error('build-docs: VitePress output not found — run `npx vitepress build docs/site` first.');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`build-docs: copied ${src} -> ${dest}`);
