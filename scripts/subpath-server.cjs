/* Simulates GitHub Pages project-site serving: dist/ is reachable ONLY under
 * /pdf-studio/ — exactly like user.github.io/pdf-studio/. Run:
 *   node scripts/subpath-server.cjs [port=5198]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '5198', 10);
const PREFIX = '/pdf-studio';
const ROOT = path.join(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};

http
  .createServer((req, res) => {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!url.startsWith(PREFIX)) {
      // GH Pages would 404; redirect for convenience when hitting root
      res.writeHead(302, { Location: PREFIX + '/' });
      res.end();
      return;
    }
    let rel = url.slice(PREFIX.length) || '/';
    let file = path.join(ROOT, rel);
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // SPA fallback like our navigateFallback
      file = path.join(ROOT, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`subpath server: http://localhost:${PORT}${PREFIX}/`));
