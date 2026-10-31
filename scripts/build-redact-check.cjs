/**
 * Copy the built redaction checker into dist/redact-check/ so the worker
 * serves it at /pdf-studio/redact-check/.
 *
 * The worker strips the /pdf-studio prefix and maps a trailing slash to
 * index.html, so dist/redact-check/index.html is all the routing it needs.
 * The checker's assets are relative (base './'), so they resolve under the
 * subpath without any configuration.
 *
 * Run AFTER `vite build` — that command empties dist/.
 */
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const src = join(root, 'packages', 'redact-check', 'dist');
const dest = join(root, 'dist', 'redact-check');

if (!existsSync(src)) {
  console.error(
    'build-redact-check: no build found — run `npm run build -w pdfstudio-redact-check` first.',
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log('copied redact-check -> dist/redact-check');
